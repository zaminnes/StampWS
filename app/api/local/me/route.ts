import { NextRequest } from "next/server";
import { accountView, getLocalSession, localDatabaseKind, localQuery } from "@/lib/local-server";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

function goodsWithParsedOptions(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => ({
    ...row,
    options: typeof row.options === "string" ? JSON.parse(row.options || "[]") : row.options || []
  }));
}

export async function GET(request: NextRequest) {
  try {
    const current = await getLocalSession(request);
    if (!current) return jsonOk({ account: null });
    const goodsQuery =
      localDatabaseKind() === "sqlite"
        ? `SELECT g.*, b.name AS booth_name,
                  COALESCE(json_group_array(json_object(
                    'id', o.id,
                    'name', o.name,
                    'totalStock', o.total_stock,
                    'remainingStock', o.remaining_stock
                  )) FILTER (WHERE o.id IS NOT NULL), '[]') AS options
             FROM local_goods g
             JOIN local_booths b ON b.id = g.booth_id
             LEFT JOIN local_goods_options o ON o.goods_id = g.id
            WHERE ($1 = 'admin' OR g.status = 'public')
            GROUP BY g.id, b.name
            ORDER BY g.created_at DESC`
        : `SELECT g.*, b.name AS booth_name,
                  COALESCE(json_agg(json_build_object(
                    'id', o.id,
                    'name', o.name,
                    'totalStock', o.total_stock,
                    'remainingStock', o.remaining_stock
                  ) ORDER BY o.created_at) FILTER (WHERE o.id IS NOT NULL), '[]') AS options
             FROM local_goods g
             JOIN local_booths b ON b.id = g.booth_id
             LEFT JOIN local_goods_options o ON o.goods_id = g.id
            WHERE ($1::text = 'admin' OR g.status = 'public')
            GROUP BY g.id, b.name
            ORDER BY g.created_at DESC`;
    const [booths, goods, orders] = await Promise.all([
      localQuery(
        current.session.role === "superAdmin"
          ? "SELECT * FROM local_booths ORDER BY created_at DESC"
          : current.session.role === "boothAdmin"
            ? `SELECT b.* FROM local_booths b
               JOIN local_admin_booths ab ON ab.booth_id = b.id
              WHERE ab.account_id = $1
              ORDER BY b.created_at DESC`
          : "SELECT * FROM local_booths WHERE active = true ORDER BY name",
        current.session.role === "boothAdmin" ? [current.account.id] : []
      ),
      localQuery(goodsQuery, [current.session.role === "participant" ? "participant" : "admin"]),
      current.session.role === "participant"
        ? localQuery(
            `SELECT ord.*, g.name AS goods_name, b.name AS booth_name, opt.name AS option_name
               FROM local_goods_orders ord
               JOIN local_goods g ON g.id = ord.goods_id
               JOIN local_booths b ON b.id = g.booth_id
               JOIN local_goods_options opt ON opt.id = ord.option_id
              WHERE ord.participant_account_id = $1
              ORDER BY ord.created_at DESC`,
            [current.account.id]
          )
        : Promise.resolve({ rows: [] })
    ]);

    return jsonOk({
      account: accountView(current.account, current.session.role),
      booths: booths.rows,
      goods: goodsWithParsedOptions(goods.rows),
      orders: orders.rows
    });
  } catch (error) {
    return jsonError(error);
  }
}
