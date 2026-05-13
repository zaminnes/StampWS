import { NextRequest } from "next/server";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import {
  createGoodsClaimToken,
  localAudit,
  requireLocalRole,
  withLocalTransaction
} from "@/lib/local-server";
import { randomId } from "@/lib/crypto";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireLocalRole(request, ["participant"]);
    rateLimit(`local-goods-order:${current.account.id}`, 40, 10 * 60 * 1000);

    const body = (await request.json()) as { goodsId?: string; optionId?: string };
    const goodsId = body.goodsId || "";
    const optionId = body.optionId || "";

    const result = await withLocalTransaction(async (client) => {
      const goods = await client.query<{ id: string; booth_id: string; name: string; status: string }>(
        "SELECT id, booth_id, name, status FROM local_goods WHERE id = $1",
        [goodsId]
      );
      const item = goods.rows[0];
      if (!item || item.status !== "public") throw new HttpError(404, "신청 가능한 굿즈가 아닙니다.");

      const option = await client.query<{ id: string; name: string; remaining_stock: number }>(
        "SELECT id, name, remaining_stock FROM local_goods_options WHERE id = $1 AND goods_id = $2 FOR UPDATE",
        [optionId, goodsId]
      );
      const selected = option.rows[0];
      if (!selected) throw new HttpError(404, "옵션을 찾을 수 없습니다.");
      if (selected.remaining_stock <= 0) throw new HttpError(409, "재고가 없습니다.");

      const duplicate = await client.query("SELECT 1 FROM local_goods_orders WHERE participant_account_id = $1 AND goods_id = $2", [
        current.account.id,
        goodsId
      ]);
      if ((duplicate.rowCount || 0) > 0) throw new HttpError(409, "이미 신청한 굿즈입니다.");

      const orderId = randomId("gord");
      const { token, tokenHash } = await createGoodsClaimToken(orderId);
      await client.query("UPDATE local_goods_options SET remaining_stock = remaining_stock - 1 WHERE id = $1", [optionId]);
      const order = await client.query(
        `INSERT INTO local_goods_orders
          (id, goods_id, option_id, participant_account_id, claim_token_hash, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'reserved', now())
         RETURNING *`,
        [orderId, goodsId, optionId, current.account.id, tokenHash]
      );
      await localAudit(client, {
        actorAccountId: current.account.id,
        action: "local.goods.order",
        targetType: "goodsOrder",
        targetId: orderId,
        request,
        metadata: { goodsId, optionId }
      });
      return {
        order: order.rows[0],
        claimToken: token,
        claimUrl: `${process.env.PUBLIC_BASE_URL || request.nextUrl.origin}/local?claim=${encodeURIComponent(token)}`
      };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
