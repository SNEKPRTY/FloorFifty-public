import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";

const { content } = parseGameContentArtifact(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../content/generated/content.json"), "utf8")),
);

describe("songs off the stage", () => {
  it("names no stage on any song", () => {
    for (const song of content.songs) expect(song).not.toHaveProperty("stageId");
  });

  it("keeps the dawn tutorial's song out of the catalog", () => {
    expect(content.songs.map((song) => song.id)).not.toContain("dawn-tutorial");
  });
});

const JUKEBOX = ["moving-on", "farther-from-home", "whats-next", "chrome-in-the-rain", "we-outside", "la-reina-del-mambo", "crash-mode", "pyramid-scheme", "static-in-the-air", "unseen"];
const LOCKED: Record<string, string> = { "crash-mode": "any-match", "pyramid-scheme": "games-2", "static-in-the-air": "games-3", unseen: "share-replay" };
const song = (id: string) => content.songs.find((entry) => entry.id === id)!;

describe("the jukebox", () => {
  it("lists the ten songs in jukebox order in the base pack", () => {
    const base = content.packs.find((pack) => pack.id === "base")!;
    expect(base.songs.filter((id) => JUKEBOX.includes(id))).toEqual(JUKEBOX);
  });

  it("gives every song a cover, timing, a preview window and a results window", () => {
    for (const id of JUKEBOX) {
      expect(song(id).coverAlias).toBe(`cover.${id.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())}`);
      expect(song(id).bpm).toBeGreaterThan(0);
      expect(song(id).loopEndMs).toBeGreaterThan(song(id).loopStartMs);
      expect(song(id).resultsEndMs! - song(id).resultsStartMs!).toBeGreaterThanOrEqual(8000);
      expect(song(id).previewEndMs! - song(id).previewStartMs!).toBeGreaterThanOrEqual(8000);
      expect(song(id).previewEndMs!).toBeLessThanOrEqual(song(id).loopEndMs);
    }
  });

  it("locks the last four songs behind their conditions, in grant order", () => {
    for (const [id, condition] of Object.entries(LOCKED)) expect(song(id).unlock).toBe(condition);
    for (const id of JUKEBOX.slice(0, 6)) expect(song(id).unlock).toBeUndefined();
  });
});
