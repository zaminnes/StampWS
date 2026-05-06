import type { Account, Booth, StampDb } from "./types";

export function clubIdFromBoothId(boothId?: string) {
  return boothId?.match(/^(.+)_booth_\d+$/)?.[1] || "";
}

export function managedBoothsForAccount(account: Account, db: StampDb): Booth[] {
  if (account.role === "superAdmin") return db.booths;
  if (account.role !== "boothAdmin" || !account.boothId) return [];
  const clubId = clubIdFromBoothId(account.boothId);
  if (!clubId) return [];
  return db.booths.filter((booth) => clubIdFromBoothId(booth.id) === clubId);
}

export function boothForAccount(account: Account, db: StampDb, requestedBoothId?: string) {
  const managedBooths = managedBoothsForAccount(account, db);
  if (requestedBoothId) return managedBooths.find((booth) => booth.id === requestedBoothId);
  if (account.boothId) return managedBooths.find((booth) => booth.id === account.boothId) || managedBooths[0];
  return managedBooths[0];
}
