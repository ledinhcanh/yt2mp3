import { createMp3Encoder } from "wasm-media-encoders";

type EncodeRequest = {
  id: number;
  sampleRate: number;
  bitrate: number;
  channels: ArrayBuffer[];
};

const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

let encoderPromise: ReturnType<typeof createMp3Encoder> | null = null;

function getEncoder() {
  if (!encoderPromise) {
    encoderPromise = createMp3Encoder().catch((error) => {
      encoderPromise = null;
      throw error;
    });
  }
  return encoderPromise;
}

scope.addEventListener("message", (event: MessageEvent<EncodeRequest>) => {
  const { id, sampleRate, bitrate, channels } = event.data;

  getEncoder()
    .then((encoder) => {
      encoder.configure({
        sampleRate,
        channels: (channels.length === 2 ? 2 : 1) as 1 | 2,
        bitrate: bitrate as 128 | 192 | 320,
      });

      const samples = channels.map((buffer) => new Float32Array(buffer));
      const totalFrames = samples[0].length;
      const blockFrames = 1152 * 32;

      // encode() returns a view owned by the encoder, so copy every chunk out.
      let output = new Uint8Array(Math.min(8 * 1024 * 1024, Math.max(1 << 16, totalFrames * 4)));
      let position = 0;

      const append = (data: Uint8Array) => {
        if (position + data.length > output.length) {
          const next = new Uint8Array(Math.max(output.length * 2, position + data.length));
          next.set(output.subarray(0, position));
          output = next;
        }
        output.set(data, position);
        position += data.length;
      };

      for (let offset = 0; offset < totalFrames; offset += blockFrames) {
        const end = Math.min(offset + blockFrames, totalFrames);
        const block = samples.map((channel) => channel.subarray(offset, end));

        append(encoder.encode(block));

        if (offset % (blockFrames * 16) === 0) {
          scope.postMessage({
            id,
            type: "progress",
            percent: Math.min(99, (offset / totalFrames) * 100),
          });
        }
      }

      append(encoder.finalize());

      const buffer = output.buffer.slice(0, position) as ArrayBuffer;
      scope.postMessage({ id, type: "done", percent: 100, buffer }, [buffer]);
    })
    .catch((error: unknown) => {
      scope.postMessage({
        id,
        type: "error",
        message: error instanceof Error ? error.message : "Không thể mã hoá MP3.",
      });
    });
});
