# ARCHITECTURE — Kiến trúc & luồng xử lý YT2MP3

> Tài liệu kỹ thuật dành cho người maintainer. Tài liệu người dùng (cài đặt, deploy) xem `README.md`.
> Cập nhật lần cuối: 2026-11-02 (sau khi thêm dark mode, auto-convert, WASM worker).

## 1. Tổng quan

Web app chuyển video YouTube thành MP3. Nguyên tắc thiết kế:

- **Server chỉ làm proxy/metadata** — không ffmpeg, không lưu file âm thanh.
- **Client làm nặng**: tải âm thanh, giải mã PCM, mã hoá MP3 (WASM trong Web Worker).
- Không database, không API key, không state ngoài RAM (cache in-memory).

Stack: Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · CSS thuần (không UI framework).

## 2. Cấu trúc source

```
app/
  layout.tsx                  # Metadata, script khởi tạo theme chống FOUC
  page.tsx                    # Landing page (server component) + header có ThemeToggle
  globals.css                 # Toàn bộ style; biến màu 2 theme :root (sáng) / html.dark (tối)
  icon.svg
  api/info/route.ts           # POST: link → TrackInfo (metadata + độ dài + dung lượng)
  api/audio/route.ts          # GET: proxy stream âm thanh từ CDN YouTube (hỗ trợ Range)
components/
  Downloader.tsx              # Client component trung tâm: form, tải song song, decode, gọi worker
  ThemeToggle.tsx             # Nút bật tắt sáng/tối (icon mặt trời/mặt trăng)
  mp3-encoder.worker.ts       # Web Worker mã hoá MP3 bằng LAME WASM
  mp3-tags.ts                 # Cắt ID3v2/ID3v1/Lyrics3/APEv2 khỏi MP3 vừa encode
  mp4-segments.ts             # Tách fMP4 thành segment giải mã được (video dài)
lib/
  youtube.ts                  # Parse link, resolve qua youtubei.js + cache + fallback client
  potoken.ts                  # Mint PO token bằng BotGuard (bgutils-js + jsdom)
  invidious.ts                # Phương án dự phòng cuối: Invidious API
  site.ts                     # Cấu hình: tên site, giới hạn 15 phút cho MP3
```

## 3. Luồng xử lý tổng thể

### Luồng 1 — Dán link (tự động chuyển đổi)

```
User dán link (Ctrl+V hoặc nút "Dán")
  │  Downloader.tsx: onPaste → isYouTubeUrl() kiểm regex
  │     ✔ đúng link YouTube → setUrl + gọi convert() ngay (không cần bấm nút)
  │     ✘ link lạ            → chỉ điền vào ô input, đợi user bấm "Chuyển đổi"
  ▼
POST /api/info  { url }
  │  route.ts: extractVideoId() → chỉ nhận videoId 11 ký tự [A-Za-z0-9_-]
  ▼
resolveTrack(videoId)          (lib/youtube.ts)
  │  1. Cache hit (TTL 5 phút)? → trả ngay
  │  2. getPoToken(videoId)     (lib/potoken.ts, xem mục 4.2)
  │  3. getInfo client "MWEB" + po_token
  │  4. Nếu bot check (LOGIN_REQUIRED):
  │       reset minter → mint token mới → thử MWEB lần 2
  │       → fallback client "ANDROID_VR" → "IOS" (không cần token)
  │  5. Vẫn thất bại → resolveInvidiousTrack() (lib/invidious.ts)
  │  6. Chọn format audio tốt nhất (ưu tiên mp4/aac, rồi bitrate cao nhất)
  │  7. chosen.decipher(player) — LUÔN chạy để giải tham số `n` (tránh 403)
  │  8. Gắn `pot=<contentPoToken>` vào URL stream nếu chưa có
  │  9. Lưu cache, trả { info, url }
  ▼
Response { ok, track: TrackInfo }
  ▼
Client: setTrack + phase "ready" → hiện card kết quả (thumbnail, bitrate pills, nút tải)
```

