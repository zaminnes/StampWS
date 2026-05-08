"use client";

import jsQR from "jsqr";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STAMP_REWARD_THRESHOLD } from "@/lib/stamp-config";
import beanTeaImage from "../../public/rewards/bean-tea.png";
import dalgonaImage from "../../public/rewards/dalgona.png";
import icedTeaImage from "../../public/rewards/iced-tea.png";
import popcornImage from "../../public/rewards/popcorn.png";

type Role = "participant" | "boothAdmin" | "rewardAdmin" | "superAdmin";

type Reward = {
  id: "chemistry" | "biology" | "quasar" | "alphago";
  name: string;
  clubName: string;
  imagePath: string;
  stockCount?: number;
  stockUpdatedAt?: string;
  active: boolean;
};

type Stamp = {
  id: string;
  boothId: string;
  boothName: string;
  stampImageDataUrl: string;
  createdAt: string;
};

type BoothView = {
  id: string;
  name: string;
  clubName: string;
  stampImageDataUrl?: string;
  stampDesignUpdatedAt?: string;
  hasCustomStampImage?: boolean;
  active?: boolean;
};

type CodeRow = {
  codeLabel: string;
  fullCode?: string;
  groupName: string;
  role: string;
  targetName: string;
  used: boolean;
  multiUse?: boolean;
  useCount?: number;
  usedAt?: string;
  revoked: boolean;
  usedByDisplayName?: string;
};

type LeaderboardRow = {
  rank: number;
  accountId: string;
  displayName: string;
  bio: string;
  avatarStampImageDataUrl?: string;
  stampCount: number;
  firstStampAt?: string;
  completedSevenAt?: string;
  completed: boolean;
  durationMs: number | null;
  behindFirstMs: number;
  behindSecondMs: number;
};

type TempPassView = {
  id: string;
  label: string;
  displayName: string;
  status: "active" | "redeemed" | "voided";
  stampCount: number;
  createdAt: string;
  redeemedAt?: string;
  redeemedRewardId?: Reward["id"];
  qrToken?: string | null;
};

type TeaReservationView = {
  id: string;
  orderNumber: number;
  displayName: string;
  studentCode?: string;
  source: "online" | "manual" | "reward";
  priority?: boolean;
  status: "reserved" | "brewing" | "ready" | "served" | "cancelled";
  quantity: number;
  note?: string;
  serialCommand?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  readyAt?: string;
  servedAt?: string;
  cancelledAt?: string;
};

type TeaReservationsPayload = {
  reservations: TeaReservationView[];
  stockCount?: number;
  stockUpdatedAt?: string;
};

type TeaFirmwarePayload = {
  firmwareText: string;
  updatedAt?: string;
  source: "storage" | "default";
};

type ArduinoButtonView = {
  id: string;
  label: string;
  scriptText: string;
  createdAt: string;
  updatedAt: string;
};

type TeaButtonsPayload = {
  buttons: ArduinoButtonView[];
  updatedAt?: string;
};

type RewardStockPayload = {
  rewards: Reward[];
};

type ClubNoticeView = {
  id: string;
  clubId: string;
  clubName: string;
  message: string;
  createdAt: string;
  createdByDisplayName: string;
};

type NoticePayload = {
  notices: ClubNoticeView[];
  canPost: boolean;
  postClubName: string;
};

type SecurityLoginRow = {
  id: string;
  loginId: string;
  displayName: string;
  role: string;
  result: "success" | "failed" | "blocked";
  reason: string;
  deviceShort: string;
  userAgentSummary: string;
  createdAt: string;
};

type SecurityActivityRow = {
  id: string;
  actorDisplayName: string;
  actorLoginId: string;
  action: string;
  targetId: string;
  detail: string;
  createdAt: string;
};

type SecurityDeviceBlockRow = {
  id: string;
  deviceShort: string;
  reason: string;
  loginIds: string[];
  active: boolean;
  createdAt: string;
  releasedAt?: string;
};

type SecurityPayload = {
  loginEvents: SecurityLoginRow[];
  activityEvents: SecurityActivityRow[];
  deviceBlocks: SecurityDeviceBlockRow[];
};

type AdminAccountRow = {
  id: string;
  loginId: string;
  displayName: string;
  studentCode?: string;
  role: Role;
  targetName: string;
  disabled: boolean;
  createdAt: string;
  lastLoginAt?: string;
};

type BluetoothWriteCharacteristic = {
  writeValue?: (value: Uint8Array) => Promise<void>;
  writeValueWithoutResponse?: (value: Uint8Array) => Promise<void>;
};

type BluetoothService = {
  getCharacteristic: (uuid: string) => Promise<BluetoothWriteCharacteristic>;
};

type BluetoothServer = {
  getPrimaryService: (uuid: string) => Promise<BluetoothService>;
};

type BluetoothDevice = {
  addEventListener: (type: "gattserverdisconnected", listener: () => void) => void;
  gatt: {
    connect: () => Promise<BluetoothServer>;
  };
};

type SerialPort = {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable?: ReadableStream<Uint8Array>;
  writable?: WritableStream<Uint8Array>;
};

declare global {
  interface Navigator {
  bluetooth?: {
    requestDevice: (options: {
      filters: Array<{ namePrefix: string }>;
      optionalServices: string[];
    }) => Promise<BluetoothDevice>;
  };
  serial?: {
    requestPort: () => Promise<SerialPort>;
    addEventListener: (type: "disconnect", listener: () => void) => void;
  };
  }
}

type MePayload = {
  account: null | {
    id: string;
    loginId: string;
    role: Role;
    displayName: string;
    displayNameRequired?: boolean;
    studentCode?: string;
    boothId?: string;
    rewardId?: Reward["id"];
    selectedRewardId?: Reward["id"];
  };
  rewards?: Reward[];
  booths?: Array<{
    id: string;
    name: string;
    clubName: string;
    active: boolean;
    hasStampImage: boolean;
  }>;
  participantQrToken?: string;
  profile?: {
    nickname: string;
    bio: string;
    avatarStampId?: string;
    avatarStampImageDataUrl?: string;
    themeId: string;
    frameId: string;
  };
  stamps?: Stamp[];
  stats?: {
    stampCount: number;
    uniqueBoothCount: number;
    couponEligible: boolean;
    couponClaimed: boolean;
    completedSevenAt?: string;
  };
  coupon?: null | {
    id: string;
    rewardId: Reward["id"];
    status: "unused" | "redeemed";
    createdAt: string;
    redeemedAt?: string;
    qrToken: string;
  };
  booth?: BoothView;
  managedBooths?: BoothView[];
  reward?: Reward;
  issuedCount?: number;
  redeemedCount?: number;
  adminSummary?: {
    accountCount: number;
    participantCount: number;
    stampCount: number;
    couponCount: number;
    redeemedCouponCount: number;
    tempPassCount: number;
    redeemedTempPassCount: number;
  };
  defaultStampImageDataUrl?: string;
};

type AuthMode = "participant" | "adminLogin" | "adminJoin";
type AppTab = "home" | "profile" | "leaderboard" | "boothScan" | "stampStudio" | "rewardScan" | "teaMaker" | "codes" | "admin" | "tempPasses" | "notices";

type StampEffectState = {
  id: number;
  mode: "give" | "receive";
  title: string;
  detail: string;
  imageDataUrl?: string;
};

const REWARD_KO: Record<Reward["id"], { clubName: string; name: string; detail?: string }> = {
  chemistry: { clubName: "화학", name: "달고나" },
  biology: { clubName: "생명", name: "콩가루차" },
  quasar: { clubName: "퀘이사", name: "팝콘" },
  alphago: { clubName: "알파고", name: "아이스티", detail: "made by Automatic Ice-Tea Maker Machine" }
};

const REWARD_IMAGE_SRC: Record<Reward["id"], string> = {
  chemistry: dalgonaImage.src,
  biology: beanTeaImage.src,
  quasar: popcornImage.src,
  alphago: icedTeaImage.src
};

function rewardImagePath(rewardId?: Reward["id"]) {
  return rewardId ? REWARD_IMAGE_SRC[rewardId] : "";
}

async function apiJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {})
    },
    credentials: "same-origin"
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

function publicQrValue(token: string) {
  const baseUrl = process.env.NEXT_PUBLIC_STAMP_PUBLIC_URL || "https://stampws.kr";
  return `${baseUrl}/?qr=${encodeURIComponent(token)}`;
}

function extractQrToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("qr") || url.searchParams.get("token") || trimmed;
  } catch {
    return trimmed;
  }
}

function formatTime(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDuration(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "-";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function rewardLabel(reward?: Reward) {
  if (!reward) return "-";
  const label = REWARD_KO[reward.id];
  return label ? `${label.clubName} - ${label.name}` : `${reward.clubName} - ${reward.name}`;
}

function rewardNameById(rewardId?: Reward["id"]) {
  if (!rewardId) return "-";
  const label = REWARD_KO[rewardId];
  return label ? `${label.clubName} - ${label.name}` : rewardId;
}

function rewardDetail(rewardId?: Reward["id"]) {
  if (!rewardId) return "";
  return REWARD_KO[rewardId]?.detail || "";
}

function rewardStockCount(reward?: Reward) {
  return typeof reward?.stockCount === "number" ? Math.max(0, Math.floor(reward.stockCount)) : undefined;
}

function rewardIgnoresStampStock(rewardId?: Reward["id"]) {
  return rewardId === "alphago";
}

function rewardSoldOutForStamp(reward?: Reward) {
  if (!reward || rewardIgnoresStampStock(reward.id)) return false;
  return rewardStockCount(reward) === 0;
}

function rewardStockLabel(reward?: Reward) {
  if (!reward) return "";
  if (rewardIgnoresStampStock(reward.id)) return "쿠폰 재고 제외";
  const stock = rewardStockCount(reward);
  return typeof stock === "number" ? `${stock}개` : "재고 미설정";
}

function RewardImage({ reward, className = "" }: { reward?: Reward; className?: string }) {
  if (!reward) return <div className={`rewardVisual empty ${className}`}>-</div>;
  return (
    <div className={`rewardVisual ${className}`}>
      <img src={rewardImagePath(reward.id)} alt={rewardLabel(reward)} />
    </div>
  );
}

function canUseTeaMaker(account?: MePayload["account"]) {
  return account?.role === "superAdmin" || account?.rewardId === "alphago";
}

function teaReservationStatus(status?: TeaReservationView["status"]) {
  if (status === "brewing") return "제조중";
  if (status === "ready") return "픽업";
  if (status === "served") return "완료";
  if (status === "cancelled") return "취소";
  return "예약중";
}

function serialStatusLabel(status: string) {
  const labels: Record<string, string> = {
    offline: "미연결",
    idle: "대기",
    cup: "컵 감지",
    ready: "준비",
    dispensing: "추출",
    lowering: "하강",
    mixing: "믹싱",
    lifting: "상승",
    complete: "완료",
    emergency: "비상",
    error: "점검"
  };
  return labels[status] || status;
}

function teaSourceLabel(reservation: Pick<TeaReservationView, "source" | "priority">) {
  if (reservation.priority || reservation.source === "reward") return "쿠폰 우선";
  if (reservation.source === "manual") return "현장";
  return "온라인";
}

function arduinoCommandScript(command: string) {
  return `void runButton() {
  Serial.println("${command}");
}
`;
}

function newArduinoButtonDraft(label = "새 버튼", command = TEA_DEFAULT_COMMAND): ArduinoButtonView {
  const now = new Date().toISOString();
  return {
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label,
    scriptText: arduinoCommandScript(command),
    createdAt: now,
    updatedAt: now
  };
}

function parseArduinoButtonScript(scriptText: string) {
  const steps: Array<{ type: "send"; command: string } | { type: "delay"; ms: number }> = [];
  const source = scriptText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const tokens: Array<{ index: number; step: { type: "send"; command: string } | { type: "delay"; ms: number } }> = [];
  const commandPattern = /(?:Serial\.(?:println|print|write)|send|writeSerial|command)\s*\(\s*(?:F\s*\(\s*)?["']([^"'\n]{1,80})["']\s*\)?\s*\)/gi;
  const delayPattern = /(?:delay|wait)\s*\(\s*(\d{1,6})\s*\)/gi;

  function normalizeCommand(value: string) {
    const candidate = value.normalize("NFKC").trim().toUpperCase();
    return /^[A-Z][A-Z0-9_:-]*(,[A-Z0-9_.:-]+){0,6}$/.test(candidate) ? candidate.slice(0, 80) : "";
  }

  for (const match of source.matchAll(commandPattern)) {
    const command = normalizeCommand(match[1] || "");
    if (command) tokens.push({ index: match.index || 0, step: { type: "send", command } });
  }

  for (const match of source.matchAll(delayPattern)) {
    tokens.push({
      index: match.index || 0,
      step: { type: "delay", ms: Math.min(Number(match[1]), 60_000) }
    });
  }

  source.split("\n").forEach((rawLine, lineIndex) => {
    const withoutComment = rawLine.replace(/\/\/.*$/, "").trim();
    if (!withoutComment || /[(){}]/.test(withoutComment)) return;
    if (/^(#|const\b|int\b|long\b|float\b|double\b|bool\b|char\b|String\b|void\b|return\b|if\b|else\b|for\b|while\b|switch\b)/i.test(withoutComment)) return;
    withoutComment.split(";").forEach((part, partIndex) => {
      const command = normalizeCommand(part);
      if (command) tokens.push({ index: source.indexOf(rawLine) + lineIndex + partIndex / 10, step: { type: "send", command } });
    });
  });

  const seen = new Set<string>();
  for (const { step } of tokens.sort((a, b) => a.index - b.index)) {
    const key = step.type === "delay" ? `d:${step.ms}:${steps.length}` : `s:${step.command}:${steps.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push(step);
  }

  return steps;
}

function isTeaCupCommand(command: string) {
  const clean = command.normalize("NFKC").trim().toUpperCase();
  return /^(T|FORCE),\d{1,3},\d{1,3}(,\d{1,3})?$/.test(clean) ||
    /^(D3|FORCE_D3|DRINK3),\d{1,3},\d{1,3}$/.test(clean);
}

function roleLabel(role?: Role) {
  if (role === "participant") return "참가자";
  if (role === "boothAdmin") return "부스";
  if (role === "rewardAdmin") return "보상";
  if (role === "superAdmin") return "총괄";
  return "-";
}

const PRINTER_WIDTH = 576;
const TEA_DEFAULT_COMMAND = "T,15,20";

let printerConnected = false;
const writeCharRef: { current: any } = { current: null };
let printProgressSetter = (_progress: number) => {};

function setPrinterConnected(value: boolean) {
  printerConnected = value;
}

function setPrintProgress(value: number) {
  printProgressSetter(value);
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("QR 이미지를 만들지 못했습니다."));
    image.src = src;
  });
}

function drawCenteredText(context: CanvasRenderingContext2D, text: string, y: number, width: number, size: number, weight = 800) {
  context.fillStyle = "#111827";
  context.font = `${weight} ${size}px Inter, Apple SD Gothic Neo, Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillText(text, width / 2, y);
}

function fitText(value: string, maxLength: number) {
  return Array.from(value).slice(0, maxLength).join("");
}

async function renderTempPassCanvas(pass: TempPassView) {
  if (!pass.qrToken) throw new Error("인쇄할 QR 토큰이 없습니다.");
  const width = PRINTER_WIDTH;
  const height = 420;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("인쇄 캔버스를 만들지 못했습니다.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#111827";
  context.lineWidth = 2;
  context.strokeRect(14, 14, width - 28, height - 28);

  drawCenteredText(context, "WSHS SCIENCE", 34, width, 26, 900);
  drawCenteredText(context, fitText(pass.displayName || pass.label, 12), 76, width, 38, 900);

  const qrSize = 244;
  const qrX = Math.round((width - qrSize) / 2);
  const qrY = 138;
  const qrImage = await loadCanvasImage(`/api/qr?value=${encodeURIComponent(publicQrValue(pass.qrToken))}`);
  context.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

  drawCenteredText(context, `${STAMP_REWARD_THRESHOLD}개 완료 후 보상 부스 스캔`, qrY + qrSize + 22, width, 22, 800);
  drawCenteredText(context, `${pass.label} · 현장 임시권`, qrY + qrSize + 56, width, 16, 700);

  return canvas;
}

const toBW = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
  const imageData = ctx.getImageData(0, 0, w, h);
  const px = imageData.data;
  const bw: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
      let rr = r, gg = g, bb = b;
      if (a < 255) { const alpha = a / 255; rr = Math.round(r * alpha + 255 * (1 - alpha)); gg = Math.round(g * alpha + 255 * (1 - alpha)); bb = Math.round(b * alpha + 255 * (1 - alpha)); }
      const gray = Math.round(rr * 0.299 + gg * 0.587 + bb * 0.114);
      row.push(gray < 128 ? 1 : 0);
    }
    bw.push(row);
  }
  return bw;
};

const sendCmd = async (bytes: number[]) => {
  const data = new Uint8Array(bytes);
  try { await writeCharRef.current.writeValueWithoutResponse(data); } catch (e) { await writeCharRef.current.writeValue(data); }
};

const sendDataMTU = async (data: Uint8Array, progressBase = 0, progressScale = 90) => {
  const CHUNK_SIZE = 100;
  let sentBytes = 0;
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, Math.min(i + CHUNK_SIZE, data.length));
    let retries = 0;
    while (retries < 10) {
      try { await writeCharRef.current.writeValueWithoutResponse(chunk); sentBytes += chunk.length; break; }
      catch (e) { retries++; if (retries >= 10) throw new Error(`BLE 전송 실패 at ${i}`); await delay(20 * retries); }
    }
    setPrintProgress(progressBase + Math.round((sentBytes / data.length) * progressScale));
    await delay(8);
  }
};

const sendToPrinter = async (bwData: number[][], progressBase = 0, progressScale = 90) => {
  const h = bwData.length;
  const w = bwData[0].length;
  const bytesPerLine = Math.ceil(w / 8);

  const bitmap = new Uint8Array(bytesPerLine * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bwData[y][x] === 1) {
        const byteIdx = y * bytesPerLine + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        bitmap[byteIdx] |= (1 << bitIdx);
      }
    }
  }

  const header = new Uint8Array([0x1D, 0x76, 0x30, 0x00, bytesPerLine & 0xFF, (bytesPerLine >> 8) & 0xFF, h & 0xFF, (h >> 8) & 0xFF]);
  const packet = new Uint8Array(header.length + bitmap.length);
  packet.set(header, 0);
  packet.set(bitmap, header.length);

  await sendDataMTU(packet, progressBase, progressScale);
  await delay(500);
  await sendCmd([0x1B, 0x50]);
};

