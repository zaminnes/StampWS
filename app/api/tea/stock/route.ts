import { NextRequest } from "next/server";
import { requireCurrentSession } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, randomId } from "@/lib/crypto";
import { readDb, updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeRewardStock } from "@/lib/reward-stock";
import { assertTeaMakerAccess, decrementTeaStock, teaStockCount } from "@/lib/tea-access";
import type { Account, RewardId } from "@/lib/types";

export const runtime = "nodejs";

function normalizeStock(value: unknown) {
  const stock = Number(value);
  if (!Number.isFinite(stock)) throw new HttpError(400, "재고 수량을 입력하세요.");
  return Math.min(Math.max(Math.floor(stock), 0), 5000);
}

function rewardStockMode(request: NextRequest) {
  return request.nextUrl.searchParams.get("scope") === "rewards";
}

function canEditRewardStock(account: Account, rewardId: RewardId) {
  if (account.role === "superAdmin") return true;
  return (account.role === "rewardAdmin" || account.role === "boothAdmin") && account.rewardId === rewardId;
}

function visibleRewards(account: Account, rewards: Awaited<ReturnType<typeof readDb>>["rewards"]) {
  return account.role === "superAdmin" ? rewards : rewards.filter((reward) => reward.id === account.rewardId);
}

export async function GET(request: NextRequest) {
  try {
    const current = await requireCurrentSession(request);
    const db = await readDb();
    const account = db.accounts.find((item) => item.id === current.account.id);
    if (!account || account.disabled) throw new HttpError(401, "계정을 찾을 수 없습니다.");
    if (current.session.role === "participant") throw new HttpError(403, "관리자 권한이 필요합니다.");
    if (rewardStockMode(request)) {
      if (!["boothAdmin", "rewardAdmin", "superAdmin"].includes(account.role)) throw new HttpError(403, "관리자 권한이 필요합니다.");
      return jsonOk({ rewards: visibleRewards(account, db.rewards) });
    }
    assertTeaMakerAccess(account);
    return jsonOk({ stockCount: teaStockCount(db), updatedAt: db.meta.teaStockUpdatedAt });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireCurrentSession(request);
    rateLimit(`tea-stock:${current.account.id}`, 80, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { action?: "set" | "decrement"; stockCount?: number; rewardId?: RewardId };

    const result = await updateDb(async (db) => {
      const account = db.accounts.find((item) => item.id === current.account.id);
      if (!account || account.disabled) throw new HttpError(401, "계정을 찾을 수 없습니다.");
      if (current.session.role === "participant") throw new HttpError(403, "관리자 권한이 필요합니다.");
      const now = new Date().toISOString();
      if (rewardStockMode(request)) {
        if (!body.rewardId) throw new HttpError(400, "보상을 선택하세요.");
        if (!canEditRewardStock(account, body.rewardId)) throw new HttpError(403, "담당 보상 재고만 수정할 수 있습니다.");
        const reward = db.rewards.find((item) => item.id === body.rewardId);
        if (!reward) throw new HttpError(404, "보상을 찾을 수 없습니다.");
        const stockCount = normalizeRewardStock(body.stockCount);
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
        return { reward, rewards: visibleRewards(account, db.rewards) };
      }

      assertTeaMakerAccess(account);
      let stockCount: number;
      if (body.action === "decrement") {
        stockCount = decrementTeaStock(db, account.id, now);
      } else {
        stockCount = normalizeStock(body.stockCount);
        db.meta.teaStockCount = stockCount;
        db.meta.teaStockUpdatedAt = now;
        db.meta.teaStockUpdatedByAccountId = account.id;
      }
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: account.id,
        action: body.action === "decrement" ? "tea.stock.decrement" : "tea.stock.set",
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: { stockCount }
      });
      return { stockCount, updatedAt: now };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