TrackInfo trả về client:

| Trường | Ý nghĩa |
|---|---|
| `videoId`, `title`, `author`, `duration`, `thumbnail` | Hiển thị card |
| `mimeType`, `bitrate`, `sizeBytes` | Dùng để chia chunk tải + tính dung lượng MP3 ước lượng |
| `sourceFormat` | `"aac"` hoặc `"opus"` — quyết định đuôi file bản gốc (m4a/webm) và warn Safari |

### Luồng 2 — Tải MP3 (nút "Tải MP3")

```
handleDownloadMp3()
  │  Chặn trước: duration > 15 phút (SITE.maxMp3DurationSeconds) → chỉ cho "Tải bản gốc"
  ▼
BƯỚC 1. fetchAudio()  — tiến trình 0% → 55%
  │  Chia file thành các chunk 1 MB (AUDIO_CHUNK_SIZE)
  │  Tải SONG SONG 5 chunk cùng lúc (AUDIO_CONCURRENCY) qua GET /api/audio
  │  Mỗi request gửi Range: bytes=<start>-<end>
  │  Xử lý: 416 (hết stream) → dừng · content-range → cập nhật tổng thật
  │         rỗng → dừng · lỗi → huỷ toàn bộ, ném lỗi đầu tiên
  │  Ghép các chunk theo đúng thứ tự index
  ▼
GET /api/audio?id=...  (server, mỗi chunk một request)
  │  resolveTrack(id) — gần như luôn cache hit (map lookup)
  │  fetch CDN googlevideo kèm Range (Range bắt buộc — không Range bị YouTube
  │  bóp còn ~30 KB/s; có Range thì full speed)
  │  CDN trả 403/410 (URL hết hạn) → resolveTrack(force) 1 lần rồi thử lại
  │  Stream body về client (206 + Content-Range)
  ▼
BƯỚC 2. decodeAudioData()  — 55% → 58%
  │  Web Audio API giải mã AAC/Opus → AudioBuffer (PCM float32)
  │  ⚠ Khâu duy nhất còn chặn main thread nhẹ (~0.9s với bài 3:33)
  ▼
BƯỚC 3. encodeMp3InWorker()  — 58% → 100% (65% + percent*0.35)
  │  Lấy channel data (tối đa 2 kênh), POST sang worker kèm transferable
  │  (ArrayBuffer bị detach sau khi transfer — không copy)
  │  Worker: LAME WASM encode theo block 1152×32 frame, postMessage tiến trình
  │  → main thread hoàn toàn mượt trong lúc encode
  │  Worker trả ArrayBuffer MP3 (transferable ngược lại)
  ▼
triggerDownload(blob, "<tên đã sanitize>.mp3")
```

### Luồng 3 — Tải bản gốc (M4A/WebM)

Giống luồng 2 nhưng **bỏ bước 2–3**: bytes gốc từ CDN được ghép và tải nguyên trạng.
Ưu tiên dùng khi: video dài > 15 phút, Safari không decode được Opus, hoặc muốn giữ
chất lượng nguồn không mất qua re-encode.

## 4. Chi tiết từng module

### 4.1. `lib/youtube.ts` — resolve metadata

- `extractVideoId()`: nhận videoId trần, `youtube.com/watch?v=`, `youtu.be/<id>`,
  `/shorts/`, `/embed/`, `/live/`, `/v/`, `/e/`, mọi sub-domain `*.youtube.com`, `youtube-nocookie.com`.
- Thứ tự thử client (hằng số `FALLBACK_CLIENTS`):

  | Thứ tự | Client | PO token |
  |---|---|---|
  | 1 | `MWEB` | Có (web PO token) |
  | 2 | `MWEB` (sau khi refresh token) | Token mới |
  | 3 | `ANDROID_VR` | Không |
  | 4 | `IOS` | Không |
  | 5 | Invidious (mọi instance) | — |

- Bot check được phát hiện bằng `playability_status === "LOGIN_REQUIRED"`
  (không so text vì text đã bản dịch tiếng Việt).
