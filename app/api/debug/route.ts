import { getPoToken } from "@/lib/potoken";
import { extractVideoId, getInnertube, isVideoId } from "@/lib/youtube";

type Client =
  | "WEB"
  | "MWEB"
  | "ANDROID"
  | "IOS"
  | "ANDROID_VR"
  | "TV"
  | "TV_SIMPLY"
  | "TV_EMBEDDED"
  | "WEB_EMBEDDED"
  | "VISIONOS";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CLIENTS: Client[] = [
  "WEB",
  "MWEB",
  "ANDROID",
  "IOS",
  "ANDROID_VR",
  "TV",
  "TV_SIMPLY",
  "TV_EMBEDDED",
  "WEB_EMBEDDED",
  "VISIONOS",
];

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") || extractVideoId(params.get("url") ?? "");

  if (!id || !isVideoId(id)) {
    return Response.json({ ok: false, error: "ID video khong hop le." }, { status: 400 });
  }

  const onlyClient = params.get("client") as Client | null;
  const clients = onlyClient
    ? CLIENTS.filter((client) => client === onlyClient)
    : CLIENTS;
  const tokenMode = params.get("token") ?? "web";

  const yt = await getInnertube();
  let token: string | null = null;
  let tokenError = "";
  const tokenStarted = Date.now();

  if (tokenMode !== "none") {
    try {
      token = await getPoToken(id);
    } catch (error) {
      tokenError = error instanceof Error ? error.message : String(error);
    }
  }

  const results: unknown[] = [];

  for (const client of clients) {
    const useToken =
      Boolean(token) &&
      (tokenMode === "all" ||
        (tokenMode !== "none" && (client === "WEB" || client === "MWEB")));
    const started = Date.now();

    try {
      const info = await yt.getInfo(id, {
        client,
        ...(useToken ? { po_token: token as string } : {}),
      });
      const formats = info.streaming_data?.adaptive_formats ?? [];
      const audio = formats.filter((format) => format.has_audio && !format.has_video);

      results.push({
        client,
        token: useToken ? token?.length ?? 0 : 0,
        status: info.playability_status?.status ?? null,
        reason: info.playability_status?.reason ?? null,
        formats: formats.length,
        audio: audio.length,
        firstAudio: audio[0]?.mime_type ?? null,
        bitrate: Number(audio[0]?.bitrate) || 0,
        ms: Date.now() - started,
      });
    } catch (error) {
      results.push({
        client,
        token: useToken ? token?.length ?? 0 : 0,
        error: error instanceof Error ? error.message : String(error),
        ms: Date.now() - started,
      });
    }
  }

  return Response.json({
    ok: true,
    id,
    token: token ? token.length : 0,
    tokenError: tokenError || null,
    tokenMs: Date.now() - tokenStarted,
    results,
  });
}
