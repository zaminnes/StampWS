import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("value") || "";
  if (value.length < 1 || value.length > 512) {
    return NextResponse.json({ error: "QR 값이 올바르지 않습니다." }, { status: 400 });
  }

  const png = await QRCode.toBuffer(value, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 260,
    color: {
      dark: "#000000",
      light: "#ffffff"
    }
  });

  const body = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store"
    }
  });
}
