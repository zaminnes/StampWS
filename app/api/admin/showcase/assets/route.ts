import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { HttpError, jsonError } from "@/lib/http";

export const runtime = "nodejs";

const ASSET_DIR = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "app",
  "api",
  "admin",
  "showcase",
  "_assets"
);

const ASSETS = {
  "stampws-audio.mp3": {
    file: path.join(ASSET_DIR, "stampws-audio.mp3"),
    contentType: "audio/mpeg"
  },
  "stampws-audio-classic.mp3": {
    file: path.join(ASSET_DIR, "stampws-audio-classic.mp3"),
    contentType: "audio/mpeg"
  },
  "stampws-audio-boss.mp3": {
    file: path.join(ASSET_DIR, "stampws-audio-boss.mp3"),
    contentType: "audio/mpeg"
  },
  "SW.mp4": {
    file: path.join(ASSET_DIR, "SW.mp4"),
    contentType: "video/mp4"
  },
  "James.mp4": {
    file: path.join(ASSET_DIR, "James.mp4"),
    contentType: "video/mp4"
  }
} as const;

function baseHeaders(contentType: string) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Accept-Ranges": "bytes"
  };
}

function parseRange(rangeHeader: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start = rawStart ? Number(rawStart) : 0;
  let end = rawEnd ? Number(rawEnd) : size - 1;
  if (!rawStart && rawEnd) {
    const suffixLength = Number(rawEnd);
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["superAdmin"]);
    const name = request.nextUrl.searchParams.get("name") || "";
    const asset = ASSETS[name as keyof typeof ASSETS];
    if (!asset) throw new HttpError(404, "파일을 찾을 수 없습니다.");

    const file = await readFile(asset.file);
    const headers = baseHeaders(asset.contentType);
    const range = request.headers.get("range");

    if (range) {
      const parsed = parseRange(range, file.byteLength);
      if (!parsed) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            ...headers,
            "Content-Range": `bytes */${file.byteLength}`
          }
        });
      }
      const chunk = file.subarray(parsed.start, parsed.end + 1);
      const body = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
      return new NextResponse(body, {
        status: 206,
        headers: {
          ...headers,
          "Content-Length": String(chunk.byteLength),
          "Content-Range": `bytes ${parsed.start}-${parsed.end}/${file.byteLength}`
        }
      });
    }

    const body = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;

    return new NextResponse(body, {
      headers: {
        ...headers,
        "Content-Length": String(file.byteLength)
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