const connectPrinter = async () => {
  if (!navigator.bluetooth) {
    alert("이 브라우저에서는 블루투스 프린터를 지원하지 않습니다.\n\nChrome, Edge 또는 Opera 브라우저를 사용해주세요.");
    return false;
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "nemonic" }],
      optionalServices: ["00005000-d102-11e1-9b23-74f07d000000", "3b790000-923e-4f69-b794-74f07d000000", "49535343-fe78-4ae5-8fa9-9fafd205e455"]
    });
    device.addEventListener("gattserverdisconnected", () => {
      setPrinterConnected(false);
      writeCharRef.current = null;
    });
    const server = await device.gatt.connect();
    const services = [
      { svc: "00005000-d102-11e1-9b23-74f07d000000", write: "00005001-d102-11e1-9b23-74f07d000000", name: "NEMONIC" },
      { svc: "3b790000-923e-4f69-b794-74f07d000000", write: "3b790002-923e-4f69-b794-74f07d000000", name: "MIP201" },
      { svc: "49535343-fe78-4ae5-8fa9-9fafd205e455", write: "49535343-8841-43f4-a8d4-ecbe34729bb3", name: "MIP301" }
    ];
    for (const s of services) {
      try {
        const sv = await server.getPrimaryService(s.svc);
        writeCharRef.current = await sv.getCharacteristic(s.write);
        setPrinterConnected(true);
        return true;
      } catch (e) { }
    }
    throw new Error("서비스 없음");
  } catch (error: any) {
    if (error.name !== "NotFoundError") {
      alert("프린터 연결 실패: " + error.message);
    }
    return false;
  }
};

async function printTempPasses(passes: TempPassView[], onProgress: (progress: number) => void) {
  const printable = passes.filter((pass) => pass.status === "active" && pass.qrToken);
  if (printable.length === 0) throw new Error("인쇄할 임시 QR이 없습니다.");

  printProgressSetter = onProgress;
  if (!printerConnected && !(await connectPrinter())) throw new Error("프린터 연결 실패");

  try {
    await sendCmd([0x1B, 0x40]);
    await delay(200);

    for (const [index, pass] of printable.entries()) {
      const canvas = await renderTempPassCanvas(pass);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("인쇄 캔버스를 읽지 못했습니다.");
      const bwData = toBW(context, canvas.width, canvas.height);
      const progressBase = Math.round((index / printable.length) * 90);
      const progressScale = Math.max(1, Math.round(90 / printable.length));
      await sendToPrinter(bwData, progressBase, progressScale);
      await delay(Math.max(2000, canvas.height * 10));
      await sendCmd([0x1B, 0x69]);
      await delay(1000);
    }

    setPrintProgress(100);
  } finally {
    printProgressSetter = () => {};
  }
}

function QrImage({ token, label }: { token: string; label: string }) {
  return (
    <div className="qrBox" aria-label={label}>
      <img src={`/api/qr?value=${encodeURIComponent(publicQrValue(token))}`} alt={label} />
      <p>{label}</p>
    </div>
  );
}

function StampEffect({ effect }: { effect: StampEffectState }) {
  return (
    <div className={`stampEffect ${effect.mode}`} aria-live="polite" key={effect.id}>
      <div className="burstRing" />
      <div className="spark s1" />
      <div className="spark s2" />
      <div className="spark s3" />
      <div className="effectStamp">
        {effect.imageDataUrl ? <img src={effect.imageDataUrl} alt="" /> : <span>STAMP</span>}
      </div>
      <div className="effectText">
        <strong>{effect.title}</strong>
        <span>{effect.detail}</span>
      </div>
    </div>
  );
}

function Scanner({ label, onScan }: { label: string; onScan: (token: string) => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const [active, setActive] = useState(false);
  const [manual, setManual] = useState("");
  const [message, setMessage] = useState("");

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  async function processToken(token: string) {
    if (!token || busyRef.current) return;
    busyRef.current = true;
    try {
      await onScan(token);
      setMessage("처리 완료");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "처리 실패");
    } finally {
      window.setTimeout(() => {
        busyRef.current = false;
      }, 1200);
    }
  }

  async function startCamera() {
    setMessage("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("사진 스캔 사용");
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
      setMessage("카메라 켜짐");
    } catch {
      setMessage("카메라 권한 확인");
    }
  }

  useEffect(() => {
    if (!active || !videoRef.current) return;
    let cancelled = false;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    async function tick() {
      if (cancelled || !videoRef.current) return;
      try {
        const video = videoRef.current;
        if (context && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          const scale = Math.min(1, 900 / video.videoWidth);
          const width = Math.max(1, Math.floor(video.videoWidth * scale));
          const height = Math.max(1, Math.floor(video.videoHeight * scale));
          canvas.width = width;
          canvas.height = height;
          context.drawImage(video, 0, 0, width, height);
          const imageData = context.getImageData(0, 0, width, height);
          const code = jsQR(imageData.data, width, height, { inversionAttempts: "attemptBoth" });
          const token = extractQrToken(code?.data || "");
          await processToken(token);
        }
      } catch {
        setMessage("카메라 확인");
      }
      window.setTimeout(tick, 220);
    }

    tick();
    return () => {
      cancelled = true;
    };
  }, [active, onScan]);

  async function submitManual() {
    if (!manual.trim()) return;
    await processToken(extractQrToken(manual));
    setManual("");
  }

  async function scanImageFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busyRef.current) return;
    setMessage("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("이미지 읽기 실패"));
        reader.readAsDataURL(file);
      });
      const image = await loadCanvasImage(dataUrl);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("이미지 스캔 실패");
      const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.floor(image.naturalWidth * scale));
      const height = Math.max(1, Math.floor(image.naturalHeight * scale));
      canvas.width = width;
      canvas.height = height;
      context.drawImage(image, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const code = jsQR(imageData.data, width, height, { inversionAttempts: "attemptBoth" });
      const token = extractQrToken(code?.data || "");
      if (!token) throw new Error("QR을 찾지 못했습니다.");
      await processToken(token);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "사진 스캔 실패");
    }
  }

  return (
    <section className="panel scanPanel">
      <div className="sectionHeader">
        <div>
          <h2>{label}</h2>
          <p>QR을 비추세요.</p>
        </div>
        <div className="buttonRow">
          <button className="secondaryButton" onClick={active ? stopCamera : startCamera} type="button">
            {active ? "끄기" : "카메라"}
          </button>
          <label className="fileScanButton">
            사진
            <input accept="image/*" capture="environment" onChange={scanImageFile} type="file" />
          </label>
        </div>
      </div>
      <video className="scannerVideo" ref={videoRef} muted playsInline />
      <div className="inlineForm">
        <input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="QR token" />
        <button onClick={submitManual} type="button">처리</button>
      </div>
      {message && <p className="statusText">{message}</p>}
    </section>
  );
}

