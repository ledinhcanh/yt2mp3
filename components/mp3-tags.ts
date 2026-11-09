const FRAME_SYNC_MASK = 0xe0;

// Layer III bitrate (kbps) theo chuẩn MPEG1 và MPEG2/2.5.
const BITRATE_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATE_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES: Record<number, readonly number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

const LYRICS3_END_V2 = "LYRICS200";
const LYRICS3_END_V1 = "LYRICSEND";
const LYRICS3_BEGIN = "LYRICSBEGIN";

// ID3v2 có thể chứa ảnh bìa vài MB. Khi tag hỏng, phải quét qua vùng đó để
// tìm frame đầu thật; chặn trần để không quét cả file.
const MAX_FRAME_SCAN_BYTES = 8 * 1024 * 1024;

type FrameHeader = {
  frameLength: number;
  sampleRate: number;
};

function isSynchsafe(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function isId3v2(bytes: Uint8Array, offset: number): boolean {
  return (
    bytes[offset] === 0x49 &&
    bytes[offset + 1] === 0x44 &&
    bytes[offset + 2] === 0x33
  );
}

function matchesAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset < 0 || offset + text.length > bytes.length) return false;

  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }

  return true;
}

/**
 * Đọc header frame MPEG Layer III. Trả về độ dài frame để có thể nhảy sang
 * frame kế tiếp — đây là cơ sở để phân biệt frame thật với "sync giả" trong
 * dữ liệu ảnh bìa.
 */
function parseFrameHeader(bytes: Uint8Array, offset: number): FrameHeader | null {
  if (offset + 4 > bytes.length) return null;
  if (bytes[offset] !== 0xff) return null;

  const second = bytes[offset + 1];
  if ((second & FRAME_SYNC_MASK) !== FRAME_SYNC_MASK) return null;

  const version = (second >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = (second >> 1) & 0x03; // 1 = Layer III
  const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
  const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03;
  const padding = (bytes[offset + 2] >> 1) & 0x01;

  if (version === 1 || layer !== 1 || sampleRateIndex === 3) return null;

  const bitrate = (version === 3 ? BITRATE_V1_L3 : BITRATE_V2_L3)[bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version][sampleRateIndex];
  if (!bitrate || !sampleRate) return null;

  const frameLength = Math.floor(((version === 3 ? 144 : 72) * bitrate) / sampleRate) + padding;
  if (frameLength < 24) return null;

  return { frameLength, sampleRate };
}

/**
 * Tìm frame MPEG đầu tiên, nhưng chỉ chấp nhận khi có ít nhất vài frame nối
 * tiếp nhau đúng độ dài và cùng sample rate. Một cặp byte `FF Ex` đơn lẻ xuất
 * hiện đầy trong dữ liệu JPEG nên nếu chỉ kiểm tra 1 header thì rất dễ cắt
 * nhầm vào giữa ảnh bìa.
 */
function findFirstFrame(bytes: Uint8Array, start: number, end: number): number {
  const limit = Math.min(end, start + MAX_FRAME_SCAN_BYTES);

  for (let index = start; index + 4 <= limit; index += 1) {
    const first = parseFrameHeader(bytes, index);
    if (!first) continue;

    let position = index;
    let confirmed = true;

    for (let step = 0; step < 3; step += 1) {
      const frame = parseFrameHeader(bytes, position);
      if (!frame || frame.sampleRate !== first.sampleRate) {
        confirmed = false;
        break;
      }

      position += frame.frameLength;
      if (position + 4 > end) break; // chạm cuối file: chấp nhận
    }

    if (confirmed) return index;
  }

  return -1;
}

/** Lyrics3v2 kết thúc bằng 6 chữ số (độ dài) + "LYRICS200"; v1 bằng "LYRICSEND". */
function stripLyrics3(bytes: Uint8Array, start: number, end: number): number {
  if (end - start >= 15 && matchesAt(bytes, end - LYRICS3_END_V2.length, LYRICS3_END_V2)) {
    let size = 0;
    let valid = true;

    for (let index = end - 15; index < end - 9; index += 1) {
      const digit = bytes[index] - 0x30;
      if (digit < 0 || digit > 9) {
        valid = false;
        break;
      }
      size = size * 10 + digit;
    }

    if (valid && size > 0 && end - (size + 15) >= start) return end - (size + 15);
  }

  if (end - start >= 20 && matchesAt(bytes, end - LYRICS3_END_V1.length, LYRICS3_END_V1)) {
    const floor = Math.max(start, end - 5100 - LYRICS3_BEGIN.length);

    for (let index = end - LYRICS3_END_V1.length - LYRICS3_BEGIN.length; index >= floor; index -= 1) {
      if (matchesAt(bytes, index, LYRICS3_BEGIN)) return index;
    }
  }

  return end;
}

/** APEv2: footer 32 byte nằm ở cuối, BẮT ĐẦU bằng "APETAGEX". */
function stripApev2(bytes: Uint8Array, start: number, end: number): number {
  if (end - start < 32 || !matchesAt(bytes, end - 32, "APETAGEX")) return end;

  const footer = end - 32;
  const size =
    bytes[footer + 12] |
    (bytes[footer + 13] << 8) |
    (bytes[footer + 14] << 16) |
    (bytes[footer + 15] << 24);
  const flags =
    (bytes[footer + 20] |
      (bytes[footer + 21] << 8) |
      (bytes[footer + 22] << 16) |
      (bytes[footer + 23] << 24)) >>>
    0;

  // size chỉ tính phần item + footer; nếu cờ "có header" bật thì cộng thêm 32.
  const total = size + ((flags & 0x80000000) !== 0 ? 32 : 0);
  if (total <= 0 || total > end - start) return end;

  return end - total;
}

/**
 * Remove anything that is not raw MP3 frames:
 * - ID3v2 tags at the start (nhiều khối nối tiếp, kể cả footer)
 * - ID3v1 (128 byte cuối), Lyrics3v1/v2, APEv2 ở cuối file
 * - phần rác không phải frame ở đầu (ID3v2 hỏng, header lạ)
 *
 * Kết quả giữ nguyên toàn bộ frame âm thanh nhưng bỏ ảnh bìa và metadata —
 * dạng tương thích nhất với đầu xe khó tính.
 *
 * Lưu ý: header Xing/Info/LAME nằm BÊN TRONG frame đầu tiên nên hàm này không
 * bỏ nó; chỉ dữ liệu nằm ngoài frame âm thanh mới bị cắt.
 */
export function stripMp3Metadata(input: Uint8Array): Uint8Array {
  let start = 0;
  let end = input.length;

  while (end - start >= 10 && isId3v2(input, start)) {
    const flags = input[start + 5];
    const size = isSynchsafe(input, start + 6);
    const footer = (flags & 0x10) !== 0 ? 10 : 0;
    const skip = 10 + size + footer;
    if (start + skip > end) break; // size hỏng: để bước cuối tìm frame thật
    start += skip;
  }

  if (end - start >= 128 && matchesAt(input, end - 128, "TAG")) end -= 128;

  end = stripLyrics3(input, start, end);
  end = stripApev2(input, start, end);

  if (!parseFrameHeader(input, start)) {
    const frameStart = findFirstFrame(input, start, end);
    // Không chắc đâu là frame thật thì giữ nguyên file: cắt sai còn tệ hơn.
    if (frameStart < 0) return input;
    start = frameStart;
  }

  return start === 0 && end === input.length ? input : input.subarray(start, end);
}
