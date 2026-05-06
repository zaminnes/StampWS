import { NextRequest, NextResponse } from "next/server";
import { clientFingerprint, hashFingerprint, hashToken, randomId } from "./crypto";
import { readDb, updateDb } from "./db";
import { HttpError } from "./http";
import type { Account, Role, Session } from "./types";

export const SESSION_COOKIE = "wshs_stamp_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

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

export async function createSession(account: Account, request: NextRequest) {
  const now = new Date();
  const token = randomId("tok");
  const tokenHash = await hashToken(token);
  const { ip, userAgent } = clientFingerprint(request.headers);
  const session: Session = {
    id: randomId("sess"),
    accountId: account.id,
    tokenHash,
    role: account.role,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
    revoked: false,
    ipHash: await hashFingerprint(ip),
    userAgentHash: await hashFingerprint(userAgent)
  };

  await updateDb((db) => {
    db.sessions = db.sessions.filter((item) => item.expiresAt > now.toISOString() && !item.revoked);
    db.sessions.push(session);
    const storedAccount = db.accounts.find((item) => item.id === account.id);
    if (storedAccount) storedAccount.lastLoginAt = now.toISOString();
  });

  return { session, token };
}

export function setSessionCookie(response: NextResponse, sessionId: string, token: string) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: `${sessionId}.${token}`,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
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
