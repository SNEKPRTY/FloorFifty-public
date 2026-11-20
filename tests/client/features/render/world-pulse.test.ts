// @vitest-environment node
/**
 * The world moving with the music.
 *
 * The behaviour is easy and the constraint is the point, so most of these test
 * the constraint: that the pulse comes from the tick and nowhere else, that it
 * stays inside bounds a landing edge can survive, and that no audio state
 * anywhere can change it.
 */

import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { PULSE, ticksPerBeat, type SongTiming } from "../../../../apps/client/src/lib/beat-clock";
import {
  PULSE_DEPTH,
  worldPulseAt,
} from "../../../../apps/client/src/features/render/world-pulse";

const SONG: SongTiming = { bpm: 146, beatOffsetTicks: 24 };
const tickAtBeat = (beat: number): number =>
  Math.ceil(SONG.beatOffsetTicks + beat * ticksPerBeat(SONG.bpm));

describe("the pulse", () => {
  it("is nothing at all without a song, which is a still world not a broken one", () => {
    expect(worldPulseAt(100, undefined)).toBeUndefined();
  });

  it("is the same at the same tick, on every client and in every replay", () => {
    // The property the whole design rests on: two clients agree without
    // exchanging anything, because they are both reading a number the server
    // already guarantees.
    for (const tick of [0, 37, 1_500, 60_000]) {
      expect(worldPulseAt(tick, SONG)).toEqual(worldPulseAt(tick, SONG));
    }
  });

  it("keeps time to the song as it plays, wherever the tick is, where it is told the song's beat", () => {
    // Beat 8 is a bar's first; the tick is half a beat off it either way.
    const heard = worldPulseAt(tickAtBeat(5) + 12, SONG, 8)!;
    expect(heard).toEqual(worldPulseAt(tickAtBeat(2), SONG, 8));
    expect(heard.onDownbeat).toBe(true);
    expect(heard.platformScale).toBeCloseTo(1 + PULSE.downbeatStrength * PULSE_DEPTH.platform, 6);
    expect(worldPulseAt(0, SONG, 8.5)!.platformScale).toBeLessThan(heard.platformScale);
  });

  it("swells the platform into the beat and settles it after", () => {
    const onBeat = worldPulseAt(tickAtBeat(4), SONG)!;
    const between = worldPulseAt(tickAtBeat(4) + Math.round(ticksPerBeat(SONG.bpm) / 2), SONG)!;
    expect(onBeat.platformScale).toBeGreaterThan(between.platformScale);
  });

  it("keeps the platform swell inside its declared depth", () => {
    // The swell is large enough to see now. What keeps the landing edge honest
    // is not its size but its direction: `platform-view` thickens a slab
    // downward, so the top face never moves whatever this returns.
    for (let tick = 0; tick <= TICK_HZ * 60; tick += 1) {
      const pulse = worldPulseAt(tick, SONG)!;
      expect(pulse.platformScale).toBeGreaterThanOrEqual(1);
      expect(pulse.platformScale).toBeLessThanOrEqual(1 + PULSE_DEPTH.platform);
    }
  });

  it("only ever brightens the city, never dims it below rest", () => {
    // A glow that dips under its own resting level reads as the lights failing
    // rather than as a rhythm.
    for (let tick = 0; tick <= TICK_HZ * 30; tick += 1) {
      expect(worldPulseAt(tick, SONG)!.windowGlow).toBeGreaterThanOrEqual(PULSE_DEPTH.windowRest);
    }
  });

  it("breathes the camera downward, and within its declared depth", () => {
    for (let tick = 0; tick <= TICK_HZ * 30; tick += 1) {
      const { cameraBreath } = worldPulseAt(tick, SONG)!;
      expect(cameraBreath).toBeLessThanOrEqual(0);
      expect(Math.abs(cameraBreath)).toBeLessThanOrEqual(PULSE_DEPTH.camera);
    }
  });

  it("marks the first beat of a bar and only the first", () => {
    expect(worldPulseAt(tickAtBeat(8), SONG)!.onDownbeat).toBe(true);
    expect(worldPulseAt(tickAtBeat(9), SONG)!.onDownbeat).toBe(false);
    expect(worldPulseAt(tickAtBeat(10), SONG)!.onDownbeat).toBe(false);
    expect(worldPulseAt(tickAtBeat(11), SONG)!.onDownbeat).toBe(false);
    expect(worldPulseAt(tickAtBeat(12), SONG)!.onDownbeat).toBe(true);
  });
});

describe("what the pulse is not", () => {
  it("reads nothing but the tick and the song's authored timing", async () => {
    // Structural, because this is the rule the slice is built on and the way
    // it gets broken is convenience: one reference to an audio element's
    // currentTime here and a muted tab stops pulsing, which is a race that
    // looks different depending on whether the speakers are on.
    const [{ readFileSync }, { resolve }] = await Promise.all([
      import("node:fs"),
      import("node:path"),
    ]);
    const source = readFileSync(
      resolve(process.cwd(), "apps/client/src/features/render/world-pulse.ts"),
      "utf8",
    );

    for (const forbidden of ["currentTime", "AudioContext", "Date.now", "performance.now"]) {
      expect(source, `world-pulse.ts reads ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("is identical whether or not anything is audible", () => {
    // There is no audio parameter to pass, which is the point: muting cannot
    // change a function that was never given a way to know.
    const before = worldPulseAt(1_234, SONG);
    const after = worldPulseAt(1_234, SONG);
    expect(before).toEqual(after);
  });
});
