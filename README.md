# YT2MP3 — Chuyển video YouTube thành MP3

Web app chuyển video YouTube thành file MP3, chạy hoàn toàn trên trình duyệt của người dùng. Giao diện tiếng Việt, tối ưu cho điện thoại, sẵn sàng deploy lên Vercel.

> Chỉ tải nội dung bạn sở hữu hoặc có quyền sử dụng. Tôn trọng bản quyền và điều khoản của YouTube.

## Tính năng

- Dán link `youtube.com`, `youtu.be`, YouTube Shorts hoặc YouTube Music.
- Xem trước tiêu đề, kênh, thời lượng và ảnh thumbnail.
- Chọn bitrate MP3: `128`, `192`, `320` kbps.
- Mã hoá MP3 **ngay trên trình duyệt** bằng Web Audio API + lamejs (không upload file lên máy chủ).
- Tải kèm bản gốc `M4A` / `WebM` nếu muốn.
- Giao diện dark mode, responsive, không quảng cáo.
- Không cần database, không cần API key.

## Cách hoạt động

```
Trình duyệt
  │  1. POST /api/info  (link YouTube)
  ▼
Next.js API (Node runtime)
  │  - youtubei.js lấy metadata + URL âm thanh
  │  - giải mã chữ ký / tham số `n`
  ▼
Trình duyệt
  │  2. GET /api/audio?id=... (theo từng chunk 3 MB, có Range)
  ▼
Next.js API  ──Range request──►  googlevideo.com
  │  - thêm `Range: bytes=0-` để tránh bị YouTube bóp băng thông
  ▼
Trình duyệt
  │  3. decodeAudioData() → PCM
  │  4. lamejs → MP3
  ▼
Tải file .mp3 về máy
```

Điểm quan trọng:

- YouTube bóp băng thông các request tải liền mạch xuống ~30 KB/s. Gửi kèm header `Range` giúp tải nhanh gấp hàng chục lần.
- File âm thanh được chia thành các chunk 3 MB khi tải để nằm dưới giới hạn response 4.5 MB của Vercel Functions.
- Việc mã hoá MP3 diễn ra ở client nên server không cần ffmpeg và không lưu file.

## Chạy local

Yêu cầu Node.js >= 20.9.

```bash
npm install
npm run dev
```

Mở http://localhost:3000.

Build production:

```bash
npm run build
npm start
```

Kiểm tra type:

```bash
npm run typecheck
```

## Deploy lên Vercel (khuyến nghị)

### Cách 1 — qua GitHub

1. Tạo repository mới trên GitHub rồi push code lên:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<username>/<repo>.git
   git push -u origin main
   ```
2. Vào [vercel.com/new](https://vercel.com/new), chọn **Import Git Repository** và chọn repo vừa push.
3. Giữ nguyên cấu hình mặc định (Framework: **Next.js**), bấm **Deploy**.
4. Sau khi build xong, Vercel cấp cho bạn một link dạng `https://<ten-du-an>.vercel.app`.

Mỗi lần push lên `main`, Vercel sẽ tự động deploy lại.

### Cách 2 — qua Vercel CLI

```bash
npm i -g vercel
vercel
vercel --prod
```

Không cần biến môi trường nào.

> **Lưu ý:** GitHub Pages **không** chạy được project này vì cần API routes phía server. Hãy deploy trên Vercel (hoặc một host Node.js khác như Railway, Render, Fly.io). Nếu chỉ muốn host tĩnh trên GitHub Pages, bạn sẽ phải thay backend bằng một API bên thứ ba.

## Tuỳ chỉnh

- **Tên thương hiệu / link GitHub:** sửa `lib/site.ts`.
- **Giới hạn độ dài khi chuyển MP3:** sửa `maxMp3DurationSeconds` trong `lib/site.ts` (mặc định 15 phút để tránh hết RAM trình duyệt).
- **Màu sắc / giao diện:** sửa biến CSS trong `app/globals.css`.
- **Bitrate cho phép:** sửa mảng `BITRATES` trong `components/Downloader.tsx`.

## Cấu trúc project

```
app/
  api/info/route.ts     # lấy metadata + URL âm thanh
  api/audio/route.ts    # proxy stream âm thanh (hỗ trợ Range)
  layout.tsx
  page.tsx              # landing page
  globals.css
components/
  Downloader.tsx        # UI + tải audio + mã hoá MP3
lib/
  site.ts               # cấu hình thương hiệu
  youtube.ts            # youtubei.js, parse link, cache
```

## API

### `POST /api/info`

```json
{ "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
```

Trả về:

```json
{
  "ok": true,
  "track": {
    "videoId": "dQw4w9WgXcQ",
    "title": "...",
    "author": "...",
    "duration": 213,
    "thumbnail": "https://...",
    "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"",
    "bitrate": 130677,
    "sizeBytes": 3449447,
    "sourceFormat": "aac"
  }
}
```

### `GET /api/audio?id=<videoId>`

Stream âm thanh, hỗ trợ header `Range`:

```bash
curl -H "Range: bytes=0-1048575" "http://localhost:3000/api/audio?id=dQw4w9WgXcQ" -o part.bin
```

## Giới hạn & xử lý sự cố

- **Video bị giới hạn / riêng tư / yêu cầu đăng nhập:** API trả lỗi 422 kèm lý do.
- **YouTube thay đổi API:** chạy `npm update youtubei.js` để lấy bản mới. Đây là thư viện được cập nhật thường xuyên.
- **Vercel bị YouTube chặn IP:** một số IP datacenter có thể bị YouTube hạn chế. Nếu gặp lỗi 403/410 hàng loạt, hãy thử deploy sang host khác hoặc thêm proxy outbound.
- **Video dài:** chuyển MP3 trên trình duyệt cần giải mã toàn bộ PCM vào RAM. Mặc định giới hạn 15 phút; video dài hơn vẫn tải được bản gốc.
- **Safari:** nếu giải mã file WebM/Opus thất bại, hãy dùng nút “Tải bản gốc” hoặc thử video khác.

## Công nghệ

- Next.js 16 (App Router) + React 19 + TypeScript
- [`youtubei.js`](https://github.com/LuanRT/YouTube.js) để lấy luồng âm thanh
- Web Audio API + [`@breezystack/lamejs`](https://www.npmjs.com/package/@breezystack/lamejs) để mã hoá MP3 phía client
- CSS thuần, không phụ thuộc UI framework

## Giấy phép

Mã nguồn dùng cho mục đích học tập / cá nhân. Người dùng tự chịu trách nhiệm về nội dung mình tải xuống.
