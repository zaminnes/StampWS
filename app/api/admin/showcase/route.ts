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

function serverShowcaseHtml(html: string) {
  return html
    .replaceAll("./stampws-audio.mp3", "/api/admin/showcase/assets?name=stampws-audio.mp3")
    .replaceAll("../../SW.mp4", "/api/admin/showcase/assets?name=SW.mp4")
    .replaceAll("../../James.mp4", "/api/admin/showcase/assets?name=James.mp4")
    .replaceAll("../../public/rewards/", "/rewards/")
    .replaceAll("http://127.0.0.1:4174 로 열기", "총괄 창에서 다시 열기");
}

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["superAdmin"]);
    const html = serverShowcaseHtml(await readFile(SHOWCASE_HTML, "utf8"));

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