- Chấm điểm format: `mp4 ? 1000 : 0 + bitrate/1000` → ưu tiên AAC mp4, bitrate cao nhất.
- Innertube instance là singleton (`innertubePromise`), tạo 1 lần với
  `lang: "vi"`, `location: "VN"`, `retrieve_player: true`, `enable_session_cache: false`.
  Nếu tạo lỗi sẽ tự xoá promise để lần sau thử lại.

### 4.2. `lib/potoken.ts` — mint PO token (BotGuard)

Mục đích: giảm lỗi "Sign in to confirm you're not a bot" khi chạy trên IP datacenter (Vercel...).

Cơ chế:

1. `getChallenge()` (bgutils-js) lấy challenge từ Google.
2. Chạy interpreter JavaScript của BotGuard **bên trong jsdom** (`runScripts: "outside-only"`)
   — chủ ý để VM không rò rỉ `window`/`document` ra global của server Next.js.
3. `snapshot()` → POST `GenerateIT` lấy integrity token → tạo **minter** (hàm mint token).
4. `minter.mint(videoId)` → web PO token (base64url) gắn với từng video.

Cache & vòng đời:

| Đối tượng | TTL | Giới hạn |
|---|---|---|
| PO token theo video | 6 giờ | 200 entry (LRU) |
| Minter (VM BotGuard) | 9 giờ | 1 instance, tái dùng |
| Mint request | — | Tuần tự qua `mintQueue` (tránh race khi nhiều request cùng lúc) |

`resetPoTokenProvider()`: xoá minter + toàn bộ token cache — được gọi khi phát hiện bot check
để mint lại từ đầu.

### 4.3. `lib/invidious.ts` — dự phòng cuối

- Chỉ chạy khi youtubei.js thất bại hoàn toàn (lỗi network, bot check không qua được).
- Danh sách instance: biến môi trường `INVIDIOUS_INSTANCES` (phân tách dấu phẩy)
  + mặc định `https://yt.chocolatemoo53.com`.
- Mỗi instance timeout 12s (`AbortSignal.timeout`); gọi `/api/v1/videos/<id>?local=true`.
- Chọn format: chỉ nhận `type: audio/*` + URL https, ưu tiên mp4 rồi bitrate.
- Trả `null` nếu mọi instance đều lỗi → route trả lỗi 422/502 cho client.

### 4.4. `components/Downloader.tsx` — state machine phía client

Phase: `idle → loading → ready → working → ready` (lỗi quay về `idle`/`ready`).

- **Auto-convert khi paste**: `onPaste` trên input chặn hành vi mặc định, lấy
  `clipboardData.getData("text/plain")`, nếu khớp regex YouTube thì gọi `convert()` luôn.
  Regex nhận: `youtube.com/watch?…v=`, `/shorts/`, `/live/`, `/embed/`, `youtu.be/`
  (có/không `www.` `m.` `music.`, có/không `https://`).
- **fetchAudio song song**: `AUDIO_CHUNK_SIZE = 1 MB`, `AUDIO_CONCURRENCY = 5`.
  Chunk 1 MB để nằm dưới giới hạn response 4.5 MB của Vercel Functions và để
  nhiều request chạy song song không vướng. Việc ghép file giữ thứ tự index chunk,
  độc lập với thời điểm từng request xong.
- **Progress**: tải 0–55% · giải mã 55–65% (58% cố định khi bắt đầu) · encode 65–100%.
- Worker là singleton trong module (tạo 1 lần, tái dùng giữa các lần tải);
  `onerror` của worker sẽ từ chối promise của job đang chạy.
- Chỉ cho phép 1 job encode/tải tại một thời điểm (`phase === "working"` chặn UI).

### 4.5. `components/mp3-encoder.worker.ts` — giao thức worker

Message vào (main → worker):

```ts
{ id: number, sampleRate: number, bitrate: 128|192|320, channels: ArrayBuffer[] }
```

