import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import {
  distinctPicks,
  playerRows,
  revealByline,
  revealCoversToFetch,
  secondsLeft,
  seedChoiceLabel,
  type PlayerRow,
} from "../../../../apps/client/src/features/select/select-model";
import { lobbySnapshot, LOCAL_ID, playerSnapshot, REMOTE_ID } from "../../support/snapshots";

const { content } = parseGameContentArtifact(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../content/generated/content.json"), "utf8")),
);
const art = (alias: string) => `/assets/${alias}`;
const inSelect = (tick: number) => ({
  ...lobbySnapshot(2, { players: [playerSnapshot({ characterId: "frog" }), playerSnapshot({ id: REMOTE_ID, name: "Sable", colour: "cyan" })] }),
  phase: "select" as const,
  tick,
  select: {
    step: "stage" as const,
    endsAtTick: 900,
    picks: { [LOCAL_ID]: { focus: "snow-shrine", locked: false, seed: "random" as const }, [REMOTE_ID]: { focus: "rooftops", locked: true, seed: "random" as const } },
    loaded: [],
  },
});

describe("the select model", () => {
  it("counts down in whole seconds and never below zero", () => {
    expect(secondsLeft(inSelect(0))).toBe(15);
    expect(secondsLeft(inSelect(900 - TICK_HZ + 1))).toBe(1);
    expect(secondsLeft(inSelect(2000))).toBe(0);
  });

  it("gives one row per player: bust, name, the stage they are on, whether they locked", () => {
    expect(playerRows(inSelect(0), content, art, LOCAL_ID)).toEqual([
      { seat: 0, name: "Kite", colour: "scarlet", art: "/assets/portrait.frogScarlet", itemId: "snow-shrine", itemLabel: "Snow Shrine", locked: false, local: true },
      { seat: 1, name: "Sable", colour: "cyan", art: "/assets/portrait.cyan", itemId: "rooftops", itemLabel: "Rooftops", locked: true, local: false },
    ]);
  });

  it("labels a stage pick's seed when it is Classic or a code, never the default Random (stage seeds spec §4.3)", () => {
    const base = inSelect(0);
    const seeded = {
      ...base,
      select: { ...base.select, picks: { [LOCAL_ID]: { focus: "snow-shrine", locked: false, seed: 48213 }, [REMOTE_ID]: { focus: "rooftops", locked: true, seed: "classic" as const } } },
    };
    expect(playerRows(seeded, content, art, LOCAL_ID).map((row) => row.seedLabel)).toEqual(["#048213", "Classic"]);
  });

  it("gives a song step's rows no seed", () => {
    const base = inSelect(0);
    const songStep = { ...base, select: { ...base.select, step: "song" as const } };
    expect(playerRows(songStep, content, art, LOCAL_ID, "song").some((row) => "seedLabel" in row)).toBe(false);
  });

  it("names a seed choice", () => {
    expect([seedChoiceLabel("random"), seedChoiceLabel("classic"), seedChoiceLabel(7)]).toEqual(["Random", "Classic", "#000007"]);
  });

  it("names a Random pick, and has no row for a seat nobody holds", () => {
    const solo = {
      ...inSelect(0),
      players: [inSelect(0).players[0]!],
      select: { ...inSelect(0).select, picks: { [LOCAL_ID]: { focus: "?", locked: true, seed: "random" as const } } },
    };
    const rows = playerRows(solo, content, art, LOCAL_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemId: "?", itemLabel: "Random stage" });
  });

  it("says whose pick won, and Your pick for your own", () => {
    const rows = playerRows(inSelect(0), content, art, LOCAL_ID);
    expect(revealByline(rows, 1)).toBe("Picked by Sable");
    expect(revealByline(rows, 0)).toBe("Your pick");
    expect(revealByline(rows, 3)).toBe("");
  });

  it("names a song step's picks by song, and a Random pick as Random song", () => {
    const base = inSelect(0);
    const songStep = {
      ...base,
      select: { ...base.select, step: "song" as const, picks: { [LOCAL_ID]: { focus: "moving-on", locked: false, seed: "random" as const }, [REMOTE_ID]: { focus: "?", locked: true, seed: "random" as const } } },
    };
    expect(playerRows(songStep, content, art, LOCAL_ID, "song").map((row) => row.itemLabel)).toEqual(["Moving On", "Random song"]);
  });
});

describe("the picks that differ from yours", () => {
  const row = (seat: number, itemId: string, local = false): PlayerRow => ({
    seat,
    name: ["Kite", "Sable", "Wren", "Koi"][seat]!,
    colour: (["scarlet", "cyan", "gold", "violet"] as const)[seat]!,
    itemId,
    itemLabel: itemId,
    locked: false,
    local,
  });

  it("keeps your own pick and every pick that differs", () => {
    const rows = distinctPicks([row(0, "rooftops", true), row(1, "sunken-dome"), row(2, "rooftops")]);
    expect(rows.map((r) => r.itemLabel)).toEqual(["rooftops", "sunken-dome", undefined]);
  });

  it("keeps every row, so nobody's lock is hidden", () => {
    const rows = distinctPicks([row(0, "rooftops", true), { ...row(1, "rooftops"), locked: true }]);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.locked).toBe(true);
  });

  it("changes nothing when this device holds no seat", () => {
    const rows = [row(0, "rooftops"), row(1, "rooftops")];
    expect(distinctPicks(rows)).toEqual(rows);
  });
});

describe("the song reveal's covers, fetched while the players pick (Owner, 2026-10-10)", () => {
  const songStep = (picks: Record<string, string>) => {
    const base = inSelect(0);
    return {
      ...base,
      select: {
        ...base.select,
        step: "song" as const,
        picks: Object.fromEntries(Object.entries(picks).map(([id, focus]) => [id, { focus, locked: false, seed: "random" as const }])),
      },
    };
  };

  it("asks for the large cover of each song a player is on, once each", () => {
    expect(revealCoversToFetch(songStep({ [LOCAL_ID]: "moving-on", [REMOTE_ID]: "whats-next" }), content, art)).toEqual([
      "/assets/cover.movingOnFull",
      "/assets/cover.whatsNextFull",
    ]);
    expect(revealCoversToFetch(songStep({ [LOCAL_ID]: "moving-on", [REMOTE_ID]: "moving-on" }), content, art)).toEqual([
      "/assets/cover.movingOnFull",
    ]);
  });

  it("asks for nothing for Random, an unknown song, or outside the song step", () => {
    expect(revealCoversToFetch(songStep({ [LOCAL_ID]: "random", [REMOTE_ID]: "no-such-song" }), content, art)).toEqual([]);
    expect(revealCoversToFetch(inSelect(0), content, art)).toEqual([]);
  });
});

