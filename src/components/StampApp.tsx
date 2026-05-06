"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Role = "participant" | "boothAdmin" | "rewardAdmin" | "superAdmin";

type Reward = {
  id: "chemistry" | "biology" | "quasar" | "alphago";
  name: string;
  clubName: string;
  imagePath: string;
  active: boolean;
};

type Stamp = {
  id: string;
  boothId: string;
  boothName: string;
  stampImageDataUrl: string;
  createdAt: string;
};

type CodeRow = {
  codeLabel: string;
  fullCode?: string;
  groupName: string;
  role: string;
  targetName: string;
  used: boolean;
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

type PrinterType = "normal" | "mini";

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
  gatt?: {
    connect: () => Promise<BluetoothServer>;
  };
};

type BluetoothNavigator = Navigator & {
  bluetooth?: {
    requestDevice: (options: {
      filters: Array<{ namePrefix: string }>;
      optionalServices: string[];
    }) => Promise<BluetoothDevice>;
  };
};

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
  booth?: {
    id: string;
    name: string;
    clubName: string;
    stampImageDataUrl?: string;
    stampDesignUpdatedAt?: string;
    hasCustomStampImage?: boolean;
  };
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
type AppTab = "home" | "profile" | "leaderboard" | "boothScan" | "stampStudio" | "rewardScan" | "codes" | "admin" | "tempPasses";

type StampEffectState = {
  id: number;
  mode: "give" | "receive";
  title: string;
  detail: string;
  imageDataUrl?: string;
};

const REWARD_KO: Record<Reward["id"], { clubName: string; name: string }> = {
  chemistry: { clubName: "화학", name: "달고나" },
  biology: { clubName: "생명", name: "콩가루차" },
  quasar: { clubName: "퀘이사", name: "팝콘" },
  alphago: { clubName: "알파고", name: "아이스티" }
};

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

function roleLabel(role?: Role) {
  if (role === "participant") return "참가자";
  if (role === "boothAdmin") return "부스";
  if (role === "rewardAdmin") return "보상";
  if (role === "superAdmin") return "총괄";
  return "-";
}

const PRINTER_WIDTHS: Record<PrinterType, number> = {
  normal: 576,
  mini: 384
};

const PRINTER_SERVICES = [
  { service: "00005000-d102-11e1-9b23-74f07d000000", write: "00005001-d102-11e1-9b23-74f07d000000" },
  { service: "3b790000-923e-4f69-b794-74f07d000000", write: "3b790002-923e-4f69-b794-74f07d000000" },
  { service: "49535343-fe78-4ae5-8fa9-9fafd205e455", write: "49535343-8841-43f4-a8d4-ecbe34729bb3" }
];

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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

async function renderTempPassCanvas(pass: TempPassView, printerType: PrinterType) {
  if (!pass.qrToken) throw new Error("인쇄할 QR 토큰이 없습니다.");
  const width = PRINTER_WIDTHS[printerType];
  const height = printerType === "mini" ? 360 : 420;
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

  drawCenteredText(context, "WSHS SCIENCE", 34, width, printerType === "mini" ? 22 : 26, 900);
  drawCenteredText(context, fitText(pass.displayName || pass.label, 12), printerType === "mini" ? 68 : 76, width, printerType === "mini" ? 30 : 38, 900);

  const qrSize = printerType === "mini" ? 188 : 244;
  const qrX = Math.round((width - qrSize) / 2);
  const qrY = printerType === "mini" ? 116 : 138;
  const qrImage = await loadCanvasImage(`/api/qr?value=${encodeURIComponent(publicQrValue(pass.qrToken))}`);
  context.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

  drawCenteredText(context, "7개 완료 후 보상 부스 스캔", qrY + qrSize + 22, width, printerType === "mini" ? 18 : 22, 800);
  drawCenteredText(context, `${pass.label} · 현장 임시권`, qrY + qrSize + (printerType === "mini" ? 48 : 56), width, printerType === "mini" ? 14 : 16, 700);

  return canvas;
}

