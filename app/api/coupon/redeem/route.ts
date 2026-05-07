import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, randomId, verifyCouponQrToken, verifyTempPassQrToken } from "@/lib/crypto";
import { updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { STAMP_REWARD_THRESHOLD } from "@/lib/stamp-config";
import type { RewardId } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireRole(request, ["boothAdmin", "rewardAdmin", "superAdmin"]);
    rateLimit(`coupon-redeem:${current.account.id}`, 80, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { token?: string; rewardId?: RewardId };
    const token = (body.token || "").trim();
    const parsedCouponToken = await verifyCouponQrToken(token);
    const parsedTempPassToken = parsedCouponToken ? null : await verifyTempPassQrToken(token);
    if (!parsedCouponToken && !parsedTempPassToken) throw new HttpError(400, "쿠폰 또는 임시 QR 코드가 올바르지 않습니다.");

    const result = await updateDb(async (db) => {
      const actor = db.accounts.find((item) => item.id === current.account.id);
      if (!actor || actor.disabled) throw new HttpError(401, "계정을 찾을 수 없습니다.");

      if (parsedTempPassToken) {
        const rewardId = actor.role === "superAdmin" ? body.rewardId : actor.rewardId;
        if (!rewardId) throw new HttpError(403, "지급할 보상을 선택할 수 없습니다.");

        const reward = db.rewards.find((item) => item.id === rewardId && item.active);
        if (!reward) throw new HttpError(404, "보상을 찾을 수 없습니다.");

        const tempPass = db.tempPasses.find((item) => item.id === parsedTempPassToken.tempPassId);
        if (!tempPass || tempPass.status === "voided") throw new HttpError(404, "임시 QR을 찾을 수 없습니다.");
        if (tempPass.status === "redeemed") throw new HttpError(409, "이미 보상 지급된 임시 QR입니다.");
        if (tempPass.qrVersion !== parsedTempPassToken.qrVersion) {
          throw new HttpError(403, "만료된 임시 QR 코드입니다.");
        }
        if (tempPass.stamps.length < STAMP_REWARD_THRESHOLD) {
          throw new HttpError(403, `임시 QR은 스탬프 ${STAMP_REWARD_THRESHOLD}개부터 보상 지급이 가능합니다.`);
        }

        const now = new Date().toISOString();
        tempPass.status = "redeemed";
        tempPass.redeemedAt = now;
        tempPass.redeemedByAccountId = actor.id;
        tempPass.redeemedRewardId = reward.id;

        db.auditLogs.push({
          id: randomId("audit"),
          actorAccountId: actor.id,
          action: "tempPass.redeem",
          targetId: tempPass.id,
          createdAt: now,
          ipHash: await hashFingerprint(ip),
          userAgentHash: await hashFingerprint(userAgent),
          metadata: {
            tempPassLabel: tempPass.label,
            rewardId: reward.id,
            stampCount: tempPass.stamps.length
          }
        });

        return {
          participantName: tempPass.displayName || tempPass.label,
          rewardName: reward.name,
          rewardClubName: reward.clubName,
          redeemedAt: now,
          temporary: true
        };
      }

      if (!parsedCouponToken) throw new HttpError(400, "쿠폰 또는 임시 QR 코드가 올바르지 않습니다.");
      const coupon = db.coupons.find((item) => item.id === parsedCouponToken.couponId);
      if (!coupon) throw new HttpError(404, "쿠폰을 찾을 수 없습니다.");
      if (coupon.status !== "unused") throw new HttpError(409, "이미 사용된 쿠폰입니다.");
      if (actor.role !== "superAdmin" && actor.rewardId !== coupon.rewardId) {
        throw new HttpError(403, "담당 보상 쿠폰만 사용할 수 있습니다.");
      }

      const participant = db.accounts.find((item) => item.id === coupon.participantAccountId);
      const reward = db.rewards.find((item) => item.id === coupon.rewardId);
      if (!participant || !reward) throw new HttpError(404, "쿠폰 정보를 찾을 수 없습니다.");

      const now = new Date().toISOString();
      coupon.status = "redeemed";
      coupon.redeemedAt = now;
      coupon.redeemedByAccountId = actor.id;
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: actor.id,
        action: "coupon.redeem",
        targetId: coupon.id,
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: {
          participantAccountId: participant.id,
          rewardId: reward.id
        }
      });

      return {
        participantName: participant.displayName,
        rewardName: reward.name,
        rewardClubName: reward.clubName,
        redeemedAt: now
      };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
