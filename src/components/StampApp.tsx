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
  };
};

type AuthMode = "login" | "register" | "adminJoin";
type AppTab = "home" | "profile" | "leaderboard" | "boothScan" | "stampStudio" | "rewardScan" | "codes" | "admin";

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
        <div className="metricGrid compactMetrics">
          <div><strong>7</strong><span>쿠폰</span></div>
          <div><strong>1</strong><span>보상</span></div>
          <div><strong>50</strong><span>코드</span></div>
        </div>
        <section className="panel">
          <h2>보상</h2>
          <div className="rewardStrip">
            <img src="/rewards/dalgona.png" alt="Dalgona" />
            <img src="/rewards/bean-tea.png" alt="Bean Powder Tea" />
            <img src="/rewards/popcorn.png" alt="Popcorn" />
            <img src="/rewards/iced-tea.png" alt="Iced Tea" />
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
  const progress = Math.min(me.stats?.stampCount || 0, 7);

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
      <section className="panel profilePreview">
        <div className={`avatarFrame frame-${me.profile?.frameId || "clean"}`}>
          {me.profile?.avatarStampImageDataUrl ? <img src={me.profile.avatarStampImageDataUrl} alt="대표 스탬프" /> : <span>STAMP</span>}
        </div>
        <div>
          <p className="eyebrow">참가자</p>
          <h2>{me.account?.displayName}</h2>
          <p>{me.profile?.bio || "한 줄 소개 없음"}</p>
          <div className="progressTrack">
            <span style={{ width: `${(progress / 7) * 100}%` }} />
          </div>
          <p className="statusText">스탬프 {me.stats?.stampCount || 0}/7개</p>
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
        <h2>스탬프</h2>
        <div className="stampGrid">
          {(me.stamps || []).map((stamp) => (
            <div className="stampTile" key={stamp.id}>
              <img src={stamp.stampImageDataUrl} alt={stamp.boothName} />
              <strong>{stamp.boothName}</strong>
              <span>{formatTime(stamp.createdAt)}</span>
            </div>
          ))}
          {(me.stamps || []).length === 0 && <p className="emptyText">기록 없음</p>}
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
          <small>{me.account.role}</small>
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
          </div>
        </section>
      )}
    </main>
  );
}
