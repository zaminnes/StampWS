import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const firmwareText = await fs.readFile(
    path.join(process.cwd(), "public", "arduino", "alphago_tea_maker_full.ino"),
    "utf8"
  );

  return new NextResponse(firmwareText, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Disposition": "attachment; filename=\"alphago_tea_maker_full.ino\"",
      "Content-Type": "text/x-arduino; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
