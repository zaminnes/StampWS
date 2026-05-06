import crypto from "node:crypto";

const seed = process.env.ADMIN_CODE_SEED;

if (!seed || seed.length < 16) {
  console.error("Set ADMIN_CODE_SEED first.");
  process.exit(1);
}

function code(label) {
  const suffix = crypto.createHmac("sha256", seed).update(label).digest("base64url").toUpperCase().slice(0, 7);
  return `${label}-${suffix}`;
}

const boothIds = ["chemistry", "biology", "quasar", "alphago", "physics", "earth", "robotics", "math", "astronomy", "maker"];
const rewardIds = ["chemistry", "biology", "quasar", "alphago"];

console.log("Booth admin codes");
for (let index = 1; index <= 40; index += 1) {
  const label = `B-${String(index).padStart(2, "0")}`;
  console.log(`${label} ${boothIds[(index - 1) % boothIds.length]} ${code(label)}`);
}

console.log("");
console.log("Reward admin codes");
for (let index = 1; index <= 8; index += 1) {
  const label = `R-${String(index).padStart(2, "0")}`;
  console.log(`${label} ${rewardIds[(index - 1) % rewardIds.length]} ${code(label)}`);
}

console.log("");
console.log("Super admin invite codes");
for (let index = 1; index <= 2; index += 1) {
  const label = `S-${String(index).padStart(2, "0")}`;
  console.log(`${label} ${code(label)}`);
}
