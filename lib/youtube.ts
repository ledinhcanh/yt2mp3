import { Innertube, Platform } from "youtubei.js";
import { resolveInvidiousTrack } from "./invidious";
import { getPoToken, resetPoTokenProvider } from "./potoken";

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;
const VISITOR_TTL_MS = 6 * 60 * 60 * 1000;
const VISITOR_TIMEOUT_MS = 10_000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface TrackInfo {
  videoId: string;
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
  mimeType: string;
  bitrate: number;
  sizeBytes: number;
  sourceFormat: "aac" | "opus";
}

export interface ResolvedTrack {
  info: TrackInfo;
  url: string;
  cachedAt: number;
}

export class ResolveError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ResolveError";
    this.status = status;
  }
}

const cache = new Map<string, ResolvedTrack>();

let platformReady = false;
let innertubePromise: Promise<Innertube> | null = null;

let visitorDataCache: { value: string | null; expiresAt: number } | null = null;

function preparePlatform() {
  if (platformReady) return;

  Platform.shim.eval = async (data) => new Function(data.output)();
  platformReady = true;
}

/**
 * Fetch a real visitor id from the YouTube homepage. YouTube only serves
 * unthrottled media URLs to sessions backed by a genuine visitor id; locally
 * generated sessions are limited to the first ~1 MiB of every stream, which
 * makes any video longer than a few minutes fail with HTTP 403.
 */
async function getVisitorData(): Promise<string | null> {
  if (visitorDataCache && visitorDataCache.expiresAt > Date.now()) {
    return visitorDataCache.value;
  }

  let value: string | null = null;

  try {
    const response = await fetch("https://www.youtube.com/", {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(VISITOR_TIMEOUT_MS),
    });

    if (response.ok) {
      const html = await response.text();
      const match =
        /"visitorData":"([^"]+)"/.exec(html) ??
        /VISITOR_DATA":"([^"]+)"/.exec(html);
      value = match?.[1] ?? null;
    }
  } catch (error) {
    console.warn("[youtube] failed to fetch visitor data", error);
  }

  visitorDataCache = {
    value,
    // Retry quickly after a failure instead of pinning a fake session for hours.
    expiresAt: Date.now() + (value ? VISITOR_TTL_MS : 60_000),
  };
  return value;
}

export async function getInnertube(): Promise<Innertube> {
  preparePlatform();

  if (!innertubePromise) {
    innertubePromise = (async () => {
      const visitorData = await getVisitorData();

      return Innertube.create({
        retrieve_player: true,
        generate_session_locally: !visitorData,
        enable_session_cache: false,
        lang: "vi",
        location: "VN",
        ...(visitorData ? { visitor_data: visitorData } : {}),
      });
    })();

    innertubePromise.catch(() => {
      innertubePromise = null;
    });
  }

  return innertubePromise;
}

export function isVideoId(value: string): boolean {
  return VIDEO_ID_RE.test(value);
}

export function extractVideoId(input: string): string | null {
  if (!input) return null;

  const trimmed = input.trim();
  if (VIDEO_ID_RE.test(trimmed)) return trimmed;

  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const isYouTube =
    host === "youtu.be" ||
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com");

  if (!isYouTube) return null;

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && VIDEO_ID_RE.test(id) ? id : null;
  }

  const queryId = url.searchParams.get("v");
  if (queryId && VIDEO_ID_RE.test(queryId)) return queryId;

  const parts = url.pathname.split("/").filter(Boolean);
  const pathPrefixes = new Set(["shorts", "embed", "live", "v", "e"]);
  if (parts.length >= 2 && pathPrefixes.has(parts[0])) {
    const id = parts[1];
    if (VIDEO_ID_RE.test(id)) return id;
  }

  return null;
}

function pickThumbnail(videoId: string, thumbnails: { url?: string; width?: number }[] | undefined): string {
  const fallback = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  if (!thumbnails?.length) return fallback;

  const sorted = [...thumbnails]
    .filter((item) => Boolean(item.url))
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));

  return sorted[0]?.url ?? fallback;
}

