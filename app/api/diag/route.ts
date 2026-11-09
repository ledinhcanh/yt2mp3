import { Innertube, Platform } from "youtubei.js";
import { getPoToken } from "@/lib/potoken";

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
      if (!response.ok) return null;
      const html = await response.text();
      const match =
        /"visitorData":"([^"]+)"/.exec(html) ??
        /VISITOR_DATA":"([^"]+)"/.exec(html);
      return match?.[1] ?? null;
    }),
  );

  return (
    results
      .map((result) => (result.status === "fulfilled" ? result.value : null))
      .find((value) => value) ?? null
  );
}

type ClientSpec = { name: string; token?: string | null };

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
    report.visitor = visitor ? `${visitor.slice(0, 12)}...` : null;

    const yt = await Innertube.create({
      retrieve_player: true,
      generate_session_locally: !visitor,
      enable_session_cache: false,
      lang: "vi",
      location: "VN",
      ...(visitor ? { visitor_data: visitor } : {}),
    });

    let webToken: string | null = null;
    const tokenStarted = Date.now();
    try {
      webToken = await getPoToken(id);
    } catch (error) {
      report.tokenError = String(error);
    }
    report.tokenMs = Date.now() - tokenStarted;
    report.token = webToken ? "yes" : null;

    const clients: ClientSpec[] = [
      { name: "VISIONOS" },
      { name: "MWEB", token: webToken },
      { name: "WEB", token: webToken },
      { name: "TV" },
      { name: "TV_SIMPLY" },
      { name: "TV_EMBEDDED" },
      { name: "WEB_EMBEDDED" },
      { name: "IOS" },
      { name: "ANDROID_VR" },
    ];

    const results: Record<string, unknown>[] = [];
    for (const client of clients) {
      const clientStarted = Date.now();
      const entry: Record<string, unknown> = { client: client.name };
      try {
        const info = await yt.getInfo(id, {
          client: client.name as never,
          ...(client.token ? { po_token: client.token } : {}),
        });
        const formats = (info.streaming_data?.adaptive_formats ?? []).filter(
          (format) => format.has_audio && !format.has_video,
        );
        entry.status = info.playability_status?.status;
        entry.formats = formats.length;
        formats.sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
        const chosen = formats[0];
        if (chosen) {
          entry.mime = chosen.mime_type;
          entry.size = chosen.content_length;
        }
        if (chosen && !report.probe) {
          let url = "";
          try {
            url = await chosen.decipher(yt.session.player);
          } catch {}
          if (!url) url = chosen.url ?? "";
          if (url) {
            const parsed = new URL(url);
            const offset = 1024 * 1024 + 1;
            const probeStarted = Date.now();
            const response = await fetch(url, {
              headers: { Range: `bytes=${offset}-${offset + 1}` },
              cache: "no-store",
              signal: AbortSignal.timeout(15_000),
            });
            report.probe = {
              client: client.name,
              host: parsed.host,
              n: parsed.searchParams.get("n"),
              pot: parsed.searchParams.has("pot"),
              status: response.status,
              ms: Date.now() - probeStarted,
            };
            await response.body?.cancel().catch(() => undefined);
          }
        }
      } catch (error) {
        entry.status = "ERROR";
        entry.error = String(error).slice(0, 160);
      }
      entry.ms = Date.now() - clientStarted;
      results.push(entry);
    }

    report.clients = results;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }

  report.totalMs = Date.now() - started;
  return Response.json(report);
}
