import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { boothForAccount } from "@/lib/booth-access";
import { clientFingerprint, hashFingerprint, hashPassword, normalizeLoginId, randomId, verifyParticipantQrToken, verifyTempPassQrToken } from "@/lib/crypto";
import { updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { STAMP_REWARD_THRESHOLD } from "@/lib/stamp-config";

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
    const current = await requireRole(request, ["boothAdmin", "superAdmin"]);
    rateLimit(`grant-stamp:${current.account.id}`, 80, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { token?: string; boothId?: string; studentCode?: string };
    const token = (body.token || "").trim();
    const manualStudentCode = body.studentCode ? normalizeStudentCode(body.studentCode) : "";
    if (manualStudentCode && current.session.role !== "superAdmin") {
      throw new HttpError(403, "학번 직접 지급은 총괄 관리자만 가능합니다.");
    }
    const parsedParticipantToken = manualStudentCode ? null : await verifyParticipantQrToken(token);
    const parsedTempPassToken = manualStudentCode || parsedParticipantToken ? null : await verifyTempPassQrToken(token);
    if (!manualStudentCode && !parsedParticipantToken && !parsedTempPassToken) {
      throw new HttpError(400, "참가자 또는 임시 QR 코드가 올바르지 않습니다.");
    }

    const result = await updateDb(async (db) => {
      const actor = db.accounts.find((item) => item.id === current.account.id);
      if (!actor || actor.disabled) throw new HttpError(401, "계정을 찾을 수 없습니다.");

      const requestedBoothId = actor.role === "superAdmin" ? body.boothId || actor.boothId : body.boothId || actor.boothId;
      if (!requestedBoothId) throw new HttpError(403, "담당 부스를 선택하세요.");
      const booth = boothForAccount(actor, db, requestedBoothId);
      if (!booth || !booth.active) throw new HttpError(404, "부스를 찾을 수 없습니다.");

      const now = new Date().toISOString();

      if (manualStudentCode) {
        const loginIdLower = normalizeLoginId(manualStudentCode);
        let participant = db.accounts.find((item) => item.loginIdLower === loginIdLower);
        let createdParticipant = false;
        if (participant?.disabled) throw new HttpError(403, "사용할 수 없는 참가자입니다.");
        if (!participant) {
          participant = {
            id: randomId("acc"),
            loginId: manualStudentCode,
            loginIdLower,
            passwordHash: await hashPassword(randomId("participant")),
            role: "participant",
            displayName: manualStudentCode,
            studentCode: manualStudentCode,
            qrVersion: 1,
            disabled: false,
            createdAt: now
          };
          db.accounts.push(participant);
          db.profiles.push({
            accountId: participant.id,
            nickname: "",
            bio: "",
            themeId: "science",
            frameId: "clean",
            publicProfile: true,
            updatedAt: now
          });
          db.userStats.push({
            accountId: participant.id,
            stampCount: 0,
            uniqueBoothCount: 0,
            couponEligible: false,
            couponClaimed: false
          });
          createdParticipant = true;
        } else {
          const existingParticipant = participant;
          existingParticipant.studentCode ||= manualStudentCode;
          if (!db.profiles.some((profile) => profile.accountId === existingParticipant.id)) {
            db.profiles.push({
              accountId: existingParticipant.id,
              nickname: existingParticipant.displayName === manualStudentCode ? "" : existingParticipant.displayName,
              bio: "",
              themeId: "science",
              frameId: "clean",
              publicProfile: true,
              updatedAt: now
            });
          }
          if (!db.userStats.some((stats) => stats.accountId === existingParticipant.id)) {
            db.userStats.push({
              accountId: existingParticipant.id,
              stampCount: 0,
              uniqueBoothCount: 0,
              couponEligible: false,
              couponClaimed: false
            });
          }
        }

        const alreadyStamped = db.stamps.some(
          (stamp) => stamp.participantAccountId === participant.id && stamp.boothId === booth.id && !stamp.voided
        );
        if (alreadyStamped) {
          throw new HttpError(409, "이 부스의 스탬프는 이미 지급되었습니다.");
        }

        const stamp = {
          id: randomId("stp"),
          participantAccountId: participant.id,
          boothId: booth.id,
          boothName: booth.name,
          stampImageDataUrl: `booth:${booth.id}`,
          issuedByAdminId: actor.id,
          createdAt: now,
          voided: false
        };
        db.stamps.push(stamp);

        const participantStamps = db.stamps.filter((item) => item.participantAccountId === participant.id && !item.voided);
        const uniqueBoothCount = new Set(participantStamps.map((item) => item.boothId)).size;
        let stats = db.userStats.find((item) => item.accountId === participant.id);
        if (!stats) {
          stats = {
            accountId: participant.id,
            stampCount: 0,
            uniqueBoothCount: 0,
            couponEligible: false,
            couponClaimed: false
          };
          db.userStats.push(stats);
        }
        stats.stampCount = participantStamps.length;
        stats.uniqueBoothCount = uniqueBoothCount;
        stats.firstStampAt = stats.firstStampAt || now;
        stats.lastStampAt = now;
        stats.couponEligible = stats.stampCount >= STAMP_REWARD_THRESHOLD;
        if (stats.stampCount >= STAMP_REWARD_THRESHOLD && !stats.completedSevenAt) stats.completedSevenAt = now;

        db.auditLogs.push({
          id: randomId("audit"),
          actorAccountId: actor.id,
          action: "booth.stamp.manualGrant",
          targetId: stamp.id,
          createdAt: now,
          ipHash: await hashFingerprint(ip),
          userAgentHash: await hashFingerprint(userAgent),
          metadata: {
            participantAccountId: participant.id,
            studentCode: manualStudentCode,
            boothId: booth.id,
            stampCount: stats.stampCount,
            createdParticipant
          }
        });

        return {
          stamp,
          participantName: participant.displayName,
          stampCount: stats.stampCount,
          couponEligible: stats.couponEligible,
          manual: true,
          createdParticipant
        };
      }

      if (parsedTempPassToken) {
        const tempPass = db.tempPasses.find((item) => item.id === parsedTempPassToken.tempPassId);
        if (!tempPass || tempPass.status === "voided") throw new HttpError(404, "임시 QR을 찾을 수 없습니다.");
        if (tempPass.status === "redeemed") throw new HttpError(409, "이미 보상 지급된 임시 QR입니다.");
        if (tempPass.qrVersion !== parsedTempPassToken.qrVersion) {
          throw new HttpError(403, "만료된 임시 QR 코드입니다.");
        }
        if (tempPass.stamps.some((stamp) => stamp.boothId === booth.id)) {
          throw new HttpError(409, "이 부스의 스탬프는 이미 지급되었습니다.");
        }

        tempPass.stamps.push({
          boothId: booth.id,
          boothName: booth.name,
          stampImageDataUrl: `booth:${booth.id}`,
          issuedByAdminId: actor.id,
          createdAt: now
        });

        db.auditLogs.push({
          id: randomId("audit"),
          actorAccountId: actor.id,
          action: "tempPass.stamp.grant",
          targetId: tempPass.id,
          createdAt: now,
          ipHash: await hashFingerprint(ip),
          userAgentHash: await hashFingerprint(userAgent),
          metadata: {
            tempPassLabel: tempPass.label,
            boothId: booth.id,
            stampCount: tempPass.stamps.length
          }
        });

        return {
          participantName: tempPass.displayName || tempPass.label,
          stampCount: tempPass.stamps.length,
          couponEligible: tempPass.stamps.length >= STAMP_REWARD_THRESHOLD,
          temporary: true
        };
      }

      if (!parsedParticipantToken) throw new HttpError(400, "참가자 또는 임시 QR 코드가 올바르지 않습니다.");
      const participant = db.accounts.find((item) => item.id === parsedParticipantToken.accountId);
      if (!participant || participant.disabled || (participant.role !== "participant" && !participant.studentCode)) {
        throw new HttpError(404, "참가자 계정을 찾을 수 없습니다.");
      }
      if (participant.qrVersion !== parsedParticipantToken.qrVersion) {
        throw new HttpError(403, "만료된 참가자 QR 코드입니다.");
      }

      const alreadyStamped = db.stamps.some(
        (stamp) => stamp.participantAccountId === participant.id && stamp.boothId === booth.id && !stamp.voided
      );
      if (alreadyStamped) {
        throw new HttpError(409, "이 부스의 스탬프는 이미 지급되었습니다.");
      }

      const stamp = {
        id: randomId("stp"),
        participantAccountId: participant.id,
        boothId: booth.id,
        boothName: booth.name,
        stampImageDataUrl: `booth:${booth.id}`,
        issuedByAdminId: actor.id,
        createdAt: now,
        voided: false
      };
      db.stamps.push(stamp);

      const participantStamps = db.stamps.filter((item) => item.participantAccountId === participant.id && !item.voided);
      const uniqueBoothCount = new Set(participantStamps.map((item) => item.boothId)).size;
      let stats = db.userStats.find((item) => item.accountId === participant.id);
      if (!stats) {
        stats = {
          accountId: participant.id,
          stampCount: 0,
          uniqueBoothCount: 0,
          couponEligible: false,
          couponClaimed: false
        };
        db.userStats.push(stats);
      }
      stats.stampCount = participantStamps.length;
      stats.uniqueBoothCount = uniqueBoothCount;
      stats.firstStampAt = stats.firstStampAt || now;
      stats.lastStampAt = now;
      stats.couponEligible = stats.stampCount >= STAMP_REWARD_THRESHOLD;
      if (stats.stampCount >= STAMP_REWARD_THRESHOLD && !stats.completedSevenAt) stats.completedSevenAt = now;

      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: actor.id,
        action: "booth.stamp.grant",
        targetId: stamp.id,
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: {
          participantAccountId: participant.id,
          boothId: booth.id,
          stampCount: stats.stampCount
        }
      });

      return {
        stamp,
        participantName: participant.displayName,
        stampCount: stats.stampCount,
        couponEligible: stats.couponEligible
      };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
