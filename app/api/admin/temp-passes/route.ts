import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { clientFingerprint, createTempPassQrToken, hashFingerprint, randomId, sanitizeDisplayName } from "@/lib/crypto";
import { readDb, updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import type { TempPass } from "@/lib/types";

export const runtime = "nodejs";

function nextTempLabel(passes: TempPass[], offset: number) {
  const maxNumber = passes.reduce((max, pass) => {
    const match = /^TMP-(\d+)$/.exec(pass.label);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `TMP-${String(maxNumber + offset).padStart(3, "0")}`;
}

async function tempPassView(pass: TempPass) {
  return {
    id: pass.id,
    label: pass.label,
    displayName: pass.displayName || pass.label,
    status: pass.status,
    stampCount: pass.stamps.length,
    createdAt: pass.createdAt,
    redeemedAt: pass.redeemedAt,
    redeemedRewardId: pass.redeemedRewardId,
    qrToken: pass.status === "active" ? await createTempPassQrToken(pass.id, pass.qrVersion) : null
  };
}

async function listTempPasses(passes: TempPass[]) {
  const rows = passes
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 120);
  return Promise.all(rows.map(tempPassView));
}

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["superAdmin"]);
    const db = await readDb();
    return jsonOk({ passes: await listTempPasses(db.tempPasses) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 2048);
    const current = await requireRole(request, ["superAdmin"]);
    rateLimit(`temp-pass-create:${current.account.id}`, 10, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { count?: number; displayNames?: string; displayName?: string };
    const names = (body.displayNames || body.displayName || "")
      .split(/\n|,/)
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => sanitizeDisplayName(name));
    const count = names.length > 0 ? names.length : Math.floor(Number(body.count || 1));
    if (!Number.isInteger(count) || count < 1 || count > 40) {
      throw new HttpError(400, "1~40개만 생성할 수 있습니다.");
    }

    const created = await updateDb(async (db) => {
      const actor = db.accounts.find((item) => item.id === current.account.id);
      if (!actor || actor.disabled || actor.role !== "superAdmin") {
        throw new HttpError(403, "최고관리자만 생성할 수 있습니다.");
      }

      const now = new Date().toISOString();
      const newPasses: TempPass[] = Array.from({ length: count }, (_, index) => ({
        id: randomId("tmp"),
        label: nextTempLabel(db.tempPasses, index + 1),
        displayName: names[index] || nextTempLabel(db.tempPasses, index + 1),
        qrVersion: 1,
        status: "active",
        stamps: [],
        issuedByAccountId: actor.id,
        createdAt: now
      }));

      db.tempPasses.push(...newPasses);
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: actor.id,
        action: "tempPass.create",
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: {
          count,
          firstLabel: newPasses[0]?.label || null,
          lastLabel: newPasses[newPasses.length - 1]?.label || null
        }
      });

      return newPasses;
    });

    return jsonOk({ passes: await listTempPasses(created), created: await Promise.all(created.map(tempPassView)) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 2048);
    const current = await requireRole(request, ["superAdmin"]);
    rateLimit(`temp-pass-delete:${current.account.id}`, 20, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { passId?: string; confirmLabel?: string };

    await updateDb(async (db) => {
      const pass = db.tempPasses.find((item) => item.id === body.passId);
      if (!pass) throw new HttpError(404, "임시 QR을 찾을 수 없습니다.");
      if ((body.confirmLabel || "").trim() !== pass.label) {
        throw new HttpError(400, `${pass.label}을 정확히 입력해야 삭제됩니다.`);
      }
      db.tempPasses = db.tempPasses.filter((item) => item.id !== pass.id);
      const now = new Date().toISOString();
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: current.account.id,
        action: "tempPass.delete",
        targetId: pass.id,
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: {
          label: pass.label,
          status: pass.status,
          stampCount: pass.stamps.length
        }
      });
    });

    const db = await readDb();
    return jsonOk({ ok: true, passes: await listTempPasses(db.tempPasses) });
  } catch (error) {
    return jsonError(error);
  }
}
