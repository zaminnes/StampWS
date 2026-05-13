"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Role = "participant" | "boothAdmin" | "rewardAdmin" | "superAdmin";

type Account = {
  id: string;
  type: "student" | "guest" | "admin";
  role: Role;
  loginId: string;
  studentCode?: string | null;
  displayName: string;
};

type Booth = {
  id: string;
  name: string;
  club_name: string;
  location: string;
  active: boolean;
};

type GoodsOption = {
  id: string;
  name: string;
  totalStock?: number;
  remainingStock?: number;
  total_stock?: number;
  remaining_stock?: number;
};

type Goods = {
  id: string;
  booth_id: string;
  booth_name: string;
  name: string;
  description: string;
  image_url: string;
  status: "draft" | "public" | "closed";
  options: GoodsOption[];
};

type Order = {
  id: string;
  goods_id: string;
  goods_name: string;
  booth_name: string;
  option_name: string;
  status: "reserved" | "claimed" | "cancelled";
  created_at: string;
};

type Me = {
  account: Account | null;
  booths?: Booth[];
  goods?: Goods[];
  orders?: Order[];
};

type AuthMode = "student" | "guest" | "admin" | "join";

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청 실패");
  return data as T;
}

function stockOf(option: GoodsOption) {
  return option.remainingStock ?? option.remaining_stock ?? 0;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function QrPreview({ value }: { value: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let alive = true;
    import("qrcode").then((QRCode) => {
      QRCode.toDataURL(value, { margin: 1, width: 220, color: { dark: "#111827", light: "#ffffff" } }).then((next) => {
        if (alive) setSrc(next);
      });
    });
    return () => {
      alive = false;
    };
  }, [value]);

  if (!src) return <div className="localQrSkeleton" />;
  return <img className="localQrImage" src={src} alt="QR" />;
}

function guestTokenFromQr(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    return parsed.searchParams.get("guest") || "";
  } catch {
    return trimmed.startsWith("g.") ? trimmed : "";
  }
}

function QrCameraLogin({ onToken, disabled }: { onToken: (token: string) => Promise<void>; disabled: boolean }) {
  const [message, setMessage] = useState("");
  const [active, setActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  const stopCamera = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    setMessage("카메라 준비");
    try {
      const jsQR = (await import("jsqr")).default;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } }
      });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error("카메라를 열지 못했습니다.");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setActive(true);
      setMessage("QR을 비추세요");
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("QR을 읽지 못했습니다.");

      const scan = async () => {
        const video = videoRef.current;
        if (!video || !streamRef.current) return;
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          const token = code ? guestTokenFromQr(code.data) : "";
          if (token) {
            setMessage("인식 완료");
            stopCamera();
            await onToken(token);
            return;
          }
        }
        frameRef.current = requestAnimationFrame(scan);
      };

      frameRef.current = requestAnimationFrame(scan);
    } catch (error) {
      stopCamera();
      const text = error instanceof Error ? error.message : "카메라 실패";
      setMessage(text.includes("Permission") || text.includes("denied") ? "카메라 권한을 허용하세요." : text);
    }
  };

  return (
    <div className="localQrCamera">
      <video ref={videoRef} muted playsInline />
      <div className="localCameraActions">
        <button className="localPrimary" disabled={disabled || active} onClick={startCamera} type="button">
          스캔 시작
        </button>
        {active && (
          <button className="localSecondary" onClick={stopCamera} type="button">
            중지
          </button>
        )}
      </div>
      <p>{message || "카메라로 QR 스캔"}</p>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="localField">
      <span>{props.label}</span>
      <input
        value={props.value}
        type={props.type || "text"}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="localField">
      <span>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.children}
      </select>
    </label>
  );
}

