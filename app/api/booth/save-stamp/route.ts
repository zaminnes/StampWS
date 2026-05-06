import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, randomId } from "@/lib/crypto";
import { updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function validateStampImage(dataUrl: string) {
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    throw new HttpError(400, "도장 이미지는 PNG/JPEG/WebP data URL이어야 합니다.");
  }
  if (dataUrl.length > 350_000) {
    throw new HttpError(413, "도장 이미지가 너무 큽니다. 작은 캔버스로 저장하세요.");
  }
  return dataUrl;
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 400_000);
    const current = await requireRole(request, ["boothAdmin"]);
    rateLimit(`stamp-design:${current.account.id}`, 20, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { imageDataUrl?: string };
    const imageDataUrl = validateStampImage(body.imageDataUrl || "");

    await updateDb(async (db) => {
      const account = db.accounts.find((item) => item.id === current.account.id);
      if (!account?.boothId) throw new HttpError(403, "담당 부스가 없습니다.");
      const booth = db.booths.find((item) => item.id === account.boothId);
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
