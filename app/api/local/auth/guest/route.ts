import { NextRequest } from "next/server";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import {
  createLocalSession,
  localAudit,
  setLocalSessionCookie,
  verifyGuestLoginToken,
  withLocalTransaction
} from "@/lib/local-server";
import { clientFingerprint, hashPassword, normalizeLoginId, randomId } from "@/lib/crypto";
import type { LocalAccount } from "@/lib/local-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const { ip } = clientFingerprint(request.headers);
    rateLimit(`local-guest-login:${ip}`, 60, 10 * 60 * 1000);

    const body = (await request.json()) as { token?: string };
    const parsed = await verifyGuestLoginToken((body.token || "").trim());
    if (!parsed) throw new HttpError(400, "게스트 QR이 올바르지 않습니다.");

    const account = await withLocalTransaction<LocalAccount>(async (client) => {
      const passResult = await client.query<{
        id: string;
        label: string;
        display_name: string;
        status: string;
        account_id: string | null;
        expires_at: string | null;
      }>(
        `SELECT id, label, display_name, status, account_id, expires_at
           FROM local_guest_passes
          WHERE token_hash = $1
          FOR UPDATE`,
        [parsed.tokenHash]
      );
      const pass = passResult.rows[0];
      if (!pass || pass.status !== "active") throw new HttpError(404, "사용할 수 없는 게스트 QR입니다.");
      if (pass.expires_at && pass.expires_at <= new Date().toISOString()) throw new HttpError(403, "만료된 게스트 QR입니다.");

      if (pass.account_id) {
        const existing = await client.query<LocalAccount>("SELECT * FROM local_accounts WHERE id = $1", [pass.account_id]);
        const account = existing.rows[0];
        if (!account || account.disabled) throw new HttpError(403, "사용할 수 없는 게스트입니다.");
        await client.query("UPDATE local_guest_passes SET last_login_at = now() WHERE id = $1", [pass.id]);
        await localAudit(client, {
          actorAccountId: account.id,
          action: "local.guest.login",
          targetType: "guestPass",
          targetId: pass.id,
          request
        });
        return account;
      }

      const accountId = randomId("acc");
      const loginId = `guest:${pass.id}`;
      const result = await client.query<LocalAccount>(
        `INSERT INTO local_accounts
          (id, type, role, login_id, login_id_lower, guest_pass_id, password_hash, display_name, disabled, created_at, last_login_at)
         VALUES ($1, 'guest', 'participant', $2, $3, $4, $5, $6, false, now(), now())
         RETURNING *`,
        [accountId, loginId, normalizeLoginId(loginId), pass.id, await hashPassword(randomId("guest")), pass.display_name]
      );
      await client.query("UPDATE local_guest_passes SET account_id = $1, last_login_at = now() WHERE id = $2", [accountId, pass.id]);
      await localAudit(client, {
        actorAccountId: accountId,
        action: "local.guest.create",
        targetType: "guestPass",
        targetId: pass.id,
        request,
        metadata: { label: pass.label }
      });
      return result.rows[0];
    });

    const session = await createLocalSession(account, request, "participant");
    const response = jsonOk({ ok: true });
    setLocalSessionCookie(response, session);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
