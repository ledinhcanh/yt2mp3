"use client";

import { useMemo, useState } from "react";
import { SITE } from "@/lib/site";

const YOUTUBE_URL_RE =
  /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com\/(watch\?.*v=|shorts\/|live\/|embed\/)|youtu\.be\/)/i;

function isYouTubeUrl(value: string): boolean {
  return YOUTUBE_URL_RE.test(value.trim());
}

type Track = {
  videoId: string;
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
  mimeType: string;
  bitrate: number;
  sizeBytes: number;
  sourceFormat: "aac" | "opus";
};

const BITRATES = [128, 192, 320] as const;
type Bitrate = (typeof BITRATES)[number];

type Phase = "idle" | "loading" | "ready" | "working";

type Progress = { label: string; percent: number } | null;

function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "--:--";

  const total = Math.round(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";

  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.slice(0, 120) || "audio";
}

const AUDIO_CHUNK_SIZE = 1024 * 1024;
const AUDIO_CONCURRENCY = 5;

async function readErrorMessage(response: Response): Promise<string> {
  let message = `Không tải được âm thanh (${response.status}).`;

  try {
    const data = (await response.json()) as { error?: string };
    if (data?.error) message = data.error;
  } catch {
    // ignore non-JSON responses
  }

  return message;
}

async function fetchAudio(
  videoId: string,
  expectedBytes: number,
  onProgress: (percent: number) => void,
): Promise<Uint8Array> {
  const audioUrl = `/api/audio?id=${encodeURIComponent(videoId)}`;
  const total = Number.isFinite(expectedBytes) && expectedBytes > 0 ? expectedBytes : 0;

  if (total === 0) {
    const response = await fetch(audioUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(await readErrorMessage(response));

    const buffer = await response.arrayBuffer();
    onProgress(100);
    return new Uint8Array(buffer);
  }

  const chunkCount = Math.ceil(total / AUDIO_CHUNK_SIZE);
  const parts = new Array<Uint8Array | null>(chunkCount).fill(null);
  let received = 0;
  let streamTotal = total;
  let failed: unknown = null;
  let ended = false;
  let nextIndex = 0;

  const fetchChunk = async (index: number) => {
    const start = index * AUDIO_CHUNK_SIZE;
    const end = Math.min(start + AUDIO_CHUNK_SIZE, streamTotal) - 1;

    const response = await fetch(audioUrl, {
      cache: "no-store",
      headers: { Range: `bytes=${start}-${end}` },
    });

    if (response.status === 416) {
      ended = true;
      return;
    }

    if (!response.ok) throw new Error(await readErrorMessage(response));

    // Trust the real stream size reported by the CDN, which can differ by a
    // few bytes from the size returned by the metadata endpoint.
    const contentRange = response.headers.get("content-range");
    const totalMatch = contentRange ? /\/(\d+)\s*$/.exec(contentRange) : null;
    if (totalMatch) {
      streamTotal = Number(totalMatch[1]);
      if (streamTotal < start) {
        ended = true;
        return;
      }
    }

    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length === 0) {
      ended = true;
      return;
    }

    parts[index] = data;
    received += data.length;
    onProgress(streamTotal > 0 ? Math.min(99, (received / streamTotal) * 100) : 99);
  };

  const workers = Array.from(
    { length: Math.min(AUDIO_CONCURRENCY, chunkCount) },
    async () => {
      for (let index = nextIndex++; index < chunkCount && !failed && !ended; index = nextIndex++) {
        try {
          await fetchChunk(index);
        } catch (error) {
          failed = error;
        }
      }
    },
  );

  await Promise.all(workers);

  if (failed) throw failed;

  const valid = parts.filter((part): part is Uint8Array => part !== null);
  const output = new Uint8Array(valid.reduce((sum, part) => sum + part.length, 0));
  let position = 0;

  for (const part of valid) {
    output.set(part, position);
    position += part.length;
  }

  onProgress(100);
  return output;
}

async function decodeAudio(bytes: Uint8Array): Promise<AudioBuffer> {
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioCtx) {
    throw new Error("Trình duyệt của bạn không hỗ trợ Web Audio API.");
  }

  const context = new AudioCtx();

  try {
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return await context.decodeAudioData(buffer);
  } finally {
    await context.close().catch(() => undefined);
  }
}

let mp3Worker: Worker | null = null;
let rejectActiveEncode: ((error: Error) => void) | null = null;
let encodeJobId = 0;

function getMp3Worker(): Worker {
  if (mp3Worker) return mp3Worker;

  mp3Worker = new Worker(new URL("./mp3-encoder.worker.ts", import.meta.url));
  mp3Worker.onerror = () => {
    rejectActiveEncode?.(new Error("Trình duyệt không thể chạy bộ mã hoá âm thanh."));
    rejectActiveEncode = null;
  };

  return mp3Worker;
}