function AuthPanel({ onDone }: { onDone: () => Promise<void> }) {
  const [mode, setMode] = useState<AuthMode>("participant");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem("wshsParticipantCache");
    if (!raw) return;
    let cancelled = false;
    try {
      const cached = JSON.parse(raw) as { studentCode?: string; cacheKey?: string };
      if (!cached.studentCode || !cached.cacheKey) return;
      apiJson<{ ok: true; participantCache?: { studentCode: string; cacheKey: string } }>("/api/auth/participant", {
        method: "POST",
        body: JSON.stringify(cached)
      })
        .then(async (data) => {
          if (cancelled) return;
          if (data.participantCache) {
            window.localStorage.setItem("wshsParticipantCache", JSON.stringify(data.participantCache));
          }
          await onDone();
        })
        .catch(() => {
          window.localStorage.removeItem("wshsParticipantCache");
        });
    } catch {
      window.localStorage.removeItem("wshsParticipantCache");
    }
    return () => {
      cancelled = true;
    };
  }, [onDone]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (mode === "participant") {
        const data = await apiJson<{ ok: true; participantCache?: { studentCode: string; cacheKey: string } }>("/api/auth/participant", {
          method: "POST",
          body: JSON.stringify({ studentCode: loginId })
        });
        if (data.participantCache) {
          window.localStorage.setItem("wshsParticipantCache", JSON.stringify(data.participantCache));
        }
        await onDone();
        return;
      }

      const endpoint = mode === "adminLogin" ? "/api/auth/login" : "/api/admin/join";
      await apiJson(endpoint, {
        method: "POST",
        body: JSON.stringify({ loginId, password, displayName, inviteCode })
      });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="authShell">
      <section className="authPanel authPrimary">
        <div className="authTitle">
          <p className="eyebrow">과학의날</p>
          <h1>입장</h1>
          <p>스탬프 {STAMP_REWARD_THRESHOLD}개부터 쿠폰.</p>
        </div>
        <div className="segmented authModes">
          <button className={mode === "participant" ? "active" : ""} onClick={() => setMode("participant")} type="button">참가자</button>
          <button className={mode === "adminLogin" ? "active" : ""} onClick={() => setMode("adminLogin")} type="button">관리자</button>
          <button className={mode === "adminJoin" ? "active" : ""} onClick={() => setMode("adminJoin")} type="button">관리자 가입</button>
        </div>
        <label>
          {mode === "participant" ? "학번" : "아이디"}
          <input
            value={loginId}
            onChange={(event) => setLoginId(event.target.value)}
            autoComplete="username"
            inputMode={mode === "participant" ? "numeric" : "text"}
            maxLength={mode === "participant" ? 5 : undefined}
            pattern={mode === "participant" ? "[1-3][0-9]{4}" : undefined}
            placeholder={mode === "participant" ? "예: 10214" : ""}
          />
        </label>
        {mode === "participant" && <p className="hintText">중학생은 임시 QR. 다른 학번 반복 입장은 제한될 수 있어요.</p>}
        {mode !== "participant" && (
          <label>
            비밀번호
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "adminLogin" ? "current-password" : "new-password"} />
          </label>
        )}
        {mode === "adminJoin" && (
          <label>
            표시 이름
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={12} />
          </label>
        )}
        {mode === "adminJoin" && (
          <label>
            관리자 가입번호
            <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="B-CHEM-..." />
          </label>
        )}
        {error && <p className="errorText">{error}</p>}
        <button className="primaryButton" disabled={busy} onClick={submit} type="button">
          {busy ? "처리중" : mode === "participant" ? "입장" : mode === "adminLogin" ? "로그인" : "관리자 가입"}
        </button>
      </section>
      <section className="quickPanel">
        <section className="panel opsPanel compactOpsPanel">
          <div className="previewHeader compactPreviewHeader">
            <div>
              <p className="eyebrow">운영</p>
              <h2>준비</h2>
            </div>
            <span className="liveBadge">James 제작</span>
          </div>
          <div className="statusStrip">
            <div>
              <strong>{STAMP_REWARD_THRESHOLD}개</strong>
              <span>쿠폰</span>
            </div>
            <div>
              <strong>1개</strong>
              <span>보상</span>
            </div>
            <div>
              <strong>QR</strong>
              <span>확인</span>
            </div>
          </div>
          <div className="simpleFlow" aria-label="이용 순서">
            <span>입장</span>
            <span>스탬프</span>
            <span>쿠폰</span>
          </div>
          <div className="rewardMiniList">
            <div>
              <img src={rewardImagePath("chemistry")} alt="" />
              <div>
                <strong>화학</strong>
                <span>달고나</span>
              </div>
            </div>
            <div>
              <img src={rewardImagePath("biology")} alt="" />
              <div>
                <strong>생명</strong>
                <span>콩가루차</span>
              </div>
            </div>
            <div>
              <img src={rewardImagePath("quasar")} alt="" />
              <div>
                <strong>퀘이사</strong>
                <span>팝콘</span>
              </div>
            </div>
            <div>
              <img src={rewardImagePath("alphago")} alt="" />
              <div>
                <strong>알파고</strong>
                <span>아이스티</span>
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function ParticipantHome({ me, refresh }: { me: MePayload; refresh: () => Promise<void> }) {
  const [selectedReward, setSelectedReward] = useState<Reward["id"]>("chemistry");
  const [error, setError] = useState("");
  const rewards = me.rewards || [];
  const couponReward = rewards.find((reward) => reward.id === me.coupon?.rewardId);
  const selectedRewardItem = rewards.find((reward) => reward.id === selectedReward);
  const couponCanChange = Boolean(me.coupon && me.coupon.status === "unused" && rewardSoldOutForStamp(couponReward));
  const stamps = me.stamps || [];
  const progress = Math.min(me.stats?.stampCount || 0, STAMP_REWARD_THRESHOLD);
  const remaining = Math.max(STAMP_REWARD_THRESHOLD - progress, 0);
  const latestStamp = [...stamps].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const couponStatus = me.coupon
    ? me.coupon.status === "unused" ? "사용 가능" : "사용 완료"
    : me.stats?.couponEligible ? "변환 가능" : "대기";

  useEffect(() => {
    if (!rewards.length) return;
    if (selectedRewardItem && !rewardSoldOutForStamp(selectedRewardItem)) return;
    const firstAvailable = rewards.find((reward) => !rewardSoldOutForStamp(reward));
    if (firstAvailable) setSelectedReward(firstAvailable.id);
  }, [rewards, selectedRewardItem]);

  async function createCoupon() {
    setError("");
    try {
      await apiJson("/api/coupon/create", {
        method: "POST",
        body: JSON.stringify({ rewardId: selectedReward })
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "쿠폰 발급 실패");
    }
  }

  return (
    <div className="gridTwo">
      <section className="panel homeSummary">
        <div className="sectionHeader compactHeader">
          <div>
            <p className="eyebrow">내 기록</p>
            <h2>{me.account?.displayName}</h2>
          </div>
          <span className={`pill ${remaining === 0 ? "ok" : "done"}`}>
            {couponStatus}
          </span>
        </div>
        <div className="identityBlock">
          <div className={`avatarFrame frame-${me.profile?.frameId || "clean"}`}>
            {me.profile?.avatarStampImageDataUrl ? <img src={me.profile.avatarStampImageDataUrl} alt="대표 스탬프" /> : <span>STAMP</span>}
          </div>
          <div>
            <p>{me.profile?.bio || "한 줄 소개 없음"}</p>
            <div className="progressLabel">
              <strong>{progress}/{STAMP_REWARD_THRESHOLD}</strong>
              <span>스탬프</span>
            </div>
            <div className="progressTrack">
              <span style={{ width: `${(progress / STAMP_REWARD_THRESHOLD) * 100}%` }} />
            </div>
          </div>
        </div>
        <div className="summaryRows">
          <div>
            <span>남은 스탬프</span>
            <strong>{remaining === 0 ? "완료" : `${remaining}개`}</strong>
          </div>
          <div>
            <span>최근 기록</span>
            <strong>{latestStamp ? latestStamp.boothName : "없음"}</strong>
          </div>
          <div>
            <span>쿠폰 상태</span>
            <strong>{couponStatus}</strong>
          </div>
        </div>
      </section>

      {me.participantQrToken && <QrImage token={me.participantQrToken} label="내 QR" />}

      <section className="panel widePanel">
        <div className="sectionHeader">
          <div>
            <h2>쿠폰</h2>
            <p>{STAMP_REWARD_THRESHOLD}개부터 선택.</p>
          </div>
        </div>
        {me.coupon ? (
          <div className="couponLayout">
            <div className="couponRewardInfo">
              <RewardImage reward={couponReward} className="couponRewardImage" />
              <p className="couponTitle">{rewardLabel(couponReward)}</p>
              {rewardDetail(couponReward?.id) && <p className="rewardDetail">{rewardDetail(couponReward?.id)}</p>}
              <p className="rewardDetail">{rewardStockLabel(couponReward)}</p>
              <p className={`pill ${me.coupon.status === "unused" ? "ok" : "done"}`}>
                {couponCanChange ? "교체 가능" : me.coupon.status === "unused" ? "사용 가능" : `사용 완료 ${formatTime(me.coupon.redeemedAt)}`}
              </p>
            </div>
            <QrImage token={me.coupon.qrToken} label="쿠폰 QR" />
            {couponCanChange && (
              <div className="couponChangeBox">
                <div className="sectionHeader compactHeader">
                  <div>
                    <h2>교체</h2>
                    <p>품절 보상 변경.</p>
                  </div>
                </div>
                <div className="rewardGrid compactRewardGrid">
                  {rewards.map((reward) => {
                    const soldOut = rewardSoldOutForStamp(reward);
                    return (
                      <button
                        className={`rewardChoice ${selectedReward === reward.id ? "selected" : ""} ${soldOut ? "soldOut" : ""}`}
                        disabled={soldOut || reward.id === me.coupon?.rewardId}
                        key={reward.id}
                        onClick={() => setSelectedReward(reward.id)}
                        type="button"
                      >
                        <img src={rewardImagePath(reward.id)} alt={reward.name} />
                        <span>{rewardLabel(reward)}</span>
                        <small>{soldOut ? "품절" : rewardStockLabel(reward)}</small>
                      </button>
                    );
                  })}
                </div>
                {error && <p className="errorText">{error}</p>}
                <button className="primaryButton" disabled={!selectedRewardItem || rewardSoldOutForStamp(selectedRewardItem) || selectedReward === me.coupon.rewardId} onClick={createCoupon} type="button">
                  교체
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="rewardGrid">
              {rewards.map((reward) => {
                const soldOut = rewardSoldOutForStamp(reward);
                return (
                  <button
                    className={`rewardChoice ${selectedReward === reward.id ? "selected" : ""} ${soldOut ? "soldOut" : ""}`}
                    disabled={soldOut}
                    key={reward.id}
                    onClick={() => setSelectedReward(reward.id)}
                    type="button"
                  >
                    <img src={rewardImagePath(reward.id)} alt={reward.name} />
                    <span>{rewardLabel(reward)}</span>
                    <small>{soldOut ? "품절" : rewardStockLabel(reward)}</small>
                    {rewardDetail(reward.id) && <small>{rewardDetail(reward.id)}</small>}
                  </button>
                );
              })}
            </div>
            {error && <p className="errorText">{error}</p>}
            <button className="primaryButton" disabled={(me.stats?.stampCount || 0) < STAMP_REWARD_THRESHOLD || !selectedRewardItem || rewardSoldOutForStamp(selectedRewardItem)} onClick={createCoupon} type="button">
              변환
            </button>
          </>
        )}
      </section>

      <TeaReservationCard me={me} />
      <NoticePanel compact />

      <section className="panel widePanel">
        <div className="sectionHeader compactHeader">
          <div>
            <h2>스탬프</h2>
            <p>받은 기록.</p>
          </div>
          <span className="countText">{stamps.length}개</span>
        </div>
        <div className="stampList">
          {stamps.map((stamp) => (
            <div className="stampRecord" key={stamp.id}>
              <img src={stamp.stampImageDataUrl} alt={`${stamp.boothName} 로고`} />
              <div>
                <strong>{stamp.boothName}</strong>
                <span>{formatTime(stamp.createdAt)}</span>
              </div>
              <span className="pill done">완료</span>
            </div>
          ))}
          {stamps.length === 0 && <p className="emptyText">기록 없음</p>}
        </div>
      </section>
    </div>
  );
}

function TeaReservationCard({ me }: { me: MePayload }) {
  const [reservations, setReservations] = useState<TeaReservationView[]>([]);
  const [stockCount, setStockCount] = useState(0);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await apiJson<TeaReservationsPayload>("/api/tea/reservations", { method: "GET" });
    setReservations(data.reservations);
    setStockCount(data.stockCount || 0);
  }, []);

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "예약 로드 실패"));
  }, [load]);

  const activeReservation = reservations.find((reservation) => ["reserved", "brewing", "ready"].includes(reservation.status));
  const latestReservation = activeReservation || reservations[0];
  const recentReservations = reservations.slice(0, 3);
  const reservationStatus = latestReservation ? teaReservationStatus(latestReservation.status) : "주문 가능";
  const reservationTime = latestReservation ? formatTime(latestReservation.updatedAt) : "바로 예약";
  const hasTeaCoupon = me.coupon?.rewardId === "alphago" && me.coupon.status === "unused";
  const priorityText = hasTeaCoupon ? "쿠폰 우선 적용" : "쿠폰 선택 시 우선";
  const teaSoldOutForOnline = stockCount <= 0 && !hasTeaCoupon;

  async function createReservation() {
    setBusy(true);
    setMessage("");
    try {
      const data = await apiJson<{ reservation: TeaReservationView }>("/api/tea/reservations", {
        method: "POST",
        body: JSON.stringify({ note })
      });
      setNote("");
      await load();
      setMessage(`#${data.reservation.orderNumber} 예약됨`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "예약 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel teaCustomerPanel widePanel">
      <div className="teaCustomerHero">
        <div className="teaHeroCopy">
          <div className="teaHeroBadges">
            <span className={`teaStatusChip ${latestReservation?.status || "idle"}`}>{reservationStatus}</span>
            <span className={`teaPriorityChip ${hasTeaCoupon ? "active" : ""}`}>{priorityText}</span>
          </div>
          <h2>아이스티</h2>
          <p>Automatic Ice-Tea Maker</p>
          <div className="teaHeroMetrics">
            <div>
              <span>번호</span>
              <strong>{latestReservation ? `#${latestReservation.orderNumber}` : "-"}</strong>
            </div>
            <div>
              <span>시간</span>
              <strong>{reservationTime}</strong>
            </div>
            <div>
              <span>재고</span>
              <strong>{stockCount}잔</strong>
            </div>
          </div>
        </div>
        <div className="teaProductStage" aria-hidden="true">
          <img src={rewardImagePath("alphago")} alt="" />
          <span>ALPHAGO</span>
        </div>
      </div>

      <div className={`teaPriorityNotice ${hasTeaCoupon ? "active" : ""}`}>
        <strong>{hasTeaCoupon ? "우선 제조" : "쿠폰 우선"}</strong>
        <span>{hasTeaCoupon ? "알파고 쿠폰 예약은 먼저 처리됩니다." : "아이스티 쿠폰을 선택하면 예약 대기열에서 우선권을 받습니다."}</span>
      </div>

      <div className="teaReserveAction">
        <label>
          <span>요청 메모</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={60} placeholder="얼음 적게" />
        </label>
        <button className="teaReserveCta" disabled={busy || Boolean(activeReservation) || teaSoldOutForOnline} onClick={createReservation} type="button">
          {busy ? "처리중" : activeReservation ? "진행중" : teaSoldOutForOnline ? "품절" : hasTeaCoupon ? "쿠폰예약" : "예약구매"}
        </button>
      </div>
      {message && <p className={message.includes("실패") || message.includes("진행") ? "errorText" : "statusText"}>{message}</p>}

      <div className="teaRecentBox">
        <div className="teaRecentHead">
          <strong>최근 예약</strong>
          <span>{reservations.length}건</span>
        </div>
        <div className="teaRecentList">
          {recentReservations.map((reservation) => (
            <div className={`teaRecentItem ${reservation.priority ? "priority" : ""}`} key={reservation.id}>
              <span>#{reservation.orderNumber}</span>
              <strong>{reservation.priority ? "쿠폰 우선" : teaReservationStatus(reservation.status)}</strong>
              <small>{formatTime(reservation.updatedAt)}</small>
            </div>
          ))}
          {recentReservations.length === 0 && <p className="emptyText">아직 없음</p>}
        </div>
      </div>
    </section>
  );
}

function NoticePanel({ compact = false }: { compact?: boolean }) {
  const [notices, setNotices] = useState<ClubNoticeView[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [postClubName, setPostClubName] = useState("");
  const [message, setMessage] = useState("");
  const [noticeText, setNoticeText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await apiJson<NoticePayload>("/api/notices", { method: "GET" });
    setNotices(data.notices);
    setCanPost(data.canPost);
    setPostClubName(data.postClubName);
  }, []);

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "공지 로드 실패"));
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function sendNotice() {
    setBusy(true);
    setMessage("");
    try {
      const data = await apiJson<{ notices: ClubNoticeView[] }>("/api/notices", {
        method: "POST",
        body: JSON.stringify({ message: noticeText })
      });
      setNoticeText("");
      setNotices(data.notices);
      setMessage("공지 보냄");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "공지 실패");
    } finally {
      setBusy(false);
    }
  }

  const visibleNotices = compact ? notices.slice(0, 5) : notices;

  return (
    <section className={`panel noticePanel ${compact ? "widePanel" : ""}`}>
      <div className="sectionHeader compactHeader">
        <div>
          <h2>공지</h2>
          <p>{canPost ? `${postClubName}에서 보냄.` : "동아리 소식."}</p>
        </div>
      </div>
      {canPost && (
        <div className="noticeComposer">
          <input value={noticeText} onChange={(event) => setNoticeText(event.target.value)} maxLength={120} placeholder="짧은 공지" />
          <button className="primaryButton" disabled={busy || noticeText.trim().length < 2} onClick={sendNotice} type="button">
            보내기
          </button>
        </div>
      )}
      {message && <p className={message.includes("보냄") ? "statusText" : "errorText"}>{message}</p>}
      <div className="noticeList">
        {visibleNotices.map((notice) => (
          <article className="noticeItem" key={notice.id}>
            <div>
              <strong>{notice.clubName}</strong>
              <span>{formatTime(notice.createdAt)} · {notice.createdByDisplayName}</span>
            </div>
            <p>{notice.message}</p>
          </article>
        ))}
        {visibleNotices.length === 0 && <p className="emptyText">공지 없음</p>}
      </div>
    </section>
  );
}

