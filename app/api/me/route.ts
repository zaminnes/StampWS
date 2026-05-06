import { NextRequest } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { buildMePayload } from "@/lib/views";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const current = await getCurrentSession(request);
    if (!current) return jsonOk({ account: null });
    const db = await readDb();
    return jsonOk(await buildMePayload(current.account, db));
  } catch (error) {
    return jsonError(error);
  }
}
