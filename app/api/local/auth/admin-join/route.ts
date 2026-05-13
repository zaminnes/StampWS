import { NextRequest } from "next/server";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import {
  createLocalSession,
  hashLocalPassword,
  localAudit,
  sanitizeDisplayName,
  sanitizeLocalText,
  setLocalSessionCookie,
  withLocalTransaction
} from "@/lib/local-server";
import { clientFingerprint, hashToken, normalizeInviteCode, normalizeLoginId, randomId, validateLoginId } from "@/lib/crypto";
import type { LocalAccount } from "@/lib/local-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const { ip } = clientFingerprint(request.headers);
    rateLimit(`local-admin-join:${ip}`, 20, 10 * 60 * 1000);

    const body = (await request.json()) as { inviteCode?: string; loginId?: string; password?: string; displayName?: string };
    const inviteHash = await hashToken(normalizeInviteCode(body.inviteCode || ""));
    const loginId = validateLoginId(body.loginId || "");
    const displayName = sanitizeDisplayName(body.displayName || "");
    const passwordHash = await hashLocalPassword(body.password || "");

    const account = await withLocalTransaction<LocalAccount>(async (client) => {
      const codeResult = await client.query<{
        id: string;
        role: "boothAdmin" | "rewardAdmin" | "superAdmin";
        booth_id: string | null;
        used_by_account_id: string | null;
        revoked: boolean;
      }>(
        `SELECT id, role, booth_id, used_by_account_id, revoked
           FROM local_invite_codes
          WHERE code_hash = $1
          FOR UPDATE`,
        [inviteHash]
      );
      const code = codeResult.rows[0];
      if (!code || code.revoked || code.used_by_account_id) throw new HttpError(403, "관리자 코드가 올바르지 않거나 이미 사용되었습니다.");

      const accountId = randomId("acc");
      const result = await client.query<LocalAccount>(
        `INSERT INTO local_accounts
          (id, type, role, login_id, login_id_lower, password_hash, display_name, disabled, created_at, last_login_at)
         VALUES ($1, 'admin', $2, $3, $4, $5, $6, false, now(), now())
         RETURNING *`,
        [accountId, code.role, loginId, normalizeLoginId(loginId), passwordHash, displayName]
      );
      if (code.booth_id) {
        await client.query("INSERT INTO local_admin_booths (account_id, booth_id) VALUES ($1, $2)", [accountId, code.booth_id]);
      }
      await client.query("UPDATE local_invite_codes SET used_by_account_id = $1, used_at = now() WHERE id = $2", [accountId, code.id]);
      await localAudit(client, {
        actorAccountId: accountId,
        action: "local.admin.join",
        targetType: "inviteCode",
        targetId: code.id,
        request,
        metadata: { role: code.role, boothId: code.booth_id, label: sanitizeLocalText(displayName, 2, 12, "이름") }
      });
      return result.rows[0];
    });

    const session = await createLocalSession(account, request);
    const response = jsonOk({ ok: true });
    setLocalSessionCookie(response, session);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