function ProfileEditor({ me, refresh }: { me: MePayload; refresh: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(me.account?.displayName || "");
  const [bio, setBio] = useState(me.profile?.bio || "");
  const [avatarStampId, setAvatarStampId] = useState(me.profile?.avatarStampId || "");
  const [themeId, setThemeId] = useState(me.profile?.themeId || "science");
  const [frameId, setFrameId] = useState(me.profile?.frameId || "clean");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDisplayName(me.account?.displayName || "");
    setBio(me.profile?.bio || "");
    setAvatarStampId(me.profile?.avatarStampId || "");
    setThemeId(me.profile?.themeId || "science");
    setFrameId(me.profile?.frameId || "clean");
  }, [me]);

  async function saveProfile() {
    setMessage("");
    try {
      await apiJson("/api/profile/update", {
        method: "POST",
        body: JSON.stringify({ displayName, bio, avatarStampId: avatarStampId || null, themeId, frameId })
      });
      await refresh();
      setMessage("저장되었습니다.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "저장 실패");
    }
  }

  return (
    <section className="panel">
      <div className="sectionHeader">
        <div>
          <h2>프로필</h2>
          <p>이름 변경 제한 있음.</p>
        </div>
      </div>
      <div className="formGrid">
        <label>
          표시 이름
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={12} />
        </label>
        <label>
          한 줄 소개
          <input value={bio} onChange={(event) => setBio(event.target.value)} maxLength={80} />
        </label>
        <label>
          좋아하는 스탬프
          <select value={avatarStampId} onChange={(event) => setAvatarStampId(event.target.value)}>
            <option value="">기본</option>
            {(me.stamps || []).map((stamp) => (
              <option value={stamp.id} key={stamp.id}>{stamp.boothName}</option>
            ))}
          </select>
        </label>
        <label>
          테마
          <select value={themeId} onChange={(event) => setThemeId(event.target.value)}>
            <option value="science">Science</option>
            <option value="mint">Mint</option>
            <option value="sunset">Sunset</option>
            <option value="space">Space</option>
            <option value="clean">Clean</option>
            <option value="mono">Mono</option>
          </select>
        </label>
        <label>
          프레임
          <select value={frameId} onChange={(event) => setFrameId(event.target.value)}>
            <option value="clean">Clean</option>
            <option value="lab">Lab</option>
            <option value="orbit">Orbit</option>
            <option value="spark">Spark</option>
            <option value="winner">Winner</option>
          </select>
        </label>
      </div>
      {message && <p className={message.includes("실패") || message.includes("없") || message.includes("한 번") ? "errorText" : "statusText"}>{message}</p>}
      <button className="primaryButton" onClick={saveProfile} type="button">저장</button>
    </section>
  );
}

function RequiredNamePanel({ refresh }: { refresh: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveName() {
    setBusy(true);
    setMessage("");
    try {
      await apiJson("/api/profile/update", {
        method: "POST",
        body: JSON.stringify({ displayName })
      });
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel requiredNamePanel">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">처음 설정</p>
          <h2>이름 입력</h2>
          <p>랭킹과 쿠폰 확인에 표시됩니다.</p>
        </div>
      </div>
      <label>
        이름
        <input autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={12} placeholder="실명 입력" />
      </label>
      {message && <p className="errorText">{message}</p>}
      <button className="primaryButton" disabled={busy || displayName.trim().length < 2} onClick={saveName} type="button">
        저장
      </button>
    </section>
  );
}

function StampStudio({ me, refresh }: { me: MePayload; refresh: () => Promise<void> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const managedBooths = useMemo(() => {
    const booths = me.managedBooths?.length ? me.managedBooths : me.booth ? [me.booth] : [];
    return booths.filter((booth) => booth.active !== false);
  }, [me.booth, me.managedBooths]);
  const [selectedBoothId, setSelectedBoothId] = useState("");
  const selectedBooth = managedBooths.find((booth) => booth.id === selectedBoothId) || managedBooths[0];
  const [color, setColor] = useState("#ef4444");
  const [size, setSize] = useState(12);
  const [message, setMessage] = useState("");
  const [previewDataUrl, setPreviewDataUrl] = useState("");
  const [boothName, setBoothName] = useState("");

  useEffect(() => {
    if (!managedBooths.length) {
      setSelectedBoothId("");
      return;
    }
    if (!managedBooths.some((booth) => booth.id === selectedBoothId)) {
      setSelectedBoothId(managedBooths[0].id);
    }
  }, [managedBooths, selectedBoothId]);

  useEffect(() => {
    setBoothName(selectedBooth?.name || "");
  }, [selectedBooth?.id, selectedBooth?.name]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (selectedBooth?.stampImageDataUrl) {
      const image = new Image();
      image.onload = () => {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setPreviewDataUrl(canvas.toDataURL("image/png"));
      };
      image.src = selectedBooth.stampImageDataUrl;
    } else {
      setPreviewDataUrl(canvas.toDataURL("image/png"));
    }
  }, [selectedBooth?.id, selectedBooth?.stampImageDataUrl]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const next = point(event);
    context.lineTo(next.x, next.y);
    context.strokeStyle = color;
    context.lineWidth = size;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  }

  function startDraw(event: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = canvasRef.current?.getContext("2d");
    const start = point(event);
    context?.beginPath();
    context?.moveTo(start.x, start.y);
  }

  function syncPreview() {
    const canvas = canvasRef.current;
    if (canvas) setPreviewDataUrl(canvas.toDataURL("image/png"));
  }

  function endDraw() {
    drawingRef.current = false;
    syncPreview();
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    syncPreview();
  }

  async function saveStamp() {
    setMessage("");
    const canvas = canvasRef.current;
    if (!canvas || !selectedBooth) return;
    try {
      await apiJson("/api/booth/save-stamp", {
        method: "POST",
        body: JSON.stringify({ boothId: selectedBooth.id, imageDataUrl: canvas.toDataURL("image/png") })
      });
      await refresh();
      setMessage("저장됨");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "저장 실패");
    }
  }

  async function resetStamp() {
    setMessage("");
    if (!selectedBooth) return;
    if (!window.confirm(`${selectedBooth.name} 도장을 기본값으로 되돌릴까요?`)) return;
    try {
      await apiJson("/api/booth/save-stamp", {
        method: "POST",
        body: JSON.stringify({ boothId: selectedBooth.id, reset: true })
      });
      await refresh();
      clearCanvas();
      setMessage("원본 리셋");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "리셋 실패");
    }
  }

  async function saveBoothName() {
    setMessage("");
    if (!selectedBooth) return;
    try {
      await apiJson("/api/admin/booths", {
        method: "PATCH",
        body: JSON.stringify({ boothId: selectedBooth.id, name: boothName })
      });
      await refresh();
      setMessage("부스명 저장");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "저장 실패");
    }
  }

  return (
    <>
    <section className="panel">
      <div className="sectionHeader">
        <div>
          <h2>도장</h2>
          <p>{selectedBooth ? `${selectedBooth.clubName} · ${selectedBooth.name}` : "부스 없음"}</p>
        </div>
      </div>
      <div className="canvasTools">
        <label>
          부스
          <select value={selectedBooth?.id || ""} onChange={(event) => setSelectedBoothId(event.target.value)}>
            {managedBooths.map((booth) => (
              <option key={booth.id} value={booth.id}>{booth.name}</option>
            ))}
          </select>
        </label>
        <label>
          부스명
          <input value={boothName} onChange={(event) => setBoothName(event.target.value)} maxLength={28} />
        </label>
        <button className="secondaryButton" disabled={!selectedBooth} onClick={saveBoothName} type="button">저장</button>
      </div>
      <div className="canvasTools">
        <label>
          색상
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </label>
        <label>
          굵기
          <input type="range" min={2} max={28} value={size} onChange={(event) => setSize(Number(event.target.value))} />
        </label>
        <button className="secondaryButton" onClick={clearCanvas} type="button">지우기</button>
      </div>
      <canvas
        className="stampCanvas"
        height={260}
        onPointerDown={startDraw}
        onPointerLeave={endDraw}
        onPointerMove={draw}
        onPointerUp={endDraw}
        ref={canvasRef}
        width={260}
      />
      <div className="stampPreview">
        <span>미리보기</span>
        {previewDataUrl ? <img src={previewDataUrl} alt="도장 미리보기" /> : <strong>STAMP</strong>}
      </div>
      {message && <p className={(message.includes("저장") || message.includes("리셋")) && !message.includes("실패") ? "statusText" : "errorText"}>{message}</p>}
      <div className="buttonRow">
        <button className="primaryButton" disabled={!selectedBooth} onClick={saveStamp} type="button">저장</button>
        <button className="secondaryButton" disabled={!selectedBooth} onClick={resetStamp} type="button">원본 리셋</button>
      </div>
    </section>
    {me.account?.role === "boothAdmin" && <BoothNamesPanel me={me} refresh={refresh} />}
    </>
  );
}

function BoothScanPanel({ me, onScan }: { me: MePayload; onScan: (token: string, booth: BoothView) => Promise<void> }) {
  const managedBooths = useMemo(() => {
    const booths = me.managedBooths?.length ? me.managedBooths : me.booth ? [me.booth] : [];
    return booths.filter((booth) => booth.active !== false);
  }, [me.booth, me.managedBooths]);
  const [selectedBoothId, setSelectedBoothId] = useState("");
  const selectedBooth = managedBooths.find((booth) => booth.id === selectedBoothId) || managedBooths[0];

  useEffect(() => {
    if (!managedBooths.length) {
      setSelectedBoothId("");
      return;
    }
    if (!managedBooths.some((booth) => booth.id === selectedBoothId)) {
      setSelectedBoothId(managedBooths[0].id);
    }
  }, [managedBooths, selectedBoothId]);

  return (
    <div className="gridTwo">
      <section className="panel boothScanCard">
        <div className="sectionHeader">
          <div>
            <h2>부스</h2>
            <p>{selectedBooth ? selectedBooth.clubName : "선택 필요"}</p>
          </div>
        </div>
        <label>
          지급 부스
          <select value={selectedBooth?.id || ""} onChange={(event) => setSelectedBoothId(event.target.value)}>
            {managedBooths.map((booth) => (
              <option key={booth.id} value={booth.id}>{booth.name}</option>
            ))}
          </select>
        </label>
        <div className="stampPreview boothStampPreview">
          <span>지급 도장</span>
          {selectedBooth?.stampImageDataUrl ? <img src={selectedBooth.stampImageDataUrl} alt={`${selectedBooth.name} 도장`} /> : <strong>STAMP</strong>}
        </div>
      </section>
      <Scanner
        label="QR 지급"
        onScan={async (token) => {
          if (!selectedBooth) throw new Error("부스를 선택하세요.");
          await onScan(token, selectedBooth);
        }}
      />
    </div>
  );
}

