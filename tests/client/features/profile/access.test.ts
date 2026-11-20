import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import { deviceAccess, NO_PROGRESS, tileAccess, unlockAllFor } from "../../../../apps/client/src/features/profile/access";

const { content } = parseGameContentArtifact(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../content/generated/content.json"), "utf8")),
);

describe("device access", () => {
  it("is the open set with nothing earned or bought", () => {
    expect(deviceAccess(content, { unlockAll: false }).characters).toEqual(["ninja"]);
  });

  it("is everything with ?dev=unlock-all", () => {
    expect(deviceAccess(content, { unlockAll: true }).characters).toEqual(content.characters.map((character) => character.id));
  });

  it("honours ?dev=unlock-all only in a dev build", () => {
    expect(unlockAllFor("?dev=unlock-all", true)).toBe(true);
    expect(unlockAllFor("?dev=unlock-all", false)).toBe(false);
    expect(unlockAllFor("?dev=other", true)).toBe(false);
    expect(unlockAllFor("?x=1&dev=unlock-all", true)).toBe(true);
  });

  it("counts a locked tile's progress towards its goal when the store knows it", () => {
    const progress = { unlocked: () => false, count: (id: string) => (id === "games-5" ? 2 : undefined) };
    expect(tileAccess(content, "character", "frog", { unlockAll: false, progress })).toEqual({
      state: "locked",
      hint: "Finish 5 races",
      goal: 5,
      count: 2,
      progress: "2/5",
    });
  });

  it("describes each tile's state", () => {
    expect(tileAccess(content, "character", "ninja", { unlockAll: false })).toEqual({ state: "open" });
    expect(tileAccess(content, "character", "frog", { unlockAll: false })).toEqual({ state: "locked", hint: "Finish 5 races", goal: 5 });
    expect(
      tileAccess(content, "character", "frog", { unlockAll: false, progress: { ...NO_PROGRESS, count: () => 2 } }),
    ).toEqual({ state: "locked", hint: "Finish 5 races", goal: 5, count: 2, progress: "2/5" });
    expect(tileAccess(content, "character", "robo", { unlockAll: false })).toEqual({ state: "locked", hint: "Finish 7 races", goal: 7 });
    expect(tileAccess(content, "character", "penguin", { unlockAll: false })).toEqual({ state: "dlc" });
    expect(tileAccess(content, "character", "penguin", { unlockAll: true })).toEqual({ state: "open" });
  });

  it("an owned pack and an earned item reach the access set", () => {
    const progress = { unlocked: (id: string) => id === "games-5", count: () => undefined };
    const entitlements = { owns: (id: string) => id === "after-hours" };
    expect(deviceAccess(content, { unlockAll: false, progress, entitlements }).characters).toEqual(
      expect.arrayContaining(["ninja", "frog", "penguin", "oni", "witch", "knight"]),
    );
  });

  it("marks an earned, unrevealed tile new, and never under unlock-all", () => {
    const progress = { unlocked: () => true, count: () => undefined, isNew: (key: string) => key === "character:frog" };
    expect(tileAccess(content, "character", "frog", { unlockAll: false, progress })).toEqual({ state: "open", isNew: true });
    expect(tileAccess(content, "character", "ninja", { unlockAll: false, progress })).toEqual({ state: "open" });
    expect(tileAccess(content, "character", "frog", { unlockAll: true, progress })).toEqual({ state: "open" });
  });
});
