import { NextRequest, NextResponse } from "next/server";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonOk(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: "요청을 처리하지 못했습니다." }, { status: 400 });
}

function parseHost(host: string, protocol = "https:") {
  const parsed = new URL(`${protocol}//${host}`);
  const defaultPort = protocol === "https:" ? "443" : "80";
  const port = parsed.port || defaultPort;
  return {
    hostname: parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
    port,
    value: `${parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase()}${port === defaultPort ? "" : `:${port}`}`
  };
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function forwardedHostCandidates(request: NextRequest, protocol: string) {
  const candidates = new Set<string>();
  const addHost = (value?: string | null) => {
    if (!value) return;
    for (const part of value.split(",")) {
      const host = part.trim();
      if (!host) continue;
      try {
        candidates.add(parseHost(host, protocol).value);
      } catch {
        continue;
      }
    }
  };

  addHost(request.headers.get("host"));
  addHost(request.headers.get("x-forwarded-host"));
  addHost(request.headers.get("x-original-host"));
  addHost(request.nextUrl.host);

  const forwarded = request.headers.get("forwarded") || "";
  const match = /host="?([^;,"]+)/i.exec(forwarded);
  addHost(match?.[1]);

  return candidates;
}

function allowedOrigins() {
  return (process.env.STAMP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        const parsed = origin.includes("://") ? new URL(origin) : new URL(`https://${origin}`);
        return `${parsed.protocol}//${parseHost(parsed.host, parsed.protocol).value}`;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

function isAllowedLocalOrigin(origin: URL, host: string) {
  if (process.env.NODE_ENV === "production") return false;
  const originHost = {
    hostname: origin.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
    port: origin.port || (origin.protocol === "https:" ? "443" : "80")
  };
  const requestHost = parseHost(host, origin.protocol);
  return isLocalHost(originHost.hostname) && isLocalHost(requestHost.hostname) && originHost.port === requestHost.port;
}

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  try {
    const originUrl = new URL(origin);
    const originHost = parseHost(originUrl.host, originUrl.protocol);
    const originValue = `${originUrl.protocol}//${originHost.value}`;
    const hostCandidates = forwardedHostCandidates(request, originUrl.protocol);
    const hasLocalCandidate = [...hostCandidates].some((host) => isAllowedLocalOrigin(originUrl, host));
    if (!hostCandidates.has(originHost.value) && !hasLocalCandidate && !allowedOrigins().includes(originValue)) {
      throw new HttpError(403, "다른 사이트에서 보낸 요청은 차단됩니다.");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, "요청 출처가 올바르지 않습니다.");
  }
}

export function assertContentLength(request: NextRequest, maxBytes: number) {
  const raw = request.headers.get("content-length");
  if (raw && Number(raw) > maxBytes) {
    throw new HttpError(413, "요청 데이터가 너무 큽니다.");
  }
}
