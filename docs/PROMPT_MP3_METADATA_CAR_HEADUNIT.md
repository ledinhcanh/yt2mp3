# Prompt: MP3 bị crash trên đầu xe do ảnh bìa và metadata

## Bối cảnh

Một số đầu xe (ví dụ VinFast VF3) bị treo, crash hoặc tự khởi động lại khi
duyệt/chuyển bài trong thư mục MP3 trên USB. Nghi vấn phổ biến: file MP3 có
nhúng ảnh bìa (Album Art) dung lượng lớn và nhiều siêu dữ liệu ID3.

## Giải thích kỹ thuật

Một file MP3 gồm:

- **Audio frames**: dữ liệu âm thanh thật (mỗi frame ~26 ms ở 44.1 kHz).
- **ID3v2**: khối tag ở **đầu file** — tên bài (TIT2), ca sĩ (TPE1), album
  (TALB), và frame **APIC** chứa ảnh bìa. Có thể có nhiều khối nối tiếp nhau.
- **Tag ở cuối file**: ID3v1 (128 byte), Lyrics3v1/v2, APEv2.

Khi cắm USB, đầu xe quét toàn bộ file để đọc tag và ảnh bìa nhằm hiển thị lên
màn hình. Nếu ảnh bìa là PNG/JPEG độ phân giải cao (vài trăm KB đến vài MB),
hoặc tag có cấu trúc lạ, parser ID3 của đầu xe có thể:

- Cấp phát/đọc quá bộ nhớ hạn chế của thiết bị.
- Gặp lỗi giải mã ảnh không được hỗ trợ.
- Làm tiến trình media chết và tự khởi động lại.

Cách gọi "buffer overflow" trong mô tả thường là cách nói dân gian; thực tế
phần lớn là **lỗi parser hoặc thiếu RAM**, không hẳn là lỗi bảo mật.

## Nguyên nhân — thứ tự ưu tiên để kiểm tra

Đây là thứ tự **nên kiểm tra trước sau**, dựa trên triệu chứng (treo khi tua /
chuyển bài), không phải bảng xếp hạng đo được trên nhiều đầu xe.

| # | Nguyên nhân | Vì sao làm treo |
|---|---|---|
| 1 | **VBR thiếu/sai TOC** (Xing/Info/VBRI) | Đầu xe dựa vào header để biết tổng thời lượng và vị trí byte; thiếu/sai TOC → tính sai chỗ nhảy khi tua, hoặc phải quét lại toàn file |
| 2 | **Ảnh bìa APIC lớn** | Parser cấp phát buffer đúng bằng kích thước ảnh rồi giải mã JPEG/PNG trên chip yếu → hết RAM |
| 3 | **ID3v2.4 / UTF-8** | Nhiều đầu xe chỉ hiểu ID3v2.3; gặp v2.4 là bỏ qua tag hoặc đọc sai offset |
| 4 | **Tag rác**: APEv2, ID3v1, Lyrics3, nhiều khối ID3v2 nối tiếp | Mỗi parser xử lý một kiểu; khối lạ làm lệch offset đọc frame |
| 5 | **USB**: exFAT/NTFS, GPT, cluster lớn, quá nhiều file/thư mục | Không mount được hoặc quét quá lâu |
| 6 | **Tên file Unicode / ký tự lạ** | Không có font, hoặc parser tên file gặp byte lạ |
| 7 | **Sample rate 48 kHz** | Một số chip giải mã chỉ nhận 44.1 kHz |

Đừng đọc bảng này thành "hễ có header là hỏng": `Info` chỉ là bản CBR của
`Xing` — file **320 kbps CBR cũng có `Info`** và chạy bình thường. Cái làm treo
là **VBR không có TOC đúng**, không phải sự có mặt của header.

## Tác dụng của việc xoá ảnh bìa và metadata

