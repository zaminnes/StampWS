import { NextRequest } from "next/server";
import { clearSessionCookie, revokeSession } from "@/lib/auth";
import { assertSameOrigin, jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await revokeSession(request);
    const response = jsonOk({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
