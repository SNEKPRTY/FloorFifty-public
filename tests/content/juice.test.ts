import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildPayload } from "@floor-fifty/content/canonicalize";
import { compile } from "@floor-fifty/content/compiler";
import { parseSources } from "@floor-fifty/content/parse";
import { validateJuice } from "@floor-fifty/content/validate/juice";
import { REPO_ROOT, temporaryContentPaths, validTree } from "./support";

// These tests copy and write temporary file trees. In the gate's CPU pod the disk stalled for more than the 5 s
// default now and then (2026-11-18, run 44413282784), though each takes 3 to 100 ms in a container; 30 s is a
// ceiling for a stalled disk, and a test that really hangs still fails.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const AUTHORED = readFileSync(resolve(REPO_ROOT, "content/juice.toml"), "utf8");
const parse = (text: string) => parseSources({ ...validTree(), juice: { file: "content/juice.toml", text } });
const withLine = (from: string, to: string): string => {
  expect(AUTHORED).toContain(from);
  return AUTHORED.replace(from, to);
};

describe("juice.toml", () => {
  it("parses the authored file into the payload", () => {
    const result = parse(AUTHORED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildPayload(result.parsed).juice.slam.hitStopMs).toBe(50);
  });

  it("reads the springs, the lean and the squash knocks (Wonder spec §4.1, §4.2)", () => {
    const result = parse(AUTHORED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const juice = buildPayload(result.parsed).juice;
    expect(juice.bounce.squash).toEqual({ amount: 0.25 });
    expect(juice.slam.squash).toEqual({ amount: 0.5 });
    expect(juice.springs.squash).toEqual({ f: 4, zeta: 0.35, r: 0 });
    expect(juice.lean).toEqual({ maxDeg: 12, fullSpeed: 356, stepDeg: 3 });
    expect(juice.slam.dust.sparks).toBe(6);
    expect(juice.wrap.sparks).toBe(4);
  });

  it("reads the words' tuning (Wonder spec §5)", () => {
    const result = parse(AUTHORED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const words = buildPayload(result.parsed).juice.words;
    expect(words.localCap).toBe(2);
    expect(words.repeatGapMs).toBe(1500);
    expect(words.streakFrom).toBe(3);
    expect(words.skewDeg).toBe(12);
  });

  it("refuses a streak whose nice comes before it starts", () => {
    expect(parse(withLine("niceFrom = 5", "niceFrom = 2")).ok).toBe(false);
  });

  it("refuses a spring that cannot answer", () => {
    expect(parse(withLine("squash = { f = 4, zeta = 0.35, r = 0 }", "squash = { f = 0, zeta = 0.35, r = 0 }")).ok).toBe(false);
  });

  it("refuses a lean past 30 degrees", () => {
    expect(parse(withLine("maxDeg = 12", "maxDeg = 45")).ok).toBe(false);
  });

  it("refuses a squash knock past 0.6", () => {
    expect(parse(withLine("squash = { amount = 0.25 }", "squash = { amount = 0.9 }")).ok).toBe(false);
  });

  it("refuses a particle limit past its range", () => {
    expect(parse(withLine("particles = 160", "particles = 4096")).ok).toBe(false);
    expect(parse(withLine("particles = 160", "particles = 0")).ok).toBe(false);
  });

  it("refuses a slam threshold outside 0–1", () => {
    expect(parse(withLine("threshold = 0.6", "threshold = 1.5")).ok).toBe(false);
  });

  it("refuses a hit-stop long enough to hold the picture of an input", () => {
    expect(parse(withLine("hitStopMs = 50", "hitStopMs = 500")).ok).toBe(false);
  });

  it("refuses an unknown key", () => {
    const result = parse(`${AUTHORED}\n[shake]\nunits = 4\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]!.code).toBe("unknownField");
  });

  it("refuses a stage override naming no palette role", () => {
    expect(parse(withLine("[palette.stages]", '[palette.stages.rooftops]\ndust = "glitter"')).ok).toBe(false);
  });

  it("refuses a stage override for a stage that does not exist", () => {
    const result = parse(withLine("[palette.stages]", '[palette.stages.moon]\ndust = "cloud"'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateJuice(result.parsed)).toEqual([
      expect.objectContaining({ code: "unknownReference", file: "content/juice.toml" }),
    ]);
  });

  it("accepts a stage override for a stage that exists", () => {
    const result = parse(withLine("[palette.stages]", '[palette.stages.rooftops]\ndust = "cloud"'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateJuice(result.parsed)).toEqual([]);
  });

  it("reports a missing juice.toml as a missing required file", async () => {
    const paths = await temporaryContentPaths();
    await rm(join(paths.sourceRoot, "juice.toml"));
    const result = await compile(paths);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "missingField", file: "content/juice.toml" }),
      );
  });
});
