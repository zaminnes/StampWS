import { HttpError } from "./http";
import type { Account, StampDb, TeaReservation } from "./types";

export const TEA_REWARD_ID = "alphago";
export const TEA_DEFAULT_COMMAND = "T,15,20";

export function canOperateTeaMaker(account?: Account | null) {
  if (!account || account.disabled) return false;
  if (account.role === "superAdmin") return true;
  return (account.role === "boothAdmin" || account.role === "rewardAdmin") && account.rewardId === TEA_REWARD_ID;
}

export function assertTeaMakerAccess(account?: Account | null) {
  if (!canOperateTeaMaker(account)) {
    throw new HttpError(403, "알파고 티메이커 운영 권한이 없습니다.");
  }
}

export function nextTeaOrderNumber(db: StampDb) {
  return db.teaReservations.reduce((max, item) => Math.max(max, item.orderNumber || 0), 0) + 1;
}

export function hasTeaCouponPriority(db: StampDb, accountId: string) {
  return db.coupons.some((coupon) => (
    coupon.participantAccountId === accountId &&
    coupon.rewardId === TEA_REWARD_ID &&
    coupon.status === "unused"
  ));
}

export function teaStockCount(db: StampDb) {
  return Math.max(0, Math.floor(db.meta.teaStockCount || 0));
}

export function decrementTeaStock(db: StampDb, accountId: string, now: string) {
  const current = teaStockCount(db);
  if (current <= 0) {
    throw new HttpError(409, "아이스티 재고가 없습니다.");
  }
  db.meta.teaStockCount = current - 1;
  db.meta.teaStockUpdatedAt = now;
  db.meta.teaStockUpdatedByAccountId = accountId;
  return db.meta.teaStockCount;
}

export function isOpenTeaReservation(reservation: TeaReservation) {
  return reservation.status === "reserved" || reservation.status === "brewing" || reservation.status === "ready";
}

export function teaReservationView(reservation: TeaReservation) {
  return {
    id: reservation.id,
    orderNumber: reservation.orderNumber,
    displayName: reservation.displayName,
    studentCode: reservation.studentCode,
    source: reservation.source,
    priority: reservation.source === "reward",
    status: reservation.status,
    quantity: reservation.quantity,
    note: reservation.note,
    serialCommand: reservation.serialCommand,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
    startedAt: reservation.startedAt,
    readyAt: reservation.readyAt,
    servedAt: reservation.servedAt,
    cancelledAt: reservation.cancelledAt
  };
}
