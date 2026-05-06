import { NextRequest } from "next/server";
import { createSession, recordLoginFailure, setSessionCookie } from "@/lib/auth";
import { clientFingerprint, normalizeLoginId, verifyPassword } from "@/lib/crypto";
import { readDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const { ip } = clientFingerprint(request.headers);
    rateLimit(`login:${ip}`, 15, 10 * 60 * 1000);

    const body = (await request.json()) as { loginId?: string; password?: string };
    const loginIdLower = normalizeLoginId(body.loginId || "");
    const db = await readDb();
    const account = db.accounts.find((item) => item.loginIdLower === loginIdLower);
    if (!account || account.disabled || !(await verifyPassword(body.password || "", account.passwordHash))) {
      await recordLoginFailure(request, loginIdLower || "-", "아이디 또는 비밀번호 오류", account?.role);
      throw new HttpError(401, "아이디 또는 비밀번호가 올바르지 않습니다.");
    }

    const { session, token, deviceId } = await createSession(account, request);
    const response = jsonOk({ ok: true });
    setSessionCookie(response, session.id, token, deviceId);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
