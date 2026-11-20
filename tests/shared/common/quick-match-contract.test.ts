import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  QUICK_MATCH_SEARCH_TICKS,
  QUICK_MATCH_START_TICKS,
} from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import { ProtocolError, parseJoinOptions } from "@floor-fifty/shared/common/schemas";
import { createRaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";

const join = (extra: Record<string, unknown> = {}) => ({ name: "Kite", protocolVersion: PROTOCOL_VERSION, ...extra });

describe("the quick match clocks", () => {
  it("are thirty and twenty seconds, in ticks", () => {
    expect(QUICK_MATCH_START_TICKS).toBe(1800);
    expect(QUICK_MATCH_SEARCH_TICKS).toBe(1200);
  });
});

describe("join options", () => {
  it("accepts quickMatch, so the first join of a Find a race is not refused as malformed", () => {
    expect(parseJoinOptions(join({ quickMatch: true })).quickMatch).toBe(true);
  });

  it("leaves quickMatch absent when the client sent none", () => {
    expect("quickMatch" in parseJoinOptions(join())).toBe(false);
  });

  it("refuses a quickMatch that is not a boolean", () => {
    expect(() => parseJoinOptions(join({ quickMatch: "yes" }))).toThrow(ProtocolError);
  });
});

describe("a race's access", () => {
  const players = [{ id: asPlayerId("room-p1"), name: asPlayerName("Kite") }];
  const base = { seed: 7, lapCount: 1 as const, tuning: resolveTuning(), players };

  it("is private unless the room is opened to strangers", () => {
    expect(createRaceState(base).access).toBe("private");
    expect(createRaceState({ ...base, access: "public" }).access).toBe("public");
  });

  it("starts with neither clock set", () => {
    const race = createRaceState({ ...base, access: "public" });
    expect(race.startsAtTick).toBeUndefined();
    expect(race.soloFromTick).toBeUndefined();
  });
});
