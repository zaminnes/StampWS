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
  return booth?.stampImageDataUrl || db.meta.defaultStampImageDataUrl || defaultStampDataUrl(booth?.name || "STAMP");
}

function speedrunRow(params: {
  accountId: string;
  displayName: string;
  bio: string;
  avatarStampImageDataUrl?: string;
  stampCount: number;
  firstStampAt?: string;
  completedSevenAt?: string;
  lastStampAt?: string;
}) {
  const completed = Boolean(params.firstStampAt && params.completedSevenAt && params.stampCount >= 7);
  return {
    ...params,
    completed,
    durationMs: completed
      ? Math.max(0, new Date(params.completedSevenAt as string).getTime() - new Date(params.firstStampAt as string).getTime())
      : null
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
        const firstStampAt = stats.firstStampAt || participantStamps[0]?.createdAt;
        const completedSevenAt = stats.completedSevenAt || participantStamps[6]?.createdAt;
        const avatarStamp = profile.avatarStampId
          ? db.stamps.find((stamp) => stamp.id === profile.avatarStampId && !stamp.voided)
          : participantStamps[participantStamps.length - 1];

        return speedrunRow({
          accountId: account.id,
          displayName: account.displayName,
          bio: profile.bio,
          avatarStampImageDataUrl: avatarStamp ? resolveStampImage(avatarStamp.stampImageDataUrl, db) : undefined,
          stampCount: participantStamps.length,
          firstStampAt,
          completedSevenAt,
          lastStampAt: stats.lastStampAt || participantStamps[participantStamps.length - 1]?.createdAt
        });
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const baseRows = participantRows
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? -1 : 1;
        if (a.completed && b.completed) {
          if (a.durationMs !== b.durationMs) return (a.durationMs || 0) - (b.durationMs || 0);
          if (a.completedSevenAt !== b.completedSevenAt) return (a.completedSevenAt || "").localeCompare(b.completedSevenAt || "");
        } else {
          if (a.stampCount !== b.stampCount) return b.stampCount - a.stampCount;
          if ((a.firstStampAt || "") !== (b.firstStampAt || "")) return (a.firstStampAt || "9999").localeCompare(b.firstStampAt || "9999");
        }
        return (a.lastStampAt || "9999").localeCompare(b.lastStampAt || "9999");
      })
      .slice(0, 50);

    const completedRows = baseRows.filter((row) => row.completed);
    const firstDuration = completedRows[0]?.durationMs;
    const secondDuration = completedRows[1]?.durationMs;
    const rows = baseRows.map((row, index) => ({
      ...row,
      rank: index + 1,
      behindFirstMs: row.completed && typeof firstDuration === "number" && typeof row.durationMs === "number" ? Math.max(0, row.durationMs - firstDuration) : 0,
      behindSecondMs: row.completed && typeof secondDuration === "number" && typeof row.durationMs === "number" ? Math.max(0, row.durationMs - secondDuration) : 0
    }));

    return jsonOk({ rows });
  } catch (error) {
    return jsonError(error);
  }
}
