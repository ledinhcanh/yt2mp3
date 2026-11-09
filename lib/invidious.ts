import type { TrackInfo } from "./youtube";

const DEFAULT_INSTANCES = ["https://yt.chocolatemoo53.com"];
const REQUEST_TIMEOUT_MS = 12_000;

export interface InvidiousTrack {
  info: TrackInfo;
  url: string;
}

interface InvidiousFormat {
  url?: string;
  type?: string;
  bitrate?: number | string;
  clen?: number | string;
  container?: string;
}

interface InvidiousVideo {
  title?: string;
  author?: string;
  lengthSeconds?: number;
  videoThumbnails?: { url?: string; width?: number; height?: number }[];
  adaptiveFormats?: InvidiousFormat[];
  error?: string;
}

function instances(): string[] {
  const configured = (process.env.INVIDIOUS_INSTANCES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set([...configured, ...DEFAULT_INSTANCES])];
}

function pickThumbnail(video: InvidiousVideo): string {
  const thumbnails = video.videoThumbnails ?? [];
  const sorted = [...thumbnails]
    .filter((item) => typeof item.url === "string" && item.url.length > 0)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));

  return sorted[0]?.url ?? "";
}

const RANGE_PROBE_OFFSET = 1024 * 1024 + 1;

/**
 * Several public Invidious instances hand out media URLs that are bound to
 * their own IP (or redirect to googlevideo with a mismatched `ip` parameter),
 * so the URL fails with 403 when a different server fetches it. Probe past the
 * 1 MiB boundary before trusting a URL.
 */
async function isRangeReadable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: {
        Range: `bytes=${RANGE_PROBE_OFFSET}-${RANGE_PROBE_OFFSET + 1}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.status === 206 || response.status === 416;
  } catch (error) {
    console.warn("[invidious] media probe failed", error);
    return false;
  }
}

function isAudioFormat(format: InvidiousFormat): boolean {
  return (
    typeof format.url === "string" &&
    format.url.startsWith("https://") &&
    typeof format.type === "string" &&
    format.type.startsWith("audio/")
  );
}

function scoreFormat(format: InvidiousFormat): number {
  const isMp4 = format.type?.includes("mp4") ? 1_000_000 : 0;
  return isMp4 + (Number(format.bitrate) || 0);
}

async function fetchVideo(instance: string, videoId: string): Promise<InvidiousVideo> {
  const url = `${instance.replace(/\/+$/, "")}/api/v1/videos/${encodeURIComponent(videoId)}?local=true`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "yt2mp3/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = (await response.json()) as InvidiousVideo;

  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

export async function resolveInvidiousTrack(videoId: string): Promise<InvidiousTrack | null> {
  for (const instance of instances()) {
    try {
      const video = await fetchVideo(instance, videoId);
      const formats = (video.adaptiveFormats ?? []).filter(isAudioFormat);

      if (formats.length === 0) {
        console.warn("[invidious] no audio formats", instance, videoId);
        continue;
      }

      formats.sort((a, b) => scoreFormat(b) - scoreFormat(a));
      const chosen = formats[0];
      const type = chosen.type ?? "audio/mp4";
      const title = video.title?.trim() || "Không có tiêu đề";
      const thumbnail = pickThumbnail(video);

      if (!(await isRangeReadable(chosen.url as string))) {
        console.warn("[invidious] media url is not readable", instance, videoId);
        continue;
      }

      const info: TrackInfo = {
        videoId,
        title,
        author: video.author?.trim() || "YouTube",
        duration: Number(video.lengthSeconds) || 0,
        thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        mimeType: type,
        bitrate: Number(chosen.bitrate) || 0,
        sizeBytes: Number(chosen.clen) || 0,
        sourceFormat:
          chosen.container === "webm" || type.includes("opus") ? "opus" : "aac",
      };

      console.info("[invidious] resolved", videoId, instance);

      return { info, url: chosen.url as string };
    } catch (error) {
      console.warn("[invidious] instance failed", instance, videoId, error);
    }
  }

  return null;
}
