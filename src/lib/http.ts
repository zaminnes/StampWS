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

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const host = request.headers.get("host");
  if (!host) throw new HttpError(403, "요청 출처를 확인할 수 없습니다.");

  try {
    if (new URL(origin).host !== host) {
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
