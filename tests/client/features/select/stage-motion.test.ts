// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IDLE_FRAMES, SHEET, SHEET_ROWS, sequence, type StageFrame } from "../../../../apps/client/src/features/select/stage-motion";

type Entry = { alias: string; animations: Record<string, unknown> };
function characterEntries(node: unknown): Entry[] {
  if (Array.isArray(node)) return node.flatMap(characterEntries);
  if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record["role"] === "character" && typeof record["animations"] === "object") return [record as unknown as Entry];
    return Object.values(record).flatMap(characterEntries);
  }
  return [];
}
const total = (frames: readonly StageFrame[]) => frames.reduce((sum, frame) => sum + frame.ms, 0);
const row = (name: (typeof SHEET_ROWS)[number]) => SHEET_ROWS.indexOf(name);

describe("stage-motion", () => {
  it("reads a sheet's rows in the manifest's order", () => {
    const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../packages/asset-contract/assets/art-manifest.json"), "utf8"));
    const entries = characterEntries(manifest);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const keys = Object.keys(entry.animations);
      expect(SHEET_ROWS.slice(0, keys.length), entry.alias).toEqual(keys);
    }
    expect(SHEET.rows).toBe(SHEET_ROWS.length);
  });

  it("idles on idle's two frames, 900 ms round", () => {
    expect(IDLE_FRAMES.map((frame) => [frame.row, frame.column])).toEqual([[row("idle"), 0], [row("idle"), 1]]);
    expect(total(IDLE_FRAMES)).toBe(900);
  });

  it("drops in: falls, lands with dust, in 350 ms", () => {
    const drop = sequence("drop", false);
    expect(drop[0]!.row).toBe(row("fall"));
    expect(drop.at(-2)).toMatchObject({ row: row("land"), column: 0, lift: 0, dust: true });
    expect(drop.at(-1)).toMatchObject({ row: row("land"), column: 1, lift: 0 });
    expect(total(drop)).toBe(350);
  });

  it("hops on a pick: jumps, lands, in the 500 ms the page waits", () => {
    const hop = sequence("hop", false);
    expect(hop[0]!.row).toBe(row("jump"));
    expect(hop.at(-1)).toMatchObject({ row: row("land"), lift: 0 });
    expect(total(hop)).toBe(500);
  });

  it("keeps every frame on the sheet and on whole pixels", () => {
    for (const frame of [...IDLE_FRAMES, ...sequence("drop", false), ...sequence("hop", false)]) {
      expect(frame.row).toBeLessThan(SHEET.rows);
      expect(frame.column).toBeLessThan(SHEET.columns);
      expect(Number.isInteger(frame.lift)).toBe(true);
      expect(frame.ms).toBeGreaterThan(0);
    }
  });

  it("cuts with reduced motion", () => {
    expect(sequence("drop", true)).toEqual([]);
    expect(sequence("hop", true)).toEqual([]);
  });
});