function AuthPanel({ refresh }: { refresh: () => Promise<void> }) {
  const [mode, setMode] = useState<AuthMode>("student");
  const [studentCode, setStudentCode] = useState("");
  const [studentName, setStudentName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [adminName, setAdminName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "student") {
        await apiJson("/api/local/auth/student", {
          method: "POST",
          body: JSON.stringify({ studentCode, displayName: studentName || undefined })
        });
      } else if (mode === "admin") {
        await apiJson("/api/local/auth/admin", {
          method: "POST",
          body: JSON.stringify({ loginId, password })
        });
      } else {
        await apiJson("/api/local/auth/admin-join", {
          method: "POST",
          body: JSON.stringify({ inviteCode, loginId, password, displayName: adminName })
        });
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "실패");
    } finally {
      setBusy(false);
    }
  };

  const loginGuestByToken = async (token: string) => {
    setBusy(true);
    setMessage("");
    try {
      await apiJson("/api/local/auth/guest", {
        method: "POST",
        body: JSON.stringify({ token })
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="localAuthShell">
      <section className="localAuthCard">
        <div className="localBrandRow">
          <div>
            <p className="localEyebrow">StampWS</p>
            <h1>입장</h1>
          </div>
        </div>
        <div className="localTabs" role="tablist" aria-label="로그인 방식">
          <button className={mode === "student" ? "isActive" : ""} onClick={() => setMode("student")} type="button">
            학번
          </button>
          <button className={mode === "guest" ? "isActive" : ""} onClick={() => setMode("guest")} type="button">
            게스트
          </button>
          <button className={mode === "admin" ? "isActive" : ""} onClick={() => setMode("admin")} type="button">
            관리자
          </button>
          <button className={mode === "join" ? "isActive" : ""} onClick={() => setMode("join")} type="button">
            관리자 가입
          </button>
        </div>
        <form className="localForm" onSubmit={submit}>
          {mode === "student" && (
            <>
              <Field label="학번" value={studentCode} onChange={setStudentCode} placeholder="10214" autoComplete="username" />
              <Field label="이름" value={studentName} onChange={setStudentName} placeholder="처음만 입력" autoComplete="name" />
              <p className="localNotice">외부인은 게스트 QR로 입장하세요.</p>
            </>
          )}
          {mode === "guest" && (
            <>
              <QrCameraLogin onToken={loginGuestByToken} disabled={busy} />
              <p className="localNotice">총괄 관리자 QR만 됩니다.</p>
            </>
          )}
          {mode === "admin" && (
            <>
              <Field label="아이디" value={loginId} onChange={setLoginId} autoComplete="username" />
              <Field label="비밀번호" value={password} onChange={setPassword} type="password" autoComplete="current-password" />
            </>
          )}
          {mode === "join" && (
            <>
              <Field label="가입 코드" value={inviteCode} onChange={setInviteCode} />
              <Field label="아이디" value={loginId} onChange={setLoginId} autoComplete="username" />
              <Field label="비밀번호" value={password} onChange={setPassword} type="password" autoComplete="new-password" />
              <Field label="이름" value={adminName} onChange={setAdminName} autoComplete="name" />
            </>
          )}
          {message && <p className="localError">{message}</p>}
          {mode !== "guest" && (
            <button className="localPrimary" type="submit" disabled={busy}>
              {busy ? "처리중" : mode === "join" ? "관리자 가입" : "입장"}
            </button>
          )}
        </form>
      </section>
    </main>
  );
}

function ParticipantPanel({ me, refresh }: { me: Me; refresh: () => Promise<void> }) {
  const [busyId, setBusyId] = useState("");
  const [claimUrl, setClaimUrl] = useState("");
  const [message, setMessage] = useState("");
  const ordersByGoods = useMemo(() => new Set((me.orders || []).map((order) => order.goods_id)), [me.orders]);

  const orderGoods = async (goods: Goods, optionId: string) => {
    setBusyId(goods.id);
    setMessage("");
    try {
      const result = await apiJson<{ claimUrl: string }>("/api/local/goods/order", {
        method: "POST",
        body: JSON.stringify({ goodsId: goods.id, optionId })
      });
      setClaimUrl(result.claimUrl);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "신청 실패");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="localGrid">
      <div className="localPanel localWide">
        <div className="localSectionHead">
          <div>
            <p className="localEyebrow">신청</p>
            <h2>굿즈</h2>
          </div>
          <span>{me.goods?.length || 0}개</span>
        </div>
        {message && <p className="localError">{message}</p>}
        <div className="localGoodsGrid">
          {(me.goods || []).map((goods) => {
            const firstOption = goods.options[0];
            const stock = firstOption ? stockOf(firstOption) : 0;
            const ordered = ordersByGoods.has(goods.id);
            return (
              <article className="localGoodsCard" key={goods.id}>
                <div className="localGoodsImage">
                  {goods.image_url ? <img src={goods.image_url} alt="" /> : <span>{goods.name.slice(0, 2)}</span>}
                </div>
                <div>
                  <strong>{goods.name}</strong>
                  <p>{goods.booth_name}</p>
                </div>
                <div className="localGoodsFooter">
                  <span>{ordered ? "신청 완료" : stock > 0 ? `${stock}개` : "품절"}</span>
                  <button
                    className="localSmallButton"
                    disabled={!firstOption || stock <= 0 || ordered || busyId === goods.id}
                    onClick={() => orderGoods(goods, firstOption.id)}
                    type="button"
                  >
                    신청
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <div className="localPanel">
        <div className="localSectionHead">
          <div>
            <p className="localEyebrow">내역</p>
            <h2>수령</h2>
          </div>
        </div>
        {claimUrl && (
          <div className="localQrCard">
            <QrPreview value={claimUrl} />
            <button className="localSecondary" onClick={() => navigator.clipboard?.writeText(claimUrl)} type="button">
              복사
            </button>
          </div>
        )}
        <div className="localList">
          {(me.orders || []).map((order) => (
            <div className="localListItem" key={order.id}>
              <div>
                <strong>{order.goods_name}</strong>
                <span>{order.option_name}</span>
              </div>
              <em>{order.status === "claimed" ? "수령" : "대기"}</em>
            </div>
          ))}
          {!(me.orders || []).length && <p className="localEmpty">아직 신청 없음</p>}
        </div>
      </div>
    </section>
  );
}

function AdminPanel({ me, refresh, claimFromUrl }: { me: Me; refresh: () => Promise<void>; claimFromUrl: string }) {
  const isSuper = me.account?.role === "superAdmin";
  const [boothName, setBoothName] = useState("");
  const [clubName, setClubName] = useState("");
  const [location, setLocation] = useState("");
  const [createdCode, setCreatedCode] = useState("");
  const [inviteBoothId, setInviteBoothId] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestLabel, setGuestLabel] = useState("");
  const [guestUrl, setGuestUrl] = useState("");
  const [goodsBoothId, setGoodsBoothId] = useState(me.booths?.[0]?.id || "");
  const [goodsName, setGoodsName] = useState("");
  const [goodsDesc, setGoodsDesc] = useState("");
  const [goodsImage, setGoodsImage] = useState("");
  const [optionName, setOptionName] = useState("기본");
  const [stock, setStock] = useState("30");
  const [claimToken, setClaimToken] = useState(claimFromUrl);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!goodsBoothId && me.booths?.[0]) setGoodsBoothId(me.booths[0].id);
  }, [goodsBoothId, me.booths]);

  useEffect(() => {
    if (claimFromUrl) setClaimToken(claimFromUrl);
  }, [claimFromUrl]);

  const createBooth = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    const result = await apiJson<{ inviteCode?: string }>("/api/local/admin/booths", {
      method: "POST",
      body: JSON.stringify({ name: boothName, clubName, location, createCode: true })
    });
    setCreatedCode(result.inviteCode || "");
    setBoothName("");
    setClubName("");
    setLocation("");
    await refresh();
  };

  const createInvite = async () => {
    setMessage("");
    const result = await apiJson<{ code: string }>("/api/local/admin/invite-codes", {
      method: "POST",
      body: JSON.stringify({ boothId: inviteBoothId || undefined, role: "boothAdmin" })
    });
    setInviteCode(result.code);
  };

  const createGuest = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    const result = await apiJson<{ loginUrl: string }>("/api/local/admin/guest-passes", {
      method: "POST",
      body: JSON.stringify({ displayName: guestName, label: guestLabel || guestName, category: "guest" })
    });
    setGuestUrl(result.loginUrl);
    setGuestName("");
    setGuestLabel("");
    await refresh();
  };

  const createGoods = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    await apiJson("/api/local/goods", {
      method: "POST",
      body: JSON.stringify({
        boothId: goodsBoothId,
        name: goodsName,
        description: goodsDesc,
        imageUrl: goodsImage,
        status: "public",
        options: [{ name: optionName, stock: Number(stock) }]
      })
    });
    setGoodsName("");
    setGoodsDesc("");
    setGoodsImage("");
    setOptionName("기본");
    await refresh();
  };

  const claimGoods = async () => {
    setMessage("");
    const result = await apiJson<{ goodsName: string }>("/api/local/goods/claim", {
      method: "POST",
      body: JSON.stringify({ token: claimToken })
    });
    setMessage(`${result.goodsName} 수령 완료`);
    setClaimToken("");
  };

  return (
    <section className="localGrid">
      <div className="localPanel">
        <div className="localSectionHead">
          <div>
            <p className="localEyebrow">제작</p>
            <h2>굿즈</h2>
          </div>
        </div>
        <form className="localForm" onSubmit={createGoods}>
          <SelectField label="부스" value={goodsBoothId} onChange={setGoodsBoothId}>
            {(me.booths || []).map((booth) => (
              <option key={booth.id} value={booth.id}>
                {booth.name}
              </option>
            ))}
          </SelectField>
          <Field label="이름" value={goodsName} onChange={setGoodsName} placeholder="키링" />
          <Field label="설명" value={goodsDesc} onChange={setGoodsDesc} placeholder="선착순" />
          <Field label="이미지" value={goodsImage} onChange={setGoodsImage} placeholder="https://..." />
          <div className="localPair">
            <Field label="옵션" value={optionName} onChange={setOptionName} />
            <Field label="재고" value={stock} onChange={setStock} type="number" />
          </div>
          <button className="localPrimary" type="submit">
            저장
          </button>
        </form>
      </div>
      <div className="localPanel">
        <div className="localSectionHead">
          <div>
            <p className="localEyebrow">사용</p>
            <h2>수령</h2>
          </div>
        </div>
        <div className="localForm">
          <Field label="수령 QR" value={claimToken} onChange={setClaimToken} placeholder="claim.gord_..." />
          <button className="localPrimary" onClick={claimGoods} type="button" disabled={!claimToken}>
            처리
          </button>
        </div>
      </div>
      {isSuper && (
        <>
          <div className="localPanel">
            <div className="localSectionHead">
              <div>
                <p className="localEyebrow">총괄</p>
                <h2>부스</h2>
              </div>
            </div>
            <form className="localForm" onSubmit={createBooth}>
              <Field label="부스명" value={boothName} onChange={setBoothName} />
              <Field label="동아리" value={clubName} onChange={setClubName} />
              <Field label="위치" value={location} onChange={setLocation} />
              <button className="localPrimary" type="submit">
                생성
              </button>
            </form>
            {createdCode && (
              <div className="localCodeBox">
                <span>가입 코드</span>
                <strong>{createdCode}</strong>
              </div>
            )}
          </div>
          <div className="localPanel">
            <div className="localSectionHead">
              <div>
                <p className="localEyebrow">총괄</p>
                <h2>코드</h2>
              </div>
            </div>
            <div className="localForm">
              <SelectField label="부스" value={inviteBoothId} onChange={setInviteBoothId}>
                <option value="">전체</option>
                {(me.booths || []).map((booth) => (
                  <option key={booth.id} value={booth.id}>
                    {booth.name}
                  </option>
                ))}
              </SelectField>
              <button className="localSecondary" onClick={createInvite} type="button">
                코드 생성
              </button>
            </div>
            {inviteCode && (
              <div className="localCodeBox">
                <span>새 코드</span>
                <strong>{inviteCode}</strong>
              </div>
            )}
          </div>
          <div className="localPanel">
            <div className="localSectionHead">
              <div>
                <p className="localEyebrow">입장</p>
                <h2>게스트</h2>
              </div>
            </div>
            <form className="localForm" onSubmit={createGuest}>
              <Field label="이름" value={guestName} onChange={setGuestName} />
              <Field label="라벨" value={guestLabel} onChange={setGuestLabel} placeholder="외부인 01" />
              <button className="localPrimary" type="submit">
                QR 생성
              </button>
            </form>
            {guestUrl && (
              <div className="localQrCard">
                <QrPreview value={guestUrl} />
                <p className="localNotice">사진으로 저장해서 전달</p>
              </div>
            )}
          </div>
        </>
      )}
      <div className="localPanel localWide">
        <div className="localSectionHead">
          <div>
            <p className="localEyebrow">현황</p>
            <h2>목록</h2>
          </div>
          <span>{me.booths?.length || 0}개 부스</span>
        </div>
        {message && <p className={message.includes("완료") ? "localSuccess" : "localError"}>{message}</p>}
        <div className="localTable">
          {(me.goods || []).map((goods) => (
            <div className="localTableRow" key={goods.id}>
              <strong>{goods.name}</strong>
              <span>{goods.booth_name}</span>
              <em>{goods.options.map((option) => `${option.name} ${stockOf(option)}`).join(" / ")}</em>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LocalStampApp() {
  const [me, setMe] = useState<Me>({ account: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [claimFromUrl, setClaimFromUrl] = useState("");

  const refresh = useCallback(async () => {
    const next = await apiJson<Me>("/api/local/me");
    setMe(next);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const guest = params.get("guest");
    const claim = params.get("claim") || "";
    if (claim) setClaimFromUrl(claim);
    const boot = async () => {
      try {
        if (guest) {
          await apiJson("/api/local/auth/guest", { method: "POST", body: JSON.stringify({ token: guest }) });
          params.delete("guest");
          window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
        }
        await refresh();
      } catch (bootError) {
        setError(bootError instanceof Error ? bootError.message : "불러오기 실패");
      } finally {
        setLoading(false);
      }
    };
    boot();
  }, [refresh]);

  const logout = async () => {
    await apiJson("/api/local/auth/logout", { method: "POST", body: JSON.stringify({}) });
    setMe({ account: null });
  };

  if (loading) return <div className="localLoading">불러오는 중</div>;
  if (!me.account) {
    return (
      <>
        {error && <div className="localTopError">{error}</div>}
        <AuthPanel refresh={refresh} />
      </>
    );
  }

  return (
    <main className="localAppShell">
      <header className="localTopBar">
        <div>
          <p className="localEyebrow">StampWS</p>
          <h1>{me.account.role === "participant" ? "오늘" : "운영"}</h1>
        </div>
        <div className="localTopActions">
          <span>로그인됨</span>
          <button className="localSecondary" onClick={logout} type="button">
            나가기
          </button>
        </div>
      </header>
      <section className="localStatusRow">
        <div>
          <strong>{me.account.role === "participant" ? (me.account.type === "guest" ? "게스트" : "참가자") : "관리자"}</strong>
          <span>계정</span>
        </div>
        <div>
          <strong>{me.booths?.length || 0}</strong>
          <span>부스</span>
        </div>
        <div>
          <strong>{me.orders?.filter((order) => order.status === "reserved").length || 0}</strong>
          <span>대기</span>
        </div>
      </section>
      {me.account.role === "participant" ? (
        <ParticipantPanel me={me} refresh={refresh} />
      ) : (
        <AdminPanel me={me} refresh={refresh} claimFromUrl={claimFromUrl} />
      )}
    </main>
  );
}
