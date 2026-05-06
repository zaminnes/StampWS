import { createCouponQrToken, createParticipantQrToken, defaultStampDataUrl } from "./crypto";
import type { Account, Profile, StampDb, UserStats } from "./types";

export function accountView(account: Account) {
  return {
    id: account.id,
    loginId: account.loginId,
    role: account.role,
    displayName: account.displayName,
    boothId: account.boothId,
    rewardId: account.rewardId,
    selectedRewardId: account.selectedRewardId,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt
  };
}

export function defaultProfile(account: Account): Profile {
  return {
    accountId: account.id,
    nickname: account.displayName,
    bio: "",
    themeId: "science",
    frameId: "clean",
    publicProfile: true,
    updatedAt: account.createdAt
  };
}

export function defaultStats(accountId: string): UserStats {
  return {
    accountId,
    stampCount: 0,
    uniqueBoothCount: 0,
    couponEligible: false,
    couponClaimed: false
  };
}

function resolveStampImage(stampImageDataUrl: string, db: StampDb) {
  if (!stampImageDataUrl.startsWith("booth:")) return stampImageDataUrl;
  const boothId = stampImageDataUrl.split(":")[1];
  const booth = db.booths.find((item) => item.id === boothId);
  return booth?.stampImageDataUrl || defaultStampDataUrl(booth?.name || "STAMP");
}

export async function buildMePayload(account: Account, db: StampDb) {
  const base = {
    account: accountView(account),
    rewards: db.rewards,
    booths: db.booths.map((booth) => ({
      id: booth.id,
      name: booth.name,
      clubName: booth.clubName,
      active: booth.active,
      hasStampImage: Boolean(booth.stampImageDataUrl)
    }))
  };

  if (account.role === "participant") {
    const profile = db.profiles.find((item) => item.accountId === account.id) || defaultProfile(account);
    const stamps = db.stamps
      .filter((stamp) => stamp.participantAccountId === account.id && !stamp.voided)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((stamp) => ({
        ...stamp,
        stampImageDataUrl: resolveStampImage(stamp.stampImageDataUrl, db)
      }));
    const stats = db.userStats.find((item) => item.accountId === account.id) || defaultStats(account.id);
    const coupon = db.coupons.find((item) => item.participantAccountId === account.id);
    const avatarStamp = profile.avatarStampId ? stamps.find((stamp) => stamp.id === profile.avatarStampId) : undefined;

    return {
      ...base,
      participantQrToken: await createParticipantQrToken(account.id, account.qrVersion),
      profile: {
        ...profile,
        avatarStampImageDataUrl: avatarStamp?.stampImageDataUrl
      },
      stamps,
      stats,
      coupon: coupon
        ? {
            ...coupon,
            qrToken: await createCouponQrToken(coupon.id)
          }
        : null
    };
  }

  if (account.role === "boothAdmin") {
    const booth = db.booths.find((item) => item.id === account.boothId);
    return {
      ...base,
      booth,
      issuedCount: db.stamps.filter((stamp) => stamp.issuedByAdminId === account.id && !stamp.voided).length
    };
  }

  if (account.role === "rewardAdmin") {
    const reward = db.rewards.find((item) => item.id === account.rewardId);
    return {
      ...base,
      reward,
      redeemedCount: db.coupons.filter((coupon) => coupon.redeemedByAccountId === account.id).length
    };
  }

  return {
    ...base,
    adminSummary: {
      accountCount: db.accounts.length,
      participantCount: db.accounts.filter((item) => item.role === "participant").length,
      stampCount: db.stamps.filter((stamp) => !stamp.voided).length,
      couponCount: db.coupons.length,
      redeemedCouponCount: db.coupons.filter((coupon) => coupon.status === "redeemed").length
    }
  };
}
