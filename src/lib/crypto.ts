import crypto from "node:crypto";
import { promisify } from "node:util";
import { getAppSecret } from "./secrets";

const scryptAsync = promisify(crypto.scrypt);

export function randomId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
}

export function randomCode(label: string) {
  return `${label}-${crypto.randomBytes(5).toString("base64url").toUpperCase()}`;
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64url");
  const expected = Buffer.from(parts[2], "base64url");
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function normalizeLoginId(loginId: string) {
  return loginId.trim().toLowerCase();
}

export function validateLoginId(loginId: string) {
  const normalized = normalizeLoginId(loginId);
  if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(normalized)) {
    throw new Error("아이디는 영문/숫자/._- 조합 3~24자로 입력하세요.");
  }
  return normalized;
}

export function validatePassword(password: string) {
  if (typeof password !== "string" || password.length < 6 || password.length > 128) {
    throw new Error("비밀번호는 6~128자로 입력하세요.");
  }
}

export function normalizeInviteCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export async function hashToken(token: string) {
  const secret = await getAppSecret();
  return crypto.createHmac("sha256", secret).update(token).digest("base64url");
}

async function signPayload(payload: string) {
  const secret = await getAppSecret();
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

async function verifySignature(payload: string, signature: string) {
  const expected = await signPayload(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function createParticipantQrToken(accountId: string, qrVersion: number) {
  const payload = `participant:${accountId}:${qrVersion}`;
  const signature = await signPayload(payload);
  return `p.${accountId}.${qrVersion}.${signature}`;
}

export async function verifyParticipantQrToken(token: string) {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "p") return null;
  const [, accountId, versionText, signature] = parts;
  const qrVersion = Number(versionText);
  if (!/^acc_[A-Za-z0-9_-]+$/.test(accountId) || !Number.isInteger(qrVersion)) return null;
  const payload = `participant:${accountId}:${qrVersion}`;
  if (!(await verifySignature(payload, signature))) return null;
  return { accountId, qrVersion };
}

export async function createCouponQrToken(couponId: string) {
  const payload = `coupon:${couponId}`;
  const signature = await signPayload(payload);
  return `c.${couponId}.${signature}`;
}

export async function verifyCouponQrToken(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "c") return null;
  const [, couponId, signature] = parts;
  if (!/^cpn_[A-Za-z0-9_-]+$/.test(couponId)) return null;
  const payload = `coupon:${couponId}`;
  if (!(await verifySignature(payload, signature))) return null;
  return { couponId };
}

export async function createTempPassQrToken(tempPassId: string, qrVersion: number) {
  const payload = `tempPass:${tempPassId}:${qrVersion}`;
  const signature = await signPayload(payload);
  return `t.${tempPassId}.${qrVersion}.${signature}`;
}

export async function verifyTempPassQrToken(token: string) {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "t") return null;
  const [, tempPassId, versionText, signature] = parts;
  const qrVersion = Number(versionText);
  if (!/^tmp_[A-Za-z0-9_-]+$/.test(tempPassId) || !Number.isInteger(qrVersion)) return null;
  const payload = `tempPass:${tempPassId}:${qrVersion}`;
  if (!(await verifySignature(payload, signature))) return null;
  return { tempPassId, qrVersion };
}

const RESERVED_NAME_WORDS = ["admin", "staff", "super", "관리자", "운영자", "부스관리자", "총괄"];

export function sanitizeDisplayName(value: string) {
  const collapsed = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const cleaned = collapsed.replace(/[<>{}[\]"'`\\]/g, "");
  const length = Array.from(cleaned).length;
  if (length < 2 || length > 12) {
    throw new Error("이름은 2~12자로 입력하세요.");
  }
  const lower = cleaned.toLowerCase();
  if (RESERVED_NAME_WORDS.some((word) => lower.includes(word.toLowerCase()))) {
    throw new Error("관리자처럼 보이는 이름은 사용할 수 없습니다.");
  }
  return cleaned;
}

export function sanitizeBio(value: string) {
  return value.normalize("NFKC").replace(/[<>{}[\]"'`\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function clientFingerprint(headers: Headers) {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const userAgent = headers.get("user-agent") || "unknown";
  return { ip, userAgent };
}

export async function hashFingerprint(value: string) {
  return hashToken(value);
}

export function defaultStampDataUrl(boothName: string) {
  const safeName = boothName.replace(/[<>&"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" rx="44" fill="#fff7ed"/><circle cx="120" cy="120" r="82" fill="none" stroke="#ef4444" stroke-width="13"/><circle cx="120" cy="120" r="56" fill="none" stroke="#f97316" stroke-width="6"/><text x="120" y="113" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#b91c1c">WSHS</text><text x="120" y="145" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#9a3412">${safeName}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
