import { NextRequest } from "next/server";
import { requireCurrentSession } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, randomId } from "@/lib/crypto";
import { readDb, updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { assertTeaMakerAccess } from "@/lib/tea-access";
import type { ArduinoButton } from "@/lib/types";

export const runtime = "nodejs";

const MAX_BUTTONS = 24;
const MAX_SCRIPT_BYTES = 64_000;

function normalizeLabel(value: unknown) {
  if (typeof value !== "string") throw new HttpError(400, "버튼 이름을 입력하세요.");
  const label = value.normalize("NFKC").replace(/[<>{}[\]"'`\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 18);
  if (label.length < 1) throw new HttpError(400, "버튼 이름을 입력하세요.");
  return label;
}

function normalizeScript(value: unknown) {
  if (typeof value !== "string") throw new HttpError(400, "INO 스크립트를 입력하세요.");
  const scriptText = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const bytes = new TextEncoder().encode(scriptText).byteLength;
  if (bytes < 1) throw new HttpError(400, "INO 스크립트를 입력하세요.");
  if (bytes > MAX_SCRIPT_BYTES) throw new HttpError(413, "버튼 스크립트는 64KB 이하만 저장됩니다.");
  if (scriptText.includes("\0")) throw new HttpError(400, "텍스트 스크립트만 저장할 수 있습니다.");
  return `${scriptText}\n`;
}

function normalizeButtons(value: unknown, previous: ArduinoButton[], actorAccountId: string, now: string) {
  if (!Array.isArray(value)) throw new HttpError(400, "버튼 목록이 올바르지 않습니다.");
  if (value.length > MAX_BUTTONS) throw new HttpError(413, "버튼은 24개까지 저장됩니다.");
  const previousMap = new Map(previous.map((button) => [button.id, button]));
  const seen = new Set<string>();

  return value.map((item) => {
    const raw = item as { id?: unknown; label?: unknown; scriptText?: unknown };
    const id = typeof raw.id === "string" && /^ardbtn_[A-Za-z0-9_-]+$/.test(raw.id) && !seen.has(raw.id)
      ? raw.id
      : randomId("ardbtn");
    seen.add(id);
    const previousButton = previousMap.get(id);
    return {
      id,
      label: normalizeLabel(raw.label),
      scriptText: normalizeScript(raw.scriptText),
      createdAt: previousButton?.createdAt || now,
      updatedAt: now,
      updatedByAccountId: actorAccountId
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const current = await requireCurrentSession(request);
    assertTeaMakerAccess(current.account);
    const db = await readDb();
    return jsonOk({
      buttons: db.meta.arduinoButtons || [],
      updatedAt: db.meta.arduinoButtonsUpdatedAt
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, MAX_BUTTONS * MAX_SCRIPT_BYTES + 4096);
    const current = await requireCurrentSession(request);
    assertTeaMakerAccess(current.account);
    rateLimit(`tea-buttons:${current.account.id}`, 40, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { buttons?: unknown };

    const result = await updateDb(async (db) => {
      const account = db.accounts.find((item) => item.id === current.account.id);
      assertTeaMakerAccess(account);
      const now = new Date().toISOString();
      const buttons = normalizeButtons(body.buttons, db.meta.arduinoButtons || [], account?.id || current.account.id, now);
      db.meta.arduinoButtons = buttons;
      db.meta.arduinoButtonsUpdatedAt = now;
      db.meta.arduinoButtonsUpdatedByAccountId = account?.id || current.account.id;
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: account?.id || current.account.id,
        action: "tea.arduinoButtons.save",
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: { count: buttons.length }
      });
      return { buttons, updatedAt: now };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
