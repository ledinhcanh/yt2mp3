# Hướng dẫn cấu hình `YOUTUBE_COOKIE` cho bản Vercel

Tài liệu này dùng khi link Vercel báo lỗi dạng:

```
Đăng nhập để xác nhận bạn không phải là robot
Máy chủ đang chạy có thể bị YouTube chặn...
```

## Vì sao cần cookie?

YouTube chặn các dải IP datacenter (trong đó có IP của Vercel): video ngắn vẫn tải
được, nhưng video dài (~1 giờ) trả về `LOGIN_REQUIRED` cho mọi client
(`VISIONOS`, `MWEB`, `WEB`, `TV`, `IOS`, `ANDROID_VR`, ...) dù có PO token.

Đổi region Vercel (`sin1`, `iad1`, `hkg1`, ...) **không giải quyết được** — đã thử
và vẫn bị chặn. Cách hiệu quả là cho server dùng cookie của một tài khoản YouTube
đã đăng nhập, vì phiên đã đăng nhập sẽ vượt qua bước kiểm tra bot.

## Cách lấy cookie

> Dùng **tài khoản Google phụ**, không dùng tài khoản chính. Google có thể cảnh
> báo hoặc tạm khoá tài khoản khi thấy đăng nhập từ IP datacenter.

### Cách 1 — Raw `Cookie` header (khuyến nghị)

1. Mở `https://www.youtube.com` và đăng nhập bằng tài khoản phụ.
2. Nhấn `F12` → tab **Network** → tải lại trang (`Ctrl+R`).
3. Chọn request đầu tiên của `www.youtube.com`.
4. Mục **Request Headers**, tìm dòng `cookie:` → copy toàn bộ giá trị.

### Cách 2 — Extension Cookie-Editor

1. Cài extension **Cookie-Editor** (hoặc **EditThisCookie**).
2. Mở youtube.com → Cookie-Editor → **Export** → **JSON**.
3. Copy toàn bộ JSON.

Code hỗ trợ cả 3 định dạng trong biến `YOUTUBE_COOKIE`:

- Chuỗi `Cookie` header: `SID=...; HSID=...; SSID=...`
- JSON array/object do extension xuất ra
- Nội dung file `cookies.txt` (Netscape)

## Cấu hình trên Vercel

1. Vào project **yt2mp3** trên Vercel.
2. **Settings** → **Environment Variables** → **Add**.
3. Nhập:
   - **Key**: `YOUTUBE_COOKIE`
   - **Value**: chuỗi cookie vừa copy
   - Chọn **Production** (và **Preview** nếu cần)
4. Bấm **Save**.
5. Vào **Deployments** → deployment mới nhất → **⋯** → **Redeploy**.

> Biến môi trường chỉ có hiệu lực ở deployment mới, nên **bắt buộc redeploy**.

## Kiểm tra

Thay `https://yt2mp3-steel.vercel.app` bằng domain thực tế của bạn:

```powershell
# Video dài ~1 giờ phải trả 206 (không còn 422)
curl.exe -s -o NUL -w "%{http_code}`n" `
  -H "Range: bytes=1048576-2097151" `
  "https://yt2mp3-steel.vercel.app/api/audio?id=MFbfeuTjNNY"
```

Kết quả mong đợi: `206`.

Hoặc mở web, dán link video dài, bấm tải và kiểm tra file MP3.

## Lưu ý bảo mật

- `YOUTUBE_COOKIE` là thông tin đăng nhập: **không commit** vào Git, không gửi
  qua chat/công cụ không mã hoá. Vercel Environment Variables được mã hoá.
- Cookie sẽ hết hạn hoặc bị thu hồi. Khi lỗi quay lại, lấy cookie mới và cập nhật.
- Nếu dùng tài khoản chính, rủi ro bị Google cảnh báo/khoá cao hơn.

## Xử lý sự cố

### Vẫn báo `LOGIN_REQUIRED` dù đã set cookie

- Kiểm tra lại deployment đã redeploy sau khi thêm biến chưa.
- Cookie có thể đã hết hạn hoặc bị Google từ chối từ IP datacenter.
- Thử tài khoản phụ khác (tài khoản mới hoàn toàn có thể vẫn bị challenge).
- Phương án tiếp theo: dùng **proxy residential**. Cần thêm biến `YOUTUBE_PROXY`
  (hỗ trợ `http://user:pass@host:port`) và cho các request YouTube đi qua proxy.

### Không muốn dùng cookie

Chạy app trên máy cá nhân rồi mở public bằng **Cloudflare Tunnel**:

```powershell
cloudflared tunnel --url http://localhost:3000
```

Cloudflare trả về một URL public; máy khác dùng URL đó, còn server chạy trên IP
mạng nhà nên không bị YouTube chặn. Nhược điểm: máy phải bật và URL đổi mỗi lần
chạy (trừ khi dùng named tunnel + domain riêng).

## Liên quan

- Code đọc biến: `lib/youtube.ts` (`normalizeCookie`, `YOUTUBE_COOKIE`).
- Lỗi `LOGIN_REQUIRED` được trả về với HTTP `422` kèm gợi ý cập nhật cookie.
