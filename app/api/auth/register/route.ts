import { NextRequest } from "next/server";
import { assertSameOrigin, HttpError, jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    throw new HttpError(410, "참가자는 학번으로 입장하세요.");
  } catch (error) {
    return jsonError(error);
  }
}
