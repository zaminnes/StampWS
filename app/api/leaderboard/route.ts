import { NextRequest } from "next/server";
import { requireCurrentSession } from "@/lib/auth";
import { defaultStampDataUrl } from "@/lib/crypto";
import { readDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { defaultProfile, defaultStats } from "@/lib/views";

export const runtime = "nodejs";

function resolveStampImage(stampImageDataUrl: string, db: Awaited<ReturnType<typeof readDb>>) {
  if (!stampImageDataUrl.startsWith("booth:")) return stampImageDataUrl;
  const boothId = stampImageDataUrl.split(":")[1];
  const booth = db.booths.find((item) => item.id === boothId);
  return booth?.stampImageDataUrl || defaultStampDataUrl(booth?.name || "STAMP");
}

export async function GET(request: NextRequest) {
  try {
    await requireCurrentSession(request);
    const db = await readDb();
    const participants = db.accounts.filter((account) => account.role === "participant" && !account.disabled);
    const rows = participants
      .map((account) => {
        const profile = db.profiles.find((item) => item.accountId === account.id) || defaultProfile(account);
        const stats = db.userStats.find((item) => item.accountId === account.id) || defaultStats(account.id);
        const avatarStamp = profile.avatarStampId
          ? db.stamps.find((stamp) => stamp.id === profile.avatarStampId && !stamp.voided)
          : undefined;

        return {
          accountId: account.id,
          displayName: account.displayName,
          bio: profile.bio,
          avatarStampImageDataUrl: avatarStamp ? resolveStampImage(avatarStamp.stampImageDataUrl, db) : undefined,
          themeId: profile.themeId,
          frameId: profile.frameId,
          stampCount: stats.stampCount,
          completedSevenAt: stats.completedSevenAt,
          lastStampAt: stats.lastStampAt
        };
      })
      .sort((a, b) => {
        if (b.stampCount !== a.stampCount) return b.stampCount - a.stampCount;
        const aCompleted = a.completedSevenAt || "9999";
        const bCompleted = b.completedSevenAt || "9999";
        if (aCompleted !== bCompleted) return aCompleted.localeCompare(bCompleted);
        return (a.lastStampAt || "9999").localeCompare(b.lastStampAt || "9999");
      })
      .slice(0, 50)
      .map((row, index) => ({ ...row, rank: index + 1 }));

    return jsonOk({ rows });
  } catch (error) {
    return jsonError(error);
  }
}
