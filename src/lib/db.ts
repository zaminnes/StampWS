import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  Account,
  AdminInviteCode,
  AuditLog,
  Booth,
  Coupon,
  NameChangeLog,
  Profile,
  RewardId,
  RewardItem,
  Session,
  Stamp,
  StampDb,
  UserStats
} from "./types";
import { hashPassword, hashToken, normalizeInviteCode, randomCode, randomId } from "./crypto";

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "stamp-db.json");
const BOOTSTRAP_FILE = path.join(DATA_DIR, "bootstrap-secrets.txt");

const FIRESTORE_API = "https://firestore.googleapis.com/v1";
const META_COLLECTION = "stampAppMeta";
const META_ID = "state";

const COLLECTIONS = {
  accounts: "stampAppAccounts",
  sessions: "stampAppSessions",
  adminInviteCodes: "stampAppAdminInviteCodes",
  booths: "stampAppBooths",
  rewards: "stampAppRewards",
  stamps: "stampAppStamps",
  coupons: "stampAppCoupons",
  profiles: "stampAppProfiles",
  userStats: "stampAppUserStats",
  nameChangeLogs: "stampAppNameChangeLogs",
  auditLogs: "stampAppAuditLogs"
} as const;

type CollectionKey = keyof typeof COLLECTIONS;

const REWARDS: RewardItem[] = [
  { id: "chemistry", name: "Dalgona", clubName: "Chemistry", imagePath: "/rewards/dalgona.png", active: true },
  { id: "biology", name: "Bean Powder Tea", clubName: "Biology", imagePath: "/rewards/bean-tea.png", active: true },
  { id: "quasar", name: "Popcorn", clubName: "Quasar", imagePath: "/rewards/popcorn.png", active: true },
  { id: "alphago", name: "Iced Tea", clubName: "Alphago", imagePath: "/rewards/iced-tea.png", active: true }
];

const CLUBS = [
  { id: "chemistry", name: "Chemistry" },
  { id: "biology", name: "Biology" },
  { id: "quasar", name: "Quasar" },
  { id: "alphago", name: "Alphago" }
] as const;

const BOOTHS: Booth[] = CLUBS.flatMap((club) =>
  Array.from({ length: 10 }, (_, index) => {
    const boothNumber = String(index + 1).padStart(2, "0");
    return {
      id: `${club.id}_booth_${boothNumber}`,
      name: `${club.name} ${boothNumber}`,
      clubName: club.name,
      adminAccountIds: [],
      active: true
    };
  })
);

let initPromise: Promise<void> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
let tokenCache: { accessToken: string; expiresAt: number } | null = null;

function useFirestoreBackend() {
  return process.env.STAMP_DB_BACKEND === "firestore";
}

function getProjectId() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID가 필요합니다.");
  }
  return projectId;
}

function getFirestoreDocumentBase() {
  return `${FIRESTORE_API}/projects/${getProjectId()}/databases/(default)/documents`;
}

function documentName(collectionId: string, docId: string) {
  return `projects/${getProjectId()}/databases/(default)/documents/${collectionId}/${docId}`;
}

function documentPath(collectionId: string, docId: string) {
  return `${getFirestoreDocumentBase()}/${collectionId}/${docId}`;
}

function itemId(key: CollectionKey, item: unknown) {
  const record = item as { id?: string; accountId?: string };
  if (key === "profiles" || key === "userStats") return record.accountId;
  return record.id;
}

function stableStringify(value: unknown) {
  return JSON.stringify(value);
}

function rawCodeForLabel(label: string) {
  const seed = process.env.ADMIN_CODE_SEED;
  if (!seed) return randomCode(label);
  const suffix = crypto.createHmac("sha256", seed).update(label).digest("base64url").toUpperCase().slice(0, 7);
  return `${label}-${suffix}`;
}

function requireBootstrapEnvForFirestore() {
  if (!useFirestoreBackend()) return;
  if (!process.env.APP_SECRET || process.env.APP_SECRET.length < 32) {
    throw new Error("Firebase App Hosting에서는 APP_SECRET secret이 필요합니다.");
  }
  if (!process.env.ADMIN_CODE_SEED || process.env.ADMIN_CODE_SEED.length < 16) {
    throw new Error("Firebase App Hosting에서는 ADMIN_CODE_SEED secret이 필요합니다.");
  }
  if (!process.env.BOOTSTRAP_SUPERADMIN_PASSWORD || process.env.BOOTSTRAP_SUPERADMIN_PASSWORD.length < 8) {
    throw new Error("Firebase App Hosting에서는 BOOTSTRAP_SUPERADMIN_PASSWORD secret이 필요합니다.");
  }
}

