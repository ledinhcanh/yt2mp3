import {
  isVideoId,
  refreshYoutubeSession,
  resolveTrack,
  ResolveError,
} from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fetchFromCdn(url: string, range: string) {
  // Always send a Range header. A plain range-less GET gets throttled by
  // YouTube's CDN to a few tens of KB/s, while ranged reads run at full speed.
  const headers: Record<string, string> = {
    Accept: "*/*",
    Range: range,
  };

  return fetch(url, {
    headers,
    redirect: "follow",
    cache: "no-store",
  });
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";

  if (!isVideoId(id)) {
    return Response.json({ ok: false, error: "ID video không hợp lệ." }, { status: 400 });
  }

  const clientRange = request.headers.get("range");
  const upstreamRange = clientRange ?? "bytes=0-";

  try {
    let resolved = await resolveTrack(id);
    let upstream = await fetchFromCdn(resolved.url, upstreamRange);

    // A cached CDN URL can expire or get rejected. Re-resolve once and retry.
    // If that still fails, the session's visitor id is being throttled, so
    // rebuild it with a fresh visitor id before trying one last time.
    if (upstream.status === 403 || upstream.status === 410) {
      resolved = await resolveTrack(id, { force: true });
      upstream = await fetchFromCdn(resolved.url, upstreamRange);

      if (upstream.status === 403 || upstream.status === 410) {
        console.warn("[api/audio] refreshing YouTube session after 403", id);
        await refreshYoutubeSession();
        resolved = await resolveTrack(id, { force: true });
        upstream = await fetchFromCdn(resolved.url, upstreamRange);
      }
    }

    if (!upstream.ok && upstream.status !== 206) {
      return Response.json(
        { ok: false, error: `Không tải được âm thanh từ YouTube (${upstream.status}).` },
        { status: 502 },
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", resolved.info.mimeType || "application/octet-stream");
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "no-store");

    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    if (contentLength) headers.set("Content-Length", contentLength);

    let status = 200;
    if (clientRange && contentRange) {
      headers.set("Content-Range", contentRange);
      status = 206;
    }

    const extension = resolved.info.sourceFormat === "opus" ? "webm" : "m4a";
    const filename = encodeURIComponent(`${resolved.info.title}.${extension}`);
    headers.set("Content-Disposition", `inline; filename*=UTF-8''${filename}`);

    return new Response(upstream.body, {
      status,
      headers,
    });
  } catch (error) {
    const status = error instanceof ResolveError ? error.status : 500;
    const message =
      error instanceof ResolveError
        ? error.message
        : "Đã xảy ra lỗi khi tải âm thanh. Vui lòng thử lại.";

    if (!(error instanceof ResolveError)) {
      console.error("[api/audio] unexpected error", id, error);
    }

    return Response.json({ ok: false, error: message }, { status });
  }
}
