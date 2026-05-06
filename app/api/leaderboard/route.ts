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

function speedrunRow(params: {
  accountId: string;
  displayName: string;
  bio: string;
  avatarStampImageDataUrl?: string;
  stampCount: number;
  firstStampAt: string;
  completedSevenAt: string;
  lastStampAt?: string;
}) {
  return {
    ...params,
    durationMs: Math.max(0, new Date(params.completedSevenAt).getTime() - new Date(params.firstStampAt).getTime())
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireCurrentSession(request);
    const db = await readDb();
    const participants = db.accounts.filter((account) => account.role === "participant" && !account.disabled);
    const participantRows = participants
      .map((account) => {
        const profile = db.profiles.find((item) => item.accountId === account.id) || defaultProfile(account);
        const stats = db.userStats.find((item) => item.accountId === account.id) || defaultStats(account.id);
        const participantStamps = db.stamps
          .filter((stamp) => stamp.participantAccountId === account.id && !stamp.voided)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        if (participantStamps.length < 7) return null;
        const firstStampAt = participantStamps[0].createdAt;
        const completedSevenAt = stats.completedSevenAt || participantStamps[6].createdAt;
        const avatarStamp = profile.avatarStampId
          ? db.stamps.find((stamp) => stamp.id === profile.avatarStampId && !stamp.voided)
          : undefined;

        return speedrunRow({
          accountId: account.id,
          displayName: account.displayName,
          bio: profile.bio,
          avatarStampImageDataUrl: avatarStamp ? resolveStampImage(avatarStamp.stampImageDataUrl, db) : undefined,
          stampCount: participantStamps.length,
          firstStampAt,
          completedSevenAt,
          lastStampAt: stats.lastStampAt
        });
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const tempRows = db.tempPasses
      .map((pass) => {
        const stamps = pass.stamps.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        if (stamps.length < 7) return null;
        const firstStampAt = stamps[0].createdAt;
        const completedSevenAt = stamps[6].createdAt;
        return speedrunRow({
          accountId: pass.id,
          displayName: pass.displayName || pass.label,
          bio: "임시 QR",
          stampCount: stamps.length,
          firstStampAt,
          completedSevenAt,
          lastStampAt: stamps[stamps.length - 1]?.createdAt
        });
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const baseRows = [...participantRows, ...tempRows]
      .sort((a, b) => {
        if (a.durationMs !== b.durationMs) return a.durationMs - b.durationMs;
        if (a.completedSevenAt !== b.completedSevenAt) return a.completedSevenAt.localeCompare(b.completedSevenAt);
        return (a.lastStampAt || "9999").localeCompare(b.lastStampAt || "9999");
      })
      .slice(0, 50);

    const firstDuration = baseRows[0]?.durationMs;
    const secondDuration = baseRows[1]?.durationMs;
    const rows = baseRows.map((row, index) => ({
      ...row,
      rank: index + 1,
      behindFirstMs: typeof firstDuration === "number" ? Math.max(0, row.durationMs - firstDuration) : 0,
      behindSecondMs: typeof secondDuration === "number" ? Math.max(0, row.durationMs - secondDuration) : 0
    }));

    return jsonOk({ rows });
  } catch (error) {
    return jsonError(error);
  }
}
