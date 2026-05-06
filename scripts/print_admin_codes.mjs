import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const seedFile = path.join(process.cwd(), ".data", "firebase-secrets", "ADMIN_CODE_SEED");
const seed = process.env.ADMIN_CODE_SEED || (existsSync(seedFile) ? readFileSync(seedFile, "utf8").trim() : "");

if (!seed || seed.length < 16) {
  console.error("Set ADMIN_CODE_SEED first.");
  process.exit(1);
}

function code(label) {
  const suffix = crypto.createHmac("sha256", seed).update(label).digest("base64url").toUpperCase().slice(0, 7);
  return `${label}-${suffix}`;
}

const clubCodes = [
  ["B-CHEM", "화학 통합"],
  ["B-BIO", "생명 통합"],
  ["B-QUASAR", "퀘이사 통합"],
  ["B-ALPHAGO", "알파고 통합"]
];

console.log("Club integrated admin codes");
for (const [label, name] of clubCodes) {
  console.log(`${label} ${name} ${code(label)}`);
}

console.log("");
console.log("Super admin invite codes");
for (let index = 1; index <= 2; index += 1) {
  const label = `S-${String(index).padStart(2, "0")}`;
  console.log(`${label} ${code(label)}`);
}
