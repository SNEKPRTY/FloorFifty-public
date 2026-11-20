// @vitest-environment node
/**
 * The song as motion: legs of the duotone's ping pong timed to its kick, and
 * spikes off its highs, heard from the spectrum with nothing authored.
 */

import { describe, expect, it } from "vitest";
import type { MusicSpectrum } from "../../../../apps/client/src/features/audio";
import { MusicPulse, songBeatAt } from "../../../../apps/client/src/features/render/music-pulse";

const BIN_HZ = 48_000 / 1024;
const FRAME = 1 / 60;

/** The analyser's byte range, as the engine leaves it: -100 dB to -30 dB. */
const MIN_DB = -100;
const MAX_DB = -30;

/**
 * A spectrum in decibels: the kick's band at `lowDb` and the hats' at
 * `highDb`, everything else silent. The bytes are what the analyser would
 * give for the same frame, clipped at its ceiling as the real one is.
 */
const spectrumDb = (lowDb: number, highDb = -Infinity): MusicSpectrum => {
  const decibels = new Float32Array(512).fill(-Infinity);
  decibels.forEach((_, bin) => {
    const hz = bin * BIN_HZ;
    if (hz >= 40 && hz < 160) decibels[bin] = lowDb;
    else if (hz >= 5_000 && hz < 14_000) decibels[bin] = highDb;
  });
  const bins = new Uint8Array(512);
  decibels.forEach((db, bin) => {
    bins[bin] = Math.max(0, Math.min(255, Math.floor((255 / (MAX_DB - MIN_DB)) * (db - MIN_DB))));
  });
  return { bins, decibels, binHz: BIN_HZ };
};

/** A spectrum with the kick's band at `low` and the hats' at `high`, both 0 to 1 of the analyser's byte range. */
const spectrum = (low: number, high = 0): MusicSpectrum =>
  spectrumDb(low > 0 ? MIN_DB + low * (MAX_DB - MIN_DB) : -Infinity, high > 0 ? MIN_DB + high * (MAX_DB - MIN_DB) : -Infinity);

/** Plays a kick every `beatSeconds` for `seconds`, calling `each` per frame. */
const playKicks = (
  pulse: MusicPulse,
  beatSeconds: number,
  seconds: number,
  each?: (frame: ReturnType<MusicPulse["update"]>, at: number) => void,
): void => {
  for (let at = 0; at < seconds; at += FRAME) {
    const intoBeat = at % beatSeconds;
    const frame = pulse.update(FRAME, spectrum(intoBeat < 0.08 ? 0.9 : 0.05));
    each?.(frame, at);
  }
};

describe("the beat", () => {
  it("runs on at the given leg with no music, as the splash always has", () => {
    const pulse = new MusicPulse(0.6);
    expect(pulse.update(0.59).phase).toBeGreaterThan(0.8);
    expect(pulse.update(0.6).phase).toBeLessThan(0.2);
    expect(pulse.update(0.01).beats).toBe(2);
  });

  it("learns the song's tempo from its kicks", () => {
    const pulse = new MusicPulse(0.6);
    playKicks(pulse, 0.45, 8);
    expect(pulse.beatSeconds).toBeCloseTo(0.45, 1);
  });

  it("starts a leg on every kick, so the pair snaps as each one lands", () => {
    const pulse = new MusicPulse(0.6);
    playKicks(pulse, 0.5, 6);
    const snaps: number[] = [];
    let previous = pulse.update(0, spectrum(0.05));
    playKicks(pulse, 0.5, 4, (frame, at) => {
      if (frame.beats !== previous.beats) snaps.push(at % 0.5);
      previous = frame;
    });
    expect(snaps.length).toBeGreaterThanOrEqual(7);
    // Every leg began within a frame of a kick.
    for (const at of snaps) expect(Math.min(at, 0.5 - at)).toBeLessThan(FRAME * 1.5);
  });

  it("hears every kick of a loud master, where the bar sits near the analyser's ceiling", () => {
    // The race songs' masters, measured through the analyser: the kick's band
    // sits about -36 dB between kicks and reaches -22 dB on one, past the
    // byte range's -30 dB ceiling.
    const pulse = new MusicPulse(0.6);
    const beat = 0.46;
    const kicks: number[] = [];
    let previous = 0;
    for (let at = 0; at < 10; at += FRAME) {
      const { kick } = pulse.update(FRAME, spectrumDb(at % beat < 0.08 ? -22 : -36));
      if (at > 2 && kick > previous) kicks.push(at);
      previous = kick;
    }
    // Each kick after the first two seconds is heard, once, on time.
    expect(kicks.length).toBe(Math.floor((10 - 2) / beat));
    for (const at of kicks) expect(at % beat).toBeLessThan(FRAME * 1.5);
    expect(pulse.beatSeconds).toBeCloseTo(beat, 1);
  });

  it("follows a slow song rather than running on ahead of it", () => {
    const pulse = new MusicPulse(0.6);
    playKicks(pulse, 0.9, 12);
    expect(pulse.beatSeconds).toBeGreaterThan(0.8);
  });
});

