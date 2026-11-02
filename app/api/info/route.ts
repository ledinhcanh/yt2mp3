import { extractVideoId, resolveTrack, ResolveError } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INVALID_LINK_MESSAGE =
  "Link YouTube không hợp lệ. Hãy dán link dạng https://youtube.com/watch?v=... hoặc https://youtu.be/...";

function readUrlFromBody(body: unknown): string {
  if (body && typeof body === "object" && "url" in body) {
    const value = (body as { url?: unknown }).url;
    if (typeof value === "string") return value;
  }
  return "";
}

async function handle(rawUrl: string) {
  const videoId = extractVideoId(rawUrl);

  if (!videoId) {
    return Response.json({ ok: false, error: INVALID_LINK_MESSAGE }, { status: 400 });
  }

  try {
    const { info } = await resolveTrack(videoId);
    return Response.json({ ok: true, track: info });
  } catch (error) {
    const status = error instanceof ResolveError ? error.status : 500;
    const message =
      error instanceof ResolveError
        ? error.message
        : "Đã xảy ra lỗi khi xử lý video. Vui lòng thử lại.";

    if (!(error instanceof ResolveError)) {
      console.error("[api/info] unexpected error", videoId, error);
    }

    return Response.json({ ok: false, error: message }, { status });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url") ?? "";
  return handle(url);
}

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  return handle(readUrlFromBody(body));
}
