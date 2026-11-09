# Prompt: MP3 bị crash trên đầu xe do ảnh bìa và metadata

## Bối cảnh

Một số đầu xe (ví dụ VinFast VF3) bị treo, crash hoặc tự khởi động lại khi
duyệt/chuyển bài trong thư mục MP3 trên USB. Nghi vấn phổ biến: file MP3 có
nhúng ảnh bìa (Album Art) dung lượng lớn và nhiều siêu dữ liệu ID3.

## Giải thích kỹ thuật

Một file MP3 gồm:

- **Audio frames**: dữ liệu âm thanh thật.
- **ID3 tag**: tên bài (TIT2), ca sĩ (TPE1), album (TALB), năm, lời bài hát...
- **APIC frame**: ảnh bìa nhúng bên trong tag.

Khi cắm USB, đầu xe quét toàn bộ file để đọc tag và ảnh bìa nhằm hiển thị lên
màn hình. Nếu ảnh bìa là PNG/JPEG độ phân giải cao (vài trăm KB đến vài MB),
hoặc tag có cấu trúc lạ, parser ID3 của đầu xe có thể:

- Cấp phát/đọc quá bộ nhớ hạn chế của thiết bị.
- Gặp lỗi giải mã ảnh không được hỗ trợ.
- Làm tiến trình media chết và tự khởi động lại.

Cách gọi "buffer overflow" trong mô tả thường là cách nói dân gian; thực tế
phần lớn là **lỗi parser hoặc thiếu RAM**, không hẳn là lỗi bảo mật.

## Tác dụng của việc xoá ảnh bìa và metadata

- Bỏ khối APIC → đầu xe không phải đọc/giải mã ảnh bìa.
- Giảm dung lượng file (thường vài chục KB đến vài MB mỗi file).
- Giảm thời gian quét thư mục và tài nguyên cần thiết khi duyệt/chuyển bài.
- **Không làm giảm chất lượng âm thanh**, vì chỉ xoá thông tin, không nén lại nhạc.

## Quy trình bằng Mp3tag

1. Cài Mp3tag trên máy tính.
2. Mở thư mục nhạc trên USB.
3. `Ctrl + A` để chọn toàn bộ file.
4. Chuột phải vào ô **Cover Art** ở góc trái → **Remove cover**.
5. `Ctrl + S` để lưu.
6. Kiểm chứng: cột **Cover** trống, dung lượng mỗi file giảm nhẹ.

## Đánh đổi

- Xoá sạch tag → đầu xe có thể chỉ hiển thị **tên file** thay vì tên bài/ca sĩ.
- Giải pháp cân bằng hơn: **chỉ xoá ảnh bìa**, giữ lại tag text (Title, Artist)
  để màn hình xe vẫn hiển thị thông tin mà không phải giải mã ảnh.
- Nếu đầu xe vẫn crash sau khi bỏ ảnh bìa, kiểm tra thêm:
  - USB định dạng FAT32, không dùng NTFS/exFAT nếu đầu xe không hỗ trợ.
  - Tên file/folder có ký tự lạ, quá dài, hoặc quá nhiều file trong một thư mục.
  - File MP3 lỗi, bitrate quá cao, hoặc firmware đầu xe.

## Liên hệ với app hiện tại

App `yt2mp3` đã được cập nhật:

- Tự động bỏ ID3v2/ID3v1, APEv2 và ảnh bìa khi tạo MP3.
- Mặc định mã hoá **320 kbps**.
- File mới tải về không cần chạy Mp3tag nữa.
- File tải trước đây hoặc từ nguồn khác vẫn cần xử lý riêng.

Lưu ý: vì app bỏ toàn bộ tag, đầu xe sẽ hiện tên file. Nếu cần hiện tên bài/ca
sĩ mà vẫn bỏ ảnh bìa, có thể bổ sung tag text tối giản (TIT2/TPE1) mà không
thêm APIC.

## Kiểm chứng file MP3 trên Windows

```powershell
# Xem thông tin, bitrate, ảnh đính kèm
ffprobe -hide_banner -show_format -show_streams "bai-hat.mp3"

# Giải mã thử, phải không có lỗi
ffmpeg -v error -i "bai-hat.mp3" -f null -
```

Kết quả mong đợi:

- `codec_name=mp3`
- `bit_rate=320000`
- `DISPOSITION:attached_pic=0`
- Không có dòng `TAG:`
- Lệnh `ffmpeg` không in lỗi.

## Prompt ngắn để dùng lại

```text
Giải thích và xử lý vấn đề đầu xe (VF3) bị crash/reboot khi phát MP3 từ USB.
Nguyên nhân nghi vấn: ảnh bìa (APIC) dung lượng lớn và metadata ID3 làm parser
của đầu xe tràn bộ nhớ. Hãy:
1. Giải thích ngắn gọn file MP3, ID3, APIC và vì sao ảnh bìa lớn gây crash.
2. Hướng dẫn xoá cover art bằng Mp3tag, giữ hoặc bỏ tag text và nêu đánh đổi.
3. Nêu cách kiểm chứng bằng ffprobe/ffmpeg.
4. Nếu vẫn lỗi, liệt kê các nguyên nhân khác cần kiểm tra (USB, tên file,
   bitrate, firmware).
```
