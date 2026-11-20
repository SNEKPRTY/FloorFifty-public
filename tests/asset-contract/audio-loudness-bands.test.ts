/**
 * Loudness, pinned (polish spec §8.1, D-P7).
 *
 * Every audio row in the art manifest carries the loudness its own tool
 * measured; this holds each kind to its band, so a song that lands too loud,
 * or an effect someone forgot to process, fails the suite instead of the mix.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allAssets, isAudioAsset, parseArtManifest } from "@floor-fifty/asset-contract/manifest-schema";

const MANIFEST = resolve(process.cwd(), "packages/asset-contract/assets/art-manifest.json");
const audio = allAssets(parseArtManifest(JSON.parse(readFileSync(MANIFEST, "utf8"))))
  .map((entry) => entry.asset)
  .filter(isAudioAsset);

const near = (value: number, target: number, tolerance: number): boolean => Math.abs(value - target) <= tolerance;

/**
 * `ambience.*` loops that are not a stage's bed: the climb drone is mixed as
 * a layer of the song, "about the music's own level" (`DRONE_GAIN`), so it is
 * held to the music's band, not the beds'.
 */
const LAYERS_OF_THE_MUSIC = new Set(["ambience.climbDrone"]);
const report = (rows: readonly { alias: string }[], value: (row: never) => unknown) =>
  rows.map((row) => `${row.alias} ${String(value(row as never))}`);

describe("loudness bands (polish spec §8.1)", () => {
  it("has music, previews and the layers mixed into it included, at −16 LUFS integrated ±1", () => {
    const music = audio.filter((row) => row.alias.startsWith("music.") || LAYERS_OF_THE_MUSIC.has(row.alias));
    expect(music.length).toBeGreaterThan(0);
    const off = music.filter((row) => !near(row.loudnessLufs, -16, 1));
    expect(report(off, (row: { loudnessLufs: number }) => row.loudnessLufs)).toEqual([]);
  });

  it("has beds at −26 LUFS integrated ±1", () => {
    const beds = audio.filter((row) => row.alias.startsWith("ambience.") && !LAYERS_OF_THE_MUSIC.has(row.alias));
    expect(beds.length).toBeGreaterThan(0);
    const off = beds.filter((row) => !near(row.loudnessLufs, -26, 1));
    expect(report(off, (row: { loudnessLufs: number }) => row.loudnessLufs)).toEqual([]);
  });

  /** A synthesised cue is one `generate-cues.ts` wrote: its file is under `production/cues/`. */
  const synthesised = (row: { file: string }): boolean => row.file.startsWith("production/cues/");

  it("has every recorded one-shot peaking at −1 dBFS ±0.2", () => {
    const shots = audio.filter((row) => /^(sfx|ui|vo)\./.test(row.alias) && !synthesised(row));
    expect(shots.length).toBeGreaterThan(0);
    const off = shots.filter((row) => row.peakDbfs === undefined || !near(row.peakDbfs, -1, 0.2));
    expect(report(off, (row: { peakDbfs?: number }) => row.peakDbfs)).toEqual([]);
  });

  it("has every synthesised one-shot peaking at 0.7, −3.1 dBFS ±0.2 (Wonder spec §3.3)", () => {
    const shots = audio.filter((row) => /^(sfx|ui)\./.test(row.alias) && synthesised(row));
    expect(shots.length).toBeGreaterThan(0);
    const off = shots.filter((row) => row.peakDbfs === undefined || !near(row.peakDbfs, -3.1, 0.2));
    expect(report(off, (row: { peakDbfs?: number }) => row.peakDbfs)).toEqual([]);
  });

  it("synthesises every Wonder sound, and records none of them (Wonder spec §3.1)", () => {
    const WONDER = ["sfx.slam", "sfx.wrap", "ui.pop", "ui.tick", "ui.open", "ui.close", "ui.copied",
      "sfx.bounce", "sfx.wordPop", "sfx.streakStep", "sfx.stamp", "sfx.whoops"];
    const rows = WONDER.map((alias) => audio.find((row) => row.alias === alias));
    expect(rows.map((row, i) => (row === undefined ? `${WONDER[i]} missing` : synthesised(row) ? "ok" : `${row.alias} recorded`)))
      .toEqual(WONDER.map(() => "ok"));
  });

  it("synthesises the lava's sizzle, and does not record it (lava spec §5)", () => {
    const row = audio.find((candidate) => candidate.alias === "sfx.sizzle");
    expect(row === undefined ? "missing" : synthesised(row) ? "ok" : "recorded").toBe("ok");
  });

  it("records a peak for every audio row, so the next band can be checked", () => {
    expect(audio.filter((row) => row.peakDbfs === undefined).map((row) => row.alias)).toEqual([]);
  });
});
