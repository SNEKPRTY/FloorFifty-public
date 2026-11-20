import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { downbeatMs, estimateBpm, msToTicks, onsetEnvelope } from "../../packages/asset-contract/tools/beat-grid";
import { monoSamples, readWav } from "../../packages/asset-contract/tools/wav";

/** A click track: 10 ms decaying noise bursts on every beat, from `offsetMs`. */
function clicks(bpm: number, offsetMs: number, seconds: number, sampleRate = 48000): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  let seed = 1;
  const noise = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let t = offsetMs / 1000; t < seconds; t += 60 / bpm) {
    const start = Math.round(t * sampleRate);
    for (let i = 0; i < sampleRate * 0.01 && start + i < out.length; i += 1) out[start + i] = noise() * Math.exp(-i / (sampleRate * 0.002));
  }
  return out;
}

/** The distance between two beat phases, around the beat. */
const phaseError = (measuredMs: number, expectedMs: number, beatMs: number): number => {
  const difference = Math.abs(measuredMs - expectedMs) % beatMs;
  return Math.min(difference, beatMs - difference);
};

/** The masters, beside the main checkout: a worktree reaches it through git's common directory. */
function mastersDir(): string | undefined {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: import.meta.dirname,
      encoding: "utf8",
    });
    return resolve(common.trim(), "../_CommericalSongs");
  } catch {
    return undefined; // not a git checkout
  }
}
const CHROME = resolve(mastersDir() ?? "/nowhere", "Chrome in the Rain Remastered.wav");

describe("the beat grid", () => {
  it.each([
    [128, 250],
    [146, 405],
    [92, 120],
    [174, 60],
  ])("measures %d BPM with the first beat at %d ms", (bpm, offsetMs) => {
    const { envelope, hopSeconds, windowSeconds } = onsetEnvelope(clicks(bpm, offsetMs, 30), 48000);
    const measured = estimateBpm(envelope, hopSeconds);
    expect(Math.abs(measured - bpm)).toBeLessThanOrEqual(0.1);
    expect(phaseError(downbeatMs(envelope, hopSeconds, windowSeconds, measured), offsetMs, 60000 / bpm)).toBeLessThanOrEqual(15);
  });

  it("does not lock to half tempo", () => {
    const { envelope, hopSeconds } = onsetEnvelope(clicks(150, 0, 30), 48000);
    expect(Math.round(estimateBpm(envelope, hopSeconds))).toBe(150);
  });

  it("rounds milliseconds to ticks", () => {
    expect(msToTicks(405.5)).toBe(24);
  });

  // Only where the masters are: the owner's Mac. CI and a fresh clone skip it.
  it.skipIf(!existsSync(CHROME))("agrees with Chrome in the Rain's measured 146 BPM and first beat at 405.5 ms", () => {
    const wav = readWav(readFileSync(CHROME));
    const { envelope, hopSeconds, windowSeconds } = onsetEnvelope(monoSamples(wav), wav.sampleRate);
    const bpm = estimateBpm(envelope, hopSeconds);
    expect(bpm).toBeCloseTo(146, 1);
    // Within a tick of the reviewed downbeat, as a phase: the grid may name the beat before it.
    expect(phaseError(downbeatMs(envelope, hopSeconds, windowSeconds, bpm), 405.5, 60000 / bpm)).toBeLessThanOrEqual(1000 / 60);
  }, 30_000);
});
