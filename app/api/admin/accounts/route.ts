import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, hashPassword, randomId, validatePassword } from "@/lib/crypto";
import { readDb, updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function accountTargetName(account: { boothId?: string; rewardId?: string }, db: Awaited<ReturnType<typeof readDb>>) {
  const booth = account.boothId ? db.booths.find((item) => item.id === account.boothId) : undefined;
  const reward = account.rewardId ? db.rewards.find((item) => item.id === account.rewardId) : undefined;
  if (booth && reward) return `${reward.clubName} 통합`;
  return booth?.name || (reward ? `${reward.clubName} - ${reward.name}` : "-");
}

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["superAdmin"]);
    const db = await readDb();
    const accounts = db.accounts
      .slice()
      .sort((a, b) => {
        if (a.role !== b.role) return a.role.localeCompare(b.role);
        return a.createdAt.localeCompare(b.createdAt);
      })
      .map((account) => ({
        id: account.id,
        loginId: account.loginId,
        displayName: account.displayName,
        studentCode: account.studentCode,
        role: account.role,
        targetName: accountTargetName(account, db),
        disabled: account.disabled,
        createdAt: account.createdAt,
        lastLoginAt: account.lastLoginAt
      }));

    return jsonOk({ accounts });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireRole(request, ["superAdmin"]);
    rateLimit(`admin-account:${current.account.id}`, 20, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { accountId?: string; password?: string };
    const accountId = body.accountId || "";
    validatePassword(body.password || "");

    await updateDb(async (db) => {
      const target = db.accounts.find((item) => item.id === accountId);
      if (!target || target.disabled) throw new HttpError(404, "계정을 찾을 수 없습니다.");
      target.passwordHash = await hashPassword(body.password || "");
      target.qrVersion += target.role === "participant" ? 1 : 0;
      db.sessions.forEach((session) => {
        if (session.accountId === target.id) session.revoked = true;
      });
      const now = new Date().toISOString();
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: current.account.id,
        action: "admin.account.passwordReset",
        targetId: target.id,
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: {
          role: target.role,
          loginId: target.loginId
        }
      });
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
