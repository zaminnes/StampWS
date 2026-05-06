import { NextRequest } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import { hashFingerprint, hashPassword, normalizeLoginId, randomId, sanitizeDisplayName, validateLoginId, validatePassword, clientFingerprint } from "@/lib/crypto";
import { updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const { ip, userAgent } = clientFingerprint(request.headers);
    rateLimit(`register:${ip}`, 8, 10 * 60 * 1000);

    const body = (await request.json()) as { loginId?: string; password?: string; displayName?: string };
    const loginIdLower = validateLoginId(body.loginId || "");
    validatePassword(body.password || "");
    const displayName = sanitizeDisplayName(body.displayName || "");
    const now = new Date().toISOString();

    const account = await updateDb(async (db) => {
      if (db.accounts.some((item) => item.loginIdLower === loginIdLower)) {
        throw new HttpError(409, "이미 사용 중인 아이디입니다.");
      }

      const newAccount = {
        id: randomId("acc"),
        loginId: normalizeLoginId(body.loginId || ""),
        loginIdLower,
        passwordHash: await hashPassword(body.password || ""),
        role: "participant" as const,
        displayName,
        qrVersion: 1,
        disabled: false,
        createdAt: now
      };

      db.accounts.push(newAccount);
      db.profiles.push({
        accountId: newAccount.id,
        nickname: displayName,
        bio: "",
        themeId: "science",
        frameId: "clean",
        publicProfile: true,
        updatedAt: now
      });
      db.userStats.push({
        accountId: newAccount.id,
        stampCount: 0,
        uniqueBoothCount: 0,
        couponEligible: false,
        couponClaimed: false
      });
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: newAccount.id,
        action: "participant.register",
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent)
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
