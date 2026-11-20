/**
 * A replay's bytes (race-options spec §6.3): a JSON header, then change-only
 * tracks as varint deltas. The codec round-trips, and refuses what it cannot
 * read rather than playing something else.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput } from "@floor-fifty/shared/common/protocol";
import { decodeReplay, encodeReplay, ReplayFormatError } from "@floor-fifty/shared/replay/codec";
import { REPLAY_FORMAT, type Replay } from "@floor-fifty/shared/replay/replay";
import { endlessRaceState } from "../support/race";

const P1 = asPlayerId("p1");
const P2 = asPlayerId("p2");

const frame = (sequence: number, flags: Partial<HeldInput> = {}): HeldInput => ({
  sequence,
  left: false,
  right: false,
  fastFall: false,
  reset: false,
  ...flags,
});

function sample(): Replay {
  const { course: _course, ...go } = { ...endlessRaceState(2), tick: 400 };
  return {
    header: {
      format: 1,
      rulesetRevision: "r".repeat(64),
      courseRevision: "c".repeat(64),
      contentRevision: "t".repeat(64),
      stageId: "rooftops",
      songId: "redline",
      modeId: "infinite",
      lapCount: 1,
      seats: [P1, P2],
      go,
    },
    inputs: {
      [P1]: [
        { tick: 400, frame: frame(1, { right: true }) },
        { tick: 401, frame: frame(2, { reset: true }) },
        { tick: 402, frame: frame(2) },
      ],
      [P2]: [
        { tick: 405, frame: frame(9, { left: true, fastFall: true }) },
        { tick: 600, frame: null },
      ],
    },
    room: [
      { tick: 450, playerId: P2, status: "ghost" },
      { tick: 520, playerId: P2, status: "connected" },
      { tick: 600, playerId: P2, status: "dns" },
    ],
    checks: [
      { tick: 459, hash: 0xdeadbeef },
      { tick: 519, hash: 1 },
    ],
    finalTick: 700,
    finalHash: 0xffffffff,
  };
}

describe("the replay codec (race-options spec §6.3)", () => {
  it("round-trips", () => {
    expect(decodeReplay(encodeReplay(sample()))).toEqual(sample());
  });

  it("writes a valid replay's bytes exactly as format 1 always has", () => {
    const digest = createHash("sha256").update(encodeReplay(sample())).digest("hex");
    // Moved once, when each seat's `deviceClass` joined the state at GO
    // (unlockables spec §3): the header carries the whole GO state, so the
    // sample's JSON grew by that field and nothing else. No replay had left a
    // room yet, and a header without it still decodes. Moved again when each
    // seat's `cpu` flag joined it (CPU players spec §3.1). A saved replay from
    // before has no flag, which reads as a person, and still decodes and plays.
    // Moved again when Survival's `floorEdgeY` joined each seat, and
    // `freedBelow` and `clockSeconds` the race (survival spec §3, §5, §6), and
    // again when its view tightened to fit a 16:9 screen, and again when the
    // push gained `SURVIVAL_PUSH_SPEED` (lava spec §3), and again when the
    // lava gained its rubber band and a faster rise (lava band), and again when a
    // racer's edge came to wait for their first input
    // (`SURVIVAL_START_WAIT_TICKS`, first-race spec §2), and again when the
    // tutorial's edge joined base tuning (`TUTORIAL_EDGE_RISE`,
    // `TUTORIAL_EDGE_START_BELOW`, first-race spec §1); the ruleset moved
    // with it, so no older replay plays on this build anyway.
    expect(digest).toBe("5a225350b028fd559cb928a1ec567cd8a7578754ff6e6e7f5d8c4df755773975");
  });

  it("keeps the format at 1: a GO state carries no edge wait (first-race spec §2)", () => {
    // The wait is a function of the GO state and the inputs, so a replay records nothing of it.
    expect(REPLAY_FORMAT).toBe(1);
    expect(Object.values(sample().header.go.players).every((player) => !("edgeWaitTicks" in player))).toBe(true);
  });

  describe("refusing what it cannot write or read faithfully (audit remediation B7)", () => {
    const P3 = asPlayerId("p3");

    it.each([
      ["a tick that goes back", (replay: Replay) => ({ ...replay, room: [{ tick: replay.header.go.tick - 1, playerId: P1, status: "ghost" as const }] })],
      ["a seat not in the header", (replay: Replay) => ({ ...replay, room: [{ tick: replay.header.go.tick + 1, playerId: P3, status: "ghost" as const }] })],
      ["an unknown status", (replay: Replay) => ({ ...replay, room: [{ tick: replay.header.go.tick + 1, playerId: P1, status: "away" as never }] })],
      ["a sequence jump past 2^31", (replay: Replay) => ({ ...replay, inputs: { ...replay.inputs, [P1]: [{ tick: replay.header.go.tick + 1, frame: frame(2 ** 31 + 1) }] } })],
    ])("refuses to encode %s", (_case, change) => {
      expect(() => encodeReplay(change(sample()))).toThrow(ReplayFormatError);
    });

    it.each([
      ["a null header", null],
      ["a header without seats", { format: 1, go: { tick: 0 } }],
      ["a header whose go has no tick", { format: 1, seats: [], go: {} }],
    ])("refuses to decode %s", (_case, header) => {
      const json = new TextEncoder().encode(JSON.stringify(header));
      const bytes = new Uint8Array(4 + json.length);
      new DataView(bytes.buffer).setUint32(0, json.length, true);
      bytes.set(json, 4);
      expect(() => decodeReplay(bytes)).toThrow(ReplayFormatError);
    });
  });

  it("round-trips a sequence that goes down", () => {
    const replay = sample();
    replay.inputs[P1] = [{ tick: 400, frame: frame(5) }, { tick: 401, frame: frame(3) }];
    expect(decodeReplay(encodeReplay(replay)).inputs[P1]).toEqual(replay.inputs[P1]);
  });

  it("refuses an unknown format", () => {
    const replay = sample();
    const bytes = encodeReplay({ ...replay, header: { ...replay.header, format: 2 as 1 } });
    expect(() => decodeReplay(bytes)).toThrow(ReplayFormatError);
  });

  it("refuses a truncated stream at every length", () => {
    const bytes = encodeReplay(sample());
    for (let length = 0; length < bytes.length; length += 1) {
      expect(() => decodeReplay(bytes.subarray(0, length))).toThrow(ReplayFormatError);
    }
  });

  it("refuses bytes after the final hash", () => {
    const bytes = encodeReplay(sample());
    expect(() => decodeReplay(new Uint8Array([...bytes, 0]))).toThrow(ReplayFormatError);
  });

  it("refuses a track that runs past the final tick", () => {
    expect(() => decodeReplay(encodeReplay({ ...sample(), finalTick: 500 }))).toThrow(/past the final tick/);
  });
});