type VideoInfo = Awaited<ReturnType<Innertube["getInfo"]>>;
type ClientName = "VISIONOS" | "MWEB" | "IOS" | "ANDROID_VR";

const FALLBACK_CLIENTS: ClientName[] = ["IOS", "ANDROID_VR"];

function isBotCheck(info: VideoInfo): boolean {
  // The reason text is localized (lang: "vi"), so rely on the status instead.
  return info.playability_status?.status === "LOGIN_REQUIRED";
}

function isPlayable(info: VideoInfo): boolean {
  return info.playability_status?.status === "OK";
}

function hasAudioFormats(info: VideoInfo): boolean {
  return (info.streaming_data?.adaptive_formats ?? []).some(
    (format) => format.has_audio && !format.has_video,
  );
}

function requestInfo(
  yt: Innertube,
  videoId: string,
  client: ClientName,
  poToken: string | null,
): Promise<VideoInfo> {
  return yt.getInfo(videoId, {
    client,
    ...(poToken ? { po_token: poToken } : {}),
  });
}

async function tryRequest(
  yt: Innertube,
  videoId: string,
  client: ClientName,
  poToken: string | null,
): Promise<VideoInfo | null> {
  try {
    return await requestInfo(yt, videoId, client, poToken);
  } catch (error) {
    console.warn("[youtube] getInfo failed", videoId, client, error);
    return null;
  }
}

async function fetchWithPoToken(
  yt: Innertube,
  videoId: string,
): Promise<{ info: VideoInfo; token: string | null }> {
  // VISIONOS doesn't need a PO token and, with a real visitor id, returns
  // media URLs where every byte range is readable. That is what allows long
  // videos to download; the web/mobile clients cap streams at ~1 MiB.
  const visionos = await tryRequest(yt, videoId, "VISIONOS", null);
  if (visionos && isPlayable(visionos) && hasAudioFormats(visionos)) {
    return { info: visionos, token: null };
  }

  let token = await getPoToken(videoId);
  let info = await tryRequest(yt, videoId, "MWEB", token);

  if (info && (isPlayable(info) || !isBotCheck(info))) {
    return { info, token };
  }

  // A Web PO token may not be enough on flagged (datacenter) IPs. Generate a
  // fresh token once, then fall back to clients that don't use Web tokens.
  if (token) {
    console.warn("[youtube] bot check detected, refreshing PO token", videoId);
    resetPoTokenProvider();
    token = await getPoToken(videoId);

    if (token) {
      const retry = await tryRequest(yt, videoId, "MWEB", token);
      if (retry && (isPlayable(retry) || !isBotCheck(retry))) {
        return { info: retry, token };
      }
      info = retry ?? info;
    }
  }

  for (const client of FALLBACK_CLIENTS) {
    const fallback = await tryRequest(yt, videoId, client, null);
    if (fallback && isPlayable(fallback) && hasAudioFormats(fallback)) {
      console.info("[youtube] using fallback client", videoId, client);
      return { info: fallback, token: null };
    }
    if (fallback && !isBotCheck(fallback)) {
      info = fallback;
    }
  }

  if (info) {
    return { info, token };
  }

  if (visionos) {
    return { info: visionos, token: null };
  }

  throw new ResolveError("Không thể đọc thông tin video này. Vui lòng thử lại.", 502);
}

