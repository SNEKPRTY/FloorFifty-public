// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import type { RaceFacts } from "@floor-fifty/shared/unlocks/conditions";
import { PROGRESS_KEY } from "../../../../apps/client/src/features/profile/progress";
import type { SettingsStorage } from "../../../../apps/client/src/features/profile/settings";
import { ProgressStore } from "../../../../apps/client/src/features/profile/store/progress.svelte";

const { content } = parseGameContentArtifact(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../content/generated/content.json"), "utf8")),
);

const memory = (seed: Record<string, string> = {}) => {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
  } satisfies SettingsStorage & { values: Map<string, string> };
};
const solo: RaceFacts = { phase: "finished", localPlayerId: "me", seats: [{ id: "me", status: "connected", deviceClass: "desktop", cpu: false }] };

describe("the live progress store", () => {
  it("judges, saves, and tells listeners once per change", () => {
    const storage = memory();
    const store = new ProgressStore(storage, () => content);
    let calls = 0;
    store.subscribe(() => (calls += 1));
    expect(store.judge(solo, "7:1")).toBe("any-match");
    expect(store.unlocked("any-match")).toBe(true);
    expect(JSON.parse(storage.values.get(PROGRESS_KEY)!).unlocked).toEqual(["any-match"]);
    expect(store.judge(solo, "7:1")).toBeUndefined();
    expect(calls).toBe(1);
  });

  it("a grant survives a storage that throws on write", () => {
    const throwing: SettingsStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const store = new ProgressStore(throwing, () => content);
    expect(store.judge(solo, "7:1")).toBe("any-match");
    expect(store.unlocked("any-match")).toBe(true);
  });

  it("does not write an unreadable value until something changes", () => {
    const storage = memory({ [PROGRESS_KEY]: "garbage" });
    const store = new ProgressStore(storage, () => content);
    store.closeSlot();
    expect(storage.values.get(PROGRESS_KEY)).toBe("garbage");
  });

  it("an item is new once granted and until revealed", () => {
    const store = new ProgressStore(memory(), () => content);
    expect(store.isNew("song:crash-mode")).toBe(false);
    store.judge(solo, "7:1");
    expect(store.isNew("song:crash-mode")).toBe(true);
    expect(store.isNew("character:ninja")).toBe(false);
    store.reveal("song:crash-mode");
    expect(store.isNew("song:crash-mode")).toBe(false);
  });

  it("counts the counted conditions for a tile", () => {
    const store = new ProgressStore(memory(), () => content);
    store.judge(solo, "7:1");
    expect(store.count("games-5")).toBe(1);
    expect(store.count("any-match")).toBeUndefined();
  });

  it("a share on the results' round grants at once", () => {
    const store = new ProgressStore(memory(), () => content);
    store.judge({ ...solo, seats: [{ id: "me", status: "dns", deviceClass: "desktop", cpu: false }] }, "7:1");
    expect(store.share("7:1")).toBe("share-replay");
  });

  it("a second tab's change keeps the first tab's grant: each change starts from what is stored", () => {
    const storage = memory();
    const first = new ProgressStore(storage, () => content);
    const second = new ProgressStore(storage, () => content);
    expect(first.judge(solo, "7:1")).toBe("any-match");
    second.reveal("stage:rooftops");
    const stored = JSON.parse(storage.values.get(PROGRESS_KEY)!);
    expect(stored.unlocked).toEqual(["any-match"]);
    expect(stored.stats.matchesFinished).toBe(1);
    expect(stored.revealed).toEqual(["stage:rooftops"]);
    // And the second tab now knows it too.
    expect(second.unlocked("any-match")).toBe(true);
  });

  it("never writes over a newer build's progress", () => {
    const newer = JSON.stringify({ version: 2, unlocked: ["any-match", "games-5"], ledger: [] });
    const storage = memory({ [PROGRESS_KEY]: newer });
    const store = new ProgressStore(storage, () => content);
    expect(store.judge(solo, "7:1")).toBe("any-match");
    store.reveal("song:crash-mode");
    expect(storage.values.get(PROGRESS_KEY)).toBe(newer);
    // The grant still happens, for this session.
    expect(store.unlocked("any-match")).toBe(true);
  });

  it("keeps a field a later v1 build added", () => {
    const storage = memory({
      [PROGRESS_KEY]: JSON.stringify({ version: 1, seq: 0, unlocked: ["any-match"], pending: [], stats: { matchesFinished: 3 }, counted: [], slot: null, revealed: [], streak: 4 }),
    });
    const store = new ProgressStore(storage, () => content);
    expect(store.count("games-5")).toBe(3);
    store.reveal("song:crash-mode");
    const stored = JSON.parse(storage.values.get(PROGRESS_KEY)!);
    expect(stored.streak).toBe(4);
    expect(stored.stats.matchesFinished).toBe(3);
  });
});
