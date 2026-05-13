import { NextRequest } from "next/server";
import { assertContentLength, assertSameOrigin, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import {
  createGuestLoginToken,
  localAudit,
  localQuery,
  requireLocalRole,
  sanitizeLocalText,
  withLocalTransaction
} from "@/lib/local-server";
import { randomId } from "@/lib/crypto";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireLocalRole(request, ["superAdmin"]);
    const passes = await localQuery(
      `SELECT gp.id, gp.label, gp.display_name, gp.category, gp.status, gp.created_at, gp.expires_at, gp.last_login_at,
              a.display_name AS account_display_name
         FROM local_guest_passes gp
         LEFT JOIN local_accounts a ON a.id = gp.account_id
        ORDER BY gp.created_at DESC
        LIMIT 120`
    );
    return jsonOk({ passes: passes.rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireLocalRole(request, ["superAdmin"]);
    rateLimit(`local-guest-pass-create:${current.account.id}`, 120, 10 * 60 * 1000);

    const body = (await request.json()) as { displayName?: string; category?: string; label?: string; expiresAt?: string };
    const displayName = sanitizeLocalText(body.displayName || "게스트", 2, 20, "게스트 이름");
    const category = sanitizeLocalText(body.category || "guest", 2, 20, "구분");
    const label = sanitizeLocalText(body.label || displayName, 2, 24, "라벨");

    const result = await withLocalTransaction(async (client) => {
      const id = randomId("gpass");
      const { token, tokenHash } = await createGuestLoginToken(id, 1);
      const pass = await client.query(
        `INSERT INTO local_guest_passes
          (id, label, display_name, category, token_hash, qr_version, status, created_by_admin_id, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, 1, 'active', $6, now(), $7)
         RETURNING id, label, display_name, category, status, created_at, expires_at`,
        [id, label, displayName, category, tokenHash, current.account.id, body.expiresAt || null]
      );
      await localAudit(client, {
        actorAccountId: current.account.id,
        action: "local.guestPass.create",
        targetType: "guestPass",
        targetId: id,
        request,
        metadata: { label, category }
      });
      return {
        pass: pass.rows[0],
        token,
        loginUrl: `${process.env.PUBLIC_BASE_URL || request.nextUrl.origin}/local?guest=${encodeURIComponent(token)}`
      };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
