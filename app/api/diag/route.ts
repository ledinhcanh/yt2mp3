import { Innertube, Platform } from "youtubei.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function getVisitorData(): Promise<string | null> {
  const pages = [
    "https://www.youtube.com/",
    "https://m.youtube.com/",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
  ];
  const results = await Promise.allSettled(
    pages.map(async (page) => {
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

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "MFbfeuTjNNY";
  const started = Date.now();
  const report: Record<string, unknown> = {
    id,
    vercelId: request.headers.get("x-vercel-id"),
  };

  try {
    Platform.shim.eval = async (data) => new Function(data.output)();
    const visitor = await getVisitorData();
    report.visitor = visitor ? "yes" : null;

    const variants = [
      { lang: "vi", location: "VN" },
      { lang: "en", location: "US" },
      { lang: "en", location: "HK" },
      { lang: "en", location: "SG" },
      { lang: "en", location: "JP" },
    ];

    const results: Record<string, unknown>[] = [];

    for (const variant of variants) {
      const startedVariant = Date.now();
      const entry: Record<string, unknown> = { ...variant };
      try {
        const yt = await Innertube.create({
          retrieve_player: true,
          generate_session_locally: !visitor,
          enable_session_cache: false,
          lang: variant.lang,
          location: variant.location,
          ...(visitor ? { visitor_data: visitor } : {}),
        });

        for (const client of ["VISIONOS", "IOS", "ANDROID_VR"]) {
          try {
            const info = await yt.getInfo(id, { client: client as never });
            const formats = (info.streaming_data?.adaptive_formats ?? []).filter(
              (format) => format.has_audio && !format.has_video,
            );
            entry[client] = `${info.playability_status?.status}:${formats.length}`;
          } catch (error) {
            entry[client] = `ERR:${String(error).slice(0, 60)}`;
          }
        }
      } catch (error) {
        entry.error = String(error).slice(0, 120);
      }
      entry.ms = Date.now() - startedVariant;
      results.push(entry);
    }

    report.variants = results;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }

  report.totalMs = Date.now() - started;
  return Response.json(report);
}
