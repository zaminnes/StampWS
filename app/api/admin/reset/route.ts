import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { clientFingerprint, hashFingerprint } from "@/lib/crypto";
import { resetDbToClubSetup } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 1024);
    const current = await requireRole(request, ["superAdmin"]);
    rateLimit(`admin-reset:${current.account.id}`, 3, 60 * 60 * 1000);

    const body = (await request.json()) as { confirm?: string };
    if (body.confirm !== "RESET") {
      throw new HttpError(400, "RESET을 정확히 입력하세요.");
    }

    const { ip, userAgent } = clientFingerprint(request.headers);
    const result = await resetDbToClubSetup(current.account.id, await hashFingerprint(ip), await hashFingerprint(userAgent));
    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
