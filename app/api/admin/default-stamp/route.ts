import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, randomId } from "@/lib/crypto";
import { updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { validateStampImage } from "@/lib/stamp-image";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 400_000);
    const current = await requireRole(request, ["superAdmin"]);
    rateLimit(`default-stamp:${current.account.id}`, 12, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { imageDataUrl?: string };
    const imageDataUrl = validateStampImage(body.imageDataUrl || "");

    await updateDb(async (db) => {
      const now = new Date().toISOString();
      db.meta.defaultStampImageDataUrl = imageDataUrl;
      db.meta.defaultStampUpdatedAt = now;
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: current.account.id,
        action: "admin.defaultStamp.save",
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
