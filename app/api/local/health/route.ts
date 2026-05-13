import { localQuery } from "@/lib/local-server";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const startedAt = Date.now();
    const db = await localQuery<{ ok: number; now: string }>("SELECT 1 AS ok, now()::text AS now");
    return jsonOk({
      ok: true,
      db: db.rows[0],
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - startedAt
    });
  } catch (error) {
    return jsonError(error);
  }
}