function encodeMp3InWorker(
  buffer: AudioBuffer,
  bitrate: number,
  onProgress: (percent: number) => void,
): Promise<Blob> {
  const worker = getMp3Worker();
  const id = ++encodeJobId;

  const channelBuffers: ArrayBuffer[] = [];
  for (let i = 0; i < Math.min(2, buffer.numberOfChannels); i += 1) {
    channelBuffers.push(buffer.getChannelData(i).buffer);
  }

  return new Promise<Blob>((resolve, reject) => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as {
        id?: number;
        type?: string;
        percent?: number;
        buffer?: ArrayBuffer;
        message?: string;
      };

      if (!data || data.id !== id) return;

      if (data.type === "progress" && typeof data.percent === "number") {
        onProgress(data.percent);
        return;
      }

      worker.removeEventListener("message", handleMessage);
      if (rejectActiveEncode === reject) rejectActiveEncode = null;

      if (data.type === "done" && data.buffer) {
        resolve(new Blob([data.buffer], { type: "audio/mpeg" }));
      } else {
        reject(new Error(data.message || "Không thể mã hoá MP3."));
      }
    };

    rejectActiveEncode = reject;
    worker.addEventListener("message", handleMessage);
    worker.postMessage(
      { id, sampleRate: buffer.sampleRate, bitrate, channels: channelBuffers },
      channelBuffers,
    );
  });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function Downloader() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [track, setTrack] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bitrate, setBitrate] = useState<Bitrate>(192);
  const [progress, setProgress] = useState<Progress>(null);

  const busy = phase === "loading" || phase === "working";

  const estimatedSize = useMemo(() => {
    if (!track) return 0;
    return Math.round(track.duration * bitrate * 125);
  }, [track, bitrate]);

  const tooLongForMp3 = Boolean(
    track && track.duration > SITE.maxMp3DurationSeconds,
  );

  async function convert(value: string) {
    if (busy) return;

    const trimmed = value.trim();

    if (!trimmed) {
      setError("Hãy dán link YouTube trước nhé.");
      return;
    }

    setError(null);
    setTrack(null);
    setProgress(null);
    setPhase("loading");

    try {
      const response = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; track?: Track }
        | null;

      if (!response.ok || !data?.ok || !data.track) {
        throw new Error(data?.error || "Không thể xử lý link này. Vui lòng thử lại.");
      }

      setTrack(data.track);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra. Vui lòng thử lại.");
      setPhase("idle");
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void convert(url);
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();

      if (text) {
        const trimmed = text.trim();
        setUrl(trimmed);
        setError(null);

        if (isYouTubeUrl(trimmed)) void convert(trimmed);
      }
    } catch {
      setError("Trình duyệt không cho phép đọc clipboard. Hãy dán bằng Ctrl + V.");
    }
  }

  async function handleDownloadMp3() {
    if (!track || phase === "working") return;

    if (tooLongForMp3) {
      setError(
        `Video dài ${formatDuration(track.duration)}. Trình duyệt chỉ chuyển MP3 cho video dưới ${SITE.maxMp3DurationLabel} — hãy dùng "Tải bản gốc".`,
      );
      return;
    }

    setError(null);
    setPhase("working");
    setProgress({ label: "Đang tải âm thanh từ YouTube...", percent: 0 });

    try {
      const bytes = await fetchAudio(track.videoId, track.sizeBytes, (percent) => {
        setProgress({
          label: "Đang tải âm thanh từ YouTube...",
          percent: percent * 0.55,
        });
      });

      setProgress({ label: "Đang giải mã âm thanh...", percent: 58 });
      const audioBuffer = await decodeAudio(bytes);

      setProgress({ label: "Đang mã hoá MP3...", percent: 65 });
      const blob = await encodeMp3InWorker(audioBuffer, bitrate, (percent) => {
        setProgress({
          label: "Đang mã hoá MP3...",
          percent: 65 + percent * 0.35,
        });
      });

      triggerDownload(blob, `${sanitizeFilename(track.title)}.mp3`);
      setProgress({ label: "Hoàn tất! File MP3 đã được tải xuống.", percent: 100 });

      window.setTimeout(() => {
        setPhase("ready");
        setProgress(null);
      }, 1400);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} Bạn có thể thử "Tải bản gốc" thay thế.`
          : "Không thể tạo file MP3. Bạn có thể thử tải bản gốc.",
      );
      setPhase("ready");
      setProgress(null);
    }
  }

  async function handleDownloadOriginal() {
    if (!track || phase === "working") return;

    setError(null);
    setPhase("working");
    setProgress({ label: "Đang tải bản gốc...", percent: 0 });

    try {
      const bytes = await fetchAudio(track.videoId, track.sizeBytes, (percent) => {
        setProgress({ label: "Đang tải bản gốc...", percent });
      });

      const extension = track.sourceFormat === "opus" ? "webm" : "m4a";
      const mime = track.sourceFormat === "opus" ? "audio/webm" : "audio/mp4";
      triggerDownload(
        new Blob([bytes as BlobPart], { type: mime }),
        `${sanitizeFilename(track.title)}.${extension}`,
      );

      setProgress({ label: "Hoàn tất! File đã được tải xuống.", percent: 100 });

      window.setTimeout(() => {
        setPhase("ready");
        setProgress(null);
      }, 1400);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Không thể tải bản gốc. Vui lòng thử lại.",
      );
      setPhase("ready");
      setProgress(null);
    }
  }

  return (
    <form className="converter" onSubmit={handleSubmit} noValidate>
      <div className="input-row">
        <div className="input-shell">
          <svg className="input-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M10.6 13.4a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66l-1.42 1.42"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M13.4 10.6a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 0 0 5.66 5.66l1.42-1.42"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>

          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text/plain");
              if (!text) return;

              event.preventDefault();
              const trimmed = text.trim();
              setUrl(trimmed);

              if (isYouTubeUrl(trimmed)) void convert(trimmed);
            }}
            placeholder="Dán link YouTube, ví dụ: https://youtu.be/dQw4w9WgXcQ"
            aria-label="Link YouTube"
            disabled={phase === "working"}
          />

          <button
            type="button"
            className="paste-btn"
            onClick={handlePaste}
            disabled={phase === "working"}
          >
            Dán
          </button>
        </div>

        <button type="submit" className="btn btn-primary btn-convert" disabled={busy}>
          {phase === "loading" ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Đang xử lý
            </>
          ) : (
            "Chuyển đổi"
          )}
        </button>
      </div>

      <p className="input-hint">
        Hỗ trợ youtube.com, youtu.be, YouTube Shorts và YouTube Music. Dán link là tự động chuyển
        đổi ngay.
      </p>

      {error && (
        <div className="alert" role="alert">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 7.5v5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="16.5" r="1" fill="currentColor" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {phase === "loading" && (
        <div className="result skeleton" aria-hidden="true">
          <div className="track">
            <div className="thumb shimmer" />
            <div className="track-body">
              <div className="shimmer line w40" />
              <div className="shimmer line w90" />
              <div className="shimmer line w60" />
              <div className="shimmer line w30" />
            </div>
          </div>
        </div>
      )}

      {track && (
        <div className="result">
          <div className="track">
            <div className="thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={track.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
              <span className="thumb-badge">{formatDuration(track.duration)}</span>
            </div>

            <div className="track-body">
              <div className="track-top">
                <span className="chip chip-ready">
                  <span className="dot" /> Sẵn sàng
                </span>
                <span className="track-meta">
                  {track.sourceFormat.toUpperCase()} · {Math.round(track.bitrate / 1000)} kbps nguồn
                </span>
              </div>

              <h2 className="track-title" title={track.title}>
                {track.title}
              </h2>
              <p className="track-author">{track.author}</p>

              <div className="quality">
                <span className="quality-label">Chất lượng MP3</span>
                <div className="quality-options">
                  {BITRATES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`q-pill${bitrate === value ? " active" : ""}`}
                      onClick={() => setBitrate(value)}
                      disabled={phase === "working"}
                    >
                      {value} kbps
                    </button>
                  ))}
                </div>
                <span className="quality-size">≈ {formatSize(estimatedSize)}</span>
              </div>

              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleDownloadMp3}
                  disabled={phase === "working"}
                >
                  {phase === "working" ? (
                    <>
                      <span className="spinner" aria-hidden="true" />
                      Đang xử lý
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Tải MP3
                    </>
                  )}
                </button>

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleDownloadOriginal}
                  disabled={phase === "working"}
                >
                  Tải bản gốc ({track.sourceFormat === "opus" ? "WebM" : "M4A"})
                </button>
              </div>

              {progress && (
                <div className="progress" role="status" aria-live="polite">
                  <div className="bar">
                    <span style={{ width: `${Math.max(2, Math.min(100, progress.percent))}%` }} />
                  </div>
                  <div className="progress-meta">
                    <span>{progress.label}</span>
                    <span>{Math.round(Math.min(100, progress.percent))}%</span>
                  </div>
                </div>
              )}

              {tooLongForMp3 && !progress && (
                <p className="quality-note warn">
                  Video dài hơn {SITE.maxMp3DurationLabel}: trình duyệt có thể hết bộ nhớ khi mã hoá
                  MP3. Nên dùng “Tải bản gốc”.
                </p>
              )}

              <p className="quality-note">
                Nguồn âm thanh gốc của YouTube thường chỉ ~128–160 kbps. Bitrate cao hơn giúp giữ
                nguyên chất lượng khi biên tập, không tạo thêm chi tiết.
              </p>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