describe("the highs", () => {
  it("spike when the hats hit and fall away after", () => {
    const pulse = new MusicPulse(0.6);
    for (let i = 0; i < 30; i++) pulse.update(FRAME, spectrum(0.05, 0.1));
    const hit = pulse.update(FRAME, spectrum(0.05, 0.8)).spike;
    expect(hit).toBeGreaterThan(0.9);
    let after = hit;
    for (let i = 0; i < 30; i++) after = pulse.update(FRAME, spectrum(0.05, 0.8)).spike;
    expect(after).toBeLessThan(0.1);
  });

  it("do not spike on a steady top end, or on silence", () => {
    const pulse = new MusicPulse(0.6);
    let spike = 0;
    for (let i = 0; i < 120; i++) spike = pulse.update(FRAME, spectrum(0.05, 0.5)).spike;
    expect(spike).toBeLessThan(0.05);
    const quiet = new MusicPulse(0.6);
    for (let i = 0; i < 60; i++) spike = quiet.update(FRAME, spectrum(0, 0)).spike;
    expect(spike).toBe(0);
  });
});

describe("the kick", () => {
  it("nudges on an ordinary kick, strikes hard on a heavy one, and falls away", () => {
    const soft = new MusicPulse(0.6);
    const hard = new MusicPulse(0.6);
    // Long enough for the low band's average to settle on the bar's level.
    for (let i = 0; i < 300; i++) {
      soft.update(FRAME, spectrumDb(-40));
      hard.update(FRAME, spectrumDb(-40));
    }
    // An ordinary kick is 6 dB over the bar; a heavy one, 12 dB.
    const softHit = soft.update(FRAME, spectrumDb(-34)).kick;
    const hardHit = hard.update(FRAME, spectrumDb(-28)).kick;
    expect(softHit).toBeGreaterThan(0.15);
    expect(softHit).toBeLessThan(0.35);
    expect(hardHit).toBeGreaterThan(softHit * 2.5);
    expect(hardHit).toBeCloseTo(1, 1);
    let after = hardHit;
    for (let i = 0; i < 30; i++) after = hard.update(FRAME, spectrumDb(-40)).kick;
    expect(after).toBeLessThan(0.05);
  });

  it("hears a quiet kick where the beat is due, and not a bass note between beats", () => {
    // A steady bar with a heavy kick every half second, to set the tempo.
    const groove = (pulse: MusicPulse): void => {
      for (let at = 0; at < 6; at += FRAME) pulse.update(FRAME, spectrumDb(at % 0.5 < FRAME ? -28 : -40));
    };
    // Then the bar alone for `wait`, and a quiet rise of 3 dB: too small to be
    // a beat anywhere, big enough to be one where one is due.
    // `until` is how far through the next beat to wait, by the pulse's own
    // clock: past the beat under way first, then into the one after it.
    const quiet = (pulse: MusicPulse, until: number): number => {
      const { beats } = pulse.update(0, spectrumDb(-40));
      while (pulse.update(FRAME, spectrumDb(-40)).beats === beats);
      while (pulse.update(FRAME, spectrumDb(-40)).progress < until);
      return pulse.update(FRAME, spectrumDb(-37)).kick;
    };

    const onBeat = new MusicPulse(0.6);
    groove(onBeat);
    const due = quiet(onBeat, 0.95);
    expect(due).toBeGreaterThan(0.15);
    expect(due).toBeLessThan(0.3);

    const between = new MusicPulse(0.6);
    groove(between);
    expect(quiet(between, 0.5)).toBeLessThan(0.05);
  });

  it("does not strike on a beat that only runs on through silence", () => {
    const pulse = new MusicPulse(0.6);
    let kick = 0;
    for (let i = 0; i < 180; i++) kick = Math.max(kick, pulse.update(FRAME).kick);
    expect(pulse.update(0).beats).toBeGreaterThan(2);
    expect(kick).toBe(0);
  });
});

