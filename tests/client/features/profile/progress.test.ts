// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RaceFacts, RaceSeat } from "@floor-fifty/shared/unlocks/conditions";
import {
  closeSlot,
  COUNTED_KEEP,
  countOf,
  emptyProgress,
  judgeResults,
  loadProgress,
  migrateLegacy,
  PROGRESS_KEY,
  recordShare,
  reveal,
  saveProgress,
  type ProgressData,
} from "../../../../apps/client/src/features/profile/progress";
import type { SettingsStorage } from "../../../../apps/client/src/features/profile/settings";

const ORDER = ["any-match", "games-2", "share-replay", "games-3", "games-5", "games-7", "games-8", "games-10"];
const memory = (seed: Record<string, string> = {}) => {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
  } satisfies SettingsStorage & { values: Map<string, string> };
};
const seat = (id: string, over: Partial<RaceSeat> = {}): RaceSeat => ({ id, status: "connected", deviceClass: "desktop", cpu: false, ...over });
const solo: RaceFacts = { phase: "finished", localPlayerId: "me", seats: [seat("me")] };
const phoneAndDesktop: RaceFacts = { phase: "finished", localPlayerId: "me", seats: [seat("me"), seat("b", { deviceClass: "phone" })] };
const dns: RaceFacts = { phase: "finished", localPlayerId: "me", seats: [seat("me", { status: "dns" })] };

/** Judges a run of races, closing the slot between them as the countdown does. */
const play = (data: ProgressData, races: RaceFacts[], from = 1) =>
  races.reduce<{ data: ProgressData; grants: (string | undefined)[] }>(
    (acc, race, i) => {
      const step = judgeResults(closeSlot(acc.data), race, `7:${from + i}`, ORDER);
      return { data: step.data, grants: [...acc.grants, step.granted] };
    },
    { data, grants: [] },
  );

describe("the store's shape", () => {
  it("starts empty", () => {
    expect(emptyProgress()).toEqual({
      version: 1, seq: 0, unlocked: [], pending: [], stats: { matchesFinished: 0 }, counted: [], slot: null, revealed: [],
    });
  });

  it("round-trips through storage", () => {
    const storage = memory();
    const { data } = judgeResults(emptyProgress(), solo, "7:1", ORDER);
    expect(saveProgress(storage, data)).toBe(true);
    expect(loadProgress(storage)).toEqual(data);
  });

  it("reads an invalid value as empty and does not overwrite it by reading", () => {
    const storage = memory({ [PROGRESS_KEY]: '{"version":2,"future":true}' });
    expect(loadProgress(storage)).toEqual(emptyProgress());
    expect(storage.values.get(PROGRESS_KEY)).toBe('{"version":2,"future":true}');
  });

  it("reads unparseable JSON as empty", () => {
    expect(loadProgress(memory({ [PROGRESS_KEY]: "{" }))).toEqual(emptyProgress());
  });

  it("runs with no storage, a storage that throws, and a full one", () => {
    const throwing: SettingsStorage = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
    };
    expect(loadProgress(undefined)).toEqual(emptyProgress());
    expect(loadProgress(throwing)).toEqual(emptyProgress());
    expect(saveProgress(undefined, emptyProgress())).toBe(false);
    expect(saveProgress(throwing, emptyProgress())).toBe(false);
  });

  it("keeps IDs this build does not know", () => {
    const stored = { ...emptyProgress(), unlocked: ["from-the-future"], pending: [{ id: "also-future", seq: 0 }], seq: 1 };
    const data = loadProgress(memory({ [PROGRESS_KEY]: JSON.stringify(stored) }));
    expect(data.unlocked).toContain("from-the-future");
    const { data: after } = judgeResults(data, solo, "7:1", ORDER);
    expect(after.unlocked).toContain("from-the-future");
  });
});

describe("one grant per round (D-U1)", () => {
  it("a solo race grants Crash Mode's condition at once", () => {
    const { data, granted } = judgeResults(emptyProgress(), solo, "7:1", ORDER);
    expect(granted).toBe("any-match");
    expect(data.slot).toEqual({ raceKey: "7:1", used: true });
    expect(data.stats.matchesFinished).toBe(1);
  });

  it("conditions met together are granted over consecutive rounds in unlocks.toml order", () => {
    // One match finished before Crash Mode's condition existed: the second meets two at once,
    // and the third queues Static in the Air's behind them.
    const veteran = { ...emptyProgress(), stats: { matchesFinished: 1 } };
    const { grants, data } = play(veteran, [solo, solo, solo]);
    expect(grants).toEqual(["any-match", "games-2", "games-3"]);
    expect(data.pending).toEqual([]);
  });

  it("the oldest pending goes first across rounds", () => {
    let data = recordShare(emptyProgress(), undefined, ORDER).data; // share-replay pending first, seq 0
    data = { ...data, stats: { matchesFinished: 2 } };
    data = judgeResults(data, solo, "7:1", ORDER).data;              // grants share-replay, then queues 3
    expect(data.unlocked).toEqual(["share-replay"]);
    expect(data.pending.map((p) => p.id)).toEqual(["any-match", "games-2", "games-3"]);
  });

  it("judges a race key once, including after a reload", () => {
    const storage = memory();
    const first = judgeResults(emptyProgress(), phoneAndDesktop, "7:1", ORDER);
    saveProgress(storage, first.data);
    const again = judgeResults(loadProgress(storage), phoneAndDesktop, "7:1", ORDER);
    expect(again.granted).toBeUndefined();
    expect(again.data).toEqual(first.data);
  });

  it("a second room's first race is judged", () => {
    const a = judgeResults(emptyProgress(), solo, "11:1", ORDER).data;
    const b = judgeResults(closeSlot(a), solo, "29:1", ORDER);
    expect(b.data.stats.matchesFinished).toBe(2);
  });

  it("keeps only the last 16 keys", () => {
    let data = emptyProgress();
    for (let round = 1; round <= COUNTED_KEEP + 4; round += 1) data = judgeResults(closeSlot(data), dns, `7:${round}`, ORDER).data;
    expect(data.counted).toHaveLength(COUNTED_KEEP);
    expect(data.counted[0]).toBe("7:5");
  });

  it("a DNS opens the round's slot and grants nothing it did not earn", () => {
    const { data, granted } = judgeResults(emptyProgress(), dns, "7:1", ORDER);
    expect(granted).toBeUndefined();
    expect(data.slot).toEqual({ raceKey: "7:1", used: false });
    expect(data.stats.matchesFinished).toBe(0);
  });
});

