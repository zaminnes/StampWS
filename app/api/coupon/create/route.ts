import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { clientFingerprint, createCouponQrToken, hashFingerprint, randomId } from "@/lib/crypto";
import { updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { assertRewardSelectable, isRewardSoldOut, stockIsIgnoredForStampReward } from "@/lib/reward-stock";
import { STAMP_REWARD_THRESHOLD } from "@/lib/stamp-config";
import type { RewardId } from "@/lib/types";

export const runtime = "nodejs";

const REWARD_IDS = new Set<RewardId>(["chemistry", "biology", "quasar", "alphago"]);

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireRole(request, ["participant"]);
    rateLimit(`coupon-create:${current.account.id}`, 10, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { rewardId?: RewardId };
    const rewardId = body.rewardId;
    if (!rewardId || !REWARD_IDS.has(rewardId)) {
      throw new HttpError(400, "보상을 선택하세요.");
    }

    const coupon = await updateDb(async (db) => {
      const account = db.accounts.find((item) => item.id === current.account.id);
      if (!account || account.role !== "participant" || account.disabled) {
        throw new HttpError(401, "참가자 계정을 찾을 수 없습니다.");
      }

      const reward = db.rewards.find((item) => item.id === rewardId && item.active);
      if (!reward) throw new HttpError(404, "보상을 찾을 수 없습니다.");
      assertRewardSelectable(reward, { stampReward: true });

      const participantStamps = db.stamps
        .filter((stamp) => stamp.participantAccountId === account.id && !stamp.voided)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const stampCount = participantStamps.length;
      if (stampCount < STAMP_REWARD_THRESHOLD) {
        throw new HttpError(403, `스탬프 ${STAMP_REWARD_THRESHOLD}개 이상부터 쿠폰으로 변환할 수 있습니다.`);
      }
      const existingCoupon = db.coupons.find((item) => item.participantAccountId === account.id);
      if (existingCoupon) {
        if (existingCoupon.status !== "unused") throw new HttpError(409, "이미 사용된 쿠폰입니다.");
        const currentReward = db.rewards.find((item) => item.id === existingCoupon.rewardId);
        const currentRewardStillAvailable = currentReward &&
          currentReward.active &&
          (stockIsIgnoredForStampReward(currentReward.id) || !isRewardSoldOut(currentReward));
        if (currentRewardStillAvailable) {
          throw new HttpError(409, "쿠폰은 한 번만 받을 수 있습니다.");
        }
        if (existingCoupon.rewardId === rewardId) throw new HttpError(409, "이미 선택된 보상입니다.");

        const now = new Date().toISOString();
        existingCoupon.rewardId = rewardId;
        account.selectedRewardId = rewardId;
        db.auditLogs.push({
          id: randomId("audit"),
          actorAccountId: account.id,
          action: "coupon.change",
          targetId: existingCoupon.id,
          createdAt: now,
          ipHash: await hashFingerprint(ip),
          userAgentHash: await hashFingerprint(userAgent),
          metadata: { rewardId, previousRewardId: currentReward?.id || null, stampCount }
        });
        return existingCoupon;
      }

      const now = new Date().toISOString();
      const newCoupon = {
        id: randomId("cpn"),
        participantAccountId: account.id,
        rewardId,
        status: "unused" as const,
        createdAt: now
      };
      db.coupons.push(newCoupon);
      account.selectedRewardId = rewardId;

      let stats = db.userStats.find((item) => item.accountId === account.id);
      if (stats) {
        stats.couponClaimed = true;
        stats.couponEligible = stampCount >= STAMP_REWARD_THRESHOLD;
        stats.completedSevenAt ||= participantStamps[STAMP_REWARD_THRESHOLD - 1]?.createdAt;
      }

      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: account.id,
        action: "coupon.create",
        targetId: newCoupon.id,
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: { rewardId, stampCount }
      });

      return newCoupon;
    });

    return jsonOk({ coupon: { ...coupon, qrToken: await createCouponQrToken(coupon.id) } });
  } catch (error) {
    return jsonError(error);
  }
}
