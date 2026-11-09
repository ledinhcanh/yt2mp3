const FRAME_SYNC_MASK = 0xe0;

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

function isFrameHeader(bytes: Uint8Array, offset: number): boolean {
  if (offset + 3 >= bytes.length) return false;
  if (bytes[offset] !== 0xff) return false;

  const second = bytes[offset + 1];
  if ((second & FRAME_SYNC_MASK) !== FRAME_SYNC_MASK) return false;

  const version = (second >> 3) & 0x03;
  const layer = (second >> 1) & 0x03;
  const sampleRate = (bytes[offset + 2] >> 2) & 0x03;

  return version !== 1 && layer !== 0 && sampleRate !== 3;
}

function findFirstFrame(bytes: Uint8Array, start: number, end: number): number {
  for (let index = start; index + 3 < end; index += 1) {
    if (isFrameHeader(bytes, index)) return index;
  }
  return -1;
}

/**
 * Remove anything that is not raw MP3 frames:
 * - ID3v2 tags at the start (and their optional footer)
 * - ID3v1 tags in the last 128 bytes
 * - APEv2 tags at the end
 * - any non-frame prefix (for example a leading LAME/Xing header)
 *
 * The result keeps the audio frames intact but strips cover art and metadata,
 * which is the most compatible form for strict car head units.
 */
export function stripMp3Metadata(input: Uint8Array): Uint8Array {
  let start = 0;
  let end = input.length;

  while (end - start >= 10 && isId3v2(input, start)) {
    const flags = input[start + 5];
    const size = isSynchsafe(input, start + 6);
    const footer = (flags & 0x10) !== 0 ? 10 : 0;
    const skip = 10 + size + footer;
    if (skip <= 0 || start + skip > end) break;
    start += skip;
  }

  if (
    end - start >= 128 &&
    input[end - 128] === 0x54 &&
    input[end - 127] === 0x41 &&
    input[end - 126] === 0x47
  ) {
    end -= 128;
  }

  if (end - start >= 32) {
    const tag = end - 32;
    const isApe =
      input[tag] === 0x41 &&
      input[tag + 1] === 0x50 &&
      input[tag + 2] === 0x45 &&
      input[tag + 3] === 0x54 &&
      input[tag + 4] === 0x41 &&
      input[tag + 5] === 0x47 &&
      input[tag + 6] === 0x45 &&
      input[tag + 7] === 0x58;

    if (isApe) {
      const size =
        input[tag + 12] |
        (input[tag + 13] << 8) |
        (input[tag + 14] << 16) |
        (input[tag + 15] << 24);
      if (size >= 32 && end - size >= start) end -= size;
    }
  }

  if (!isFrameHeader(input, start)) {
    const frameStart = findFirstFrame(input, start, Math.min(end, start + 64 * 1024));
    if (frameStart > start) start = frameStart;
  }

  return start === 0 && end === input.length ? input : input.subarray(start, end);
}