describe("a save or share", () => {
  it("on results with an unused slot grants share-replay at once", () => {
    const opened = judgeResults(emptyProgress(), dns, "7:1", ORDER).data;
    const { data, granted } = recordShare(opened, "7:1", ORDER);
    expect(granted).toBe("share-replay");
    expect(data.slot?.used).toBe(true);
  });

  it("with a used slot waits", () => {
    const used = judgeResults(emptyProgress(), solo, "7:1", ORDER).data;
    const { data, granted } = recordShare(used, "7:1", ORDER);
    expect(granted).toBeUndefined();
    expect(data.pending.map((p) => p.id)).toEqual(["share-replay"]);
  });

  it("with no round waits even with an open slot", () => {
    const open = judgeResults(emptyProgress(), dns, "7:1", ORDER).data;
    const { granted, data } = recordShare(open, undefined, ORDER);
    expect(granted).toBeUndefined();
    expect(data.slot).toEqual({ raceKey: "7:1", used: false });
  });

  it("for another round's key waits", () => {
    const open = judgeResults(emptyProgress(), dns, "7:1", ORDER).data;
    expect(recordShare(open, "7:2", ORDER).granted).toBeUndefined();
  });

  it("a waiting share is granted at the next results", () => {
    const waiting = recordShare(emptyProgress(), undefined, ORDER).data;
    expect(judgeResults(waiting, dns, "7:1", ORDER).granted).toBe("share-replay");
  });

  it("twice changes nothing the second time", () => {
    const once = recordShare(emptyProgress(), undefined, ORDER).data;
    expect(recordShare(once, undefined, ORDER).data).toEqual(once);
  });
});

describe("the slot", () => {
  it("closes at the next countdown", () => {
    const open = judgeResults(emptyProgress(), dns, "7:1", ORDER).data;
    expect(closeSlot(open).slot).toBeNull();
    expect(recordShare(closeSlot(open), "7:1", ORDER).granted).toBeUndefined();
  });
});

describe("counts", () => {
  it("count() feeds a tile's progress for the counted conditions only", () => {
    const { data } = play(emptyProgress(), [solo, solo]);
    expect(countOf(data, "games-5")).toBe(2);
    expect(countOf(data, "games-10")).toBe(2);
    expect(countOf(data, "any-match")).toBeUndefined();
  });

  it("caps at the goal", () => {
    const data = { ...emptyProgress(), stats: { matchesFinished: 30 } };
    expect(countOf(data, "games-5")).toBe(5);
  });

  it("solo matches alone earn every counted condition, each on the match that meets it", () => {
    const { data, grants } = play(emptyProgress(), Array.from({ length: 10 }, () => solo));
    expect(data.unlocked).toEqual(["any-match", "games-2", "games-3", "games-5", "games-7", "games-8", "games-10"]);
    const at = (id: string) => grants.indexOf(id) + 1;
    expect([at("games-2"), at("games-3"), at("games-5"), at("games-7"), at("games-8"), at("games-10")]).toEqual([2, 3, 5, 7, 8, 10]);
  });
});

describe("retired conditions", () => {
  it("keeps what a device earned under with-friend and two-devices", () => {
    const old = { ...emptyProgress(), unlocked: ["any-match", "with-friend"], pending: [{ id: "two-devices", seq: 3 }] };
    const storage = memory();
    storage.setItem(PROGRESS_KEY, JSON.stringify(old));
    const data = loadProgress(storage);
    expect(data.unlocked).toEqual(["any-match", "games-2"]);
    expect(data.pending).toEqual([{ id: "games-3", seq: 3 }]);
  });

  it("drops a pending entry its new ID already holds, and leaves current progress untouched", () => {
    const both = { ...emptyProgress(), unlocked: ["games-2"], pending: [{ id: "with-friend", seq: 1 }] };
    expect(migrateLegacy(both).pending).toEqual([]);
    const current = { ...emptyProgress(), unlocked: ["games-5"] };
    expect(migrateLegacy(current)).toBe(current);
  });
});

describe("reveal", () => {
  it("adds a key once", () => {
    const once = reveal(emptyProgress(), "character:frog");
    expect(reveal(once, "character:frog").revealed).toEqual(["character:frog"]);
  });
});