- Bỏ khối APIC → đầu xe không phải đọc/giải mã ảnh bìa.
- Giảm dung lượng file (thường vài chục KB đến vài MB mỗi file).
- Giảm thời gian quét thư mục và tài nguyên cần thiết khi duyệt/chuyển bài.
- **Không làm giảm chất lượng âm thanh**, vì chỉ xoá thông tin ngoài frame,
  không nén lại nhạc.

## Quy trình bằng Mp3tag

1. Cài Mp3tag.
2. **Trước khi làm gì khác**: `Tools → Options → Tags → Mpeg` → chọn
   **"ID3v2.3 UTF-16"** (hoặc *ID3v2.3 ISO-8859-1* nếu toàn tiếng Anh).
   Để mặc định v2.4 là hỏng ngay từ đầu với đầu xe cũ.
3. Mở thư mục nhạc trên USB → `Ctrl + A`.
4. Chuột phải ô **Cover Art** (góc trái dưới) → **Remove cover**.
5. Kiểm tra tag rác: cột **Tag** hiển thị dạng `ID3v2.3 (ID3v1 APE)`. Nếu có
   `APE` hoặc `ID3v1`, chuột phải → **Remove tag** rồi ghi lại tag text (bước 6).
   Chỉ "Remove cover" là **chưa đủ**.
6. Nếu muốn hiện tên bài: paste Title/Artist vào cột, `Ctrl + S`.
7. Kiểm chứng bằng mục "Kiểm chứng file MP3" bên dưới.

## Đánh đổi

- Xoá sạch tag → đầu xe có thể chỉ hiển thị **tên file** thay vì tên bài/ca sĩ.
- Giải pháp cân bằng: **chỉ xoá ảnh bìa**, giữ tag text tối giản (Title, Artist)
  — và tag đó phải ghi bằng **ID3v2.3**, không phải v2.4.

## App `yt2mp3` làm gì

- Khi tạo MP3, app cắt **toàn bộ** dữ liệu không phải frame: ID3v2 (mọi khối
  nối tiếp, kể cả footer), ID3v1, Lyrics3v1/v2, APEv2, và phần rác ở đầu file.
- Frame âm thanh giữ nguyên byte-for-byte → chất lượng không đổi.
- Mặc định mã hoá **320 kbps CBR**, 44.1 kHz (lấy theo nguồn YouTube).
- App **không ghi lại tag text**, nên đầu xe sẽ hiện **tên file**. Muốn hiện tên
  bài thì phải thêm tag bằng Mp3tag sau khi tải, hoặc dùng extension
  `Zing MP3 Downloader` với chế độ **Đầu xe → Bỏ ảnh bìa, giữ tên bài**.
- File tải trước đây hoặc từ nguồn khác vẫn cần xử lý riêng.

## Kiểm chứng file MP3 trên Windows

### Nếu đã xoá sạch tag (đầu xe hiện tên file)

```powershell
ffprobe -v error -show_entries stream=codec_name:stream_disposition=attached_pic -of default=nw=1 "bai.mp3"
ffprobe -v error -show_entries format_tags -of default=nw=1 "bai.mp3"
```

Mong đợi: `codec_name=mp3`, `attached_pic=0`, **không có** dòng `TAG:` nào.

### Nếu giữ tag text tối giản (đầu xe hiện tên bài)

```powershell
ffprobe -v error -show_entries format_tags -of default=nw=1 "bai.mp3"
```

Mong đợi: `attached_pic=0` **nhưng vẫn có** `TAG:title=…`, `TAG:artist=…`.

### Bitrate — đọc ở stream, đừng đọc ở format

```powershell
ffprobe -v error -select_streams a:0 -show_entries stream=bit_rate,sample_rate,channels -of default=nw=1 "bai.mp3"
```

Mong đợi: `bit_rate=320000`. Ở tầng `stream`, ffprobe lấy bitrate ngay trong
header frame nên CBR 320 luôn ra đúng `320000`; con số lệch kiểu `323015` chỉ
xuất hiện ở `format=bit_rate` (`size × 8 / duration`) — và `format` còn bị ảnh
bìa làm sai hẳn (ví dụ 758589 cho file 320k + bìa 1.6 MB trong 30 giây).