function SuperAdminManualStampPanel({ me, refresh }: { me: MePayload; refresh: () => Promise<void> }) {
  const booths = useMemo(() => (me.booths || []).filter((booth) => booth.active !== false), [me.booths]);
  const [selectedBoothId, setSelectedBoothId] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedBooth = booths.find((booth) => booth.id === selectedBoothId) || booths[0];

  useEffect(() => {
    if (!booths.length) {
      setSelectedBoothId("");
      return;
    }
    if (!booths.some((booth) => booth.id === selectedBoothId)) {
      setSelectedBoothId(booths[0].id);
    }
  }, [booths, selectedBoothId]);

  async function grantManualStamp() {
    if (!selectedBooth) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await apiJson<{ participantName: string; stampCount: number; createdParticipant?: boolean }>("/api/booth/grant-stamp", {
        method: "POST",
        body: JSON.stringify({ studentCode, boothId: selectedBooth.id })
      });
      await refresh();
      setMessage(`${result.participantName} 지급 완료 (${result.stampCount}/${STAMP_REWARD_THRESHOLD})${result.createdParticipant ? " · 계정 생성" : ""}`);
      setStudentCode("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "지급 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel manualStampPanel">
      <div className="sectionHeader">
        <div>
          <h2>테스트 지급</h2>
          <p>총괄 전용.</p>
        </div>
      </div>
      <div className="inlineForm manualStampForm">
        <label>
          부스
          <select value={selectedBooth?.id || ""} onChange={(event) => setSelectedBoothId(event.target.value)}>
            {booths.map((booth) => (
              <option key={booth.id} value={booth.id}>{booth.clubName} · {booth.name}</option>
            ))}
          </select>
        </label>
        <label>
          학번
          <input
            inputMode="numeric"
            maxLength={5}
            onChange={(event) => setStudentCode(event.target.value.replace(/\D/g, "").slice(0, 5))}
            placeholder="10214"
            value={studentCode}
          />
        </label>
        <button className="primaryButton" disabled={busy || !selectedBooth || studentCode.length !== 5} onClick={grantManualStamp} type="button">
          지급
        </button>
      </div>
      <p className="hintText">QR 없이 지급.</p>
      {message && <p className={message.includes("완료") ? "statusText" : "errorText"}>{message}</p>}
    </section>
  );
}

function CodesPanel() {
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    apiJson<{ codes: CodeRow[] }>("/api/admin/codes")
      .then((data) => setCodes(data.codes))
      .catch((err) => setError(err instanceof Error ? err.message : "코드 로드 실패"));
  }, []);

  const showFullCode = codes.some((code) => code.fullCode);
  const groupedCodes = useMemo(() => {
    const order = [
      "퀘이사",
      "과학탐구반",
      "알파고",
      "화학실험탐구반",
      "의생명과학탐구반",
      "AI 무인항공기",
      "국어과",
      "창의메이커스",
      "수학과",
      "액시스 물리탐구반",
      "천문동아리",
      "총괄"
    ];
    const groups = new Map<string, CodeRow[]>();
    for (const code of codes) {
      const group = code.groupName || "기타";
      groups.set(group, [...(groups.get(group) || []), code]);
    }
    return [...groups.entries()].sort((a, b) => {
      const ai = order.includes(a[0]) ? order.indexOf(a[0]) : 99;
      const bi = order.includes(b[0]) ? order.indexOf(b[0]) : 99;
      if (ai !== bi) return ai - bi;
      return a[0].localeCompare(b[0]);
    });
  }, [codes]);

  return (
    <section className="panel">
      <div className="sectionHeader">
        <div>
          <h2>코드</h2>
          <p>{showFullCode ? "동아리별 1계정." : "원문은 숨김."}</p>
        </div>
      </div>
      {error && <p className="errorText">{error}</p>}
      <div className="codeGroups">
        {groupedCodes.map(([groupName, rows]) => (
          <section className="codeGroup" key={groupName}>
            <div className="codeGroupHeader">
              <strong>{groupName}</strong>
              <span>{rows.length}개</span>
            </div>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>번호</th>
                    {showFullCode && <th>풀 코드</th>}
                    <th>역할</th>
                    <th>담당</th>
                    <th>상태</th>
                    <th>계정</th>
                    <th>사용 시간</th>
                    <th>사용자</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((code) => (
                    <tr key={code.codeLabel}>
                      <td>{code.codeLabel}</td>
                      {showFullCode && <td className="codeText">{code.fullCode || "seed 없음"}</td>}
                      <td>{code.role}</td>
                      <td>{code.targetName}</td>
                      <td><span className={`pill ${code.revoked ? "done" : code.used ? "done" : "ok"}`}>{code.revoked ? "비활성" : code.used ? "사용됨" : "미사용"}</span></td>
                      <td>{code.useCount || 0}개</td>
                      <td>{formatTime(code.usedAt)}</td>
                      <td>{code.usedByDisplayName || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function tempPassStatus(pass: TempPassView) {
  if (pass.status === "redeemed") return "지급 완료";
  if (pass.status === "voided") return "중지";
  if (pass.stampCount >= STAMP_REWARD_THRESHOLD) return "보상 가능";
  return "진행";
}

function TempPassPanel() {
  const [passes, setPasses] = useState<TempPassView[]>([]);
  const [lastCreatedIds, setLastCreatedIds] = useState<Set<string>>(new Set());
  const [selectedPassIds, setSelectedPassIds] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(4);
  const [displayNames, setDisplayNames] = useState("");
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const data = await apiJson<{ passes: TempPassView[] }>("/api/admin/temp-passes");
    setPasses(data.passes);
  }, []);

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "임시 QR 로드 실패"));
  }, [load]);

  const printTargets = passes.filter((pass) => selectedPassIds.has(pass.id) && pass.status === "active" && pass.qrToken);

  function togglePass(passId: string) {
    setSelectedPassIds((current) => {
      const next = new Set(current);
      if (next.has(passId)) next.delete(passId);
      else next.add(passId);
      return next;
    });
  }

  async function createPasses() {
    setBusy(true);
    setMessage("");
    try {
      const data = await apiJson<{ created: TempPassView[] }>("/api/admin/temp-passes", {
        method: "POST",
        body: JSON.stringify({ count, displayNames })
      });
      const createdIds = new Set(data.created.map((pass) => pass.id));
      setLastCreatedIds(createdIds);
      setSelectedPassIds(createdIds);
      await load();
      setMessage(`${data.created.length}개 생성`);
      setDisplayNames("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "생성 실패");
    } finally {
      setBusy(false);
    }
  }

  async function printPasses() {
    setPrinting(true);
    setProgress(0);
    setMessage("");
    try {
      await printTempPasses(printTargets, setProgress);
      setMessage(`${printTargets.length}개 네모닉 인쇄 완료`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "네모닉 인쇄 실패");
    } finally {
      setPrinting(false);
    }
  }

  async function deletePass(pass: TempPassView) {
    const confirmLabel = window.prompt(`삭제하려면 ${pass.label} 을 정확히 입력하세요.`);
    if (confirmLabel === null) return;
    setMessage("");
    try {
      const data = await apiJson<{ passes: TempPassView[] }>("/api/admin/temp-passes", {
        method: "DELETE",
        body: JSON.stringify({ passId: pass.id, confirmLabel })
      });
      setPasses(data.passes);
      setSelectedPassIds((current) => {
        const next = new Set(current);
        next.delete(pass.id);
        return next;
      });
      setMessage(`${pass.label} 삭제`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "삭제 실패");
    }
  }

  return (
    <section className="panel tempPassPanel">
      <div className="sectionHeader">
        <div>
          <h2>임시 QR</h2>
          <p>폰 없는 참가자용.</p>
        </div>
        <button className="secondaryButton" onClick={load} type="button">새로고침</button>
      </div>

      <div className="tempControls">
        <label>
          생성 수
          <input min={1} max={40} type="number" value={count} onChange={(event) => setCount(Number(event.target.value))} />
        </label>
        <label className="tempNameInput">
          메모
          <textarea value={displayNames} onChange={(event) => setDisplayNames(event.target.value)} placeholder="선택 입력" rows={3} />
        </label>
        <div className="staticField">
          <span>네모닉</span>
          <strong>576px</strong>
        </div>
        <button className="primaryButton" disabled={busy} onClick={createPasses} type="button">
          {busy ? "처리중" : "생성"}
        </button>
        <button className="secondaryButton" disabled={printing || printTargets.length === 0} onClick={printPasses} type="button">
          {printing ? `${progress}%` : "인쇄"}
        </button>
        <button className="secondaryButton" onClick={() => setSelectedPassIds(new Set(passes.filter((pass) => pass.status === "active").map((pass) => pass.id)))} type="button">
          전체선택
        </button>
      </div>

      <div className="summaryRows tempSummary">
        <div><span>선택</span><strong>{printTargets.length}개</strong></div>
        <div><span>사용 가능</span><strong>{passes.filter((pass) => pass.status === "active").length}개</strong></div>
        <div><span>인쇄</span><strong>네모닉</strong></div>
      </div>

      {message && <p className={message.includes("완료") || message.includes("생성") ? "statusText" : "errorText"}>{message}</p>}

      <div className="tempPassGrid">
        {passes.map((pass) => (
          <div className={`tempPassCard ${lastCreatedIds.has(pass.id) ? "selected" : ""}`} key={pass.id}>
            <div>
              <label className="checkLine">
                <input checked={selectedPassIds.has(pass.id)} disabled={pass.status !== "active" || !pass.qrToken} onChange={() => togglePass(pass.id)} type="checkbox" />
                <strong>{pass.displayName}</strong>
              </label>
              <span className={`pill ${pass.status === "active" ? "ok" : "done"}`}>{tempPassStatus(pass)}</span>
            </div>
            <p className="tempPassLabel">{pass.label}</p>
            {pass.qrToken ? (
              <img src={`/api/qr?value=${encodeURIComponent(publicQrValue(pass.qrToken))}`} alt={`${pass.label} QR`} />
            ) : (
              <div className="usedQr">완료</div>
            )}
            <p>스탬프 {pass.stampCount}/{STAMP_REWARD_THRESHOLD}</p>
            {pass.redeemedRewardId && <p>{rewardNameById(pass.redeemedRewardId)}</p>}
            <small>{pass.redeemedAt ? formatTime(pass.redeemedAt) : formatTime(pass.createdAt)}</small>
            <button className="dangerButton" onClick={() => deletePass(pass)} type="button">삭제</button>
          </div>
        ))}
        {passes.length === 0 && <p className="emptyText">생성된 QR 없음</p>}
      </div>
    </section>
  );
}

function DefaultStampPanel({ me, refresh }: { me: MePayload; refresh: () => Promise<void> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [color, setColor] = useState("#2563eb");
  const [size, setSize] = useState(12);
  const [previewDataUrl, setPreviewDataUrl] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (me.defaultStampImageDataUrl) {
      const image = new Image();
      image.onload = () => {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setPreviewDataUrl(canvas.toDataURL("image/png"));
      };
      image.src = me.defaultStampImageDataUrl;
    } else {
      setPreviewDataUrl(canvas.toDataURL("image/png"));
    }
  }, [me.defaultStampImageDataUrl]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function syncPreview() {
    const canvas = canvasRef.current;
    if (canvas) setPreviewDataUrl(canvas.toDataURL("image/png"));
  }

  function startDraw(event: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = canvasRef.current?.getContext("2d");
    const start = point(event);
    context?.beginPath();
    context?.moveTo(start.x, start.y);
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const next = point(event);
    context.lineTo(next.x, next.y);
    context.strokeStyle = color;
    context.lineWidth = size;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  }

  function endDraw() {
    drawingRef.current = false;
    syncPreview();
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    syncPreview();
  }

  async function saveDefaultStamp() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setMessage("");
    try {
      await apiJson("/api/admin/default-stamp", {
        method: "POST",
        body: JSON.stringify({ imageDataUrl: canvas.toDataURL("image/png") })
      });
      await refresh();
      setMessage("기본 도장 저장");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "저장 실패");
    }
  }

  return (
    <section className="panel">
      <div className="sectionHeader">
        <div>
          <h2>기본 도장</h2>
          <p>도장 없는 부스에 적용.</p>
        </div>
      </div>
      <div className="canvasTools">
        <label>
          색상
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </label>
        <label>
          굵기
          <input type="range" min={2} max={28} value={size} onChange={(event) => setSize(Number(event.target.value))} />
        </label>
        <button className="secondaryButton" onClick={clearCanvas} type="button">지우기</button>
      </div>
      <canvas
        className="stampCanvas"
        height={260}
        onPointerDown={startDraw}
        onPointerLeave={endDraw}
        onPointerMove={draw}
        onPointerUp={endDraw}
        ref={canvasRef}
        width={260}
      />
      <div className="stampPreview">
        <span>미리보기</span>
        {previewDataUrl ? <img src={previewDataUrl} alt="기본 도장 미리보기" /> : <strong>STAMP</strong>}
      </div>
      {message && <p className={message.includes("저장") ? "statusText" : "errorText"}>{message}</p>}
      <button className="primaryButton" onClick={saveDefaultStamp} type="button">저장</button>
    </section>
  );
}

