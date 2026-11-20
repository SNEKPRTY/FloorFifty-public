/** The browser's deflate (race-options spec §6.3): raw deflate through the platform's streams. */

import type { ReplayCompression } from "@floor-fifty/shared/replay/compression";

/**
 * Pipes `bytes` through `stream`, rejecting once the output passes
 * `maxBytes` and cancelling the rest.
 */
async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, maxBytes = Infinity): Promise<Uint8Array> {
  // Written straight into the stream rather than through a Blob, whose
  // `stream()` not every environment has. The write is not awaited before
  // reading: the readable side has to drain for the write to finish.
  const writer = stream.writable.getWriter();
  // A cancelled read errors the writable side too; that rejection is the read's to report.
  const written = writer.write(bytes as Uint8Array<ArrayBuffer>).then(() => writer.close());
  written.catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RangeError(`the stream inflates past ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  await written;
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export const streamCompression: ReplayCompression = {
  deflate: (bytes) => through(bytes, new CompressionStream("deflate-raw")),
  inflate: (bytes, maxBytes) => through(bytes, new DecompressionStream("deflate-raw"), maxBytes),
};
