import { NextRequest } from "next/server";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import {
  localAudit,
  requireLocalBoothAccess,
  requireLocalRole,
  verifyGoodsClaimToken,
  withLocalTransaction
} from "@/lib/local-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireLocalRole(request, ["boothAdmin", "superAdmin"]);
    rateLimit(`local-goods-claim:${current.account.id}`, 100, 10 * 60 * 1000);

    const body = (await request.json()) as { token?: string };
    const parsed = await verifyGoodsClaimToken((body.token || "").trim());
    if (!parsed) throw new HttpError(400, "수령 QR이 올바르지 않습니다.");

    const result = await withLocalTransaction(async (client) => {
      const order = await client.query<{
        id: string;
        status: string;
        goods_id: string;
        participant_account_id: string;
        booth_id: string;
        goods_name: string;
      }>(
        `SELECT ord.id, ord.status, ord.goods_id, ord.participant_account_id,
                g.booth_id, g.name AS goods_name
           FROM local_goods_orders ord
           JOIN local_goods g ON g.id = ord.goods_id
          WHERE ord.claim_token_hash = $1
          FOR UPDATE`,
        [parsed.tokenHash]
      );
      const target = order.rows[0];
      if (!target) throw new HttpError(404, "수령 정보를 찾을 수 없습니다.");
      if (target.status !== "reserved") throw new HttpError(409, "이미 처리된 수령 QR입니다.");
      await requireLocalBoothAccess(current.account.id, current.session.role, target.booth_id);
      await client.query(
        "UPDATE local_goods_orders SET status = 'claimed', claimed_at = now(), claimed_by_admin_id = $1 WHERE id = $2",
        [current.account.id, target.id]
      );
      await localAudit(client, {
        actorAccountId: current.account.id,
        action: "local.goods.claim",
        targetType: "goodsOrder",
        targetId: target.id,
        request,
        metadata: { goodsId: target.goods_id, participantAccountId: target.participant_account_id }
      });
      return { orderId: target.id, goodsName: target.goods_name };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
