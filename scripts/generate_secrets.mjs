import crypto from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function secret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

const values = {
  APP_SECRET: secret(48),
  ADMIN_CODE_SEED: secret(32),
  BOOTSTRAP_SUPERADMIN_PASSWORD: secret(18)
};

if (process.argv.includes("--write")) {
  const dir = path.join(process.cwd(), ".data", "firebase-secrets");
  mkdirSync(dir, { recursive: true });
  for (const [key, value] of Object.entries(values)) {
    writeFileSync(path.join(dir, key), value, { mode: 0o600 });
  }
  console.log(`Wrote secrets to ${dir}`);
} else {
  for (const [key, value] of Object.entries(values)) {
    console.log(`${key}=${value}`);
  }
}
