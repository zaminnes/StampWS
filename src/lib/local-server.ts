import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import pg from "pg";
import {
  clientFingerprint,
  hashFingerprint,
  hashPassword,
  hashToken,
  normalizeInviteCode,
  normalizeLoginId,
  randomCode,
  randomId,
  sanitizeDisplayName,
  verifyPassword
} from "./crypto";
import { HttpError } from "./http";

const { Pool } = pg;

const LOCAL_SESSION_COOKIE = "stampws_local_session";
const LOCAL_DEVICE_COOKIE = "stampws_local_device";
const LOCAL_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const LOCAL_DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 60;

type LocalRole = "participant" | "boothAdmin" | "rewardAdmin" | "superAdmin";
type LocalAccountType = "student" | "guest" | "admin";

export type LocalAccount = {
  id: string;
  type: LocalAccountType;
  role: LocalRole;
  login_id: string;
  login_id_lower: string;
  student_code?: string | null;
  guest_pass_id?: string | null;
  password_hash?: string | null;
  display_name: string;
  disabled: boolean;
  created_at: string;
  last_login_at?: string | null;
};

export type LocalSession = {
  id: string;
  account_id: string;
  token_hash: string;
  role: LocalRole;
  revoked: boolean;
  expires_at: string;
};

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
};

declare global {
  var stampwsLocalPool: pg.Pool | undefined;
  var stampwsLocalSchemaReady: Promise<void> | undefined;
}

function localDatabaseUrl() {
  const value = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
  if (!value) {
    throw new HttpError(503, "LOCAL_DATABASE_URL 또는 DATABASE_URL이 필요합니다.");
  }
  return value;
}