describe("a song whose beat is known", () => {
  it("is where the playing song is, in beats from its authored first beat", () => {
    // 120 bpm, first beat at tick 30 (half a second in): a beat every 500 ms.
    const song = { bpm: 120, beatOffsetTicks: 30 };
    expect(songBeatAt(500, song).beat).toBeCloseTo(0);
    expect(songBeatAt(1_750, song).beat).toBeCloseTo(2.5);
    expect(songBeatAt(250, song).beat).toBeCloseTo(-0.5);
    expect(songBeatAt(0, song).beatSeconds).toBeCloseTo(0.5);
  });

  it("takes its beats from the song, not from a bass line off the beat", () => {
    const pulse = new MusicPulse(0.6);
    const starts: number[] = [];
    let previous = pulse.update(0).beats;
    // The song's beat is every half second; the loud hits come every 0.37.
    for (let at = 0; at < 6; at += FRAME) {
      const frame = pulse.update(FRAME, spectrumDb(at % 0.37 < 0.08 ? -22 : -36), { beat: at / 0.5, beatSeconds: 0.5 });
      if (frame.beats !== previous) starts.push(at);
      previous = frame.beats;
      expect(frame.progress).toBeCloseTo((at / 0.5) % 1, 5);
    }
    expect(starts).toHaveLength(11);
    for (const at of starts) expect(Math.min(at % 0.5, 0.5 - (at % 0.5))).toBeLessThan(FRAME * 1.5);
    expect(pulse.beatSeconds).toBe(0.5);
  });

  it("still strikes on the hits it hears, wherever they land", () => {
    const pulse = new MusicPulse(0.6);
    for (let i = 0; i < 120; i++) pulse.update(FRAME, spectrumDb(-36), { beat: 0.3, beatSeconds: 0.5 });
    expect(pulse.update(FRAME, spectrumDb(-24), { beat: 0.3, beatSeconds: 0.5 }).kick).toBeGreaterThan(0.5);
  });

  it("counts on, never back, when the song loops", () => {
    const pulse = new MusicPulse(0.6);
    const before = pulse.update(FRAME, undefined, { beat: 40.9, beatSeconds: 0.5 }).beats;
    expect(pulse.update(FRAME, undefined, { beat: 0.1, beatSeconds: 0.5 }).beats).toBe(before + 1);
  });

  it("runs on at the song's tempo once the song stops saying where it is", () => {
    const pulse = new MusicPulse(0.6);
    let frame = pulse.update(FRAME, undefined, { beat: 3.9, beatSeconds: 0.5 });
    const beats = frame.beats;
    // A tenth of a beat to the next one, then a whole beat after it.
    for (let at = 0; at < 0.5 * 1.1 + FRAME; at += FRAME) frame = pulse.update(FRAME);
    expect(frame.beats).toBe(beats + 2);
  });
});
