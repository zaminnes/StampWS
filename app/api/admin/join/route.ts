import { NextRequest } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import { clubIdFromBoothId } from "@/lib/booth-access";
import {
  clientFingerprint,
  hashFingerprint,
  hashPassword,
  hashToken,
  normalizeInviteCode,
  normalizeLoginId,
  randomId,
  sanitizeDisplayName,
  validateLoginId,
  validatePassword
} from "@/lib/crypto";
import { updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function isReusableClubInvite(role?: string) {
  return role === "boothAdmin" || role === "rewardAdmin";
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const { ip, userAgent } = clientFingerprint(request.headers);
    rateLimit(`admin-join:${ip}`, 60, 10 * 60 * 1000);

    const body = (await request.json()) as {
      loginId?: string;
      password?: string;
      displayName?: string;
      inviteCode?: string;
    };
    const loginIdLower = validateLoginId(body.loginId || "");
    validatePassword(body.password || "");
    const displayName = sanitizeDisplayName(body.displayName || "");
    const inviteCodeHash = await hashToken(normalizeInviteCode(body.inviteCode || ""));
    const now = new Date().toISOString();

    const account = await updateDb(async (db) => {
      if (db.accounts.some((item) => item.loginIdLower === loginIdLower)) {
        throw new HttpError(409, "이미 사용 중인 아이디입니다.");
      }

      const invite = db.adminInviteCodes.find((item) => item.codeHash === inviteCodeHash);
      if (!invite || invite.revoked) {
        throw new HttpError(403, "관리자 가입번호가 올바르지 않거나 비활성화되었습니다.");
      }
      if (!isReusableClubInvite(invite.role) && invite.used) {
        throw new HttpError(403, "총괄 관리자 가입번호는 이미 사용되었습니다.");
      }

      const newAccount = {
        id: randomId("acc"),
        loginId: normalizeLoginId(body.loginId || ""),
        loginIdLower,
        passwordHash: await hashPassword(body.password || ""),
        role: invite.role,
        displayName,
        boothId: invite.boothId,
        rewardId: invite.rewardId,
        qrVersion: 1,
        disabled: false,
        createdAt: now
      };

      db.accounts.push(newAccount);
      const previousUseCount = invite.usedCount || (invite.used ? 1 : 0);
      invite.used = true;
      invite.usedByAccountId = newAccount.id;
      invite.usedAt = now;
      invite.usedCount = previousUseCount + 1;

      if (invite.boothId) {
        const clubId = clubIdFromBoothId(invite.boothId);
        const booths = db.booths.filter((item) => clubIdFromBoothId(item.id) === clubId);
        for (const booth of booths) {
          if (!booth.adminAccountIds.includes(newAccount.id)) {
            booth.adminAccountIds.push(newAccount.id);
          }
        }
      }

      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: newAccount.id,
        action: "admin.join",
        targetId: invite.id,
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: {
          codeLabel: invite.codeLabel,
          role: invite.role,
          boothId: invite.boothId || null,
          rewardId: invite.rewardId || null
        }
      });

      return newAccount;
    });

    const { session, token } = await createSession(account, request);
    const response = jsonOk({ ok: true });
    setSessionCookie(response, session.id, token);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
