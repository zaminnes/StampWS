import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("value") || "";
  if (value.length < 1 || value.length > 512) {
    return NextResponse.json({ error: "QR 값이 올바르지 않습니다." }, { status: 400 });
  }

  const svg = await QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 260,
    color: {
      dark: "#111827",
      light: "#ffffff"
    }
  });

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