### VBR — kiểm tra riêng

Đừng dùng `stream=bit_rate` để đoán VBR: file VBR vẫn ra số bình thường
(đo thật: 106146) và gần như trùng `format=bit_rate` (106157), vì ffprobe lấy
trung bình từ header Xing. `bit_rate=N/A` chỉ xảy ra với file **hỏng header**.

Cách đúng là so kích thước các frame liền nhau:

```powershell
ffprobe -v error -select_streams a:0 -show_entries frame=pkt_size -of csv=p=0 "bai.mp3" |
  awk 'NR==1{min=$1;max=$1}{if($1<min)min=$1;if($1>max)max=$1}END{printf "ratio=%.2f\n",max/min}'
```

- `ratio` ≈ 1.00 → **CBR** (đo thật: 1044–1045)
- `ratio` > 1.1 → **VBR** (đo thật: 208–731, ratio 3.51)

### Giải mã thử

```powershell
ffmpeg -v error -i "bai.mp3" -f null -
```

Không in gì = không lỗi. Lệnh này **không** bắt được lỗi header/tag, nên vẫn
phải làm các bước trên.

## Nếu vẫn treo sau khi đã bỏ bìa

1. **USB**: FAT32, **MBR** (không GPT), cluster **32 KB**, phân vùng primary đầu
   tiên, không có phân vùng ẩn EFI. Nhiều đầu xe không đọc exFAT/NTFS.
2. **Số file**: dưới ~255 file mỗi thư mục, không lồng quá 3–4 cấp.
3. **Tên file**: chỉ ASCII, không dấu, tránh `& % # [ ] { } + ; = @ $ !`, dài
   dưới 100 ký tự, không có dấu chấm/khoảng trắng ở cuối.
4. **VBR**: tải lại ở 320 kbps CBR (app đã xuất CBR; file nguồn khác thì phải
   encode lại, không thể "chuyển" bằng cách đổi tag).
5. **Sample rate**: ép 44.1 kHz.
6. **Firmware** đầu xe.

## Prompt ngắn để dùng lại

```text
Giải thích và xử lý vấn đề đầu xe (VF3) bị crash/reboot khi phát MP3 từ USB.

1. VBR thiếu/sai TOC (Xing/Info/VBRI) là nghi phạm số 1 — đầu xe tính sai thời
   lượng/vị trí byte nên treo khi tua. Không phải "bitrate cao" (320 kbps CBR rất
   an toàn), và cũng không phải "cứ có header là hỏng": Info là bản CBR của Xing.
2. Ảnh bìa APIC lớn làm parser hết RAM.
3. ID3v2.4/UTF-8: nhiều đầu xe chỉ đọc ID3v2.3 — phải ghi bằng v2.3 UTF-16.
4. Tag rác: APEv2, ID3v1, Lyrics3, nhiều khối ID3v2 nối tiếp — "remove cover"
   một mình không đủ.

Việc cần làm:
- Hướng dẫn Mp3tag: Options → Tags → Mpeg → ID3v2.3 UTF-16; Remove cover; kiểm
  tra cả APE/ID3v1.
- Nêu đánh đổi giữa bỏ sạch tag (hiện tên file) và giữ TIT2/TPE1 (hiện tên bài).
- Kiểm chứng bằng ffprobe: tách 2 kịch bản (có tag text / không tag); đọc
  stream=bit_rate (CBR 320 luôn ra 320000, đừng đọc format=bit_rate); kiểm VBR
  bằng tỉ lệ kích thước frame; ffmpeg -f null để thử giải mã.
- Nếu vẫn lỗi: USB FAT32 + MBR + cluster 32KB, <255 file/thư mục, độ sâu ≤3, tên
  file ASCII, sample rate 44.1kHz, firmware.
```
