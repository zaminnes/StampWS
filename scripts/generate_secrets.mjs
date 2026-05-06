import crypto from "node:crypto";

function secret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

console.log(`APP_SECRET=${secret(48)}`);
console.log(`ADMIN_CODE_SEED=${secret(32)}`);
console.log(`BOOTSTRAP_SUPERADMIN_PASSWORD=${secret(10)}`);