Message ra (worker → main):

| `type` | Trường | Ý nghĩa |
|---|---|---|
| `progress` | `percent` | Gọi mỗi ~16 block, dùng cập nhật progress bar |
| `done` | `buffer` | Uint8Array MP3 hoàn chỉnh (transfer, zero-copy) |
| `error` | `message` | Lỗi encode |

Lưu ý triển khai:

- Dùng `wasm-media-encoders` (LAME biên dịch WASM, WASM nhúng base64 ngay trong JS —
  không cần fetch file `.wasm` riêng, bundler chỉ cần bundle module).
- **Kết quả `encoder.encode()` là view thuộc sở hữu của encoder — phải copy ngay** vào
  buffer đầu ra dạng mở rộng dần (bắt đầu 1–8 MB, nhân đôi khi cần).
- `encoder` được cache trong worker (`encoderPromise`) nên lần encode thứ 2 trở đi
  không phải khởi tạo WASM lại.

### 4.6. Hệ thống theme (sáng/tối)

- Biến màu khai báo 2 lần: `:root` (light) và `html.dark` (dark). Mọi thành phần chỉ
  dùng `var(--...)`, không hardcode màu nền/chữ ngoài biến.
- `app/layout.tsx` chèn script inline chạy **trước khi render** để chống FOUC:
  ưu tiên `localStorage["theme"]` → nếu chưa có thì theo `prefers-color-scheme`
  → mặc định dark nếu không đọc được cả hai.
- `ThemeToggle` là client component: toggle class `dark` trên `<html>`, ghi localStorage.
  Icon render sau khi mount (tránh lệch hydration), đổi icon kèm hiệu ứng xoay.
- `<html suppressHydrationWarning>` vì server render không biết class thật của client.

### 4.7. `components/mp3-tags.ts` — bỏ tag cho đầu xe

Sau khi worker encode xong, `stripMp3Metadata()` cắt mọi thứ không phải frame âm thanh:
ID3v2 (nhiều khối nối tiếp, kể cả footer), ID3v1, Lyrics3v1/v2, APEv2 và phần rác ở đầu file.

- Frame đầu được xác thực bằng **3 frame liên tiếp** cùng sample rate (`parseFrameHeader`),
  nên ID3v2 có size hỏng không bị cắt nhầm vào giữa ảnh bìa — cặp `FF Ex` đơn lẻ xuất hiện
  đầy trong dữ liệu JPEG nên chỉ kiểm tra 1 header là không đủ.
- Không tìm được frame chắc chắn → trả nguyên file, thay vì ghi ra file hỏng.
- Header Xing/Info/LAME nằm **trong** frame đầu nên được giữ nguyên; chỉ byte ngoài frame
  âm thanh mới bị cắt.
- LAME WASM xuất CBR 320 kbps / 44.1 kHz, nên bước này không phải xử lý VBR.

### 4.8. `components/mp4-segments.ts` — giải mã video dài

YouTube trả audio dạng fragmented MP4 (`ftyp`+`moov` rồi nhiều cặp `moof`/`mdat`). Hàm
`splitFragmentedMp4()` gom các fragment thành segment ~4 MB, mỗi segment được ghép lại với
init segment để giải mã độc lập. Nhờ vậy video dài không phải nạp toàn bộ PCM vào RAM một lúc;
trả `null` nếu file không phải fMP4 để caller quay về cách giải mã cả file.

## 5. Bảng cache tổng hợp

| Cache | Nơi | TTL | Size | Nội dung |
|---|---|---|---|---|
| Track đã resolve | `lib/youtube.ts` (Map) | 5 phút | 50 video | info + URL CDN đã decipher |
| PO token | `lib/potoken.ts` (Map) | 6 giờ | 200 video | token gắn từng video |
| Minter BotGuard | `lib/potoken.ts` | 9 giờ | 1 | VM jsdom + callback mint |
| Innertube client | `lib/youtube.ts` | Vô hạn (singleton) | 1 | Session YouTube |
| WASM encoder | worker | Vòng đời worker | 1 | Module WASM đã init |

