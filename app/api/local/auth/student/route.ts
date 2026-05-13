import { NextRequest } from "next/server";
import { assertContentLength, assertSameOrigin, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import {
  createLocalSession,
  localAudit,
  normalizeStudentCode,
  sanitizeDisplayName,
  setLocalSessionCookie,
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
    rateLimit(`local-student-login:${ip}`, 40, 10 * 60 * 1000);

    const body = (await request.json()) as { studentCode?: string; displayName?: string };
    const studentCode = normalizeStudentCode(body.studentCode || "");
    const loginIdLower = normalizeLoginId(studentCode);
    const displayName = body.displayName ? sanitizeDisplayName(body.displayName) : studentCode;

    const account = await withLocalTransaction<LocalAccount>(async (client) => {
      const existing = await client.query<LocalAccount>("SELECT * FROM local_accounts WHERE student_code = $1 OR login_id_lower = $2 LIMIT 1", [
        studentCode,
        loginIdLower
      ]);
      if (existing.rows[0]) {
        const account = existing.rows[0];
        await client.query("UPDATE local_accounts SET student_code = COALESCE(student_code, $1), last_login_at = now() WHERE id = $2", [
          studentCode,
          account.id
        ]);
        await localAudit(client, {
          actorAccountId: account.id,
          action: "local.student.login",
          targetType: "account",
          targetId: account.id,
          request,
          metadata: { studentCode }
        });
        return { ...account, student_code: account.student_code || studentCode };
      }

      const accountId = randomId("acc");
      const result = await client.query<LocalAccount>(
        `INSERT INTO local_accounts
          (id, type, role, login_id, login_id_lower, student_code, password_hash, display_name, disabled, created_at, last_login_at)
         VALUES ($1, 'student', 'participant', $2, $3, $2, $4, $5, false, now(), now())
         RETURNING *`,
        [accountId, studentCode, loginIdLower, await hashPassword(randomId("student")), displayName]
      );
      await localAudit(client, {
        actorAccountId: accountId,
        action: "local.student.create",
        targetType: "account",
        targetId: accountId,
        request,
        metadata: { studentCode }
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
