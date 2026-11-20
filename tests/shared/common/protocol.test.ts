import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";
import {
  ProtocolError,
  inputFrameSchema,
  lapCountSchema,
  loadedCommandSchema,
  lockInCommandSchema,
  parseCommand,
  parseJoinOptions,
  pickSongCommandSchema,
  pickStageCommandSchema,
  pingSchema,
  playerNameSchema,
  roomCodeSchema,
  setReadyCommandSchema,
} from "@floor-fifty/shared/common/schemas";
import { addCpuCommandSchema, removeCpuCommandSchema } from "@floor-fifty/shared/common/schemas";
import { versionVerdict } from "@floor-fifty/shared/common/refusals";
import { createRaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";

const validInput = { sequence: 1, tick: 120, left: true, right: false, fastFall: false, reset: false };

describe("the wire's version", () => {
  it("is version 19: a seat's snapshot carries how long its edge waited (first-race spec §2)", () => {
    expect(PROTOCOL_VERSION).toBe(19);
  });
});

describe("what a client may send", () => {
  it("rejects a client-supplied position", () => {
    expect(() => parseCommand(inputFrameSchema, validInput)).not.toThrow();
    expect(() => parseCommand(inputFrameSchema, { ...validInput, x: 99 })).toThrow();
    expect(() => parseCommand(inputFrameSchema, { ...validInput, winnerId: "p1" })).toThrow();
    expect(() => parseCommand(inputFrameSchema, { ...validInput, y: 5 })).toThrow();
  });

  it("accepts a well-formed input frame", () => {
    expect(parseCommand(inputFrameSchema, validInput)).toMatchObject({
      sequence: 1,
      tick: 120,
      left: true,
    });
  });

  it("requires the tick a frame takes effect on, as a whole non-negative number", () => {
    const { tick: _tick, ...unstamped } = validInput;
    expect(() => parseCommand(inputFrameSchema, unstamped)).toThrow(ProtocolError);
    expect(() => parseCommand(inputFrameSchema, { ...validInput, tick: -1 })).toThrow();
    expect(() => parseCommand(inputFrameSchema, { ...validInput, tick: 12.5 })).toThrow();
  });

  it("accepts a clock probe with a fractional tick or none, and nothing else", () => {
    expect(parseCommand(pingSchema, { id: 3, tick: 120.25 })).toEqual({ id: 3, tick: 120.25 });
    expect(parseCommand(pingSchema, { id: 3, tick: -1 })).toEqual({ id: 3, tick: -1 });
    expect(() => parseCommand(pingSchema, { id: 3, tick: -5 })).toThrow();
    expect(() => parseCommand(pingSchema, { id: 3, tick: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => parseCommand(pingSchema, { id: 3, tick: 1, extra: true })).toThrow();
  });

  it("permits only one or three host-selected laps", () => {
    expect(lapCountSchema.parse(3)).toBe(3);
    expect(lapCountSchema.parse(1)).toBe(1);
    expect(() => lapCountSchema.parse(2)).toThrow();
    expect(() => lapCountSchema.parse(0)).toThrow();
  });

  it("validates the only player-authored string on the wire", () => {
    expect(() => playerNameSchema.parse("")).toThrow();
    expect(() => playerNameSchema.parse("x".repeat(17))).toThrow();
    expect(() => playerNameSchema.parse("<img onerror=x>")).toThrow();
    expect(playerNameSchema.parse("Kite")).toBe("Kite");
  });

  it("trims a padded name rather than rejecting it", () => {
    expect(playerNameSchema.parse("  Kite  ")).toBe("Kite");
  });

  it("normalises and bounds a room code", () => {
    expect(roomCodeSchema.parse("abc123")).toBe("ABC123");
    expect(() => roomCodeSchema.parse("TOOLONG1")).toThrow();
  });

  it("accepts the remaining room commands and rejects an unknown one", () => {
    expect(parseCommand(setReadyCommandSchema, { requestId: "c1", ready: true })).toMatchObject({
      ready: true,
    });
    // A command is what a seated player may ask their room to do, and the set
    // is closed: nothing else has a schema, so nothing else parses.
    expect(() => parseCommand(setReadyCommandSchema, { requestId: "c1", winnerId: "p1" })).toThrow();
  });
});

describe("join options", () => {
  it("refuses a client on a different protocol version", () => {
    expect(() => parseJoinOptions({ name: "Kite", protocolVersion: 0 })).toThrow(/version/);
  });

  it("tags a version mismatch with a distinguishable code", () => {
    try {
      parseJoinOptions({ name: "Kite", protocolVersion: 0 });
      expect.unreachable("expected a version mismatch");
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError);
      expect((error as ProtocolError).code).toBe("VERSION_MISMATCH");
    }
  });

  it("seats a client that speaks the version the server does", () => {
    expect(parseJoinOptions({ name: "  Kite ", protocolVersion: PROTOCOL_VERSION })).toMatchObject({
      name: "Kite",
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  it("accepts join options with an access report, and without one", () => {
    const access = { stages: ["rooftops"], songs: [], characters: ["ninja"] };
    expect(parseJoinOptions({ name: "Kite", protocolVersion: PROTOCOL_VERSION, access }).access).toEqual(access);
    expect(parseJoinOptions({ name: "Kite", protocolVersion: PROTOCOL_VERSION }).access).toBeUndefined();
  });

  it("carries a device class, and refuses one it does not know", () => {
    const base = { name: "Kite", protocolVersion: PROTOCOL_VERSION };
    expect(parseJoinOptions({ ...base, deviceClass: "phone" }).deviceClass).toBe("phone");
    expect(parseJoinOptions(base).deviceClass).toBeUndefined();
    expect(() => parseJoinOptions({ ...base, deviceClass: "fridge" })).toThrow(
      expect.objectContaining({ code: "MALFORMED_MESSAGE" }),
    );
  });

  it("refuses an access report with an unknown field or a malformed ID", () => {
    expect(() => parseJoinOptions({ name: "Kite", protocolVersion: PROTOCOL_VERSION, access: { stages: [], songs: [], characters: ["NINJA"] } })).toThrow();
    expect(() => parseJoinOptions({ name: "Kite", protocolVersion: PROTOCOL_VERSION, access: { stages: [], songs: [], characters: [], extra: [] } })).toThrow();
  });
});

describe("race state creation", () => {
  const tuning = resolveTuning();

  it("seats every player on the starting floor with the starting floor visited", () => {
    const state = createRaceState({
      seed: 4182,
      lapCount: 1,
      tuning,
      players: [{ id: asPlayerId("p1"), name: asPlayerName("Kite") }],
    });
    const player = state.players[asPlayerId("p1")]!;
    expect(state.phase).toBe("lobby");
    expect(state.tick).toBe(0);
    expect(player.lap).toBe(1);
    expect(player.visitedFloorIds).toEqual([state.course.floors[0]!.id]);
    expect(player.y).toBeGreaterThan(state.course.floors[0]!.y);
  });

  it("refuses to seat more than the room capacity", () => {
    const players = Array.from({ length: MAX_PLAYERS + 1 }, (_unused, index) => ({
      id: asPlayerId(`p${index}`),
      name: asPlayerName(`Ninja ${index}`),
    }));
    expect(() => createRaceState({ seed: 1, lapCount: 1, tuning, players })).toThrow();
  });

  it("takes the select commands, and refuses a malformed stage", () => {
    expect(parseCommand(pickStageCommandSchema, { requestId: "r1", stageId: "snow-shrine" }).stageId).toBe("snow-shrine");
    expect(parseCommand(pickStageCommandSchema, { requestId: "r1", stageId: "?" }).stageId).toBe("?");
    expect(() => parseCommand(pickStageCommandSchema, { requestId: "r1", stageId: "Snow Shrine" })).toThrow();
    expect(() => parseCommand(lockInCommandSchema, { requestId: "r1", extra: true })).toThrow();
    expect(parseCommand(loadedCommandSchema, { requestId: "r1" })).toEqual({ requestId: "r1" });
  });

  it("takes a song pick by ID or ?, and refuses a malformed one", () => {
    expect(parseCommand(pickSongCommandSchema, { requestId: "r1", songId: "moving-on" }).songId).toBe("moving-on");
    expect(parseCommand(pickSongCommandSchema, { requestId: "r1", songId: "?" }).songId).toBe("?");
    expect(() => parseCommand(pickSongCommandSchema, { requestId: "r1", songId: "Moving On" })).toThrow();
    expect(() => parseCommand(pickSongCommandSchema, { requestId: "r1", stageId: "rooftops" })).toThrow();
  });
});

describe("the CPU commands", () => {
  it("take a request id, and removeCpu names a player", () => {
    expect(addCpuCommandSchema.safeParse({ requestId: "r1" }).success).toBe(true);
    expect(removeCpuCommandSchema.safeParse({ requestId: "r1", playerId: "ABCDEF-p2" }).success).toBe(true);
  });
  it("refuse anything else", () => {
    expect(addCpuCommandSchema.safeParse({ requestId: "r1", seat: 2 }).success).toBe(false);
    expect(removeCpuCommandSchema.safeParse({ requestId: "r1" }).success).toBe(false);
    expect(removeCpuCommandSchema.safeParse({ requestId: "r1", playerId: "" }).success).toBe(false);
    expect(removeCpuCommandSchema.safeParse({ requestId: "r1", playerId: "x".repeat(65) }).success).toBe(false);
  });
});

describe("the version verdict (release readiness §4.2)", () => {
  const server = { buildId: "202610041200-bbbbbbb", protocolVersion: PROTOCOL_VERSION, rulesetRevision: "r2" };

  it("seats the same protocol and ruleset", () => {
    expect(versionVerdict({ ...server }, server)).toBe("seat");
  });

  it("seats, and calls skew, a different build on the same rules", () => {
    expect(versionVerdict({ ...server, buildId: "202610031200-aaaaaaa" }, server)).toBe("skew");
  });

  it("asks an older client to reload", () => {
    expect(versionVerdict({ ...server, buildId: "202610031200-aaaaaaa", rulesetRevision: "r1" }, server))
      .toBe("VERSION_MISMATCH");
  });

  it("tells a newer client the server is updating", () => {
    expect(
      versionVerdict({ ...server, buildId: "202610051200-ccccccc", protocolVersion: PROTOCOL_VERSION + 1 }, server),
    ).toBe("SERVER_UPDATING");
  });

  // `pnpm dev` swaps content live while the Vite client keeps the ruleset it
  // started with; two dev builds are the same checkout, so only the protocol
  // can keep them apart.
  it("seats two dev builds on the same protocol whatever their rulesets", () => {
    const dev = { buildId: "dev", protocolVersion: PROTOCOL_VERSION, rulesetRevision: "r1" };
    expect(versionVerdict(dev, { ...dev, rulesetRevision: "r2" })).toBe("seat");
    expect(versionVerdict(dev, { ...dev, protocolVersion: PROTOCOL_VERSION + 1 })).toBe("VERSION_MISMATCH");
  });

  it("calls an unordered difference a mismatch", () => {
    expect(versionVerdict({ ...server, buildId: "dev", rulesetRevision: "r1" }, server)).toBe("VERSION_MISMATCH");
  });
});

describe("join options carry the client's build", () => {
  it("accept the build facts", () => {
    expect(
      parseJoinOptions({ name: "Kite", protocolVersion: PROTOCOL_VERSION, buildId: "dev", rulesetRevision: "r2" }),
    ).toMatchObject({ buildId: "dev", rulesetRevision: "r2" });
  });

  it("still accept a join without them", () => {
    expect(parseJoinOptions({ name: "Kite", protocolVersion: PROTOCOL_VERSION })).toMatchObject({ name: "Kite" });
  });

  // Both are written to the journal on a build skew, so neither may carry a
  // newline or anything else a log line could be forged from.
  it("refuse a build id or ruleset that is not one", () => {
    for (const buildId of ["x\n{\"event\":\"rooms\",\"live\":99999}", "latest", "202610041200-ABC1234"]) {
      expect(() => parseJoinOptions({ name: "Kite", protocolVersion: PROTOCOL_VERSION, buildId })).toThrow();
    }
    expect(() =>
      parseJoinOptions({ name: "Kite", protocolVersion: PROTOCOL_VERSION, rulesetRevision: "r\nforged" }),
    ).toThrow();
    expect(
      parseJoinOptions({ name: "Kite", protocolVersion: PROTOCOL_VERSION, buildId: "202610041200-abc1234", rulesetRevision: "dev" }),
    ).toMatchObject({ buildId: "202610041200-abc1234" });
  });

  it("refuse an oversized build id", () => {
    expect(() =>
      parseJoinOptions({ name: "Kite", protocolVersion: PROTOCOL_VERSION, buildId: "x".repeat(65) }),
    ).toThrow();
  });
});
