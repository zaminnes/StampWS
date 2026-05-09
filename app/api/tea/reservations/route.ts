import { NextRequest } from "next/server";
import { requireCurrentSession } from "@/lib/auth";
import { clientFingerprint, hashFingerprint, randomId, sanitizeDisplayName } from "@/lib/crypto";
import { readDb, updateDb } from "@/lib/db";
import { assertContentLength, assertSameOrigin, HttpError, jsonError, jsonOk } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import {
  assertTeaMakerAccess,
  canOperateTeaMaker,
  decrementTeaStock,
  hasTeaCouponPriority,
  isOpenTeaReservation,
  nextTeaOrderNumber,
  TEA_DEFAULT_COMMAND,
  teaStockCount,
  teaReservationView
} from "@/lib/tea-access";

export const runtime = "nodejs";

function sanitizeNote(value: string) {
  return value.normalize("NFKC").replace(/[<>{}[\]"'`\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function normalizeSerialCommand(value?: string) {
  const command = (value || TEA_DEFAULT_COMMAND).normalize("NFKC").replace(/[^\w,.-]/g, "").toUpperCase().slice(0, 40);
  const valid = /^(T|FORCE),\d{1,3},\d{1,3}(,\d{1,3})?$/.test(command) ||
    /^(D3|FORCE_D3|DRINK3),\d{1,3},\d{1,3}$/.test(command);
  if (!valid) {
    throw new HttpError(400, "시리얼 명령은 T,15,20 또는 D3,15,20 형식으로 입력하세요.");
  }
  return command;
}

function sortReservations<T extends { status: string; orderNumber: number; createdAt: string; source?: string }>(items: T[]) {
  const statusOrder: Record<string, number> = { brewing: 0, ready: 1, reserved: 2, served: 3, cancelled: 4 };
  return items.slice().sort((a, b) => {
    const byStatus = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    const byPriority = (b.source === "reward" ? 1 : 0) - (a.source === "reward" ? 1 : 0);
    if (byPriority !== 0) return byPriority;
    if (a.orderNumber !== b.orderNumber) return a.orderNumber - b.orderNumber;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export async function GET(request: NextRequest) {
  try {
    const current = await requireCurrentSession(request);
    const db = await readDb();
    const account = db.accounts.find((item) => item.id === current.account.id);
    if (!account || account.disabled) throw new HttpError(401, "계정을 찾을 수 없습니다.");

    if (current.session.role === "participant") {
      const reservations = db.teaReservations
        .filter((item) => item.participantAccountId === account.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 8)
        .map(teaReservationView);
      return jsonOk({ reservations, canOperate: false, stockCount: teaStockCount(db), stockUpdatedAt: db.meta.teaStockUpdatedAt });
    }

    assertTeaMakerAccess(account);
    const reservations = sortReservations(db.teaReservations).slice(0, 80).map(teaReservationView);
    return jsonOk({ reservations, canOperate: true, stockCount: teaStockCount(db), stockUpdatedAt: db.meta.teaStockUpdatedAt });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireCurrentSession(request);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { note?: string; displayName?: string; serialCommand?: string };
    rateLimit(`tea-reserve:${current.account.id}`, 10, 10 * 60 * 1000);

    const result = await updateDb(async (db) => {
      const account = db.accounts.find((item) => item.id === current.account.id);
      if (!account || account.disabled) throw new HttpError(401, "계정을 찾을 수 없습니다.");

      const now = new Date().toISOString();
      if (current.session.role === "participant") {
        const hasOpen = db.teaReservations.some((item) => item.participantAccountId === account.id && isOpenTeaReservation(item));
        if (hasOpen) throw new HttpError(409, "진행 중인 티 예약이 있습니다.");
        const priority = hasTeaCouponPriority(db, account.id);
        if (!priority && teaStockCount(db) <= 0) throw new HttpError(409, "아이스티 재고가 없습니다.");

        const reservation = {
          id: randomId("tea"),
          orderNumber: nextTeaOrderNumber(db),
          participantAccountId: account.id,
          displayName: account.displayName,
          studentCode: account.studentCode,
          source: priority ? ("reward" as const) : ("online" as const),
          status: "reserved" as const,
          quantity: 1,
          note: sanitizeNote(body.note || ""),
          serialCommand: TEA_DEFAULT_COMMAND,
          createdAt: now,
          updatedAt: now
        };
        db.teaReservations.push(reservation);
        db.auditLogs.push({
          id: randomId("audit"),
          actorAccountId: account.id,
          action: "tea.reservation.create",
          targetId: reservation.id,
          createdAt: now,
          ipHash: await hashFingerprint(ip),
          userAgentHash: await hashFingerprint(userAgent),
          metadata: { orderNumber: reservation.orderNumber, source: reservation.source, priority }
        });
        return teaReservationView(reservation);
      }

      assertTeaMakerAccess(account);
      const reservation = {
        id: randomId("tea"),
        orderNumber: nextTeaOrderNumber(db),
        displayName: sanitizeDisplayName(body.displayName || "현장주문"),
        source: "manual" as const,
        status: "reserved" as const,
        quantity: 1,
        note: sanitizeNote(body.note || ""),
        serialCommand: normalizeSerialCommand(body.serialCommand),
        createdAt: now,
        updatedAt: now,
        handledByAccountId: account.id
      };
      db.teaReservations.push(reservation);
      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: account.id,
        action: "tea.reservation.manualCreate",
        targetId: reservation.id,
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: { orderNumber: reservation.orderNumber, serialCommand: reservation.serialCommand || null }
      });
      return teaReservationView(reservation);
    });

    return jsonOk({ reservation: result });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    assertContentLength(request, 4096);
    const current = await requireCurrentSession(request);
    if (current.session.role === "participant") throw new HttpError(403, "알파고 티메이커 운영 권한이 없습니다.");
    assertTeaMakerAccess(current.account);
    rateLimit(`tea-operate:${current.account.id}`, 80, 10 * 60 * 1000);
    const { ip, userAgent } = clientFingerprint(request.headers);
    const body = (await request.json()) as { reservationId?: string; action?: "start" | "ready" | "serve" | "cancel"; serialCommand?: string };

    const result = await updateDb(async (db) => {
      const account = db.accounts.find((item) => item.id === current.account.id);
      if (!account || !canOperateTeaMaker(account)) throw new HttpError(403, "알파고 티메이커 운영 권한이 없습니다.");
      const actor = account;
      const reservation = db.teaReservations.find((item) => item.id === body.reservationId);
      if (!reservation) throw new HttpError(404, "예약을 찾을 수 없습니다.");
      if (reservation.status === "served" || reservation.status === "cancelled") {
        throw new HttpError(409, "이미 종료된 예약입니다.");
      }

      const now = new Date().toISOString();
      const action = body.action || "start";
      if (action === "start") {
        if (!reservation.startedAt && reservation.source !== "reward") {
          decrementTeaStock(db, actor.id, now);
        }
        reservation.status = "brewing";
        reservation.startedAt = now;
        reservation.handledByAccountId = actor.id;
        reservation.serialCommand = normalizeSerialCommand(body.serialCommand || reservation.serialCommand);
      } else if (action === "ready") {
        reservation.status = "ready";
        reservation.readyAt = now;
        reservation.handledByAccountId = actor.id;
      } else if (action === "serve") {
        reservation.status = "served";
        reservation.servedAt = now;
        reservation.handledByAccountId = actor.id;
      } else if (action === "cancel") {
        reservation.status = "cancelled";
        reservation.cancelledAt = now;
        reservation.cancelledByAccountId = actor.id;
      }
      reservation.updatedAt = now;

      db.auditLogs.push({
        id: randomId("audit"),
        actorAccountId: actor.id,
        action: `tea.reservation.${action}`,
        targetId: reservation.id,
        createdAt: now,
        ipHash: await hashFingerprint(ip),
        userAgentHash: await hashFingerprint(userAgent),
        metadata: {
          orderNumber: reservation.orderNumber,
          status: reservation.status,
          serialCommand: reservation.serialCommand || null
        }
      });

      return teaReservationView(reservation);
    });

    return jsonOk({ reservation: result });
  } catch (error) {
    return jsonError(error);
  }
}
