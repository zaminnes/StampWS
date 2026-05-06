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
  completedSevenAt?: string;
};

type TempPassView = {
  id: string;
  label: string;
  status: "active" | "redeemed" | "voided";
  stampCount: number;
  createdAt: string;
  redeemedAt?: string;
  redeemedRewardId?: Reward["id"];
  qrToken?: string | null;
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
    boothId?: string;
    rewardId?: Reward["id"];
    selectedRewardId?: Reward["id"];
  };
  rewards?: Reward[];
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
};

type AuthMode = "login" | "register" | "adminJoin";
type AppTab = "home" | "profile" | "leaderboard" | "boothScan" | "stampStudio" | "rewardScan" | "codes" | "admin" | "tempPasses";

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

function formatTime(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function rewardLabel(reward?: Reward) {
  if (!reward) return "-";
  return `${reward.clubName} - ${reward.name}`;
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
  drawCenteredText(context, pass.label, printerType === "mini" ? 68 : 76, width, printerType === "mini" ? 30 : 38, 900);

  const qrSize = printerType === "mini" ? 188 : 244;
  const qrX = Math.round((width - qrSize) / 2);
  const qrY = printerType === "mini" ? 116 : 138;
  const qrImage = await loadCanvasImage(`/api/qr?value=${encodeURIComponent(pass.qrToken)}`);
  context.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

  drawCenteredText(context, "7개 완료 후 보상 부스 스캔", qrY + qrSize + 22, width, printerType === "mini" ? 18 : 22, 800);
  drawCenteredText(context, "랭킹 제외", qrY + qrSize + (printerType === "mini" ? 48 : 56), width, printerType === "mini" ? 14 : 16, 700);

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
      <img src={`/api/qr?value=${encodeURIComponent(token)}`} alt={label} />
      <p>{label}</p>
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
        const token = codes[0]?.rawValue;
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
    await onScan(manual.trim());
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
  const [mode, setMode] = useState<AuthMode>("login");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const endpoint =
        mode === "login" ? "/api/auth/login" : mode === "register" ? "/api/auth/register" : "/api/admin/join";
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
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">로그인</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")} type="button">참가자</button>
          <button className={mode === "adminJoin" ? "active" : ""} onClick={() => setMode("adminJoin")} type="button">관리자</button>
        </div>
        <label>
          아이디
          <input value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="username" />
        </label>
        <label>
          비밀번호
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </label>
        {mode !== "login" && (
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
          {busy ? "처리중" : mode === "login" ? "로그인" : "가입"}
        </button>
      </section>
      <section className="quickPanel">
        <section className="panel opsPanel">
          <div className="previewHeader">
            <div>
              <p className="eyebrow">운영</p>
              <h2>오늘 화면</h2>
            </div>
            <span className="liveBadge">준비</span>
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
              <img src="/rewards/dalgona.png" alt="Dalgona" />
              <span>화학</span>
            </div>
            <div>
              <img src="/rewards/bean-tea.png" alt="Bean Powder Tea" />
              <span>생명</span>
            </div>
            <div>
              <img src="/rewards/popcorn.png" alt="Popcorn" />
              <span>퀘이사</span>
            </div>
            <div>
              <img src="/rewards/iced-tea.png" alt="Iced Tea" />
              <span>알파고</span>
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
        <div className="stampGrid">
          {stamps.map((stamp) => (
            <div className="stampTile" key={stamp.id}>
              <img src={stamp.stampImageDataUrl} alt={stamp.boothName} />
              <strong>{stamp.boothName}</strong>
              <span>{formatTime(stamp.createdAt)}</span>
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
          대표 스탬프
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

function StampStudio({ me, refresh }: { me: MePayload; refresh: () => Promise<void> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [color, setColor] = useState("#ef4444");
  const [size, setSize] = useState(12);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (me.booth?.stampImageDataUrl) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = me.booth.stampImageDataUrl;
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

  function endDraw() {
    drawingRef.current = false;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
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

  return (
    <section className="panel">
      <div className="sectionHeader">
        <div>
          <h2>코드</h2>
          <p>원문은 숨김.</p>
        </div>
      </div>
      {error && <p className="errorText">{error}</p>}
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>코드번호</th>
              <th>역할</th>
              <th>담당</th>
              <th>상태</th>
              <th>사용 시간</th>
              <th>사용자</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((code) => (
              <tr key={code.codeLabel}>
                <td>{code.codeLabel}</td>
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
  const [count, setCount] = useState(4);
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

  const printTargets = passes.filter((pass) =>
    lastCreatedIds.size > 0 ? lastCreatedIds.has(pass.id) && pass.status === "active" : pass.status === "active"
  );

  async function createPasses() {
    setBusy(true);
    setMessage("");
    try {
      const data = await apiJson<{ created: TempPassView[] }>("/api/admin/temp-passes", {
        method: "POST",
        body: JSON.stringify({ count })
      });
      setLastCreatedIds(new Set(data.created.map((pass) => pass.id)));
      await load();
      setMessage(`${data.created.length}개 생성`);
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
      setMessage("인쇄 완료");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "인쇄 실패");
    } finally {
      setPrinting(false);
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
        <label>
          프린터
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
      </div>

      <div className="summaryRows tempSummary">
        <div><span>인쇄 대상</span><strong>{printTargets.length}개</strong></div>
        <div><span>사용 가능</span><strong>{passes.filter((pass) => pass.status === "active").length}개</strong></div>
        <div><span>랭킹</span><strong>제외</strong></div>
      </div>

      {message && <p className={message.includes("완료") || message.includes("생성") ? "statusText" : "errorText"}>{message}</p>}

      <div className="tempPassGrid">
        {passes.map((pass) => (
          <div className={`tempPassCard ${lastCreatedIds.has(pass.id) ? "selected" : ""}`} key={pass.id}>
            <div>
              <strong>{pass.label}</strong>
              <span className={`pill ${pass.status === "active" ? "ok" : "done"}`}>{tempPassStatus(pass)}</span>
            </div>
            {pass.qrToken ? (
              <img src={`/api/qr?value=${encodeURIComponent(pass.qrToken)}`} alt={`${pass.label} QR`} />
            ) : (
              <div className="usedQr">완료</div>
            )}
            <p>스탬프 {pass.stampCount}/7</p>
            <small>{pass.redeemedAt ? formatTime(pass.redeemedAt) : formatTime(pass.createdAt)}</small>
          </div>
        ))}
        {passes.length === 0 && <p className="emptyText">생성된 QR 없음</p>}
      </div>
    </section>
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
          <p>동점은 먼저 7개.</p>
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
              <p>{row.bio || "참가자"}</p>
            </div>
            <div className="scoreBox">{row.stampCount}</div>
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

  const refresh = useCallback(async () => {
    const data = await apiJson<MePayload>("/api/me", { method: "GET" });
    setMe(data);
    if (data.account?.role === "boothAdmin") setTab((current) => (current === "home" ? "boothScan" : current));
    if (data.account?.role === "rewardAdmin") setTab((current) => (current === "home" ? "rewardScan" : current));
    if (data.account?.role === "superAdmin") setTab((current) => (current === "home" ? "admin" : current));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

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
      await refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "스탬프 지급 실패");
    }
  }, [refresh]);

  const handleCouponScan = useCallback(async (token: string) => {
    setToast("");
    try {
      const result = await apiJson<{ participantName: string; rewardName: string; rewardClubName: string }>("/api/coupon/redeem", {
        method: "POST",
        body: JSON.stringify({ token })
      });
      setToast(`${result.participantName} 쿠폰 사용 완료: ${result.rewardClubName} - ${result.rewardName}`);
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

      {tab === "home" && role === "participant" && <ParticipantHome me={me} refresh={refresh} />}
      {tab === "profile" && <ProfileEditor me={me} refresh={refresh} />}
      {tab === "leaderboard" && <Leaderboard />}
      {tab === "stampStudio" && <StampStudio me={me} refresh={refresh} />}
      {tab === "boothScan" && <Scanner label="QR 지급" onScan={handleStampScan} />}
      {tab === "tempPasses" && role === "superAdmin" && <TempPassPanel />}
      {tab === "rewardScan" && (
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
      {tab === "codes" && <CodesPanel />}
      {tab === "admin" && (
        <section className="panel">
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
      )}
    </main>
  );
}
