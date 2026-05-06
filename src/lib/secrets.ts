import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.join(process.cwd(), ".data");
const APP_SECRET_FILE = path.join(DATA_DIR, "app-secret.txt");

let appSecretPromise: Promise<string> | null = null;

export async function getAppSecret() {
  if (process.env.APP_SECRET && process.env.APP_SECRET.length >= 32) {
    return process.env.APP_SECRET;
  }

  if (process.env.STAMP_DB_BACKEND === "firestore" || process.env.NODE_ENV === "production") {
    throw new Error("Firebase App Hosting에서는 APP_SECRET secret을 설정해야 합니다.");
  }

  if (!appSecretPromise) {
    appSecretPromise = (async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      try {
        const existing = await fs.readFile(APP_SECRET_FILE, "utf8");
        if (existing.trim().length >= 32) return existing.trim();
      } catch {
        // First local run.
      }

      const generated = crypto.randomBytes(48).toString("base64url");
      await fs.writeFile(APP_SECRET_FILE, generated, { mode: 0o600 });
      return generated;
    })();
  }

  return appSecretPromise;
}
