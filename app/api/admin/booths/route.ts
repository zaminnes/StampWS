import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { boothForAccount } from "@/lib/booth-access";
import { clientFingerprint, hashFingerprint, randomId } from "@/lib/crypto";
import { updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function sanitizeBoothName(value: string) {
  const cleaned = value.normalize("NFKC").replace(/[<>{}[\]"'`\\]/g, "").replace(/\s+/g, " ").trim();
  const length = Array.from(cleaned).length;
  if (length < 2 || length > 28) {
    throw new HttpError(400, "부스 이름은 2~28자로 입력하세요.");
  }
  return cleaned;
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireRole(request, ["superAdmin", "boothAdmin"]);
    rateLimit(`admin-booth:${current.account.id}`, 40, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { boothId?: string; name?: string };
    const name = sanitizeBoothName(body.name || "");
    if (!body.boothId && current.account.role === "superAdmin") throw new HttpError(400, "부스를 선택하세요.");

    await updateDb(async (db) => {
      const actor = db.accounts.find((item) => item.id === current.account.id);
      if (!actor || actor.disabled) throw new HttpError(401, "계정을 찾을 수 없습니다.");
      const booth = actor.role === "superAdmin"
        ? db.booths.find((item) => item.id === body.boothId)
        : boothForAccount(actor, db, body.boothId || actor.boothId);
      if (!booth) throw new HttpError(404, "부스를 찾을 수 없습니다.");
      const oldName = booth.name;
      booth.name = name;
      const now = new Date().toISOString();
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: current.account.id,
        action: "admin.booth.rename",
        targetId: booth.id,
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: { oldName, newName: name }
      });
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
