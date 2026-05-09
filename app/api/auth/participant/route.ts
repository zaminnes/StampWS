import { NextRequest } from "next/server";
import { assertParticipantDeviceAllowed, createSession, setSessionCookie } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, hashPassword, hashToken, normalizeLoginId, randomId } from "@/lib/crypto";
import { updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function normalizeStudentCode(value: string) {
  const normalized = value.normalize("NFKC").replace(/\s+/g, "").trim();
  if (!/^[1-3][0-9]{4}$/.test(normalized)) {
    throw new HttpError(400, "학번은 예: 10214 형식으로 입력하세요.");
  }
  const classNumber = Number(normalized.slice(1, 3));
  const studentNumber = Number(normalized.slice(3, 5));
  if (classNumber < 1 || classNumber > 15 || studentNumber < 1 || studentNumber > 40) {
    throw new HttpError(400, "학년/반/번호가 맞는지 확인하세요.");
  }
  return normalized;
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const { ip, userAgent } = clientFingerprint(request.headers);
    rateLimit(`participant-entry:${ip}`, 25, 10 * 60 * 1000);

    const body = (await request.json()) as { studentCode?: string; cacheKey?: string };
    const studentCode = normalizeStudentCode(body.studentCode || "");
    const loginIdLower = normalizeLoginId(studentCode);
    await assertParticipantDeviceAllowed(request, loginIdLower);
    const now = new Date().toISOString();
    const nextCacheKey = randomId("pkey");
    const nextCacheHash = await hashToken(nextCacheKey);

    const account = await updateDb(async (db) => {
      const existing = db.accounts.find((item) => item.loginIdLower === loginIdLower);
      if (existing) {
        if (existing.disabled) throw new HttpError(403, "사용할 수 없는 참가자입니다.");
        if (body.cacheKey) {
          const currentCacheHash = await hashToken(body.cacheKey);
          if (!existing.participantCacheHash || existing.participantCacheHash !== currentCacheHash) {
            throw new HttpError(401, "다시 학번을 입력하세요.");
          }
        }

        existing.participantCacheHash = nextCacheHash;
        existing.studentCode ||= studentCode;
        existing.lastLoginAt = now;
        if (!db.profiles.some((profile) => profile.accountId === existing.id)) {
          db.profiles.push({
            accountId: existing.id,
            nickname: existing.displayName === studentCode ? "" : existing.displayName,
            bio: "",
            themeId: "science",
            frameId: "clean",
            publicProfile: true,
            updatedAt: now
          });
        }
        if (!db.userStats.some((stats) => stats.accountId === existing.id)) {
          db.userStats.push({
            accountId: existing.id,
            stampCount: 0,
            uniqueBoothCount: 0,
            couponEligible: false,
            couponClaimed: false
          });
        }

        db.auditLogs.push({
          id: randomId("audit"),
          actorAccountId: existing.id,
          action: body.cacheKey ? "participant.cacheLogin" : "participant.idLogin",
          createdAt: now,
          ipHash: await hashFingerprint(ip),
          userAgentHash: await hashFingerprint(userAgent)
        });

        return existing;
      }

      const newAccount = {
        id: randomId("acc"),
        loginId: studentCode,
        loginIdLower,
        passwordHash: await hashPassword(randomId("participant")),
        role: "participant" as const,
        displayName: studentCode,
        studentCode,
        participantCacheHash: nextCacheHash,
        qrVersion: 1,
        disabled: false,
        createdAt: now,
        lastLoginAt: now
      };

      db.accounts.push(newAccount);
      db.profiles.push({
        accountId: newAccount.id,
        nickname: "",
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
        action: "participant.quickRegister",
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: { studentCode }
      });
      return newAccount;
    });

    const { session, token, deviceId } = await createSession(account, request, "participant");
    const response = jsonOk({
      ok: true,
      participantCache: {
        studentCode,
        cacheKey: nextCacheKey
      }
    });
    setSessionCookie(response, session.id, token, deviceId);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
