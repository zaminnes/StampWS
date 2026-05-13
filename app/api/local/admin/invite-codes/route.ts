import { NextRequest } from "next/server";
import { assertContentLength, assertSameOrigin, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import {
  createLocalAdminInviteCode,
  localAudit,
  localQuery,
  requireLocalRole,
  withLocalTransaction
} from "@/lib/local-server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireLocalRole(request, ["superAdmin"]);
    const result = await localQuery(
      `SELECT c.id, c.code_label, c.role, c.booth_id, c.used_at, c.revoked, c.created_at,
              b.name AS booth_name,
              a.display_name AS used_by_display_name
         FROM local_invite_codes c
         LEFT JOIN local_booths b ON b.id = c.booth_id
         LEFT JOIN local_accounts a ON a.id = c.used_by_account_id
        ORDER BY c.created_at DESC
        LIMIT 100`
    );
    return jsonOk({ codes: result.rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireLocalRole(request, ["superAdmin"]);
    rateLimit(`local-invite-create:${current.account.id}`, 80, 10 * 60 * 1000);

    const body = (await request.json()) as { boothId?: string; role?: "boothAdmin" | "rewardAdmin" | "superAdmin" };
    const role = body.role || "boothAdmin";
    const result = await withLocalTransaction(async (client) => {
      const booth = body.boothId
        ? (await client.query<{ id: string; slug: string }>("SELECT id, slug FROM local_booths WHERE id = $1", [body.boothId])).rows[0]
        : null;
      const invite = await createLocalAdminInviteCode(client, {
        boothId: booth?.id,
        role,
        label: role === "superAdmin" ? "SUPER" : `BOOTH-${(booth?.slug || "ADMIN").toUpperCase().slice(0, 18)}`
      });
      await localAudit(client, {
        actorAccountId: current.account.id,
        action: "local.invite.create",
        targetType: "inviteCode",
        targetId: invite.id,
        request,
        metadata: { role, boothId: booth?.id || null }
      });
      return invite;
    });

    return jsonOk({ code: result.rawCode });
  } catch (error) {
    return jsonError(error);
  }
}
