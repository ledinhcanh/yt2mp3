/**
 * Split a fragmented MP4 (DASH) stream into self-contained, decodable chunks.
 *
 * YouTube serves audio as fragmented MP4: one `ftyp` + `moov` init segment
 * followed by `moof`/`mdat` pairs. Each fragment can be decoded on its own as
 * long as the init segment is prepended, which lets us decode long videos in
 * bounded batches instead of allocating gigabytes of PCM at once.
 *
 * Returns `null` when the input is not a fragmented MP4 so callers can fall
 * back to decoding the whole file.
 */
export function splitFragmentedMp4(
  bytes: Uint8Array,
  targetBytesPerSegment: number,
): Uint8Array[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  interface Box {
    type: string;
    start: number;
    size: number;
  }

  const boxes: Box[] = [];
  let position = 0;

  while (position + 8 <= bytes.length) {
    let size = view.getUint32(position);
    const type = String.fromCharCode(
      bytes[position + 4],
      bytes[position + 5],
      bytes[position + 6],
      bytes[position + 7],
    );
    let headerSize = 8;

    if (size === 1) {
      if (position + 16 > bytes.length) break;
      size = Number(view.getBigUint64(position + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = bytes.length - position;
    }

    if (size < headerSize || position + size > bytes.length) break;

    boxes.push({ type, start: position, size });
    position += size;
  }

  if (boxes.length === 0) return null;

  const initBoxes = boxes.filter((box) => box.type === "ftyp" || box.type === "moov");
  if (!initBoxes.some((box) => box.type === "moov")) return null;

  const moofs = boxes.filter((box) => box.type === "moof");
  if (moofs.length === 0) return null;

  const init = concatChunks(
    initBoxes.map((box) => bytes.subarray(box.start, box.start + box.size)),
  );

  const fragmentStarts = moofs.map((box) => box.start);
  const fragments = fragmentStarts.map((start, index) =>
    bytes.subarray(
      start,
      index + 1 < fragmentStarts.length ? fragmentStarts[index + 1] : bytes.length,
    ),
  );

  const segments: Uint8Array[] = [];
  let groupStart = 0;
  let groupSize = 0;

  for (let index = 0; index < fragments.length; index += 1) {
    groupSize += fragments[index].length;

    if (groupSize >= targetBytesPerSegment || index === fragments.length - 1) {
      segments.push(
        concatChunks([init, ...fragments.slice(groupStart, index + 1)]),
      );
      groupStart = index + 1;
      groupSize = 0;
    }
  }

  return segments;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;

  const output = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}
