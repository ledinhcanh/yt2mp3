import { Innertube, Platform } from "youtubei.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PAGES = [
  "https://www.youtube.com/",
  "https://m.youtube.com/",
  "https://www.youtube.com/embed/dQw4w9WgXcQ",
];

async function getVisitorData(): Promise<string | null> {
  const results = await Promise.allSettled(
    PAGES.map(async (page) => {
      const response = await fetch(page, {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: "CONSENT=YES+cb; SOCS=CAI",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return { status: response.status, visitor: null };
      const html = await response.text();
      const match =
        /"visitorData":"([^"]+)"/.exec(html) ??
        /VISITOR_DATA":"([^"]+)"/.exec(html);
      return { status: response.status, visitor: match?.[1] ?? null };
    }),
  );

  return results
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .find((value) => value?.visitor)?.visitor ?? null;
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "dQw4w9WgXcQ";
  const started = Date.now();
  const report: Record<string, unknown> = {
    id,
    vercelId: request.headers.get("x-vercel-id"),
    forwardedFor: request.headers.get("x-forwarded-for"),
  };

  try {
    Platform.shim.eval = async (data) => new Function(data.output)();

    const visitor = await getVisitorData();
    report.visitorMs = Date.now() - started;
    report.visitor = visitor ? `${visitor.slice(0, 12)}...` : null;

    const createStarted = Date.now();
    const yt = await Innertube.create({
      retrieve_player: true,
      generate_session_locally: !visitor,
      enable_session_cache: false,
      lang: "vi",
      location: "VN",
      ...(visitor ? { visitor_data: visitor } : {}),
    });
    report.createMs = Date.now() - createStarted;

    const infoStarted = Date.now();
    const info = await yt.getInfo(id, { client: "VISIONOS" });
    report.infoMs = Date.now() - infoStarted;
    report.playability = info.playability_status?.status;
    report.reason = info.playability_status?.reason ?? null;

    const formats = (info.streaming_data?.adaptive_formats ?? []).filter(
      (format) => format.has_audio && !format.has_video,
    );
    report.audioFormats = formats.length;
    formats.sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
    const chosen = formats[0];

    if (!chosen) {
      return Response.json(report);
    }

    report.mime = chosen.mime_type;
    report.bitrate = chosen.bitrate;
    report.contentLength = chosen.content_length;

    let url = "";
    try {
      url = await chosen.decipher(yt.session.player);
    } catch (error) {
      report.decipherError = String(error);
    }
    if (!url) url = chosen.url ?? "";
    report.hasUrl = Boolean(url);

    const parsed = new URL(url);
    report.host = parsed.host;
    report.n = parsed.searchParams.get("n");
    report.pot = parsed.searchParams.has("pot");
    report.ip = parsed.searchParams.get("ip");
    report.c = parsed.searchParams.get("c");

    const offset = 1024 * 1024 + 1;
    const probeStarted = Date.now();
    const response = await fetch(url, {
      headers: { Range: `bytes=${offset}-${offset + 1}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    report.probeMs = Date.now() - probeStarted;
    report.probeStatus = response.status;
    report.probeRange = response.headers.get("content-range");
    await response.body?.cancel().catch(() => undefined);
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }

  report.totalMs = Date.now() - started;
  return Response.json(report);
}
