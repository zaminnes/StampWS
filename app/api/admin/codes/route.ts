import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { account } = await requireRole(request, ["boothAdmin", "rewardAdmin", "superAdmin"]);
    const db = await readDb();
    const isSuper = account.role === "superAdmin";

    const codes = db.adminInviteCodes.map((code) => {
      const booth = code.boothId ? db.booths.find((item) => item.id === code.boothId) : undefined;
      const reward = code.rewardId ? db.rewards.find((item) => item.id === code.rewardId) : undefined;
      const usedBy = code.usedByAccountId ? db.accounts.find((item) => item.id === code.usedByAccountId) : undefined;

      return {
        codeLabel: code.codeLabel,
        role: code.role,
        targetName: booth?.name || reward?.name || "System",
        used: code.used,
        usedAt: code.usedAt,
        revoked: code.revoked,
        usedByDisplayName: isSuper ? usedBy?.displayName : undefined
      };
    });

    return jsonOk({ codes });
  } catch (error) {
    return jsonError(error);
  }
}
