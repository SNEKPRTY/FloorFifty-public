import { describe, expect, it } from "vitest";
import { monoSamples, readWav, sampleOffset, writeWav } from "../../packages/asset-contract/tools/wav";

describe("wav", () => {
  it("round-trips 16-bit stereo PCM, and mixes to mono", () => {
    const left = new Float32Array([0, 0.5, -0.5, 1]);
    const right = new Float32Array([0, 0.5, 0.5, -1]);
    const wav = readWav(writeWav([left, right], 48000));
    expect(wav).toMatchObject({ sampleRate: 48000, channels: 2, bitsPerSample: 16, format: "pcm", frames: 4 });
    const mono = monoSamples(wav);
    expect(mono[1]).toBeCloseTo(0.5, 3);
    expect(mono[2]).toBeCloseTo(0, 3);
  });

  it("cuts a frame range", () => {
    const wav = readWav(writeWav([new Float32Array([0.1, 0.2, 0.3, 0.4])], 48000));
    expect([...monoSamples(wav, 1, 3)].map((value) => Number(value.toFixed(2)))).toEqual([0.2, 0.3]);
  });

  it("refuses what is not a WAV", () => {
    expect(() => readWav(new Uint8Array(64))).toThrow(/not a WAV/);
  });

  it("finds no offset between a signal and itself, and the lag of a delayed copy", () => {
    let seed = 7;
    const noise = Float32Array.from({ length: 4 * 48000 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 1.6 - 0.8);
    const delayed = new Float32Array(noise.length);
    delayed.set(noise.subarray(0, noise.length - 100), 100);
    const master = readWav(writeWav([noise, noise], 48000));
    expect(sampleOffset(master, master, 256)).toBe(0);
    expect(sampleOffset(master, readWav(writeWav([delayed, delayed], 48000)), 256)).toBe(100);
  });
});
