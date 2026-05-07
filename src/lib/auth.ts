import { NextRequest, NextResponse } from "next/server";
import { clientFingerprint, hashFingerprint, hashToken, randomId } from "./crypto";
import { readDb, updateDb } from "./db";
import { HttpError } from "./http";
import type { Account, LoginEvent, Role, Session } from "./types";

export const SESSION_COOKIE = "wshs_stamp_session";
export const DEVICE_COOKIE = "wshs_stamp_device";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 60;
const PARTICIPANT_SWITCH_WINDOW_MS = 10 * 60 * 1000;
const PARTICIPANT_SWITCH_LIMIT = 2;

export type CurrentSession = {
  account: Account;
  session: Session;
};

function getCookieToken(request: NextRequest) {
  const value = request.cookies.get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const [sessionId, token] = value.split(".");
  if (!sessionId || !token) return null;
  return { sessionId, token };
}

function summarizeUserAgent(userAgent: string) {
  const browser = userAgent.includes("CriOS") || userAgent.includes("Chrome")
    ? "Chrome"
    : userAgent.includes("Safari")
      ? "Safari"
      : userAgent.includes("Firefox")
        ? "Firefox"
        : "Browser";
  const os = userAgent.includes("iPhone")
    ? "iPhone"
    : userAgent.includes("Android")
      ? "Android"
      : userAgent.includes("Macintosh")
        ? "Mac"
        : userAgent.includes("Windows")
          ? "Windows"
          : "Device";
  return `${os} · ${browser}`;
}

export async function getRequestDevice(request: NextRequest) {
  const deviceId = request.cookies.get(DEVICE_COOKIE)?.value || randomId("dev");
  const { ip, userAgent } = clientFingerprint(request.headers);
  return {
    deviceId,
    deviceHash: await hashToken(deviceId),
    ip,
    userAgent,
    ipHash: await hashFingerprint(ip),
    userAgentHash: await hashFingerprint(userAgent),
    userAgentSummary: summarizeUserAgent(userAgent)
  };
}

function loginEventFor(device: Awaited<ReturnType<typeof getRequestDevice>>, data: Omit<LoginEvent, "id" | "deviceHash" | "ipHash" | "userAgentHash" | "userAgentSummary" | "createdAt"> & { createdAt?: string }) {
  return {
    id: randomId("login"),
    ...data,
    deviceHash: device.deviceHash,
    ipHash: device.ipHash,
    userAgentHash: device.userAgentHash,
    userAgentSummary: device.userAgentSummary,
    createdAt: data.createdAt || new Date().toISOString()
  };
}

export async function recordLoginFailure(request: NextRequest, loginId: string, reason: string, role?: Role) {
  const device = await getRequestDevice(request);
  await updateDb((db) => {
    db.loginEvents ||= [];
    db.loginEvents.push(loginEventFor(device, {
      loginId,
      role,
      result: "failed",
      reason
    }));
    db.loginEvents = db.loginEvents.slice(-500);
  });
}

export async function assertParticipantDeviceAllowed(request: NextRequest, loginId: string) {
  const device = await getRequestDevice(request);
  const db = await readDb();
  const block = db.deviceBlocks.find((item) => item.deviceHash === device.deviceHash && item.active);
  if (!block) return device;

  await updateDb((currentDb) => {
    currentDb.loginEvents ||= [];
    currentDb.loginEvents.push(loginEventFor(device, {
      loginId,
      role: "participant",
      result: "blocked",
      reason: block.reason
    }));
    currentDb.loginEvents = currentDb.loginEvents.slice(-500);
  });
  throw new HttpError(423, "같은 기기에서 여러 학번으로 반복 입장해 잠겼습니다. 관리자에게 문의하세요.");
}

export async function createSession(account: Account, request: NextRequest) {
  const now = new Date();
  const token = randomId("tok");
  const tokenHash = await hashToken(token);
  const device = await getRequestDevice(request);
  const session: Session = {
    id: randomId("sess"),
    accountId: account.id,
    tokenHash,
    role: account.role,
    deviceHash: device.deviceHash,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
    revoked: false,
    ipHash: device.ipHash,
    userAgentHash: device.userAgentHash
  };

  await updateDb((db) => {
    db.sessions = db.sessions.filter((item) => item.expiresAt > now.toISOString() && !item.revoked);
    db.sessions.push(session);
    const storedAccount = db.accounts.find((item) => item.id === account.id);
    if (storedAccount) storedAccount.lastLoginAt = now.toISOString();
    db.loginEvents ||= [];
    db.deviceBlocks ||= [];
    db.loginEvents.push(loginEventFor(device, {
      accountId: account.id,
      loginId: account.loginId,
      role: account.role,
      displayName: account.displayName,
      result: "success",
      createdAt: now.toISOString()
    }));
    db.loginEvents = db.loginEvents.slice(-500);

    if (account.role === "participant") {
      const since = new Date(now.getTime() - PARTICIPANT_SWITCH_WINDOW_MS).toISOString();
      const recentParticipantLogins = db.loginEvents.filter((event) => (
        event.deviceHash === device.deviceHash &&
        event.role === "participant" &&
        event.result === "success" &&
        event.createdAt >= since &&
        Boolean(event.accountId)
      ));
      const accountIds = [...new Set(recentParticipantLogins.map((event) => event.accountId).filter(Boolean))] as string[];
      if (accountIds.length >= PARTICIPANT_SWITCH_LIMIT && !db.deviceBlocks.some((block) => block.deviceHash === device.deviceHash && block.active)) {
        const loginIds = [...new Set(recentParticipantLogins.map((event) => event.loginId))];
        db.deviceBlocks.push({
          id: randomId("devblk"),
          deviceHash: device.deviceHash,
          reason: "짧은 시간에 여러 참가자 계정 로그인",
          accountIds,
          loginIds,
          active: true,
          createdAt: now.toISOString()
        });
      }
    }
  });

  return { session, token, deviceId: device.deviceId };
}

export function setSessionCookie(response: NextResponse, sessionId: string, token: string, deviceId?: string) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: `${sessionId}.${token}`,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
  if (deviceId) {
    response.cookies.set({
      name: DEVICE_COOKIE,
      value: deviceId,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: DEVICE_MAX_AGE_SECONDS
    });
  }
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0
  });
}

export async function getCurrentSession(request: NextRequest): Promise<CurrentSession | null> {
  const cookie = getCookieToken(request);
  if (!cookie) return null;

  const db = await readDb();
  const session = db.sessions.find((item) => item.id === cookie.sessionId);
  if (!session || session.revoked || session.expiresAt <= new Date().toISOString()) return null;

  const tokenHash = await hashToken(cookie.token);
  if (session.tokenHash !== tokenHash) return null;

  const account = db.accounts.find((item) => item.id === session.accountId);
  if (!account || account.disabled) return null;

  return { account, session };
}

export async function requireCurrentSession(request: NextRequest) {
  const current = await getCurrentSession(request);
  if (!current) throw new HttpError(401, "로그인이 필요합니다.");
  return current;
}

export async function requireRole(request: NextRequest, roles: Role[]) {
  const current = await requireCurrentSession(request);
  if (!roles.includes(current.account.role)) {
    throw new HttpError(403, "이 기능을 사용할 권한이 없습니다.");
  }
  return current;
}

export async function revokeSession(request: NextRequest) {
  const cookie = getCookieToken(request);
  if (!cookie) return;
  await updateDb((db) => {
    const session = db.sessions.find((item) => item.id === cookie.sessionId);
    if (session) session.revoked = true;
  });
}