function canvasToPrinterBitmap(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("인쇄 데이터를 만들지 못했습니다.");
  const { width, height } = canvas;
  const imageData = context.getImageData(0, 0, width, height);
  const bytesPerLine = Math.ceil(width / 8);
  const bitmap = new Uint8Array(bytesPerLine * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const gray = imageData.data[index] * 0.299 + imageData.data[index + 1] * 0.587 + imageData.data[index + 2] * 0.114;
      if (gray < 160) {
        bitmap[y * bytesPerLine + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
      }
    }
  }

  const header = new Uint8Array([
    0x1d,
    0x76,
    0x30,
    0x00,
    bytesPerLine & 0xff,
    (bytesPerLine >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff
  ]);
  const packet = new Uint8Array(header.length + bitmap.length);
  packet.set(header, 0);
  packet.set(bitmap, header.length);
  return packet;
}

async function writePrinter(characteristic: BluetoothWriteCharacteristic, data: Uint8Array) {
  if (characteristic.writeValueWithoutResponse) {
    await characteristic.writeValueWithoutResponse(data);
    return;
  }
  if (characteristic.writeValue) {
    await characteristic.writeValue(data);
    return;
  }
  throw new Error("프린터 쓰기 기능을 찾지 못했습니다.");
}

async function connectNemonicPrinter() {
  const bluetooth = (navigator as BluetoothNavigator).bluetooth;
  if (!window.isSecureContext) {
    throw new Error("네모닉 인쇄는 HTTPS 또는 localhost에서만 가능합니다.");
  }
  if (!bluetooth) {
    throw new Error("Chrome 또는 Edge에서 블루투스를 켜주세요.");
  }

  const device = await bluetooth.requestDevice({
    filters: [{ namePrefix: "nemonic" }, { namePrefix: "Nemonic" }],
    optionalServices: PRINTER_SERVICES.map((item) => item.service)
  });
  const server = await device.gatt?.connect();
  if (!server) throw new Error("프린터 연결에 실패했습니다.");

  for (const item of PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(item.service);
      return await service.getCharacteristic(item.write);
    } catch {
      continue;
    }
  }

  throw new Error("네모닉 프린터 서비스를 찾지 못했습니다.");
}

