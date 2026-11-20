import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { asContentId, parseGameContentArtifact, type GameContentPayload } from "@floor-fifty/shared/content/game-content";
import {
  accessibleLabel,
  indexOf,
  moveTo,
  settledPick,
  songItems,
  stageItems,
  type PickerItem,
} from "../../../../apps/client/src/features/select/picker-model";

const { content } = parseGameContentArtifact(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../content/generated/content.json"), "utf8")),
);
const art = (alias: string) => `/assets/${alias}`;

describe("the picker model", () => {
  it("leads with Random, then every stage in pack order, each with its preview still", () => {
    const items = stageItems(content, art, { unlockAll: false });
    expect(items.map((item) => item.id)).toEqual(["?", "rooftops", "snow-shrine", "sunken-dome"]);
    expect(items[0]).toEqual({ id: "?", label: "Random stage", state: "open" });
    expect(items[1]).toMatchObject({ label: "Rooftops", state: "open", art: "/assets/still.rooftopsPreview" });
  });

  it("marks a DLC stage and says why it cannot be picked", () => {
    const withDlc: GameContentPayload = {
      ...content,
      packs: [
        ...content.packs,
        { id: asContentId("far"), title: "Far", dlc: true, stages: [asContentId("snow-shrine-far")], songs: [], characters: [] },
      ],
      stages: [...content.stages, { ...content.stages[1]!, id: asContentId("snow-shrine-far"), displayName: "Far Shrine" }],
    };
    const far = stageItems(withDlc, art, { unlockAll: false }).find((item) => item.id === "snow-shrine-far")!;
    expect(far).toMatchObject({ state: "dlc", reason: "DLC · Far pack" });
    expect(stageItems(withDlc, art, { unlockAll: true }).find((item) => item.id === "snow-shrine-far")!.state).toBe("open");
  });

  it("wraps a move past either end", () => {
    expect(moveTo(3, 1, 4)).toBe(0);
    expect(moveTo(0, -1, 4)).toBe(3);
    expect(moveTo(1, 1, 4)).toBe(2);
  });

  it("keeps the last pickable pick on a locked slide", () => {
    const items: PickerItem[] = [
      { id: "?", label: "Random stage", state: "open" },
      { id: "a", label: "A", state: "open" },
      { id: "b", label: "B", state: "locked", reason: "Finish any match" },
    ];
    expect(settledPick(items, 1)).toBe("a");
    expect(settledPick(items, 0)).toBe("?");
    expect(settledPick(items, 2)).toBeUndefined();
  });

  it("finds an item by ID, and names the panel for assistive technology", () => {
    const items = stageItems(content, art, { unlockAll: false });
    expect(indexOf(items, "snow-shrine")).toBe(2);
    expect(indexOf(items, "nowhere")).toBe(-1);
    expect(accessibleLabel("Stage", items, 2)).toBe("Stage, 3 of 4: Snow Shrine");
  });
});

describe("the song items", () => {
  it("leads with Random song, then every song in pack order, each with its large cover", () => {
    const items = songItems(content, art, { unlockAll: false });
    expect(items[0]).toEqual({ id: "?", label: "Random song", state: "open" });
    expect(items.find((item) => item.id === "moving-on")).toMatchObject({ label: "Moving On", state: "open", art: "/assets/cover.movingOnLarge" });
    // The tutorial's song is in no pack, so it is never a slide.
    expect(items.map((item) => item.id)).not.toContain("dawn-tutorial");
  });

  it("shows a locked song with its hint, and opens it under unlock-all", () => {
    expect(songItems(content, art, { unlockAll: false }).find((item) => item.id === "unseen")).toMatchObject({ state: "locked", reason: "Save or share a video" });
    expect(songItems(content, art, { unlockAll: true }).find((item) => item.id === "unseen")!.state).toBe("open");
  });

  it("marks a DLC song and says why it cannot be picked", () => {
    const withDlc: GameContentPayload = {
      ...content,
      packs: [...content.packs, { id: asContentId("far"), title: "Far", dlc: true, stages: [], songs: [asContentId("far-song")], characters: [] }],
      songs: [...content.songs, { ...content.songs[0]!, id: asContentId("far-song"), displayName: "Far Song" }],
    };
    expect(songItems(withDlc, art, { unlockAll: false }).find((item) => item.id === "far-song")).toMatchObject({ state: "dlc", reason: "DLC · Far pack" });
  });

  it("leaves the art off a song with no cover, for the slide's plate", () => {
    const bare: GameContentPayload = { ...content, songs: content.songs.map(({ coverAlias: _cover, ...song }) => song) };
    expect(songItems(bare, art, { unlockAll: false }).find((item) => item.id === "moving-on")!.art).toBeUndefined();
  });

  it("marks an earned, unrevealed song new (unlockables spec §7.2)", () => {
    const progress = { unlocked: () => true, count: () => undefined, isNew: (key: string) => key === "song:crash-mode" };
    const items = songItems(content, art, { unlockAll: false, progress });
    expect(items.find((item) => item.id === "crash-mode")).toMatchObject({ state: "open", isNew: true });
    expect(items.find((item) => item.id === "moving-on")!.isNew).toBeUndefined();
  });
});
