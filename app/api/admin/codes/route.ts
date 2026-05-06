import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

function adminCodeSeed() {
  if (process.env.ADMIN_CODE_SEED) return process.env.ADMIN_CODE_SEED;
  const seedFile = path.join(process.cwd(), ".data", "firebase-secrets", "ADMIN_CODE_SEED");
  return existsSync(seedFile) ? readFileSync(seedFile, "utf8").trim() : "";
}

function rawCodeForLabel(label: string, seed: string) {
  if (!seed || seed.length < 16) return undefined;
  const suffix = crypto.createHmac("sha256", seed).update(label).digest("base64url").toUpperCase().slice(0, 7);
  return `${label}-${suffix}`;
}

function groupLabel(value?: string) {
  if (!value) return "총괄";
  const normalized = value.toLowerCase();
  if (normalized.includes("chemistry") || value.includes("화학")) return "화학";
  if (normalized.includes("biology") || value.includes("생명")) return "생명";
  if (normalized.includes("quasar") || value.includes("퀘이사")) return "퀘이사";
  if (normalized.includes("alphago") || value.includes("알파고")) return "알파고";
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const { account } = await requireRole(request, ["boothAdmin", "rewardAdmin", "superAdmin"]);
    const db = await readDb();
    const isSuper = account.role === "superAdmin";
    const seed = isSuper ? adminCodeSeed() : "";

    const codes = db.adminInviteCodes.map((code) => {
      const booth = code.boothId ? db.booths.find((item) => item.id === code.boothId) : undefined;
      const reward = code.rewardId ? db.rewards.find((item) => item.id === code.rewardId) : undefined;
      const usedBy = code.usedByAccountId ? db.accounts.find((item) => item.id === code.usedByAccountId) : undefined;
      const groupName = code.role === "superAdmin" ? "총괄" : groupLabel(booth?.clubName || reward?.clubName);
      const integratedClubAdmin = code.role === "boothAdmin" && Boolean(code.rewardId);
      const multiUse = code.role !== "superAdmin";
      const linkedAccounts = db.accounts.filter((account) => (
        account.role === code.role &&
        (code.boothId ? account.boothId === code.boothId : !account.boothId) &&
        (code.rewardId ? account.rewardId === code.rewardId : !account.rewardId)
      ));
      const useCount = multiUse ? Math.max(code.usedCount || 0, linkedAccounts.length) : (code.used ? 1 : 0);

      return {
        codeLabel: code.codeLabel,
        fullCode: isSuper ? rawCodeForLabel(code.codeLabel, seed) : undefined,
        groupName,
        role: integratedClubAdmin ? "통합" : code.role === "boothAdmin" ? "부스" : code.role === "rewardAdmin" ? "보상" : "총괄",
        targetName: integratedClubAdmin ? `${groupName} 통합` : booth?.name || reward?.name || "System",
        used: code.used || useCount > 0,
        multiUse,
        useCount,
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
