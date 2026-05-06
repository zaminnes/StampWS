import { NextRequest } from "next/server";
import { requireCurrentSession } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, randomId, sanitizeBio, sanitizeDisplayName } from "@/lib/crypto";
import { updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const THEMES = new Set(["science", "mint", "sunset", "space", "clean", "mono"]);
const FRAMES = new Set(["clean", "lab", "orbit", "spark", "winner"]);

function koreaDayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 8192);
    const current = await requireCurrentSession(request);
    const { ip, userAgent } = clientFingerprint(request.headers);
    rateLimit(`profile:${current.account.id}`, 12, 10 * 60 * 1000);

    const body = (await request.json()) as {
      displayName?: string;
      bio?: string;
      avatarStampId?: string | null;
      themeId?: string;
      frameId?: string;
    };

    const nextDisplayName = body.displayName === undefined ? undefined : sanitizeDisplayName(body.displayName);
    const nextBio = body.bio === undefined ? undefined : sanitizeBio(body.bio);
    const nextThemeId = body.themeId && THEMES.has(body.themeId) ? body.themeId : undefined;
    const nextFrameId = body.frameId && FRAMES.has(body.frameId) ? body.frameId : undefined;

    await updateDb(async (db) => {
      const account = db.accounts.find((item) => item.id === current.account.id);
      if (!account || account.disabled) throw new HttpError(401, "계정을 찾을 수 없습니다.");

      const now = new Date().toISOString();
      if (nextDisplayName && nextDisplayName !== account.displayName) {
        const lastChanged = account.displayNameChangedAt ? Date.parse(account.displayNameChangedAt) : 0;
        const tooSoon = Date.now() - lastChanged < 10 * 60 * 1000;
        const dayKey = koreaDayKey();
        const countToday = account.displayNameChangeDay === dayKey ? account.displayNameChangeCountToday || 0 : 0;

        if (account.role !== "superAdmin" && tooSoon) {
          throw new HttpError(429, "이름은 10분에 한 번만 변경할 수 있습니다.");
        }
        if (account.role !== "superAdmin" && countToday >= 5) {
          throw new HttpError(429, "이름은 하루 최대 5번까지 변경할 수 있습니다.");
        }

        db.nameChangeLogs.push({
          id: randomId("name"),
          accountId: account.id,
          oldDisplayName: account.displayName,
          newDisplayName: nextDisplayName,
          changedAt: now,
          ipHash: await hashFingerprint(ip),
          userAgentHash: await hashFingerprint(userAgent)
        });

        account.displayName = nextDisplayName;
        account.displayNameChangedAt = now;
        account.displayNameChangeDay = dayKey;
        account.displayNameChangeCountToday = countToday + 1;
      }

      if (account.role === "participant") {
        let profile = db.profiles.find((item) => item.accountId === account.id);
        if (!profile) {
          profile = {
            accountId: account.id,
            nickname: account.displayName,
            bio: "",
            themeId: "science",
            frameId: "clean",
            publicProfile: true,
            updatedAt: now
          };
          db.profiles.push(profile);
        }

        if (nextDisplayName) profile.nickname = account.displayName;
        if (nextBio !== undefined) profile.bio = nextBio;
        if (nextThemeId) profile.themeId = nextThemeId;
        if (nextFrameId) profile.frameId = nextFrameId;

        if (body.avatarStampId !== undefined) {
          if (body.avatarStampId === null || body.avatarStampId === "") {
            profile.avatarStampId = undefined;
          } else {
            const stamp = db.stamps.find(
              (item) => item.id === body.avatarStampId && item.participantAccountId === account.id && !item.voided
            );
            if (!stamp) throw new HttpError(403, "받은 스탬프만 프로필 사진으로 설정할 수 있습니다.");
            profile.avatarStampId = stamp.id;
          }
        }

        profile.updatedAt = now;
      }

      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: account.id,
        action: "profile.update",
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent)
      });
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