Không có cache đĩa — restart server là mất (đúng cam kết "không lưu file").

## 6. Xử lý lỗi thường gặp

| Triệu chứng / lỗi | Nguyên nhân | Cách hệ thống tự xử lý |
|---|---|---|
| `LOGIN_REQUIRED` (bot check) | IP datacenter bị YouTube nghi | Mint lại token → thử lại MWEB → ANDROID_VR → IOS → Invidious |
| CDN trả 403/410 khi tải | URL stream hết hạn (vài giờ) hoặc sai chữ ký `n` | `/api/audio` gọi `resolveTrack(force)` rồi thử lại đúng 1 lần |
| Tải chậm ~30 KB/s | Thiếu header `Range` khi gọi CDN | Server luôn gửi Range (kể cả `bytes=0-`) |
| Invidious chậm/lỗi | Instance công cộng quá tải | Đặt `INVIDIOUS_INSTANCES` trỏ tới instance riêng |
| Video > 15 phút | Decode toàn bộ PCM vào RAM client sẽ tràn | Chặn nút "Tải MP3", hiện cảnh báo, hướng dẫn "Tải bản gốc" |
| Safari không decode WebM/Opus | Hạn chế codec của WebKit | Gợi ý dùng "Tải bản gốc" (m4a) |
| Link không hợp lệ | Sai định dạng | 400 kèm hướng dẫn định dạng đúng |
| Video riêng tư/khu vực chặn | Playability không phải OK | 422 kèm `reason` gốc từ YouTube |

## 7. Hiệu năng đã đo (Chrome headless, bài 3:33, 192 kbps)

| Giai đoạn | Trước tối ưu (lamejs JS, tuần tự) | Sau (WASM worker + tải song song) |
|---|---|---|
| Tải âm thanh (~4 MB) | ~1–2s tuần tự | ~1s (5 chunk song song) |
| Giải mã | ~0.9s | ~0.9s |
| Mã hoá MP3 | ~15–25s, **đứng UI** | ~5.9s, **UI mượt** (chạy trong worker) |
| Tổng | ~20s+ | **~8.1s** |

Hướng tối ưu tiếp theo (nếu cần): chuyển cả decode sang worker bằng
`@wasm-audio-decoders` (tiết kiệm ~1s và xoá nốt giật 255ms lúc giải mã).

## 8. Biến môi trường & cấu hình

| Biến | Bắt buộc | Mặc định | Ý nghĩa |
|---|---|---|---|
| `INVIDIOUS_INSTANCES` | Không | 1 instance công cộng | Danh sách instance dự phòng, phân tách dấu phẩy |

Cấu hình trong code:

- `lib/site.ts`: tên thương hiệu, tagline, `maxMp3DurationSeconds` (900 = 15 phút).
- `components/Downloader.tsx`: `BITRATES = [128, 192, 320]`, `AUDIO_CHUNK_SIZE`,
  `AUDIO_CONCURRENCY`, regex `YOUTUBE_URL_RE`.
- `app/globals.css`: toàn bộ màu theo biến 2 theme.
- `lib/youtube.ts`: `CACHE_TTL_MS`, `CACHE_MAX_ENTRIES`, `FALLBACK_CLIENTS`.
- `lib/potoken.ts`: `REQUEST_KEY`, TTL token/minter.

## 9. Ràng buộc khi deploy

- **Vercel Functions**: response tối đa ~4.5 MB → lý do client phải tự chia chunk nhỏ
  và server stream Range. `maxDuration = 60` cho cả 2 route.
- **Node runtime** (`runtime = "nodejs"`): bắt buộc vì `jsdom` + BotGuard không chạy
  trên Edge runtime.
- API route đặt `dynamic = "force-dynamic"` — không được cache ở bất kỳ tầng nào.
- Deploy được: Vercel, Railway, Render, Fly.io (mọi host Node.js). GitHub Pages không chạy được.
