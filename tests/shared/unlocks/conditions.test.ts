import { describe, expect, it } from "vitest";
import {
  CONDITIONS,
  CONDITION_IDS,
  CONDITION_THRESHOLDS,
  LEGACY_CONDITIONS,
  finishedMatch,
  raceKey,
  type ConditionId,
  type RaceFacts,
  type RaceSeat,
} from "@floor-fifty/shared/unlocks/conditions";

const seat = (id: string, over: Partial<RaceSeat> = {}): RaceSeat => ({
  id,
  status: "connected",
  deviceClass: "desktop",
  cpu: false,
  ...over,
});
const race = (seats: RaceSeat[], over: Partial<RaceFacts> = {}): RaceFacts => ({
  phase: "finished",
  localPlayerId: "me",
  seats,
  ...over,
});
const facts = (r: RaceFacts | undefined, matchesFinished = 0, shared = false) => ({ race: r, matchesFinished, shared });

describe("finishing a match", () => {
  it("counts solo", () => expect(finishedMatch(race([seat("me")]))).toBe(true));
  it("counts a local seat that did not place", () =>
    expect(finishedMatch(race([seat("me"), seat("b")]))).toBe(true));
  it("counts a ghost that is still held", () =>
    expect(finishedMatch(race([seat("me", { status: "ghost" })]))).toBe(true));
  it("refuses a DNS local seat", () =>
    expect(finishedMatch(race([seat("me", { status: "dns" }), seat("b")]))).toBe(false));
  it("refuses a local seat no longer in the room", () => expect(finishedMatch(race([seat("b")]))).toBe(false));
  it("refuses a race that is not finished (a halted race stays racing)", () =>
    expect(finishedMatch(race([seat("me")], { phase: "racing" }))).toBe(false));
  it("refuses no local player and no race", () => {
    expect(finishedMatch(race([seat("me")], { localPlayerId: undefined }))).toBe(false);
    expect(finishedMatch(undefined)).toBe(false);
  });
});

describe("conditions", () => {
  it("any-match is a finished match", () => {
    expect(CONDITIONS["any-match"](facts(race([seat("me")])))).toBe(true);
    expect(CONDITIONS["any-match"](facts(race([seat("me", { status: "dns" })])))).toBe(false);
  });

  it("share-replay is the shared flag alone", () => {
    expect(CONDITIONS["share-replay"](facts(race([seat("me")])))).toBe(false);
    expect(CONDITIONS["share-replay"](facts(undefined, 0, true))).toBe(true);
  });

  it.each([2, 3, 5, 7, 8, 10])("games-%i reads the count", (goal) => {
    const id = `games-${goal}` as ConditionId;
    expect(CONDITIONS[id](facts(undefined, goal - 1))).toBe(false);
    expect(CONDITIONS[id](facts(undefined, goal))).toBe(true);
  });

  it("needs nobody else: every condition is met playing alone on one device", () => {
    const alone = race([seat("me")]);
    for (const id of CONDITION_IDS) expect(CONDITIONS[id]({ race: alone, matchesFinished: 10, shared: true }), id).toBe(true);
  });

  it("carries a retired condition over to the one that took its items", () => {
    expect(LEGACY_CONDITIONS).toEqual({ "with-friend": "games-2", "two-devices": "games-3", "games-20": "games-8" });
    for (const id of Object.values(LEGACY_CONDITIONS)) expect(CONDITION_IDS).toContain(id);
  });

  it("asks for ten matches at most", () => {
    expect(Math.max(...Object.values(CONDITION_THRESHOLDS))).toBe(10);
  });
});

describe("race key", () => {
  it("is the room's seed and its round", () => expect(raceKey({ roomSeed: 812, round: 3 })).toBe("812:3"));
  it("two rooms on the same stage make different keys", () =>
    expect(raceKey({ roomSeed: 1, round: 1 })).not.toBe(raceKey({ roomSeed: 2, round: 1 })));
});

describe("CPUs (CPU players spec §6)", () => {
  const withCpus = race([seat("me"), seat("koi", { cpu: true, deviceClass: "phone" }), seat("moth", { cpu: true })]);
  it("count as a finished match, as solo does", () => {
    expect(CONDITIONS["any-match"](facts(withCpus))).toBe(true);
  });
});
