import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, randomId, verifyCouponQrToken } from "@/lib/crypto";
import { updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireRole(request, ["rewardAdmin", "superAdmin"]);
    rateLimit(`coupon-redeem:${current.account.id}`, 80, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { token?: string };
    const parsedToken = await verifyCouponQrToken((body.token || "").trim());
    if (!parsedToken) throw new HttpError(400, "쿠폰 QR 코드가 올바르지 않습니다.");

    const result = await updateDb(async (db) => {
      const actor = db.accounts.find((item) => item.id === current.account.id);
      if (!actor || actor.disabled) throw new HttpError(401, "계정을 찾을 수 없습니다.");

      const coupon = db.coupons.find((item) => item.id === parsedToken.couponId);
      if (!coupon) throw new HttpError(404, "쿠폰을 찾을 수 없습니다.");
      if (coupon.status !== "unused") throw new HttpError(409, "이미 사용된 쿠폰입니다.");
      if (actor.role === "rewardAdmin" && actor.rewardId !== coupon.rewardId) {
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
