import { NextRequest } from "next/server";
import { assertSameOrigin, jsonError, jsonOk } from "@/lib/http";
import { clearLocalSessionCookie, getLocalSession, localQuery } from "@/lib/local-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const current = await getLocalSession(request);
    if (current) {
      await localQuery("UPDATE local_sessions SET revoked = true WHERE id = $1", [current.session.id]);
    }
    const response = jsonOk({ ok: true });
    clearLocalSessionCookie(response);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
