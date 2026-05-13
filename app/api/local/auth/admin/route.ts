import { NextRequest } from "next/server";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createLocalSession, setLocalSessionCookie, verifyAdminPassword } from "@/lib/local-server";
import { clientFingerprint } from "@/lib/crypto";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const { ip } = clientFingerprint(request.headers);
    rateLimit(`local-admin-login:${ip}`, 20, 10 * 60 * 1000);

    const body = (await request.json()) as { loginId?: string; password?: string };
    const account = await verifyAdminPassword(body.loginId || "", body.password || "");
    if (!account) throw new HttpError(401, "아이디 또는 비밀번호가 올바르지 않습니다.");

    const session = await createLocalSession(account, request);
    const response = jsonOk({ ok: true });
    setLocalSessionCookie(response, session);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