async function printTempPasses(passes: TempPassView[], printerType: PrinterType, onProgress: (progress: number) => void) {
  const printable = passes.filter((pass) => pass.status === "active" && pass.qrToken);
  if (printable.length === 0) throw new Error("인쇄할 임시 QR이 없습니다.");

  onProgress(5);
  const characteristic = await connectNemonicPrinter();
  onProgress(12);

  for (const [index, pass] of printable.entries()) {
    const canvas = await renderTempPassCanvas(pass, printerType);
    const packet = canvasToPrinterBitmap(canvas);
    for (let offset = 0; offset < packet.length; offset += 100) {
      await writePrinter(characteristic, packet.slice(offset, Math.min(offset + 100, packet.length)));
      await delay(10);
    }
    await delay(700);
    await writePrinter(characteristic, new Uint8Array([0x1b, 0x69]));
    await delay(350);
    onProgress(12 + Math.round(((index + 1) / printable.length) * 88));
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

  async function startCamera() {
    setMessage("");
    if (!("BarcodeDetector" in window)) {
      setMessage("수동 입력 사용");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    setActive(true);
  }

  useEffect(() => {
    if (!active || !videoRef.current || !("BarcodeDetector" in window)) return;
    let cancelled = false;
    const detector = new (window as unknown as { BarcodeDetector: new (options: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector({
      formats: ["qr_code"]
    });

    async function tick() {
      if (cancelled || !videoRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        const token = extractQrToken(codes[0]?.rawValue || "");
        if (token && !busyRef.current) {
          busyRef.current = true;
          await onScan(token);
          setMessage("처리 완료");
          setTimeout(() => {
            busyRef.current = false;
          }, 1200);
        }
      } catch {
        setMessage("카메라 확인");
      }
      window.setTimeout(tick, 500);
    }

    tick();
    return () => {
      cancelled = true;
    };
  }, [active, onScan]);

  async function submitManual() {
    if (!manual.trim()) return;
    await onScan(extractQrToken(manual));
    setManual("");
    setMessage("처리 완료");
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
          <p>스탬프 7개부터 쿠폰.</p>
        </div>
        <div className="segmented">
          <button className={mode === "participant" ? "active" : ""} onClick={() => setMode("participant")} type="button">참가자</button>
          <button className={mode === "adminLogin" ? "active" : ""} onClick={() => setMode("adminLogin")} type="button">관리자 로그인</button>
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
        {mode === "participant" && <p className="hintText">중학생은 현장에서 임시 QR을 받아주세요.</p>}
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
            <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="B-01-..." />
          </label>
        )}
        {error && <p className="errorText">{error}</p>}
        <button className="primaryButton" disabled={busy} onClick={submit} type="button">
          {busy ? "처리중" : mode === "participant" ? "입장" : mode === "adminLogin" ? "로그인" : "가입"}
        </button>
      </section>
      <section className="quickPanel">
        <section className="panel opsPanel">
          <div className="previewHeader">
            <div>
              <p className="eyebrow">운영</p>
              <h2>오늘 화면</h2>
            </div>
            <span className="liveBadge">James 제작</span>
          </div>
          <div className="flowList">
            <div className="flowItem primaryFlow">
              <span className="flowIcon">QR</span>
              <div>
                <strong>내 QR</strong>
                <p>부스에서 제시</p>
              </div>
              <span>참가자</span>
            </div>
            <div className="flowItem">
              <span className="flowIcon">IN</span>
              <div>
                <strong>스탬프</strong>
                <p>관리자가 지급</p>
              </div>
              <span>부스</span>
            </div>
            <div className="flowItem">
              <span className="flowIcon">OK</span>
              <div>
                <strong>쿠폰</strong>
                <p>하나만 선택</p>
              </div>
              <span>보상</span>
            </div>
          </div>
          <div className="rewardRail">
            <div>
              <img src="/rewards/dalgona.png" alt="화학 달고나" />
              <span>화학 달고나</span>
            </div>
            <div>
              <img src="/rewards/bean-tea.png" alt="생명 콩가루차" />
              <span>생명 콩가루차</span>
            </div>
            <div>
              <img src="/rewards/popcorn.png" alt="퀘이사 팝콘" />
              <span>퀘이사 팝콘</span>
            </div>
            <div>
              <img src="/rewards/iced-tea.png" alt="알파고 아이스티" />
              <span>알파고 아이스티</span>
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
  const stamps = me.stamps || [];
  const progress = Math.min(me.stats?.stampCount || 0, 7);
  const remaining = Math.max(7 - progress, 0);
  const latestStamp = [...stamps].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const couponStatus = me.coupon
    ? me.coupon.status === "unused" ? "사용 가능" : "사용 완료"
    : me.stats?.couponEligible ? "변환 가능" : "대기";

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
              <strong>{progress}/7</strong>
              <span>스탬프</span>
            </div>
            <div className="progressTrack">
              <span style={{ width: `${(progress / 7) * 100}%` }} />
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
            <p>7개부터 선택.</p>
          </div>
        </div>
        {me.coupon ? (
          <div className="couponLayout">
            <div>
              <p className="couponTitle">{rewardLabel(couponReward)}</p>
              <p className={`pill ${me.coupon.status === "unused" ? "ok" : "done"}`}>
                {me.coupon.status === "unused" ? "사용 가능" : `사용 완료 ${formatTime(me.coupon.redeemedAt)}`}
              </p>
            </div>
            <QrImage token={me.coupon.qrToken} label="쿠폰 QR" />
          </div>
        ) : (
          <>
            <div className="rewardGrid">
              {rewards.map((reward) => (
                <button
                  className={`rewardChoice ${selectedReward === reward.id ? "selected" : ""}`}
                  key={reward.id}
                  onClick={() => setSelectedReward(reward.id)}
                  type="button"
                >
                  <img src={reward.imagePath} alt={reward.name} />
                  <span>{rewardLabel(reward)}</span>
                </button>
              ))}
            </div>
            {error && <p className="errorText">{error}</p>}
            <button className="primaryButton" disabled={(me.stats?.stampCount || 0) < 7} onClick={createCoupon} type="button">
              변환
            </button>
          </>
        )}
      </section>

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
  const [color, setColor] = useState("#ef4444");
  const [size, setSize] = useState(12);
  const [message, setMessage] = useState("");
  const [previewDataUrl, setPreviewDataUrl] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (me.booth?.stampImageDataUrl) {
      const image = new Image();
      image.onload = () => {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setPreviewDataUrl(canvas.toDataURL("image/png"));
      };
      image.src = me.booth.stampImageDataUrl;
    } else {
      setPreviewDataUrl(canvas.toDataURL("image/png"));
    }
  }, [me.booth?.stampImageDataUrl]);

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
    if (!canvas) return;
    try {
      await apiJson("/api/booth/save-stamp", {
        method: "POST",
        body: JSON.stringify({ imageDataUrl: canvas.toDataURL("image/png") })
      });
      await refresh();
      setMessage("저장됨");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "저장 실패");
    }
  }

  return (
    <section className="panel">
      <div className="sectionHeader">
        <div>
          <h2>도장</h2>
          <p>{me.booth?.name}</p>
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
        {previewDataUrl ? <img src={previewDataUrl} alt="도장 미리보기" /> : <strong>STAMP</strong>}
      </div>
      {message && <p className={message.includes("저장됨") ? "statusText" : "errorText"}>{message}</p>}
      <button className="primaryButton" onClick={saveStamp} type="button">저장</button>
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
    const order = ["화학", "생명", "퀘이사", "알파고", "총괄"];
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
          <p>{showFullCode ? "총괄은 원문 표시." : "원문은 숨김."}</p>
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
                      <td><span className={`pill ${code.used ? "done" : "ok"}`}>{code.revoked ? "비활성" : code.used ? "사용됨" : "미사용"}</span></td>
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
  if (pass.stampCount >= 7) return "보상 가능";
  return "진행";
}

function TempPassPanel() {
  const [passes, setPasses] = useState<TempPassView[]>([]);
  const [lastCreatedIds, setLastCreatedIds] = useState<Set<string>>(new Set());
  const [selectedPassIds, setSelectedPassIds] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(4);
  const [displayNames, setDisplayNames] = useState("");
  const [printerType, setPrinterType] = useState<PrinterType>("normal");
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
      await printTempPasses(printTargets, printerType, setProgress);
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
        <label>
          네모닉
          <select value={printerType} onChange={(event) => setPrinterType(event.target.value as PrinterType)}>
            <option value="normal">일반</option>
            <option value="mini">미니</option>
          </select>
        </label>
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
            <p>스탬프 {pass.stampCount}/7</p>
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

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const booth of me.booths || []) next[booth.id] = booth.name;
    setNames(next);
  }, [me.booths]);

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
        {(me.booths || []).map((booth) => (
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

function AdminPanel({ me, refresh }: { me: MePayload; refresh: () => Promise<void> }) {
  return (
    <div className="gridTwo adminGrid">
      <section className="panel widePanel">
        <div className="sectionHeader">
          <div>
            <h2>총괄</h2>
            <p>서버 기록 기준.</p>
          </div>
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
      <DefaultStampPanel me={me} refresh={refresh} />
      <AccountAdminPanel />
      <BoothNamesPanel me={me} refresh={refresh} />
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
              <p>{row.bio || (row.completed ? `완료 ${formatTime(row.completedSevenAt)}` : `${row.stampCount}/7 진행`)}</p>
              <div className="speedMeta">
                <span>스탬프 {row.stampCount}/7</span>
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
            <div className={`scoreBox ${row.completed ? "" : "pending"}`}>{row.completed ? formatDuration(row.durationMs || 0) : `${row.stampCount}/7`}</div>
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
  const [stampEffect, setStampEffect] = useState<StampEffectState | null>(null);
  const previousStampCountRef = useRef<number | null>(null);

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
        detail: latestStamp ? `${latestStamp.boothName} · ${nextStampCount}/7` : `${nextStampCount}/7`,
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

  const role = me.account?.role;
  const rewards = me.rewards || [];

  const nav = useMemo(() => {
    if (!role) return [];
    if (role === "participant") return [
      ["home", "스탬프"],
      ["profile", "프로필"],
      ["leaderboard", "랭킹"]
    ] as Array<[AppTab, string]>;
    if (role === "boothAdmin") return [
      ["boothScan", "지급"],
      ["stampStudio", "도장"],
      ["codes", "코드"],
      ["leaderboard", "랭킹"]
    ] as Array<[AppTab, string]>;
    if (role === "rewardAdmin") return [
      ["rewardScan", "사용"],
      ["codes", "코드"],
      ["leaderboard", "랭킹"]
    ] as Array<[AppTab, string]>;
    return [
      ["admin", "총괄"],
      ["tempPasses", "임시"],
      ["codes", "코드"],
      ["leaderboard", "랭킹"]
    ] as Array<[AppTab, string]>;
  }, [role]);

  async function logout() {
    if (me.account?.role === "participant") {
      window.localStorage.removeItem("wshsParticipantCache");
    }
    await apiJson("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
    setMe({ account: null });
    setTab("home");
  }

  const handleStampScan = useCallback(async (token: string) => {
    setToast("");
    try {
      const result = await apiJson<{ participantName: string; stampCount: number }>("/api/booth/grant-stamp", {
        method: "POST",
        body: JSON.stringify({ token })
      });
      setToast(`${result.participantName} 스탬프 지급 완료 (${result.stampCount}/7)`);
      showStampEffect({
        mode: "give",
        title: "지급 완료",
        detail: `${result.participantName} · ${result.stampCount}/7`,
        imageDataUrl: me.booth?.stampImageDataUrl
      });
      await refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "스탬프 지급 실패");
    }
  }, [me.booth?.stampImageDataUrl, refresh, showStampEffect]);

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

      {toast && <p className={toast.includes("완료") ? "toast okToast" : "toast errorToast"}>{toast}</p>}
      {stampEffect && <StampEffect effect={stampEffect} />}

      {role === "participant" && me.account.displayNameRequired && <RequiredNamePanel refresh={refresh} />}

      {!(role === "participant" && me.account.displayNameRequired) && tab === "home" && role === "participant" && <ParticipantHome me={me} refresh={refresh} />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "profile" && <ProfileEditor me={me} refresh={refresh} />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "leaderboard" && <Leaderboard />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "stampStudio" && <StampStudio me={me} refresh={refresh} />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "boothScan" && <Scanner label="QR 지급" onScan={handleStampScan} />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "tempPasses" && role === "superAdmin" && <TempPassPanel />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "rewardScan" && (
        <div className="gridTwo">
          <section className="panel rewardAdminCard">
            <h2>보상</h2>
            <p>{rewardLabel(rewards.find((reward) => reward.id === me.account?.rewardId))}</p>
            <strong>{me.redeemedCount || 0}</strong>
            <span>사용</span>
          </section>
          <Scanner label="QR 사용" onScan={handleCouponScan} />
        </div>
      )}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "codes" && <CodesPanel />}
      {!(role === "participant" && me.account.displayNameRequired) && tab === "admin" && <AdminPanel me={me} refresh={refresh} />}
    </main>
  );
}
