import { NextRequest } from "next/server";
import { requireCurrentSession } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, randomId } from "@/lib/crypto";
import { readDb, updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { assertTeaMakerAccess, decrementTeaStock, teaStockCount } from "@/lib/tea-access";

export const runtime = "nodejs";

function normalizeStock(value: unknown) {
  const stock = Number(value);
  if (!Number.isFinite(stock)) throw new HttpError(400, "재고 수량을 입력하세요.");
  return Math.min(Math.max(Math.floor(stock), 0), 5000);
}

export async function GET(request: NextRequest) {
  try {
    const current = await requireCurrentSession(request);
    assertTeaMakerAccess(current.account);
    const db = await readDb();
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
    assertTeaMakerAccess(current.account);
    rateLimit(`tea-stock:${current.account.id}`, 80, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { action?: "set" | "decrement"; stockCount?: number };

    const result = await updateDb(async (db) => {
      const account = db.accounts.find((item) => item.id === current.account.id);
      assertTeaMakerAccess(account);
      const now = new Date().toISOString();
      let stockCount: number;
      if (body.action === "decrement") {
        stockCount = decrementTeaStock(db, account?.id || current.account.id, now);
      } else {
        stockCount = normalizeStock(body.stockCount);
        db.meta.teaStockCount = stockCount;
        db.meta.teaStockUpdatedAt = now;
        db.meta.teaStockUpdatedByAccountId = account?.id || current.account.id;
      }
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: account?.id || current.account.id,
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
