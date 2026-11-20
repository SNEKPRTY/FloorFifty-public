/**
 * Deflate behind one small interface (race-options spec §6.3): the server
 * uses `node:zlib`, the browser `CompressionStream`, and this package imports
 * neither. Both speak raw deflate, so either side reads the other's bytes.
 */

import { decodeReplay, encodeReplay, ReplayFormatError } from "./codec";
import type { Replay } from "./replay";

/**
 * The most a replay from outside the room may inflate to (unlockables spec
 * §6.4): a few kilobytes of deflate can inflate to gigabytes. A real race is
 * far below it (`replay-recorder.test.ts`'s worst case is 64 KB deflated).
 */
export const REPLAY_INFLATE_MAX_BYTES = 1024 * 1024;

export type ReplayCompression = {
  deflate(bytes: Uint8Array): Promise<Uint8Array>;
  /** Rejects once the output would pass `maxBytes`, without inflating the rest. */
  inflate(bytes: Uint8Array, maxBytes?: number): Promise<Uint8Array>;
};

export async function packReplay(replay: Replay, compression: ReplayCompression): Promise<Uint8Array> {
  return compression.deflate(encodeReplay(replay));
}

/**
 * Inflates and decodes; bytes that are not a deflated replay, or that
 * inflate past `maxInflatedBytes`, are a `ReplayFormatError`.
 */
export async function unpackReplay(
  bytes: Uint8Array,
  compression: ReplayCompression,
  options: { maxInflatedBytes?: number } = {},
): Promise<Replay> {
  let raw: Uint8Array;
  try {
    raw = await compression.inflate(bytes, options.maxInflatedBytes);
  } catch {
    throw new ReplayFormatError("the replay is not deflated bytes");
  }
  return decodeReplay(raw);
}