function BoothNamesPanel({ me, refresh }: { me: MePayload; refresh: () => Promise<void> }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const editableBooths = useMemo(
    () => me.account?.role === "boothAdmin" ? (me.managedBooths || []) : (me.booths || []),
    [me.account?.role, me.booths, me.managedBooths]
  );

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const booth of editableBooths) next[booth.id] = booth.name;
    setNames(next);
  }, [editableBooths]);

  async function saveBoothName(boothId: string) {
    setMessage("");
    try {
      await apiJson("/api/admin/booths", {
        method: "PATCH",
        body: JSON.stringify({ boothId, name: names[boothId] || "" })
      });
      await refresh();
      setMessage("부스 이름 저장");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "저장 실패");
    }
  }

  return (
    <section className="panel widePanel">
      <div className="sectionHeader">
        <div>
          <h2>부스명</h2>
          <p>현장 이름으로 수정.</p>
        </div>
      </div>
      {message && <p className={message.includes("저장") ? "statusText" : "errorText"}>{message}</p>}
      <div className="boothNameGrid">
        {editableBooths.map((booth) => (
          <div className="boothNameRow" key={booth.id}>
            <div>
              <strong>{booth.id}</strong>
              <span>{booth.clubName}</span>
            </div>
            <input value={names[booth.id] || ""} onChange={(event) => setNames((current) => ({ ...current, [booth.id]: event.target.value }))} maxLength={28} />
            <button className="secondaryButton" onClick={() => saveBoothName(booth.id)} type="button">저장</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function AccountAdminPanel() {
  const [accounts, setAccounts] = useState<AdminAccountRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const data = await apiJson<{ accounts: AdminAccountRow[] }>("/api/admin/accounts");
    setAccounts(data.accounts);
    setSelectedId((current) => current || data.accounts.find((account) => account.role !== "participant")?.id || data.accounts[0]?.id || "");
  }, []);

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "계정 로드 실패"));
  }, [load]);

  async function resetPassword() {
    setMessage("");
    try {
      await apiJson("/api/admin/accounts", {
        method: "PATCH",
        body: JSON.stringify({ accountId: selectedId, password })
      });
      setPassword("");
      setMessage("비밀번호 변경");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "변경 실패");
    }
  }

  return (
    <section className="panel widePanel">
      <div className="sectionHeader">
        <div>
          <h2>계정</h2>
          <p>아이디 확인, 비번 변경.</p>
        </div>
      </div>
      <div className="accountTools">
        <label>
          계정
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {accounts.map((account) => (
              <option value={account.id} key={account.id}>
                {account.loginId} · {roleLabel(account.role)} · {account.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          새 비번
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" />
        </label>
        <button className="primaryButton" disabled={!selectedId || password.length < 8} onClick={resetPassword} type="button">변경</button>
      </div>
      {message && <p className={message.includes("변경") ? "statusText" : "errorText"}>{message}</p>}
      <div className="tableWrap compactTable">
        <table>
          <thead>
            <tr>
              <th>아이디</th>
              <th>이름</th>
              <th>역할</th>
              <th>담당</th>
              <th>최근 로그인</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td>{account.loginId}</td>
                <td>{account.displayName}</td>
                <td>{roleLabel(account.role)}</td>
                <td>{account.targetName}</td>
                <td>{formatTime(account.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SecurityLogPanel() {
  const [data, setData] = useState<SecurityPayload>({ loginEvents: [], activityEvents: [], deviceBlocks: [] });
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const next = await apiJson<SecurityPayload>("/api/admin/security", { method: "GET" });
    setData(next);
  }, []);

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "보안 로그 실패"));
  }, [load]);

  async function releaseBlock(blockId: string) {
    setMessage("");
    try {
      await apiJson("/api/admin/security", {
        method: "PATCH",
        body: JSON.stringify({ blockId })
      });
      await load();
      setMessage("차단 해제");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "해제 실패");
    }
  }

  return (
    <section className="panel widePanel securityPanel">
      <div className="sectionHeader">
        <div>
          <h2>보안 로그</h2>
          <p>참가자 계정 전환 감지.</p>
        </div>
        <button className="secondaryButton" onClick={load} type="button">새로고침</button>
      </div>
      {message && <p className={message.includes("해제") ? "statusText" : "errorText"}>{message}</p>}
      <div className="securityGrid">
        <div className="securityBox">
          <div className="securityHead">
            <strong>기기 차단</strong>
            <span>{data.deviceBlocks.filter((block) => block.active).length}건</span>
          </div>
          <div className="securityList">
            {data.deviceBlocks.map((block) => (
              <div className={`securityRow ${block.active ? "blocked" : ""}`} key={block.id}>
                <div>
                  <strong>{block.deviceShort}</strong>
                  <span>{block.reason}</span>
                  <small>{block.loginIds.join(", ") || "-"} · {formatTime(block.createdAt)}</small>
                </div>
                {block.active ? <button className="secondaryButton" onClick={() => releaseBlock(block.id)} type="button">해제</button> : <span className="pill done">해제됨</span>}
              </div>
            ))}
            {data.deviceBlocks.length === 0 && <p className="emptyText">차단 없음</p>}
          </div>
        </div>
        <div className="securityBox">
          <div className="securityHead">
            <strong>로그인</strong>
            <span>{data.loginEvents.length}건</span>
          </div>
          <div className="securityList">
            {data.loginEvents.slice(0, 80).map((event) => (
              <div className={`securityRow ${event.result}`} key={event.id}>
                <div>
                  <strong>{event.loginId} · {event.displayName}</strong>
                  <span>{event.result === "success" ? "성공" : event.result === "blocked" ? "차단" : "실패"} · {roleLabel(event.role as Role)} · {event.deviceShort}</span>
                  <small>{event.userAgentSummary} · {formatTime(event.createdAt)} {event.reason ? `· ${event.reason}` : ""}</small>
                </div>
              </div>
            ))}
            {data.loginEvents.length === 0 && <p className="emptyText">로그 없음</p>}
          </div>
        </div>
      </div>
      <div className="securityBox">
        <div className="securityHead">
          <strong>활동</strong>
          <span>{data.activityEvents.length}건</span>
        </div>
        <div className="tableWrap compactTable">
          <table>
            <thead>
              <tr>
                <th>시간</th>
                <th>계정</th>
                <th>활동</th>
                <th>대상</th>
                <th>세부</th>
              </tr>
            </thead>
            <tbody>
              {data.activityEvents.slice(0, 120).map((event) => (
                <tr key={event.id}>
                  <td>{formatTime(event.createdAt)}</td>
                  <td>{event.actorLoginId} · {event.actorDisplayName}</td>
                  <td>{event.action}</td>
                  <td>{event.targetId || "-"}</td>
                  <td>{event.detail || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function DatabaseResetPanel({ refresh }: { refresh: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function resetDatabase() {
    const confirm = window.prompt("초기화하려면 RESET을 입력하세요.");
    if (confirm === null) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await apiJson<{ preservedSuperAdmins: number; inviteCodeCount: number }>("/api/admin/reset", {
        method: "POST",
        body: JSON.stringify({ confirm })
      });
      await refresh();
      setMessage(`초기화 완료 · 총괄 ${result.preservedSuperAdmins} · 코드 ${result.inviteCodeCount}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "초기화 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel dangerZone">
      <div className="sectionHeader">
        <div>
          <h2>DB 리셋</h2>
          <p>총괄만 유지.</p>
        </div>
      </div>
      <div className="summaryRows">
        <div><span>동아리 계정</span><strong>반복 코드</strong></div>
        <div><span>총괄 코드</span><strong>2개 유지</strong></div>
        <div><span>참가 기록</span><strong>전체 삭제</strong></div>
      </div>
      {message && <p className={message.includes("완료") ? "statusText" : "errorText"}>{message}</p>}
      <button className="dangerButton" disabled={busy} onClick={resetDatabase} type="button">
        {busy ? "처리중" : "초기화"}
      </button>
    </section>
  );
}

function TeaMakerPanel() {
  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const readBufferRef = useRef("");
  const activeReservationIdRef = useRef("");
  const [reservations, setReservations] = useState<TeaReservationView[]>([]);
  const [serialConnected, setSerialConnected] = useState(false);
  const [machineStatus, setMachineStatus] = useState("offline");
  const [serialCommand, setSerialCommand] = useState(TEA_DEFAULT_COMMAND);
  const [stockCount, setStockCount] = useState(0);
  const [stockDraft, setStockDraft] = useState(0);
  const [stockUpdatedAt, setStockUpdatedAt] = useState("");
  const [firmwareText, setFirmwareText] = useState("");
  const [firmwareUpdatedAt, setFirmwareUpdatedAt] = useState("");
  const [firmwareSource, setFirmwareSource] = useState<"storage" | "default">("default");
  const [arduinoButtons, setArduinoButtons] = useState<ArduinoButtonView[]>([]);
  const [arduinoButtonsUpdatedAt, setArduinoButtonsUpdatedAt] = useState("");
  const [manualName, setManualName] = useState("현장주문");
  const [logs, setLogs] = useState<string[]>(["연결 대기"]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const openReservations = reservations.filter((reservation) => ["reserved", "brewing", "ready"].includes(reservation.status));

  const load = useCallback(async () => {
    const data = await apiJson<TeaReservationsPayload>("/api/tea/reservations", { method: "GET" });
    setReservations(data.reservations);
    setStockCount(data.stockCount || 0);
    setStockDraft(data.stockCount || 0);
    setStockUpdatedAt(data.stockUpdatedAt || "");
  }, []);

  const loadFirmware = useCallback(async () => {
    const data = await apiJson<TeaFirmwarePayload>("/api/tea/firmware", { method: "GET" });
    setFirmwareText(data.firmwareText);
    setFirmwareUpdatedAt(data.updatedAt || "");
    setFirmwareSource(data.source);
  }, []);

  const loadArduinoButtons = useCallback(async () => {
    const data = await apiJson<TeaButtonsPayload>("/api/tea/buttons", { method: "GET" });
    setArduinoButtons(data.buttons);
    setArduinoButtonsUpdatedAt(data.updatedAt || "");
  }, []);

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "예약 로드 실패"));
    loadFirmware().catch(() => undefined);
    loadArduinoButtons().catch(() => undefined);
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [load, loadFirmware, loadArduinoButtons]);

  function appendSerialLog(line: string, direction = "ARD") {
    const stamp = new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date());
    setLogs((current) => [...current.slice(-80), `[${stamp}] ${direction}> ${line}`]);
  }

  function applySerialStatus(rawLine: string) {
    const line = rawLine.trim();
    if (!line || line.startsWith("Light Sensor Value:")) return;
    appendSerialLog(line);
    const status = line.startsWith("STATUS:") ? line.slice("STATUS:".length).trim().toUpperCase() : line.toUpperCase();
    if (status.includes("SYSTEM_READY") || status.includes("READY_FOR_COMMAND")) setMachineStatus("idle");
    else if (status.includes("CUP_DETECTED")) setMachineStatus("cup");
    else if (status.includes("RFID_DETECTED") || status.includes("CARD_VERIFIED")) setMachineStatus("ready");
    else if (status.includes("DISPENSING")) setMachineStatus("dispensing");
    else if (status.includes("MIXER_LOWERING")) setMachineStatus("lowering");
    else if (status.includes("MIXING")) setMachineStatus("mixing");
    else if (status.includes("LIFTING")) setMachineStatus("lifting");
    else if (status.includes("COMPLETE")) {
      setMachineStatus("complete");
      const reservationId = activeReservationIdRef.current;
      if (reservationId) {
        patchReservation(reservationId, "ready").catch(() => undefined);
        activeReservationIdRef.current = "";
      }
    } else if (status.includes("EMERGENCY")) setMachineStatus("emergency");
    else if (status.includes("ERROR")) setMachineStatus("error");
  }

  async function readSerialLoop(port: SerialPort) {
    const decoder = new TextDecoder();
    while (portRef.current === port && port.readable) {
      try {
        const reader = port.readable.getReader();
        readerRef.current = reader;
        while (portRef.current === port) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          readBufferRef.current += decoder.decode(value, { stream: true });
          const lines = readBufferRef.current.split(/\r?\n/);
          readBufferRef.current = lines.pop() || "";
          lines.map((line) => line.trim()).filter(Boolean).forEach(applySerialStatus);
        }
      } catch {
        if (portRef.current === port) setMachineStatus("error");
      } finally {
        try { readerRef.current?.releaseLock(); } catch {}
        readerRef.current = null;
      }
    }
  }

  async function connectDevice() {
    setMessage("");
    if (!navigator.serial) {
      setMessage("Chrome/Edge HTTPS 필요");
      return false;
    }
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      portRef.current = port;
      if (port.writable) writerRef.current = port.writable.getWriter();
      setSerialConnected(true);
      setMachineStatus("idle");
      appendSerialLog("USB connected", "WEB");
      readSerialLoop(port).catch(() => setMachineStatus("error"));
      return true;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "USB 연결 실패");
      setMachineStatus("error");
      return false;
    }
  }

  async function disconnectDevice() {
    setMessage("");
    const port = portRef.current;
    portRef.current = null;
    try { await readerRef.current?.cancel(); } catch {}
    try { readerRef.current?.releaseLock(); } catch {}
    try { writerRef.current?.releaseLock(); } catch {}
    try { if (port) await port.close(); } catch {}
    readerRef.current = null;
    writerRef.current = null;
    setSerialConnected(false);
    setMachineStatus("offline");
    appendSerialLog("USB disconnected", "WEB");
  }

  async function writeSerial(command: string) {
    const writer = writerRef.current;
    if (!writer) throw new Error("USB 연결 필요");
    const clean = command.trim().toUpperCase();
    await writer.write(new TextEncoder().encode(`${clean}\n`));
    appendSerialLog(clean, "WEB");
  }

  async function ensureSerialConnection() {
    if (writerRef.current && serialConnected) return true;
    appendSerialLog("USB 연결 요청", "WEB");
    return connectDevice();
  }

  async function patchReservation(reservationId: string, action: "start" | "ready" | "serve" | "cancel", command = serialCommand) {
    const data = await apiJson<{ reservation: TeaReservationView }>("/api/tea/reservations", {
      method: "PATCH",
      body: JSON.stringify({ reservationId, action, serialCommand: command })
    });
    await load();
    return data.reservation;
  }

  async function startReservation(reservation: TeaReservationView) {
    setBusy(true);
    setMessage("");
    try {
      const command = reservation.serialCommand || serialCommand;
      const updated = await patchReservation(reservation.id, "start", command);
      activeReservationIdRef.current = updated.id;
      await writeSerial(updated.serialCommand || command);
      setMessage(`#${updated.orderNumber} 제조 시작`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "제조 실패");
    } finally {
      setBusy(false);
    }
  }

  async function manualBrew() {
    setBusy(true);
    setMessage("");
    try {
      const shouldCountStock = isTeaCupCommand(serialCommand);
      if (shouldCountStock && stockCount <= 0) throw new Error("아이스티 재고가 없습니다.");
      await writeSerial(serialCommand);
      if (shouldCountStock) await updateStock("decrement");
      setMessage("즉시 제조");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "제조 실패");
    } finally {
      setBusy(false);
    }
  }

  async function updateStock(action: "set" | "decrement") {
    const data = await apiJson<{ stockCount: number; updatedAt: string }>("/api/tea/stock", {
      method: "PATCH",
      body: JSON.stringify({ action, stockCount: stockDraft })
    });
    setStockCount(data.stockCount);
    setStockDraft(data.stockCount);
    setStockUpdatedAt(data.updatedAt);
    return data.stockCount;
  }

  async function saveStock() {
    setBusy(true);
    setMessage("");
    try {
      await updateStock("set");
      setMessage("재고 저장");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "재고 실패");
    } finally {
      setBusy(false);
    }
  }

  async function saveFirmware() {
    setBusy(true);
    setMessage("");
    try {
      const data = await apiJson<{ updatedAt: string; bytes: number }>("/api/tea/firmware", {
        method: "PATCH",
        body: JSON.stringify({ firmwareText })
      });
      setFirmwareUpdatedAt(data.updatedAt);
      setFirmwareSource("storage");
      setMessage(`INO 저장 ${Math.round(data.bytes / 1024)}KB`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "INO 저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function loadFirmwareFile(file?: File) {
    if (!file) return;
    const text = await file.text();
    setFirmwareText(text);
    setMessage(`${file.name} 불러옴`);
  }

  async function loadDefaultFirmware() {
    setBusy(true);
    setMessage("");
    try {
      const data = await apiJson<TeaFirmwarePayload>("/api/tea/firmware?default=1", { method: "GET" });
      setFirmwareText(data.firmwareText);
      setFirmwareUpdatedAt(data.updatedAt || "");
      setFirmwareSource("default");
      setMessage("명령 펌웨어 불러옴");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "기본본 실패");
    } finally {
      setBusy(false);
    }
  }

  function updateArduinoButton(id: string, patch: Partial<Pick<ArduinoButtonView, "label" | "scriptText">>) {
    setArduinoButtons((current) => current.map((button) => (
      button.id === id ? { ...button, ...patch, updatedAt: new Date().toISOString() } : button
    )));
  }

  function addArduinoButton() {
    setArduinoButtons((current) => [...current, newArduinoButtonDraft()]);
  }

  function addArduinoPresetButton(label: string, command: string) {
    setArduinoButtons((current) => [...current, newArduinoButtonDraft(label, command)]);
  }

  function deleteArduinoButton(id: string) {
    setArduinoButtons((current) => current.filter((button) => button.id !== id));
  }

  async function saveArduinoButtons() {
    setBusy(true);
    setMessage("");
    try {
      const data = await apiJson<TeaButtonsPayload>("/api/tea/buttons", {
        method: "PATCH",
        body: JSON.stringify({ buttons: arduinoButtons })
      });
      await loadArduinoButtons();
      setArduinoButtons(data.buttons);
      setArduinoButtonsUpdatedAt(data.updatedAt || "");
      setMessage(`버튼 저장 ${data.buttons.length}개`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "버튼 저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function runArduinoButton(button: ArduinoButtonView) {
    setBusy(true);
    setMessage("");
    try {
      const steps = parseArduinoButtonScript(button.scriptText);
      const sendCount = steps.filter((step) => step.type === "send").length;
      if (sendCount < 1) throw new Error("전송할 Serial.println 줄이 없습니다.");
      const connected = await ensureSerialConnection();
      if (!connected) throw new Error("USB 연결 필요");
      for (const step of steps) {
        if (step.type === "delay") {
          appendSerialLog(`delay ${step.ms}ms`, "WEB");
          await new Promise((resolve) => window.setTimeout(resolve, step.ms));
        } else {
          await writeSerial(step.command);
        }
      }
      const cupCount = steps.filter((step) => step.type === "send" && isTeaCupCommand(step.command)).length;
      for (let index = 0; index < cupCount; index += 1) {
        await updateStock("decrement");
      }
      setMessage(`${button.label} 실행`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "버튼 실행 실패");
    } finally {
      setBusy(false);
    }
  }

  async function createManualReservation() {
    setBusy(true);
    setMessage("");
    try {
      const data = await apiJson<{ reservation: TeaReservationView }>("/api/tea/reservations", {
        method: "POST",
        body: JSON.stringify({ displayName: manualName, serialCommand })
      });
      await load();
      setMessage(`#${data.reservation.orderNumber} 현장 추가`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "추가 실패");
    } finally {
      setBusy(false);
    }
  }

  async function closeReservation(reservation: TeaReservationView, action: "serve" | "cancel") {
    setMessage("");
    try {
      await patchReservation(reservation.id, action);
      setMessage(action === "serve" ? "수령 완료" : "예약 취소");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "처리 실패");
    }
  }

  return (
    <div className="gridTwo teaMakerGrid">
      <section className="panel teaDevicePanel">
        <div className="sectionHeader">
          <div>
            <h2>티메이커</h2>
            <p>알파고 운영.</p>
          </div>
          <span className={`pill ${serialConnected ? "ok" : "done"}`}>{serialStatusLabel(machineStatus)}</span>
        </div>
        <div className="teaDeviceHero">
          <img src={rewardImagePath("alphago")} alt="아이스티" />
          <div>
            <strong>아이스티</strong>
            <span>Automatic Ice-Tea Maker</span>
          </div>
        </div>
        <div className="teaStockBox">
          <div>
            <strong>{stockCount}잔</strong>
            <span>현재 재고 · {formatTime(stockUpdatedAt)}</span>
          </div>
          <label>
            재고
            <input value={stockDraft} onChange={(event) => setStockDraft(Number(event.target.value))} min={0} max={5000} type="number" />
          </label>
          <button className="primaryButton" disabled={busy} onClick={saveStock} type="button">저장</button>
        </div>
        <div className="canvasTools">
          <button className="primaryButton" onClick={serialConnected ? disconnectDevice : connectDevice} type="button">
            {serialConnected ? "해제" : "USB 연결"}
          </button>
          <label>
            명령
            <input value={serialCommand} onChange={(event) => setSerialCommand(event.target.value.toUpperCase())} placeholder={TEA_DEFAULT_COMMAND} />
          </label>
          <button className="secondaryButton" disabled={busy || !serialConnected} onClick={manualBrew} type="button">즉시제조</button>
        </div>
        <div className="canvasTools">
          <label>
            현장명
            <input value={manualName} onChange={(event) => setManualName(event.target.value)} maxLength={12} />
          </label>
          <button className="secondaryButton" disabled={busy} onClick={createManualReservation} type="button">현장추가</button>
          <a className="secondaryLink" href="/api/tea/firmware?default=1&raw=1" target="_blank" rel="noreferrer">최신INO</a>
        </div>
        {message && <p className={message.includes("실패") || message.includes("필요") ? "errorText" : "statusText"}>{message}</p>}
        <div className="arduinoButtonsPanel">
          <div className="firmwareHeader">
            <div>
              <strong>아두이노 버튼</strong>
              <span>{arduinoButtons.length}개 · {formatTime(arduinoButtonsUpdatedAt)}</span>
            </div>
            <div className="firmwareActions">
              <button className="secondaryButton" onClick={addArduinoButton} type="button">추가</button>
              <button className="secondaryButton" onClick={() => addArduinoPresetButton("청소", "CLEAN,10")} type="button">청소</button>
              <button className="secondaryButton" onClick={() => addArduinoPresetButton("전체청소", "CLEAN_ALL,10")} type="button">전체청소</button>
              <button className="secondaryButton" onClick={() => addArduinoPresetButton("3음료", "D3,15,20")} type="button">3음료</button>
              <button className="primaryButton" disabled={busy} onClick={saveArduinoButtons} type="button">저장</button>
            </div>
          </div>
          <div className="arduinoButtonList">
            {arduinoButtons.map((button) => {
              const steps = parseArduinoButtonScript(button.scriptText);
              const sendCount = steps.filter((step) => step.type === "send").length;
              return (
                <div className="arduinoButtonCard" key={button.id}>
                  <div className="arduinoButtonTop">
                    <label>
                      버튼명
                      <input value={button.label} onChange={(event) => updateArduinoButton(button.id, { label: event.target.value })} maxLength={18} />
                    </label>
                    <span className="pill">{sendCount}줄</span>
                    <button className="primaryButton" disabled={busy || sendCount < 1} onClick={() => runArduinoButton(button)} type="button">
                      {serialConnected ? "실행" : "연결실행"}
                    </button>
                    <button className="dangerButton" disabled={busy} onClick={() => deleteArduinoButton(button.id)} type="button">삭제</button>
                  </div>
                  <textarea
                    className="arduinoScriptEditor"
                    spellCheck={false}
                    value={button.scriptText}
                    onChange={(event) => updateArduinoButton(button.id, { scriptText: event.target.value })}
                  />
                  <p className="hintText">C++ 주입 아님. 명령 전송: T,15,20 / D3,15,20 / WATER,3 / TEA,3 / THIRD,3 / CLEAN,10 / CLEAN_ALL,10.</p>
                </div>
              );
            })}
            {arduinoButtons.length === 0 && <p className="emptyText">버튼 없음</p>}
          </div>
        </div>
        <div className="serialLogBox">{logs.join("\n")}</div>
        <div className="firmwarePanel">
          <div className="firmwareHeader">
            <div>
              <strong>INO 저장</strong>
              <span>{firmwareSource === "storage" ? "저장본" : "기본본"} · {formatTime(firmwareUpdatedAt)}</span>
            </div>
            <div className="firmwareActions">
              <label className="fileScanButton">
                업로드
                <input accept=".ino,text/plain" onChange={(event) => loadFirmwareFile(event.target.files?.[0]).catch((err) => setMessage(err instanceof Error ? err.message : "파일 실패"))} type="file" />
              </label>
              <button className="secondaryButton" disabled={busy} onClick={loadDefaultFirmware} type="button">기본본</button>
              <a className="secondaryLink" href="/api/tea/firmware?raw=1" target="_blank" rel="noreferrer">다운로드</a>
              <button className="primaryButton" disabled={busy || firmwareText.trim().length < 200} onClick={saveFirmware} type="button">저장</button>
            </div>
          </div>
          <textarea className="firmwareEditor" value={firmwareText} onChange={(event) => setFirmwareText(event.target.value)} spellCheck={false} />
        </div>
      </section>

      <section className="panel teaQueuePanel">
        <div className="sectionHeader">
          <div>
            <h2>예약</h2>
            <p>{openReservations.length}건 진행.</p>
          </div>
          <button className="secondaryButton" onClick={load} type="button">새로고침</button>
        </div>
        <div className="teaQueueList">
          {reservations.map((reservation) => (
            <div className={`teaQueueRow ${reservation.status}`} key={reservation.id}>
              <div>
                <strong>#{reservation.orderNumber} {reservation.displayName}</strong>
                <span>{teaReservationStatus(reservation.status)} · {teaSourceLabel(reservation)} · {formatTime(reservation.createdAt)}</span>
              </div>
              <div className="teaQueueActions">
                {reservation.status === "reserved" && <button className="primaryButton" disabled={busy || !serialConnected} onClick={() => startReservation(reservation)} type="button">제조</button>}
                {reservation.status === "ready" && <button className="secondaryButton" onClick={() => closeReservation(reservation, "serve")} type="button">수령</button>}
                {["reserved", "brewing", "ready"].includes(reservation.status) && <button className="dangerButton" onClick={() => closeReservation(reservation, "cancel")} type="button">취소</button>}
              </div>
            </div>
          ))}
          {reservations.length === 0 && <p className="emptyText">예약 없음</p>}
        </div>
      </section>
    </div>
  );
}

function RewardStockPanel({ compact = false }: { compact?: boolean }) {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await apiJson<RewardStockPayload>("/api/tea/stock?scope=rewards", { method: "GET" });
    setRewards(data.rewards);
    setDrafts(Object.fromEntries(data.rewards.map((reward) => [reward.id, rewardStockCount(reward) ?? 0])));
  }, []);

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "재고 로드 실패"));
  }, [load]);

  async function saveRewardStock(reward: Reward) {
    setBusy(true);
    setMessage("");
    try {
      const data = await apiJson<RewardStockPayload>("/api/tea/stock?scope=rewards", {
        method: "PATCH",
        body: JSON.stringify({ rewardId: reward.id, stockCount: drafts[reward.id] ?? 0 })
      });
      setRewards(data.rewards);
      setDrafts(Object.fromEntries(data.rewards.map((item) => [item.id, rewardStockCount(item) ?? 0])));
      setMessage(`${rewardLabel(reward)} 저장`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "재고 저장 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`panel ${compact ? "" : "widePanel"}`}>
      <div className="sectionHeader">
        <div>
          <h2>보상재고</h2>
          <p>0이면 품절.</p>
        </div>
        <button className="secondaryButton" onClick={() => load().catch((err) => setMessage(err instanceof Error ? err.message : "재고 로드 실패"))} type="button">새로고침</button>
      </div>
      <div className="rewardStockList">
        {rewards.map((reward) => (
          <div className="rewardStockRow" key={reward.id}>
            <RewardImage reward={reward} />
            <div>
              <strong>{rewardLabel(reward)}</strong>
              <span>{rewardIgnoresStampStock(reward.id) ? "스탬프 쿠폰 차감 없음" : `현재 ${rewardStockLabel(reward)}`}</span>
            </div>
            <label>
              재고
              <input
                value={drafts[reward.id] ?? 0}
                min={0}
                max={5000}
                onChange={(event) => setDrafts((current) => ({ ...current, [reward.id]: Number(event.target.value) }))}
                type="number"
              />
            </label>
            <button className="primaryButton" disabled={busy} onClick={() => saveRewardStock(reward)} type="button">저장</button>
          </div>
        ))}
        {rewards.length === 0 && <p className="emptyText">관리 보상 없음</p>}
      </div>
      {message && <p className={message.includes("실패") ? "errorText" : "statusText"}>{message}</p>}
    </section>
  );
}

function AdminPanel({ me, refresh }: { me: MePayload; refresh: () => Promise<void> }) {
  function openShowcaseWindow(song: "classic" | "boss" | "original" = "classic") {
    const url = `/showcase?song=${song}`;
    const opened = window.open(url, `stampwsShowcase-${song}`, "width=1280,height=720");
    if (opened) {
      opened.opener = null;
      opened.focus();
      return;
    }
    window.location.href = url;
  }

  return (
    <div className="gridTwo adminGrid">
      <section className="panel widePanel">
        <div className="sectionHeader">
          <div>
            <h2>총괄</h2>
            <p>서버 기록 기준.</p>
          </div>
          <button className="secondaryButton" onClick={() => openShowcaseWindow("classic")} type="button">소개창</button>
        </div>
        <div className="canvasTools">
          <button className="secondaryButton" onClick={() => openShowcaseWindow("classic")} type="button">클래식</button>
          <button className="secondaryButton" onClick={() => openShowcaseWindow("boss")} type="button">파이널</button>
          <button className="secondaryButton" onClick={() => openShowcaseWindow("original")} type="button">원곡</button>
        </div>
        <div className="metricGrid">
          <div><strong>{me.adminSummary?.participantCount || 0}</strong><span>참가자</span></div>
          <div><strong>{me.adminSummary?.stampCount || 0}</strong><span>스탬프</span></div>
          <div><strong>{me.adminSummary?.couponCount || 0}</strong><span>쿠폰</span></div>
          <div><strong>{me.adminSummary?.redeemedCouponCount || 0}</strong><span>사용 완료</span></div>
          <div><strong>{me.adminSummary?.tempPassCount || 0}</strong><span>임시 QR</span></div>
          <div><strong>{me.adminSummary?.redeemedTempPassCount || 0}</strong><span>임시 지급</span></div>
        </div>
      </section>
      <RewardStockPanel />
      <SuperAdminManualStampPanel me={me} refresh={refresh} />
      <DefaultStampPanel me={me} refresh={refresh} />
      <AccountAdminPanel />
      <SecurityLogPanel />
      <BoothNamesPanel me={me} refresh={refresh} />
      <DatabaseResetPanel refresh={refresh} />
    </div>
  );
}

function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    apiJson<{ rows: LeaderboardRow[] }>("/api/leaderboard")
      .then((data) => setRows(data.rows))
      .catch((err) => setError(err instanceof Error ? err.message : "리더보드 로드 실패"));
  }, []);

  return (
    <section className="panel">
      <div className="sectionHeader">
        <div>
          <h2>랭킹</h2>
          <p>진행 중도 표시.</p>
        </div>
      </div>
      {error && <p className="errorText">{error}</p>}
      <div className="leaderRows">
        {rows.map((row) => (
          <div className="leaderRow" key={row.accountId}>
            <strong>{row.rank}</strong>
            <div className="miniAvatar">{row.avatarStampImageDataUrl ? <img src={row.avatarStampImageDataUrl} alt="" /> : <span>{row.displayName.slice(0, 2)}</span>}</div>
            <div>
              <h3>{row.displayName}</h3>
              <p>{row.bio || (row.completed ? `완료 ${formatTime(row.completedSevenAt)}` : `${row.stampCount}/${STAMP_REWARD_THRESHOLD} 진행`)}</p>
              <div className="speedMeta">
                <span>스탬프 {row.stampCount}/{STAMP_REWARD_THRESHOLD}</span>
                {row.completed ? (
                  <>
                    {row.rank === 1 ? <span>기준 기록</span> : <span>1위 +{formatDuration(row.behindFirstMs)}</span>}
                    {row.rank <= 2 ? <span>2위 기준</span> : <span>2위 +{formatDuration(row.behindSecondMs)}</span>}
                  </>
                ) : (
                  <span>완주 전</span>
                )}
              </div>
            </div>
            <div className={`scoreBox ${row.completed ? "" : "pending"}`}>{row.completed ? formatDuration(row.durationMs || 0) : `${row.stampCount}/${STAMP_REWARD_THRESHOLD}`}</div>
          </div>
        ))}
        {rows.length === 0 && <p className="emptyText">기록 없음</p>}
      </div>
    </section>
  );
}

