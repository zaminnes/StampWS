import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, randomId, verifyParticipantQrToken, verifyTempPassQrToken } from "@/lib/crypto";
import { updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireRole(request, ["boothAdmin", "superAdmin"]);
    rateLimit(`grant-stamp:${current.account.id}`, 80, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { token?: string; boothId?: string };
    const token = (body.token || "").trim();
    const parsedParticipantToken = await verifyParticipantQrToken(token);
    const parsedTempPassToken = parsedParticipantToken ? null : await verifyTempPassQrToken(token);
    if (!parsedParticipantToken && !parsedTempPassToken) {
      throw new HttpError(400, "참가자 또는 임시 QR 코드가 올바르지 않습니다.");
    }

    const result = await updateDb(async (db) => {
      const actor = db.accounts.find((item) => item.id === current.account.id);
      if (!actor || actor.disabled) throw new HttpError(401, "계정을 찾을 수 없습니다.");

      const boothId = actor.role === "superAdmin" ? body.boothId || actor.boothId : actor.boothId;
      if (!boothId) throw new HttpError(403, "담당 부스가 없습니다.");

      const booth = db.booths.find((item) => item.id === boothId);
      if (!booth || !booth.active) throw new HttpError(404, "부스를 찾을 수 없습니다.");

      const now = new Date().toISOString();

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
          couponEligible: tempPass.stamps.length >= 7,
          temporary: true
        };
      }

      if (!parsedParticipantToken) throw new HttpError(400, "참가자 또는 임시 QR 코드가 올바르지 않습니다.");
      const participant = db.accounts.find((item) => item.id === parsedParticipantToken.accountId);
      if (!participant || participant.disabled || participant.role !== "participant") {
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
      stats.couponEligible = stats.stampCount >= 7;
      if (stats.stampCount >= 7 && !stats.completedSevenAt) stats.completedSevenAt = now;

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
