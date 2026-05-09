import { createCouponQrToken, createParticipantQrToken, defaultStampDataUrl } from "./crypto";
import { boothForAccount, managedBoothsForAccount } from "./booth-access";
import { STAMP_REWARD_THRESHOLD } from "./stamp-config";
import type { Account, Profile, Role, StampDb, UserStats } from "./types";

export function accountView(account: Account, roleOverride?: Role) {
  return {
    id: account.id,
    loginId: account.loginId,
    role: roleOverride || account.role,
    displayName: account.displayName,
    studentCode: account.studentCode,
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
  return booth?.stampImageDataUrl || db.meta.defaultStampImageDataUrl || defaultStampDataUrl(booth?.name || "STAMP");
}

export async function buildMePayload(account: Account, db: StampDb, roleOverride?: Role) {
  const activeRole = roleOverride || account.role;
  const base = {
    account: accountView(account, activeRole),
    rewards: db.rewards,
    booths: db.booths.map((booth) => ({
      id: booth.id,
      name: booth.name,
      clubName: booth.clubName,
      active: booth.active,
      hasStampImage: Boolean(booth.stampImageDataUrl)
    }))
  };

  if (activeRole === "participant") {
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
    const stampsAscending = [...stamps].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const computedStats = {
      ...stats,
      stampCount: stamps.length,
      uniqueBoothCount: new Set(stamps.map((stamp) => stamp.boothId)).size,
      couponEligible: stamps.length >= STAMP_REWARD_THRESHOLD,
      couponClaimed: Boolean(coupon) || stats.couponClaimed,
      firstStampAt: stats.firstStampAt || stampsAscending[0]?.createdAt,
      lastStampAt: stats.lastStampAt || stampsAscending[stampsAscending.length - 1]?.createdAt,
      completedSevenAt: stampsAscending[STAMP_REWARD_THRESHOLD - 1]?.createdAt || stats.completedSevenAt
    };

    return {
      ...base,
      participantQrToken: await createParticipantQrToken(account.id, account.qrVersion),
      account: {
        ...base.account,
        displayNameRequired: !profile.nickname || account.displayName === account.studentCode
      },
      profile: {
        ...profile,
        avatarStampImageDataUrl: avatarStamp?.stampImageDataUrl
      },
      stamps,
      stats: computedStats,
      coupon: coupon
        ? {
            ...coupon,
            qrToken: await createCouponQrToken(coupon.id)
          }
        : null
    };
  }

  if (activeRole === "boothAdmin") {
    const managedBooths = managedBoothsForAccount(account, db);
    const booth = boothForAccount(account, db);
    return {
      ...base,
      booth: booth
        ? {
            ...booth,
            stampImageDataUrl: booth.stampImageDataUrl || db.meta.defaultStampImageDataUrl || defaultStampDataUrl(booth.name),
            hasCustomStampImage: Boolean(booth.stampImageDataUrl)
          }
        : booth,
      managedBooths: managedBooths.map((item) => ({
        ...item,
        stampImageDataUrl: item.stampImageDataUrl || db.meta.defaultStampImageDataUrl || defaultStampDataUrl(item.name),
        hasCustomStampImage: Boolean(item.stampImageDataUrl)
      })),
      reward: db.rewards.find((item) => item.id === account.rewardId),
      issuedCount: db.stamps.filter((stamp) => stamp.issuedByAdminId === account.id && !stamp.voided).length,
      redeemedCount:
        db.coupons.filter((coupon) => coupon.redeemedByAccountId === account.id).length +
        db.tempPasses.filter((pass) => pass.redeemedByAccountId === account.id).length
    };
  }

  if (activeRole === "rewardAdmin") {
    const reward = db.rewards.find((item) => item.id === account.rewardId);
    return {
      ...base,
      reward,
      redeemedCount:
        db.coupons.filter((coupon) => coupon.redeemedByAccountId === account.id).length +
        db.tempPasses.filter((pass) => pass.redeemedByAccountId === account.id).length
    };
  }

  return {
    ...base,
    adminSummary: {
      accountCount: db.accounts.length,
      participantCount: db.accounts.filter((item) => item.role === "participant" || Boolean(item.studentCode)).length,
      stampCount: db.stamps.filter((stamp) => !stamp.voided).length,
      couponCount: db.coupons.length,
      redeemedCouponCount: db.coupons.filter((coupon) => coupon.status === "redeemed").length,
      tempPassCount: db.tempPasses.length,
      redeemedTempPassCount: db.tempPasses.filter((pass) => pass.status === "redeemed").length
    },
    defaultStampImageDataUrl: db.meta.defaultStampImageDataUrl || defaultStampDataUrl("WSHS")
  };
}
