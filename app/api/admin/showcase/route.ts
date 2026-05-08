import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

const SHOWCASE_HTML = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "app",
  "api",
  "admin",
  "showcase",
  "_assets",
  "stampws-showcase.html"
);

function normalizeSong(value: string | null) {
  return value === "classic" || value === "boss" || value === "original" ? value : "classic";
}

function serverShowcaseHtml(html: string, song: string) {
  return html
    .replaceAll("__STAMPWS_INITIAL_VERSION__", song)
    .replaceAll("./stampws-audio-boss.mp3", "/api/admin/showcase/assets?name=stampws-audio-boss.mp3")
    .replaceAll("./stampws-audio-classic.mp3", "/api/admin/showcase/assets?name=stampws-audio-classic.mp3")
    .replaceAll("./stampws-audio.mp3", "/api/admin/showcase/assets?name=stampws-audio.mp3")
    .replaceAll("./SW-cutout.webm", "/api/admin/showcase/assets?name=SW-cutout.webm")
    .replaceAll("./James-cutout.webm", "/api/admin/showcase/assets?name=James-cutout.webm")
    .replaceAll("./SW.mp4", "/api/admin/showcase/assets?name=SW.mp4")
    .replaceAll("./James.mp4", "/api/admin/showcase/assets?name=James.mp4")
    .replaceAll("../../../../../public/rewards/", "/rewards/")
    .replaceAll("http://127.0.0.1:4174 로 열기", "총괄 창에서 다시 열기");
}

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["superAdmin"]);
    const song = normalizeSong(request.nextUrl.searchParams.get("song"));
    const html = serverShowcaseHtml(await readFile(SHOWCASE_HTML, "utf8"), song);

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow"
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
