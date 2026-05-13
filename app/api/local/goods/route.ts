import { NextRequest } from "next/server";
import { assertContentLength, assertSameOrigin, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import {
  localAudit,
  requireLocalBoothAccess,
  requireLocalRole,
  sanitizeLocalText,
  withLocalTransaction
} from "@/lib/local-server";
import { randomId } from "@/lib/crypto";

export const runtime = "nodejs";

function normalizeStock(value: unknown) {
  const stock = Number(value);
  if (!Number.isFinite(stock)) return 0;
  return Math.max(0, Math.min(5000, Math.floor(stock)));
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 20_000);
    const current = await requireLocalRole(request, ["boothAdmin", "superAdmin"]);
    rateLimit(`local-goods-create:${current.account.id}`, 80, 10 * 60 * 1000);

    const body = (await request.json()) as {
      boothId?: string;
      name?: string;
      description?: string;
      imageUrl?: string;
      status?: "draft" | "public" | "closed";
      limitPerUser?: number;
      options?: Array<{ name?: string; stock?: number }>;
    };
    const boothId = body.boothId || "";
    await requireLocalBoothAccess(current.account.id, current.session.role, boothId);
    const name = sanitizeLocalText(body.name || "", 2, 32, "굿즈 이름");
    const description = body.description ? sanitizeLocalText(body.description, 0, 180, "설명") : "";
    const imageUrl = body.imageUrl ? body.imageUrl.trim().slice(0, 500) : "";
    const status = body.status === "draft" || body.status === "closed" ? body.status : "public";
    const limitPerUser = Math.max(1, Math.min(20, Math.floor(Number(body.limitPerUser || 1))));
    const options = (body.options && body.options.length ? body.options : [{ name: "기본", stock: 0 }])
      .slice(0, 12)
      .map((option) => ({
        name: sanitizeLocalText(option.name || "기본", 1, 24, "옵션"),
        stock: normalizeStock(option.stock)
      }));

    const result = await withLocalTransaction(async (client) => {
      const goodsId = randomId("goods");
      const goods = await client.query(
        `INSERT INTO local_goods
          (id, booth_id, name, description, image_url, status, limit_per_user, created_by_admin_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
         RETURNING *`,
        [goodsId, boothId, name, description, imageUrl, status, limitPerUser, current.account.id]
      );
      const insertedOptions = [];
      for (const option of options) {
        const row = await client.query(
          `INSERT INTO local_goods_options (id, goods_id, name, total_stock, remaining_stock, created_at)
           VALUES ($1, $2, $3, $4, $4, now())
           RETURNING *`,
          [randomId("gopt"), goodsId, option.name, option.stock]
        );
        insertedOptions.push(row.rows[0]);
      }
      await localAudit(client, {
        actorAccountId: current.account.id,
        action: "local.goods.create",
        targetType: "goods",
        targetId: goodsId,
        request,
        metadata: { boothId, options: insertedOptions.length }
      });
      return { goods: goods.rows[0], options: insertedOptions };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
