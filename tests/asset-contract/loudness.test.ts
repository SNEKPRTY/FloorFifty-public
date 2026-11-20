import { describe, expect, it } from "vitest";
import { integratedLoudness, loudestWindowMs } from "../../packages/asset-contract/tools/loudness";

const RATE = 48000;
const sine = (seconds: number, amplitude: number): Float32Array =>
  Float32Array.from({ length: seconds * RATE }, (_unused, i) => amplitude * Math.sin((2 * Math.PI * 1000 * i) / RATE));

describe("loudness", () => {
  it("reads a -20 dBFS 1 kHz stereo sine as about -20 LUFS", () => {
    const tone = sine(10, 0.1);
    expect(integratedLoudness([tone, tone], RATE)).toBeCloseTo(-20, 0);
  });

  it("gives silence the floor rather than minus infinity", () => {
    const silence = new Float32Array(RATE);
    expect(integratedLoudness([silence, silence], RATE)).toBe(-70);
  });

  it("finds the loudest stretch, on whole seconds", () => {
    const quiet = sine(30, 0.05);
    quiet.set(sine(16, 0.5), 10 * RATE);
    expect(loudestWindowMs([quiet, quiet], RATE, 16_000)).toBe(10_000);
  });

  it("finds the loudest stretch clear of a window it is told to avoid", () => {
    const track = sine(60, 0.05);
    track.set(sine(16, 0.5), 10 * RATE);
    track.set(sine(16, 0.3), 40 * RATE);
    expect(loudestWindowMs([track, track], RATE, 16_000, { startMs: 10_000, endMs: 26_000 })).toBe(40_000);
    // Overlapping the avoided window by any part counts as not clear of it.
    expect(loudestWindowMs([track, track], RATE, 16_000, { startMs: 30_000, endMs: 45_000 })).toBe(10_000);
  });
});
