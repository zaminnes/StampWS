import { NextRequest } from "next/server";
import { requireCurrentSession } from "@/lib/auth";
import { clubIdFromBoothId } from "@/lib/booth-access";
import { clientFingerprint, hashFingerprint, randomId } from "@/lib/crypto";
import { readDb, updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import type { Account, StampDb } from "@/lib/types";

export const runtime = "nodejs";

function sanitizeNotice(value: string) {
  return value.normalize("NFKC").replace(/[<>{}[\]"'`\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function clubIdForAccount(account: Account) {
  if (account.role === "boothAdmin") return clubIdFromBoothId(account.boothId);
  if (account.role === "rewardAdmin") return account.rewardId || "";
  return "";
}

function clubNameForId(db: StampDb, clubId: string) {
  return db.booths.find((booth) => clubIdFromBoothId(booth.id) === clubId)?.clubName ||
    db.rewards.find((reward) => reward.id === clubId)?.clubName ||
    clubId;
}

function noticeView(db: StampDb) {
  return db.clubNotices
    .filter((notice) => !notice.revoked)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
    .map((notice) => {
      const createdBy = db.accounts.find((account) => account.id === notice.createdByAccountId);
      return {
        id: notice.id,
        clubId: notice.clubId,
        clubName: notice.clubName,
        message: notice.message,
        createdAt: notice.createdAt,
        createdByDisplayName: createdBy?.displayName || "관리자"
      };
    });
}

export async function GET(request: NextRequest) {
  try {
    const current = await requireCurrentSession(request);
    const db = await readDb();
    const account = db.accounts.find((item) => item.id === current.account.id);
    if (!account || account.disabled) throw new HttpError(401, "계정을 찾을 수 없습니다.");
    const postClubId = current.session.role === "superAdmin" ? "" : current.session.role === "participant" ? "" : clubIdForAccount(account);
    return jsonOk({
      notices: noticeView(db),
      canPost: current.session.role === "superAdmin" || Boolean(postClubId),
      postClubId,
      postClubName: postClubId ? clubNameForId(db, postClubId) : "총괄"
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireCurrentSession(request);
    rateLimit(`notice:${current.account.id}`, 30, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { message?: string; clubId?: string };
    const message = sanitizeNotice(body.message || "");
    if (message.length < 2) throw new HttpError(400, "공지 내용을 입력하세요.");

    const result = await updateDb(async (db) => {
      const account = db.accounts.find((item) => item.id === current.account.id);
      if (!account || account.disabled || current.session.role === "participant") {
        throw new HttpError(403, "공지 권한이 없습니다.");
      }
      const clubId = current.session.role === "superAdmin" ? sanitizeNotice(body.clubId || "all").slice(0, 32) : clubIdForAccount(account);
      if (!clubId) throw new HttpError(403, "동아리 계정만 공지를 보낼 수 있습니다.");
      const clubName = clubId === "all" ? "전체" : clubNameForId(db, clubId);
      const now = new Date().toISOString();
      const notice = {
        id: randomId("notice"),
        clubId,
        clubName,
        message,
        createdByAccountId: account.id,
        createdAt: now,
        revoked: false
      };
      db.clubNotices.push(notice);
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: account.id,
        action: "club.notice.create",
        targetId: notice.id,
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: { clubId, clubName }
      });
      return noticeView(db);
    });

    return jsonOk({ notices: result });
  } catch (error) {
    return jsonError(error);
  }
}
