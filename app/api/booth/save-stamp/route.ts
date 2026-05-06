import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { boothForAccount } from "@/lib/booth-access";
import { clientFingerprint, hashFingerprint, randomId } from "@/lib/crypto";
import { updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { validateStampImage } from "@/lib/stamp-image";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 400_000);
    const current = await requireRole(request, ["boothAdmin"]);
    rateLimit(`stamp-design:${current.account.id}`, 20, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { boothId?: string; imageDataUrl?: string };
    const imageDataUrl = validateStampImage(body.imageDataUrl || "");

    await updateDb(async (db) => {
      const account = db.accounts.find((item) => item.id === current.account.id);
      if (!account) throw new HttpError(401, "계정을 찾을 수 없습니다.");
      const booth = boothForAccount(account, db, body.boothId || account.boothId);
      if (!booth || !booth.active) throw new HttpError(404, "부스를 찾을 수 없습니다.");

      const now = new Date().toISOString();
      booth.stampImageDataUrl = imageDataUrl;
      booth.stampDesignUpdatedAt = now;
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: account.id,
        action: "booth.stampDesign.save",
        targetId: booth.id,
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent)
      });
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