export function StampApp({ initialTab = "home" }: { initialTab?: AppTab }) {
  const [me, setMe] = useState<MePayload>({ account: null });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<AppTab>(initialTab);
  const [toast, setToast] = useState("");
  const [noticeAlert, setNoticeAlert] = useState<ClubNoticeView | null>(null);
  const [stampEffect, setStampEffect] = useState<StampEffectState | null>(null);
  const previousStampCountRef = useRef<number | null>(null);
  const noticeSeenRef = useRef<string | null>(null);
  const noticeAlertTimerRef = useRef<number | null>(null);

  const showStampEffect = useCallback((effect: Omit<StampEffectState, "id">) => {
    const next = { ...effect, id: Date.now() };
    setStampEffect(next);
    window.setTimeout(() => {
      setStampEffect((current) => (current?.id === next.id ? null : current));
    }, 1800);
  }, []);

  const refresh = useCallback(async () => {
    const data = await apiJson<MePayload>("/api/me", { method: "GET" });
    const previousStampCount = previousStampCountRef.current;
    const nextStampCount = data.stats?.stampCount ?? 0;
    if (data.account?.role === "participant" && previousStampCount !== null && nextStampCount > previousStampCount) {
      const latestStamp = data.stamps?.[0];
      showStampEffect({
        mode: "receive",
        title: "스탬프 받음",
        detail: latestStamp ? `${latestStamp.boothName} · ${nextStampCount}/${STAMP_REWARD_THRESHOLD}` : `${nextStampCount}/${STAMP_REWARD_THRESHOLD}`,
        imageDataUrl: latestStamp?.stampImageDataUrl
      });
    }
    previousStampCountRef.current = data.account?.role === "participant" ? nextStampCount : null;
    setMe(data);
    if (data.account?.role === "boothAdmin") setTab((current) => (current === "home" ? "boothScan" : current));
    if (data.account?.role === "rewardAdmin") setTab((current) => (current === "home" ? "rewardScan" : current));
    if (data.account?.role === "superAdmin") setTab((current) => (current === "home" ? "admin" : current));
    setLoading(false);
  }, [showStampEffect]);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (me.account?.role !== "participant" || me.account.displayNameRequired) return;
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [me.account?.role, me.account?.displayNameRequired, refresh]);

  useEffect(() => {
    const account = me.account;
    if (!account || (account.role === "participant" && account.displayNameRequired)) {
      noticeSeenRef.current = null;
      setNoticeAlert(null);
      return;
    }

    let cancelled = false;
    const storageKey = `wshsLastNotice:${account.id}`;

    async function checkNotices(initial = false) {
      const data = await apiJson<NoticePayload>("/api/notices", { method: "GET" });
      if (cancelled) return;
      const latest = data.notices[0];
      if (!latest) return;

      const storedLatestId = window.localStorage.getItem(storageKey);
      const seenId = noticeSeenRef.current || storedLatestId;

      if (initial) {
        noticeSeenRef.current = seenId || latest.id;
        if (!storedLatestId) window.localStorage.setItem(storageKey, latest.id);
        return;
      }

      if (!seenId) {
        noticeSeenRef.current = latest.id;
        window.localStorage.setItem(storageKey, latest.id);
        return;
      }

      if (latest.id === seenId) return;
      noticeSeenRef.current = latest.id;
      window.localStorage.setItem(storageKey, latest.id);
      setNoticeAlert(latest);
      if (noticeAlertTimerRef.current) window.clearTimeout(noticeAlertTimerRef.current);
      noticeAlertTimerRef.current = window.setTimeout(() => {
        setNoticeAlert((current) => (current?.id === latest.id ? null : current));
        noticeAlertTimerRef.current = null;
      }, 7000);
    }

    checkNotices(true).catch(() => undefined);
    const timer = window.setInterval(() => {
      checkNotices(false).catch(() => undefined);
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (noticeAlertTimerRef.current) {
        window.clearTimeout(noticeAlertTimerRef.current);
        noticeAlertTimerRef.current = null;
      }
    };
  }, [me.account?.id, me.account?.role, me.account?.displayNameRequired]);

  const role = me.account?.role;
  const rewards = me.rewards || [];
  const teaAccess = canUseTeaMaker(me.account);
  const rewardAccess = Boolean(me.account?.rewardId);

  const nav = useMemo(() => {
    if (!role) return [];
    if (role === "participant") return [
      ["home", "스탬프"],
      ["profile", "프로필"],
      ["leaderboard", "랭킹"]
    ] as Array<[AppTab, string]>;
    if (role === "boothAdmin") return [
      ["boothScan", "지급"],
      ...(rewardAccess ? [["rewardScan", "쿠폰사용"] as [AppTab, string]] : []),
      ...(teaAccess ? [["teaMaker", "티메이커"] as [AppTab, string]] : []),
      ["stampStudio", "도장"],
      ["notices", "공지"],
      ["codes", "코드"],
      ["leaderboard", "랭킹"]
    ] as Array<[AppTab, string]>;
    if (role === "rewardAdmin") return [
      ["rewardScan", "쿠폰사용"],
      ...(teaAccess ? [["teaMaker", "티메이커"] as [AppTab, string]] : []),
      ["notices", "공지"],
      ["codes", "코드"],
      ["leaderboard", "랭킹"]
    ] as Array<[AppTab, string]>;
    return [
      ["admin", "총괄"],
      ["teaMaker", "티메이커"],
      ["tempPasses", "임시"],
      ["notices", "공지"],
      ["codes", "코드"],
      ["leaderboard", "랭킹"]
    ] as Array<[AppTab, string]>;
  }, [role, rewardAccess, teaAccess]);

  async function logout() {
    if (me.account?.role === "participant") {
      window.localStorage.removeItem("wshsParticipantCache");
    }
    await apiJson("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
    setMe({ account: null });
    setTab("home");
  }

  function openNoticeAlert() {
    setNoticeAlert(null);
    setTab(role === "participant" ? "home" : "notices");
  }

  const handleStampScan = useCallback(async (token: string, booth: BoothView) => {
    setToast("");
    try {
      const result = await apiJson<{ participantName: string; stampCount: number }>("/api/booth/grant-stamp", {
        method: "POST",
        body: JSON.stringify({ token, boothId: booth.id })
      });
      setToast(`${result.participantName} 스탬프 지급 완료 (${result.stampCount}/${STAMP_REWARD_THRESHOLD})`);
      showStampEffect({
        mode: "give",
        title: "지급 완료",
        detail: `${result.participantName} · ${result.stampCount}/${STAMP_REWARD_THRESHOLD}`,
        imageDataUrl: booth.stampImageDataUrl
      });
      await refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "스탬프 지급 실패");
    }
  }, [refresh, showStampEffect]);

  const handleCouponScan = useCallback(async (token: string) => {
    setToast("");
    try {
      const result = await apiJson<{ participantName: string; rewardName: string; rewardClubName: string }>("/api/coupon/redeem", {
        method: "POST",
        body: JSON.stringify({ token })
      });
      setToast(`${result.participantName} 보상 지급 완료: ${result.rewardClubName} - ${result.rewardName}`);
      await refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "쿠폰 사용 실패");
    }
  }, [refresh]);

  if (loading) {
    return <main className="loadingShell">로딩 중</main>;
  }

  if (!me.account) {
    return <AuthPanel onDone={refresh} />;
  }

  return (
    <main className={`appShell theme-${me.profile?.themeId || "science"}`}>
      <header className="topBar">
        <div>
          <p className="eyebrow">과학의날</p>
          <h1>스탬프</h1>
        </div>
        <div className="userChip">
          <span>{me.account.displayName}</span>
          <small>{roleLabel(me.account.role)}</small>
          <button className="secondaryButton" onClick={logout} type="button">나가기</button>
        </div>
      </header>

      <nav className="tabBar">
        {nav.map(([key, label]) => (
          <button className={tab === key ? "active" : ""} key={key} onClick={() => setTab(key)} type="button">
            {label}
          </button>
        ))}
      </nav>

      {noticeAlert && (
        <button className="noticeAlert" onClick={openNoticeAlert} type="button">
          <span>공지</span>
          <div>
            <strong>{noticeAlert.clubName}</strong>
            <p>{noticeAlert.message}</p>
          </div>
          <small>{formatTime(noticeAlert.createdAt)}</small>
        </button>
      )}
      {toast && <p className={toast.includes("완료") ? "toast okToast" : "toast errorToast"}>{toast}</p>}
      {stampEffect && <StampEffect effect={stampEffect} />}

      {role === "participant" && me.account.displayNameRequired && <RequiredNamePanel refresh={refresh} />}

      {!(role === "participant" && me.account.displayNameRequired) && tab === "home" && role === "participant" && <ParticipantHome me={me} refresh={refresh} />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "profile" && <ProfileEditor me={me} refresh={refresh} />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "leaderboard" && <Leaderboard />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "stampStudio" && <StampStudio me={me} refresh={refresh} />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "boothScan" && <BoothScanPanel me={me} onScan={handleStampScan} />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "tempPasses" && role === "superAdmin" && <TempPassPanel />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "teaMaker" && teaAccess && <TeaMakerPanel />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "notices" && <NoticePanel />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "rewardScan" && (
        <div className="gridTwo">
          <section className="panel rewardAdminCard">
            <h2>쿠폰 사용</h2>
            <RewardImage reward={rewards.find((reward) => reward.id === me.account?.rewardId)} />
            <p>{rewardLabel(rewards.find((reward) => reward.id === me.account?.rewardId))}</p>
            {rewardDetail(me.account?.rewardId) && <small>{rewardDetail(me.account?.rewardId)}</small>}
            <strong>{me.redeemedCount || 0}</strong>
            <span>쿠폰 사용</span>
          </section>
          <Scanner label="쿠폰 QR 사용" onScan={handleCouponScan} />
          <RewardStockPanel compact />
        </div>
      )}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "codes" && <CodesPanel />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "admin" && <AdminPanel me={me} refresh={refresh} />}
    </main>
  );
}
