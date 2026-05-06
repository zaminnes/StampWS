import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, randomId } from "@/lib/crypto";
import { readDb, updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function shortHash(value: string) {
  return value.slice(0, 10);
}

function metadataText(metadata?: Record<string, string | number | boolean | null>) {
  if (!metadata) return "";
  return Object.entries(metadata)
    .map(([key, value]) => `${key}:${value ?? "-"}`)
    .join(" · ")
    .slice(0, 180);
}

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["superAdmin"]);
    const db = await readDb();
    const loginEvents = db.loginEvents
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 180)
      .map((event) => ({
        id: event.id,
        loginId: event.loginId,
        displayName: event.displayName || "-",
        role: event.role || "-",
        result: event.result,
        reason: event.reason || "",
        deviceShort: shortHash(event.deviceHash),
        userAgentSummary: event.userAgentSummary,
        createdAt: event.createdAt
      }));

    const activityEvents = db.auditLogs
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 180)
      .map((event) => {
        const actor = db.accounts.find((account) => account.id === event.actorAccountId);
        return {
          id: event.id,
          actorDisplayName: actor?.displayName || "알 수 없음",
          actorLoginId: actor?.loginId || "-",
          action: event.action,
          targetId: event.targetId || "",
          detail: metadataText(event.metadata),
          createdAt: event.createdAt
        };
      });

    const deviceBlocks = db.deviceBlocks
      .slice()
      .sort((a, b) => Number(b.active) - Number(a.active) || b.createdAt.localeCompare(a.createdAt))
      .map((block) => ({
        id: block.id,
        deviceShort: shortHash(block.deviceHash),
        reason: block.reason,
        loginIds: block.loginIds,
        active: block.active,
        createdAt: block.createdAt,
        releasedAt: block.releasedAt
      }));

    return jsonOk({ loginEvents, activityEvents, deviceBlocks });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireRole(request, ["superAdmin"]);
    rateLimit(`admin-security:${current.account.id}`, 80, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { blockId?: string };
    const blockId = body.blockId || "";

    await updateDb(async (db) => {
      const block = db.deviceBlocks.find((item) => item.id === blockId);
      if (!block) throw new HttpError(404, "차단 기록을 찾을 수 없습니다.");
      if (!block.active) return;
      const now = new Date().toISOString();
      block.active = false;
      block.releasedAt = now;
      block.releasedByAccountId = current.account.id;
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: current.account.id,
        action: "admin.deviceBlock.release",
        targetId: block.id,
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: {
          device: shortHash(block.deviceHash),
          loginIds: block.loginIds.join(",")
        }
      });
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
