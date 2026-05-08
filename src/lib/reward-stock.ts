import { HttpError } from "./http";
import type { RewardId, RewardItem, StampDb } from "./types";

export function normalizeRewardStock(value: unknown) {
  const stock = Number(value);
  if (!Number.isFinite(stock)) throw new HttpError(400, "재고 수량을 입력하세요.");
  return Math.min(Math.max(Math.floor(stock), 0), 5000);
}

export function rewardStockCount(reward?: RewardItem | null) {
  if (!reward || typeof reward.stockCount !== "number") return undefined;
  return Math.max(0, Math.floor(reward.stockCount));
}

export function isRewardSoldOut(reward?: RewardItem | null) {
  return rewardStockCount(reward) === 0;
}

export function stockIsIgnoredForStampReward(rewardId: RewardId) {
  return rewardId === "alphago";
}

export function assertRewardSelectable(reward: RewardItem, options?: { stampReward?: boolean }) {
  if (!reward.active) throw new HttpError(404, "보상을 찾을 수 없습니다.");
  if (options?.stampReward && stockIsIgnoredForStampReward(reward.id)) return;
  if (isRewardSoldOut(reward)) throw new HttpError(409, "선택한 보상이 품절입니다.");
}

export function decrementRewardStock(db: StampDb, rewardId: RewardId, accountId: string, now: string, options?: { stampReward?: boolean }) {
  if (options?.stampReward && stockIsIgnoredForStampReward(rewardId)) return undefined;
  const reward = db.rewards.find((item) => item.id === rewardId);
  if (!reward) throw new HttpError(404, "보상을 찾을 수 없습니다.");
  const stock = rewardStockCount(reward);
  if (stock === undefined) return undefined;
  if (stock <= 0) throw new HttpError(409, "보상이 품절입니다.");
  reward.stockCount = stock - 1;
  reward.stockUpdatedAt = now;
  reward.stockUpdatedByAccountId = accountId;
  return reward.stockCount;
}
