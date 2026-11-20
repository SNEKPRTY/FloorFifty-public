/**
 * Inflation is capped (unlockables spec §6.4): a replay from a file or a
 * link is untrusted, and a few kilobytes of deflate can inflate to
 * gigabytes. Both of phase 4's inflaters stop past the cap.
 */
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { encodeReplay, ReplayFormatError } from "@floor-fifty/shared/replay/codec";
import { REPLAY_INFLATE_MAX_BYTES, unpackReplay, type ReplayCompression } from "@floor-fifty/shared/replay/compression";
import { streamCompression } from "../../../apps/client/src/features/replay/replay-compression";
import { zlibCompression } from "../../../apps/server/src/rooms/replay-compression";
import { runRoomLike } from "../../server/support/room-like";

const zeros = (length: number) => new Uint8Array(deflateRawSync(new Uint8Array(length)));

// A real replay whose header alone inflates past the cap: it decodes
// uncapped, so only the cap can refuse it.
const { replay } = runRoomLike({ tuning: resolveTuning(), seats: 1 });
const oversized = new Uint8Array(
  deflateRawSync(encodeReplay({ ...replay, header: { ...replay.header, contentRevision: "x".repeat(REPLAY_INFLATE_MAX_BYTES) } })),
);

describe.each<[string, ReplayCompression]>([
  ["zlib", zlibCompression],
  ["streams", streamCompression],
])("the %s inflater's cap", (_name, compression) => {
  it("inflates a stream of exactly the cap", async () => {
    expect((await compression.inflate(zeros(REPLAY_INFLATE_MAX_BYTES), REPLAY_INFLATE_MAX_BYTES)).length).toBe(REPLAY_INFLATE_MAX_BYTES);
  });

  it("refuses a stream one byte past the cap", async () => {
    await expect(compression.inflate(zeros(REPLAY_INFLATE_MAX_BYTES + 1), REPLAY_INFLATE_MAX_BYTES)).rejects.toThrow();
  });

  it("inflates without a cap as before", async () => {
    expect((await compression.inflate(zeros(REPLAY_INFLATE_MAX_BYTES + 1))).length).toBe(REPLAY_INFLATE_MAX_BYTES + 1);
  });

  it("unpackReplay turns an inflation past the cap into a ReplayFormatError", async () => {
    expect((await unpackReplay(oversized, compression)).finalHash).toBe(replay.finalHash);
    await expect(unpackReplay(oversized, compression, { maxInflatedBytes: REPLAY_INFLATE_MAX_BYTES })).rejects.toThrow(
      ReplayFormatError,
    );
  });
});

it("the cap is 1 MB", () => expect(REPLAY_INFLATE_MAX_BYTES).toBe(1024 * 1024));
