import { NextRequest } from "next/server";
import { assertContentLength, assertSameOrigin, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import {
  createLocalAdminInviteCode,
  localAudit,
  localQuery,
  requireLocalRole,
  sanitizeLocalText,
  slugFromName,
  withLocalTransaction
} from "@/lib/local-server";
import { randomId } from "@/lib/crypto";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireLocalRole(request, ["superAdmin"]);
    const result = await localQuery("SELECT * FROM local_booths ORDER BY created_at DESC");
    return jsonOk({ booths: result.rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireLocalRole(request, ["superAdmin"]);
    rateLimit(`local-booth-create:${current.account.id}`, 60, 10 * 60 * 1000);

    const body = (await request.json()) as { name?: string; clubName?: string; location?: string; createCode?: boolean };
    const name = sanitizeLocalText(body.name || "", 2, 28, "부스 이름");
    const clubName = sanitizeLocalText(body.clubName || body.name || "", 2, 28, "동아리 이름");
    const location = body.location ? sanitizeLocalText(body.location, 0, 40, "위치") : "";

    const result = await withLocalTransaction(async (client) => {
      const boothId = randomId("booth");
      const baseSlug = slugFromName(name);
      const slug = `${baseSlug}-${boothId.slice(-5).toLowerCase()}`;
      const booth = await client.query(
        `INSERT INTO local_booths (id, slug, name, club_name, location, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, now(), now())
         RETURNING *`,
        [boothId, slug, name, clubName, location]
      );
      const invite = body.createCode === false
        ? null
        : await createLocalAdminInviteCode(client, {
            boothId,
            role: "boothAdmin",
            label: `BOOTH-${slug.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 18)}`
          });
      await localAudit(client, {
        actorAccountId: current.account.id,
        action: "local.booth.create",
        targetType: "booth",
        targetId: boothId,
        request,
        metadata: { name, clubName, codeCreated: Boolean(invite) }
      });
      return { booth: booth.rows[0], inviteCode: invite?.rawCode };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
