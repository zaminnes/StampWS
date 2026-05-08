import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireCurrentSession } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, randomId } from "@/lib/crypto";
import { readDb, updateDb } from "@/lib/db";
import { assertSameOrigin, assertContentLength, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { assertTeaMakerAccess } from "@/lib/tea-access";

export const runtime = "nodejs";

const MAX_FIRMWARE_BYTES = 180_000;

async function defaultFirmwareText() {
  try {
    return await fs.readFile(path.join(process.cwd(), "public", "arduino", "alphago_tea_maker_full.ino"), "utf8");
  } catch {
    return "";
  }
}

function validateFirmwareText(value: unknown) {
  if (typeof value !== "string") throw new HttpError(400, "INO 텍스트를 넣어주세요.");
  const text = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const size = new TextEncoder().encode(text).byteLength;
  if (size < 200) throw new HttpError(400, "INO 파일이 너무 짧습니다.");
  if (size > MAX_FIRMWARE_BYTES) throw new HttpError(413, "INO 파일은 180KB 이하만 저장됩니다.");
  if (text.includes("\0")) throw new HttpError(400, "텍스트 INO만 저장할 수 있습니다.");
  if (!/\bvoid\s+setup\s*\(/.test(text) || !/\bvoid\s+loop\s*\(/.test(text)) {
    throw new HttpError(400, "Arduino 실행 파일에는 void setup()과 void loop()가 필요합니다.");
  }
  return `${text}\n`;
}

export async function GET(request: NextRequest) {
  try {
    const current = await requireCurrentSession(request);
    assertTeaMakerAccess(current.account);
    const db = await readDb();
    const useDefault = request.nextUrl.searchParams.get("default") === "1";
    const firmwareText = useDefault ? await defaultFirmwareText() : db.meta.arduinoFirmwareText || (await defaultFirmwareText());
    const updatedAt = db.meta.arduinoFirmwareUpdatedAt;

    if (request.nextUrl.searchParams.get("raw") === "1") {
      return new NextResponse(firmwareText, {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Content-Type": "text/x-arduino; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"alphago_tea_maker_full.ino\"",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }

    return jsonOk({
      firmwareText,
      updatedAt: useDefault ? undefined : updatedAt,
      source: !useDefault && db.meta.arduinoFirmwareText ? "storage" : "default"
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, MAX_FIRMWARE_BYTES + 4096);
    const current = await requireCurrentSession(request);
    assertTeaMakerAccess(current.account);
    rateLimit(`tea-firmware:${current.account.id}`, 20, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { firmwareText?: string };
    const firmwareText = validateFirmwareText(body.firmwareText);

    const result = await updateDb(async (db) => {
      const account = db.accounts.find((item) => item.id === current.account.id);
      assertTeaMakerAccess(account);
      const now = new Date().toISOString();
      db.meta.arduinoFirmwareText = firmwareText;
      db.meta.arduinoFirmwareUpdatedAt = now;
      db.meta.arduinoFirmwareUpdatedByAccountId = account?.id;
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: account?.id || current.account.id,
        action: "tea.firmware.save",
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: {
          bytes: new TextEncoder().encode(firmwareText).byteLength
        }
      });
      return { updatedAt: now, bytes: new TextEncoder().encode(firmwareText).byteLength };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