function remember(videoId: string, entry: ResolvedTrack) {
  cache.delete(videoId);
  cache.set(videoId, entry);

  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export async function resolveTrack(
  videoId: string,
  options: { force?: boolean } = {},
): Promise<ResolvedTrack & { fromCache: boolean }> {
  if (!isVideoId(videoId)) {
    throw new ResolveError("ID video không hợp lệ.", 400);
  }

  if (!options.force) {
    const cached = cache.get(videoId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return { ...cached, fromCache: true };
    }
  }

  const yt = await getInnertube();

  let resolvedYoutube: Awaited<ReturnType<typeof fetchWithPoToken>> | null = null;

  try {
    resolvedYoutube = await fetchWithPoToken(yt, videoId);
  } catch (error) {
    console.warn("[youtube] all request strategies failed", videoId, error);
  }

  const youtubeStatus = resolvedYoutube?.info.playability_status?.status;
  const youtubeFormats = (
    resolvedYoutube?.info.streaming_data?.adaptive_formats ?? []
  ).filter((format) => format.has_audio && !format.has_video);

  if (!resolvedYoutube || youtubeStatus !== "OK" || youtubeFormats.length === 0) {
    console.warn(
      "[youtube] youtubei.js is unavailable, trying Invidious",
      videoId,
      youtubeStatus,
      youtubeFormats.length,
    );

    const invidious = await resolveInvidiousTrack(videoId);

    if (invidious) {
      const entry: ResolvedTrack = {
        info: invidious.info,
        url: invidious.url,
        cachedAt: Date.now(),
      };
      remember(videoId, entry);
      return { ...entry, fromCache: false };
    }

    if (resolvedYoutube && youtubeStatus !== "OK") {
      const reason = resolvedYoutube.info.playability_status?.reason;
      if (reason) throw new ResolveError(reason, 422);
    }

    if (resolvedYoutube) {
      throw new ResolveError(
        "Không tìm thấy luồng âm thanh cho video này. Có thể video đang bị giới hạn.",
        422,
      );
    }

    throw new ResolveError(
      "Không thể đọc thông tin video này. Vui lòng thử lại.",
      502,
    );
  }

  const poToken = resolvedYoutube;

  const info = poToken.info;
  const contentPoToken = poToken.token;

  const status = info.playability_status?.status;
  if (status !== "OK") {
    const reason =
      info.playability_status?.reason ??
      "Video không khả dụng, bị giới hạn hoặc yêu cầu đăng nhập.";
    throw new ResolveError(reason, 422);
  }

  const formats = (info.streaming_data?.adaptive_formats ?? []).filter(
    (format) => format.has_audio && !format.has_video,
  );

  if (formats.length === 0) {
    throw new ResolveError(
      "Không tìm thấy luồng âm thanh cho video này. Có thể video đang bị giới hạn.",
      422,
    );
  }

  const score = (format: (typeof formats)[number]) => {
    const isMp4 = format.mime_type.includes("mp4") ? 1000 : 0;
    return isMp4 + (Number(format.bitrate) || 0) / 1000;
  };

  formats.sort((a, b) => score(b) - score(a));
  const chosen = formats[0];

  let mediaUrl = "";
  try {
    // Always run the player decipher step: even when a URL is already present
    // YouTube may include an encoded `n` parameter that causes a 403 otherwise.
    mediaUrl = await chosen.decipher(yt.session.player);
  } catch (error) {
    console.error("[youtube] decipher failed", videoId, error);
  }

  if (!mediaUrl) mediaUrl = chosen.url ?? "";

  if (mediaUrl && contentPoToken) {
    try {
      const streamUrl = new URL(mediaUrl);
      if (!streamUrl.searchParams.has("pot")) {
        streamUrl.searchParams.set("pot", contentPoToken);
        mediaUrl = streamUrl.toString();
      }
    } catch {
      // Keep the original URL if it cannot be parsed.
    }
  }

  if (!mediaUrl) {
    throw new ResolveError("Không lấy được liên kết âm thanh từ YouTube. Vui lòng thử lại.", 502);
  }

  const info2: TrackInfo = {
    videoId,
    title: info.basic_info.title?.trim() || "Không có tiêu đề",
    author:
      info.basic_info.author?.trim() ||
      info.basic_info.channel?.name?.trim() ||
      "YouTube",
    duration: Number(info.basic_info.duration) || 0,
    thumbnail: pickThumbnail(videoId, info.basic_info.thumbnail),
    mimeType: chosen.mime_type || "audio/mp4",
    bitrate: Number(chosen.bitrate) || 0,
    sizeBytes: Number(chosen.content_length) || 0,
    sourceFormat: chosen.mime_type.includes("webm") || chosen.mime_type.includes("opus") ? "opus" : "aac",
  };

  const entry: ResolvedTrack = {
    info: info2,
    url: mediaUrl,
    cachedAt: Date.now(),
  };

  remember(videoId, entry);

  return { ...entry, fromCache: false };
}