function pool() {
  if (!globalThis.stampwsLocalPool) {
    globalThis.stampwsLocalPool = new Pool({
      connectionString: localDatabaseUrl(),
      max: Number(process.env.LOCAL_DB_POOL_MAX || 20),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
  }
  return globalThis.stampwsLocalPool;
}

export async function localQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  await ensureLocalReady();
  return pool().query<T>(text, params);
}

export async function withLocalTransaction<T>(callback: (client: pg.PoolClient) => Promise<T>) {
  await ensureLocalReady();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureLocalReady() {
  if (!globalThis.stampwsLocalSchemaReady) {
    globalThis.stampwsLocalSchemaReady = (async () => {
      const schema = await fs.readFile(path.join(process.cwd(), "db", "local-schema.sql"), "utf8");
      await pool().query(schema);
      await bootstrapLocalSuperAdmin();
    })();
  }
  return globalThis.stampwsLocalSchemaReady;
}

async function bootstrapLocalSuperAdmin() {
  const result = await pool().query<{ count: string }>("SELECT COUNT(*)::text AS count FROM local_accounts WHERE role = 'superAdmin'");
  if (Number(result.rows[0]?.count || 0) > 0) return;

  const password = process.env.LOCAL_SUPERADMIN_PASSWORD || "change-this-password";
  if (process.env.NODE_ENV === "production" && password === "change-this-password") {
    throw new Error("프로덕션 로컬 서버는 LOCAL_SUPERADMIN_PASSWORD를 설정해야 합니다.");
  }
  const now = new Date().toISOString();
  const accountId = randomId("acc");
  await pool().query(
    `INSERT INTO local_accounts
      (id, type, role, login_id, login_id_lower, password_hash, display_name, disabled, created_at)
     VALUES ($1, 'admin', 'superAdmin', 'superadmin', 'superadmin', $2, '총괄 관리자', false, $3)`,
    [accountId, await hashPassword(password), now]
  );
  await pool().query(
    `INSERT INTO local_audit_logs (id, actor_account_id, action, target_type, target_id, metadata, created_at)
     VALUES ($1, $2, 'system.bootstrapSuperAdmin', 'account', $2, $3, $4)`,
    [randomId("audit"), accountId, JSON.stringify({ loginId: "superadmin" }), now]
  );
}

export function normalizeStudentCode(value: string) {
  const normalized = value.normalize("NFKC").replace(/\s+/g, "").trim();
  if (!/^[1-3][0-9]{4}$/.test(normalized)) {
    throw new HttpError(400, "학번은 예: 10214 형식으로 입력하세요.");
  }
  const classNumber = Number(normalized.slice(1, 3));
  const studentNumber = Number(normalized.slice(3, 5));
  if (classNumber < 1 || classNumber > 15 || studentNumber < 1 || studentNumber > 40) {
    throw new HttpError(400, "학년/반/번호가 맞는지 확인하세요.");
  }
  return normalized;
}

export function sanitizeLocalText(value: string, min: number, max: number, label: string) {
  const cleaned = value.normalize("NFKC").replace(/[<>{}[\]"'`\\]/g, "").replace(/\s+/g, " ").trim();
  const length = Array.from(cleaned).length;
  if (length < min || length > max) {
    throw new HttpError(400, `${label}은 ${min}~${max}자로 입력하세요.`);
  }
  return cleaned;
}

export function slugFromName(value: string) {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || randomId("booth").replace(/^booth_/, "booth-");
}

async function requestDevice(request: NextRequest) {
  const deviceId = request.cookies.get(LOCAL_DEVICE_COOKIE)?.value || randomId("dev");
  const { ip, userAgent } = clientFingerprint(request.headers);
  return {
    deviceId,
    deviceHash: await hashToken(deviceId),
    ipHash: await hashFingerprint(ip),
    userAgentHash: await hashFingerprint(userAgent)
  };
}

export async function createLocalSession(account: LocalAccount, request: NextRequest, roleOverride?: LocalRole) {
  const token = randomId("tok");
  const device = await requestDevice(request);
  const now = new Date();
  const session = {
    id: randomId("sess"),
    accountId: account.id,
    token,
    role: roleOverride || account.role,
    expiresAt: new Date(now.getTime() + LOCAL_SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
    deviceId: device.deviceId
  };
  await localQuery(
    `INSERT INTO local_sessions
      (id, account_id, token_hash, role, device_hash, ip_hash, user_agent_hash, revoked, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9)`,
    [
      session.id,
      account.id,
      await hashToken(token),
      session.role,
      device.deviceHash,
      device.ipHash,
      device.userAgentHash,
      now.toISOString(),
      session.expiresAt
    ]
  );
  await localQuery("UPDATE local_accounts SET last_login_at = $1 WHERE id = $2", [now.toISOString(), account.id]);
  return session;
}

export function setLocalSessionCookie(response: NextResponse, session: Awaited<ReturnType<typeof createLocalSession>>) {
  response.cookies.set({
    name: LOCAL_SESSION_COOKIE,
    value: `${session.id}.${session.token}`,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: LOCAL_SESSION_MAX_AGE_SECONDS
  });
  response.cookies.set({
    name: LOCAL_DEVICE_COOKIE,
    value: session.deviceId,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: LOCAL_DEVICE_MAX_AGE_SECONDS
  });
}

export function clearLocalSessionCookie(response: NextResponse) {
  response.cookies.set({ name: LOCAL_SESSION_COOKIE, value: "", httpOnly: true, path: "/", maxAge: 0 });
}

function parseSessionCookie(request: NextRequest) {
  const value = request.cookies.get(LOCAL_SESSION_COOKIE)?.value;
  if (!value) return null;
  const [sessionId, token] = value.split(".");
  if (!sessionId || !token) return null;
  return { sessionId, token };
}

export async function getLocalSession(request: NextRequest) {
  const cookie = parseSessionCookie(request);
  if (!cookie) return null;
  const tokenHash = await hashToken(cookie.token);
  const result = await localQuery<LocalSession & LocalAccount>(
    `SELECT s.id, s.account_id, s.token_hash, s.role, s.revoked, s.expires_at,
            a.id AS account_id_value, a.type, a.role AS account_role, a.login_id, a.login_id_lower,
            a.student_code, a.guest_pass_id, a.password_hash, a.display_name, a.disabled, a.created_at, a.last_login_at
       FROM local_sessions s
       JOIN local_accounts a ON a.id = s.account_id
      WHERE s.id = $1`,
    [cookie.sessionId]
  );
  const row = result.rows[0] as unknown as {
    id: string;
    account_id: string;
    token_hash: string;
    role: LocalRole;
    revoked: boolean;
    expires_at: string;
    account_id_value: string;
    type: LocalAccountType;
    account_role: LocalRole;
    login_id: string;
    login_id_lower: string;
    student_code?: string | null;
    guest_pass_id?: string | null;
    password_hash?: string | null;
    display_name: string;
    disabled: boolean;
    created_at: string;
    last_login_at?: string | null;
  } | undefined;
  if (!row || row.revoked || row.disabled || row.expires_at <= new Date().toISOString() || row.token_hash !== tokenHash) return null;
  return {
    session: {
      id: row.id,
      account_id: row.account_id,
      token_hash: row.token_hash,
      role: row.role,
      revoked: row.revoked,
      expires_at: row.expires_at
    },
    account: {
      id: row.account_id_value,
      type: row.type,
      role: row.account_role,
      login_id: row.login_id,
      login_id_lower: row.login_id_lower,
      student_code: row.student_code,
      guest_pass_id: row.guest_pass_id,
      password_hash: row.password_hash,
      display_name: row.display_name,
      disabled: row.disabled,
      created_at: row.created_at,
      last_login_at: row.last_login_at
    } satisfies LocalAccount
  };
}

export async function requireLocalSession(request: NextRequest) {
  const current = await getLocalSession(request);
  if (!current) throw new HttpError(401, "로그인이 필요합니다.");
  return current;
}

export async function requireLocalRole(request: NextRequest, roles: LocalRole[]) {
  const current = await requireLocalSession(request);
  if (!roles.includes(current.session.role)) {
    throw new HttpError(403, "이 기능을 사용할 권한이 없습니다.");
  }
  return current;
}

export async function localAudit(client: Queryable, params: {
  actorAccountId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  request?: NextRequest;
  metadata?: Record<string, unknown>;
}) {
  const fingerprint = params.request ? clientFingerprint(params.request.headers) : null;
  const ipHash = fingerprint ? await hashFingerprint(fingerprint.ip) : null;
  const userAgentHash = fingerprint ? await hashFingerprint(fingerprint.userAgent) : null;
  await client.query(
    `INSERT INTO local_audit_logs
      (id, actor_account_id, action, target_type, target_id, ip_hash, user_agent_hash, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [
      randomId("audit"),
      params.actorAccountId || null,
      params.action,
      params.targetType || null,
      params.targetId || null,
      ipHash,
      userAgentHash,
      JSON.stringify(params.metadata || {})
    ]
  );
}

export async function createLocalAdminInviteCode(client: Queryable, params: {
  boothId?: string | null;
  role: Exclude<LocalRole, "participant">;
  label: string;
}) {
  const rawCode = randomCode(params.label);
  const codeHash = await hashToken(normalizeInviteCode(rawCode));
  const id = randomId("code");
  await client.query(
    `INSERT INTO local_invite_codes (id, code_label, code_hash, role, booth_id, revoked, created_at)
     VALUES ($1, $2, $3, $4, $5, false, now())`,
    [id, params.label, codeHash, params.role, params.boothId || null]
  );
  return { id, rawCode };
}

export async function createGuestLoginToken(guestPassId: string, version: number) {
  const token = `g.${guestPassId}.${version}.${randomId("guesttok")}`;
  return { token, tokenHash: await hashToken(token) };
}

export async function verifyGuestLoginToken(token: string) {
  if (!/^g\.gpass_[A-Za-z0-9_-]+\.\d+\.guesttok_[A-Za-z0-9_-]+$/.test(token)) return null;
  return { tokenHash: await hashToken(token) };
}

export async function createGoodsClaimToken(orderId: string) {
  const token = `claim.${orderId}.${randomId("claimtok")}`;
  return { token, tokenHash: await hashToken(token) };
}

export async function verifyAdminPassword(loginId: string, password: string) {
  const loginIdLower = normalizeLoginId(loginId);
  const result = await localQuery<LocalAccount>("SELECT * FROM local_accounts WHERE login_id_lower = $1", [loginIdLower]);
  const account = result.rows[0];
  if (!account || account.disabled || account.type !== "admin" || !account.password_hash) return null;
  if (!(await verifyPassword(password, account.password_hash))) return null;
  return account;
}

export async function hashLocalPassword(password: string) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new HttpError(400, "비밀번호는 8~128자로 입력하세요.");
  }
  return hashPassword(password);
}

export function accountView(account: LocalAccount, roleOverride?: LocalRole) {
  return {
    id: account.id,
    type: account.type,
    role: roleOverride || account.role,
    loginId: account.login_id,
    studentCode: account.student_code,
    displayName: account.display_name,
    createdAt: account.created_at,
    lastLoginAt: account.last_login_at
  };
}

export async function localAdminCanUseBooth(accountId: string, sessionRole: LocalRole, boothId: string) {
  if (sessionRole === "superAdmin") return true;
  if (sessionRole !== "boothAdmin") return false;
  const result = await localQuery("SELECT 1 FROM local_admin_booths WHERE account_id = $1 AND booth_id = $2", [accountId, boothId]);
  return (result.rowCount || 0) > 0;
}

export async function requireLocalBoothAccess(accountId: string, sessionRole: LocalRole, boothId: string) {
  if (!(await localAdminCanUseBooth(accountId, sessionRole, boothId))) {
    throw new HttpError(403, "담당 부스만 관리할 수 있습니다.");
  }
}

export { sanitizeDisplayName };
