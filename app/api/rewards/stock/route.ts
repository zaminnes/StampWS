import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, randomId } from "@/lib/crypto";
import { readDb, updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeRewardStock } from "@/lib/reward-stock";
import type { Account, RewardId } from "@/lib/types";

export const runtime = "nodejs";

function canEditRewardStock(account: Account, rewardId: RewardId) {
  if (account.role === "superAdmin") return true;
  return (account.role === "rewardAdmin" || account.role === "boothAdmin") && account.rewardId === rewardId;
}

export async function GET(request: NextRequest) {
  try {
    const current = await requireRole(request, ["boothAdmin", "rewardAdmin", "superAdmin"]);
    const db = await readDb();
    const account = db.accounts.find((item) => item.id === current.account.id);
    if (!account || account.disabled) throw new HttpError(401, "계정을 찾을 수 없습니다.");
    const rewards = account.role === "superAdmin"
      ? db.rewards
      : db.rewards.filter((reward) => reward.id === account.rewardId);
    return jsonOk({ rewards });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireRole(request, ["boothAdmin", "rewardAdmin", "superAdmin"]);
    rateLimit(`reward-stock:${current.account.id}`, 80, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { rewardId?: RewardId; stockCount?: number };
    const rewardId = body.rewardId;
    if (!rewardId) throw new HttpError(400, "보상을 선택하세요.");
    const stockCount = normalizeRewardStock(body.stockCount);

    const result = await updateDb(async (db) => {
      const account = db.accounts.find((item) => item.id === current.account.id);
      if (!account || account.disabled) throw new HttpError(401, "계정을 찾을 수 없습니다.");
      if (!canEditRewardStock(account, rewardId)) throw new HttpError(403, "담당 보상 재고만 수정할 수 있습니다.");
      const reward = db.rewards.find((item) => item.id === rewardId);
      if (!reward) throw new HttpError(404, "보상을 찾을 수 없습니다.");

      const now = new Date().toISOString();
      reward.stockCount = stockCount;
      reward.stockUpdatedAt = now;
      reward.stockUpdatedByAccountId = account.id;
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: account.id,
        action: "reward.stock.set",
        targetId: reward.id,
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: { rewardId: reward.id, stockCount }
      });

      return {
        reward,
        rewards: account.role === "superAdmin"
          ? db.rewards
          : db.rewards.filter((item) => item.id === account.rewardId)
      };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
