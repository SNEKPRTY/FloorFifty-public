/**
 * The server's deflate (race-options spec §6.3): synchronous, because the
 * room sends the replay on the tick the race ends.
 */

import { deflateRawSync, inflateRawSync } from "node:zlib";
import { encodeReplay } from "@floor-fifty/shared/replay/codec";
import type { ReplayCompression } from "@floor-fifty/shared/replay/compression";
import type { Replay } from "@floor-fifty/shared/replay/replay";

export const deflateReplaySync = (replay: Replay): Uint8Array => new Uint8Array(deflateRawSync(encodeReplay(replay)));

export const zlibCompression: ReplayCompression = {
  deflate: async (bytes) => new Uint8Array(deflateRawSync(bytes)),
  // `maxOutputLength` makes zlib throw rather than truncate.
  inflate: async (bytes, maxBytes) =>
    new Uint8Array(inflateRawSync(bytes, maxBytes === undefined ? {} : { maxOutputLength: maxBytes })),
};