async function buildInitialDb() {
  requireBootstrapEnvForFirestore();

  const now = new Date().toISOString();
  const superPassword = process.env.BOOTSTRAP_SUPERADMIN_PASSWORD || randomCode("SUPER").replace("SUPER-", "");
  const superPasswordHash = await hashPassword(superPassword);
  const superAccountId = randomId("acc");

  const bootstrapLines = [
    "WSHS Science Day Stamp local bootstrap secrets",
    "Keep this server-side only. Do not upload it to public hosting.",
    "",
    "Initial super admin",
    "loginId: superadmin",
    `password: ${superPassword}`,
    "",
    "Admin invite codes"
  ];

  const inviteCodes: AdminInviteCode[] = [];
  const boothIds = BOOTHS.map((booth) => booth.id);
  for (let index = 1; index <= 40; index += 1) {
    const codeLabel = `B-${String(index).padStart(2, "0")}`;
    const rawCode = rawCodeForLabel(codeLabel);
    const boothId = boothIds[(index - 1) % boothIds.length];
    inviteCodes.push({
      id: randomId("code"),
      codeLabel,
      codeHash: await hashToken(normalizeInviteCode(rawCode)),
      role: "boothAdmin",
      boothId,
      used: false,
      revoked: false,
      createdAt: now
    });
    bootstrapLines.push(`${codeLabel} boothAdmin ${boothId}: ${rawCode}`);
  }

  const rewardIds: RewardId[] = ["chemistry", "biology", "quasar", "alphago"];
  for (let index = 1; index <= 8; index += 1) {
    const codeLabel = `R-${String(index).padStart(2, "0")}`;
    const rawCode = rawCodeForLabel(codeLabel);
    const rewardId = rewardIds[(index - 1) % rewardIds.length];
    inviteCodes.push({
      id: randomId("code"),
      codeLabel,
      codeHash: await hashToken(normalizeInviteCode(rawCode)),
      role: "rewardAdmin",
      rewardId,
      used: false,
      revoked: false,
      createdAt: now
    });
    bootstrapLines.push(`${codeLabel} rewardAdmin ${rewardId}: ${rawCode}`);
  }

  for (let index = 1; index <= 2; index += 1) {
    const codeLabel = `S-${String(index).padStart(2, "0")}`;
    const rawCode = rawCodeForLabel(codeLabel);
    inviteCodes.push({
      id: randomId("code"),
      codeLabel,
      codeHash: await hashToken(normalizeInviteCode(rawCode)),
      role: "superAdmin",
      used: false,
      revoked: false,
      createdAt: now
    });
    bootstrapLines.push(`${codeLabel} superAdmin: ${rawCode}`);
  }

  const db: StampDb = {
    meta: { createdAt: now, updatedAt: now, version: 1 },
    accounts: [
      {
        id: superAccountId,
        loginId: "superadmin",
        loginIdLower: "superadmin",
        passwordHash: superPasswordHash,
        role: "superAdmin",
        displayName: "Super Admin",
        qrVersion: 1,
        disabled: false,
        createdAt: now
      }
    ],
    sessions: [],
    adminInviteCodes: inviteCodes,
    booths: BOOTHS,
    rewards: REWARDS,
    stamps: [],
    coupons: [],
    profiles: [],
    userStats: [],
    nameChangeLogs: [],
    auditLogs: []
  };

  return { db, bootstrapLines };
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createInitialLocalDb() {
  const { db, bootstrapLines } = await buildInitialDb();
  await fs.writeFile(DB_FILE, `${JSON.stringify(db, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(BOOTSTRAP_FILE, `${bootstrapLines.join("\n")}\n`, { mode: 0o600 });
}

async function ensureLocalDb() {
  if (!initPromise) {
    initPromise = (async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      if (!(await fileExists(DB_FILE))) {
        await createInitialLocalDb();
      }
    })();
  }
  return initPromise;
}

async function getAccessToken() {
  if (process.env.FIRESTORE_OAUTH_TOKEN) return process.env.FIRESTORE_OAUTH_TOKEN;
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - 60_000 > now) return tokenCache.accessToken;

  const response = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error("App Hosting 서비스 계정 토큰을 가져오지 못했습니다.");
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  tokenCache = { accessToken: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return tokenCache.accessToken;
}

async function firestoreRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const accessToken = await getAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {})
    },
    cache: "no-store"
  });

  if (response.status === 404) {
    throw Object.assign(new Error("not found"), { status: 404 });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firestore 요청 실패 ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

type FirestoreDocument = {
  name: string;
  fields?: {
    payload?: { stringValue?: string };
  };
  updateTime?: string;
};

type FirestoreListResponse = {
  documents?: FirestoreDocument[];
  nextPageToken?: string;
};

async function getMetaDoc() {
  try {
    return await firestoreRequest<FirestoreDocument>(documentPath(META_COLLECTION, META_ID));
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

async function listCollection<T>(key: CollectionKey) {
  const collectionId = COLLECTIONS[key];
  const items: T[] = [];
  const payloads = new Map<string, string>();
  const names = new Set<string>();
  let pageToken = "";

  do {
    const url = new URL(`${getFirestoreDocumentBase()}/${collectionId}`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    let data: FirestoreListResponse;
    try {
      data = await firestoreRequest<FirestoreListResponse>(url.toString());
    } catch (error) {
      if ((error as { status?: number }).status === 404) break;
      throw error;
    }

    for (const document of data.documents || []) {
      const id = decodeURIComponent(document.name.split("/").pop() || "");
      const payload = document.fields?.payload?.stringValue || "";
      if (!payload) continue;
      names.add(id);
      payloads.set(id, payload);
      items.push(JSON.parse(payload) as T);
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return { items, payloads, names };
}

type FirestoreSnapshot = {
  db: StampDb | null;
  metaUpdateTime?: string;
  payloads: Record<CollectionKey, Map<string, string>>;
  names: Record<CollectionKey, Set<string>>;
};

async function readFirestoreSnapshot(): Promise<FirestoreSnapshot> {
  const metaDoc = await getMetaDoc();
  if (!metaDoc) {
    return {
      db: null,
      payloads: emptyPayloadMaps(),
      names: emptyNameSets()
    };
  }

  const metaPayload = metaDoc.fields?.payload?.stringValue;
  if (!metaPayload) throw new Error("Firestore meta payload가 비어 있습니다.");

  const accounts = await listCollection<Account>("accounts");
  const sessions = await listCollection<Session>("sessions");
  const adminInviteCodes = await listCollection<AdminInviteCode>("adminInviteCodes");
  const booths = await listCollection<Booth>("booths");
  const rewards = await listCollection<RewardItem>("rewards");
  const stamps = await listCollection<Stamp>("stamps");
  const coupons = await listCollection<Coupon>("coupons");
  const profiles = await listCollection<Profile>("profiles");
  const userStats = await listCollection<UserStats>("userStats");
  const nameChangeLogs = await listCollection<NameChangeLog>("nameChangeLogs");
  const auditLogs = await listCollection<AuditLog>("auditLogs");

  return {
    db: {
      meta: JSON.parse(metaPayload),
      accounts: accounts.items,
      sessions: sessions.items,
      adminInviteCodes: adminInviteCodes.items,
      booths: booths.items,
      rewards: rewards.items,
      stamps: stamps.items,
      coupons: coupons.items,
      profiles: profiles.items,
      userStats: userStats.items,
      nameChangeLogs: nameChangeLogs.items,
      auditLogs: auditLogs.items
    },
    metaUpdateTime: metaDoc.updateTime,
    payloads: {
      accounts: accounts.payloads,
      sessions: sessions.payloads,
      adminInviteCodes: adminInviteCodes.payloads,
      booths: booths.payloads,
      rewards: rewards.payloads,
      stamps: stamps.payloads,
      coupons: coupons.payloads,
      profiles: profiles.payloads,
      userStats: userStats.payloads,
      nameChangeLogs: nameChangeLogs.payloads,
      auditLogs: auditLogs.payloads
    },
    names: {
      accounts: accounts.names,
      sessions: sessions.names,
      adminInviteCodes: adminInviteCodes.names,
      booths: booths.names,
      rewards: rewards.names,
      stamps: stamps.names,
      coupons: coupons.names,
      profiles: profiles.names,
      userStats: userStats.names,
      nameChangeLogs: nameChangeLogs.names,
      auditLogs: auditLogs.names
    }
  };
}

function emptyPayloadMaps(): Record<CollectionKey, Map<string, string>> {
  return {
    accounts: new Map(),
    sessions: new Map(),
    adminInviteCodes: new Map(),
    booths: new Map(),
    rewards: new Map(),
    stamps: new Map(),
    coupons: new Map(),
    profiles: new Map(),
    userStats: new Map(),
    nameChangeLogs: new Map(),
    auditLogs: new Map()
  };
}

function emptyNameSets(): Record<CollectionKey, Set<string>> {
  return {
    accounts: new Set(),
    sessions: new Set(),
    adminInviteCodes: new Set(),
    booths: new Set(),
    rewards: new Set(),
    stamps: new Set(),
    coupons: new Set(),
    profiles: new Set(),
    userStats: new Set(),
    nameChangeLogs: new Set(),
    auditLogs: new Set()
  };
}

function addWrite(writes: unknown[], name: string, payload: string) {
  writes.push({
    update: {
      name,
      fields: {
        payload: { stringValue: payload }
      }
    }
  });
}

function addCollectionWrites<T>(writes: unknown[], key: CollectionKey, items: T[], previous: Map<string, string>, previousNames: Set<string>) {
  const seen = new Set<string>();
  const collectionId = COLLECTIONS[key];

  for (const item of items) {
    const id = itemId(key, item);
    if (!id) throw new Error(`${collectionId} item id가 없습니다.`);
    seen.add(id);
    const payload = stableStringify(item);
    if (previous.get(id) !== payload) {
      addWrite(writes, documentName(collectionId, id), payload);
    }
  }

  for (const id of previousNames) {
    if (!seen.has(id)) {
      writes.push({ delete: documentName(collectionId, id) });
    }
  }
}

async function commitFirestoreDb(db: StampDb, snapshot: FirestoreSnapshot) {
  db.meta.updatedAt = new Date().toISOString();
  const writes: unknown[] = [];
  const metaPayload = stableStringify(db.meta);
  const metaWrite: Record<string, unknown> = {
    update: {
      name: documentName(META_COLLECTION, META_ID),
      fields: {
        payload: { stringValue: metaPayload }
      }
    },
    currentDocument: snapshot.metaUpdateTime ? { updateTime: snapshot.metaUpdateTime } : { exists: false }
  };
  writes.push(metaWrite);

  addCollectionWrites(writes, "accounts", db.accounts, snapshot.payloads.accounts, snapshot.names.accounts);
  addCollectionWrites(writes, "sessions", db.sessions, snapshot.payloads.sessions, snapshot.names.sessions);
  addCollectionWrites(writes, "adminInviteCodes", db.adminInviteCodes, snapshot.payloads.adminInviteCodes, snapshot.names.adminInviteCodes);
  addCollectionWrites(writes, "booths", db.booths, snapshot.payloads.booths, snapshot.names.booths);
  addCollectionWrites(writes, "rewards", db.rewards, snapshot.payloads.rewards, snapshot.names.rewards);
  addCollectionWrites(writes, "stamps", db.stamps, snapshot.payloads.stamps, snapshot.names.stamps);
  addCollectionWrites(writes, "coupons", db.coupons, snapshot.payloads.coupons, snapshot.names.coupons);
  addCollectionWrites(writes, "profiles", db.profiles, snapshot.payloads.profiles, snapshot.names.profiles);
  addCollectionWrites(writes, "userStats", db.userStats, snapshot.payloads.userStats, snapshot.names.userStats);
  addCollectionWrites(writes, "nameChangeLogs", db.nameChangeLogs, snapshot.payloads.nameChangeLogs, snapshot.names.nameChangeLogs);
  addCollectionWrites(writes, "auditLogs", db.auditLogs, snapshot.payloads.auditLogs, snapshot.names.auditLogs);

  if (writes.length > 450) {
    throw new Error("한 번에 저장할 변경량이 너무 큽니다. 운영 전 컬렉션별 저장 로직으로 분리해야 합니다.");
  }

  await firestoreRequest(`${FIRESTORE_API}/projects/${getProjectId()}/databases/(default)/documents:commit`, {
    method: "POST",
    body: JSON.stringify({ writes })
  });
}

async function readFirestoreDb() {
  const snapshot = await readFirestoreSnapshot();
  if (snapshot.db) return snapshot.db;
  const { db } = await buildInitialDb();
  await commitFirestoreDb(db, snapshot);
  return db;
}

export async function readDb() {
  if (useFirestoreBackend()) return readFirestoreDb();
  await ensureLocalDb();
  const raw = await fs.readFile(DB_FILE, "utf8");
  return JSON.parse(raw) as StampDb;
}

async function writeLocalDb(db: StampDb) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  db.meta.updatedAt = new Date().toISOString();
  const tempFile = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(db, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempFile, DB_FILE);
}

async function updateFirestoreDb<T>(mutator: (db: StampDb) => T | Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const snapshot = await readFirestoreSnapshot();
      const db = snapshot.db || (await buildInitialDb()).db;
      const result = await mutator(db);
      await commitFirestoreDb(db, snapshot);
      return result;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("FAILED_PRECONDITION") && !message.includes("ABORTED") && !message.includes("409")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function updateDb<T>(mutator: (db: StampDb) => T | Promise<T>) {
  if (useFirestoreBackend()) return updateFirestoreDb(mutator);

  const run = writeQueue.catch(() => undefined).then(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeLocalDb(db);
    return result;
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function getBootstrapFilePath() {
  return BOOTSTRAP_FILE;
}
