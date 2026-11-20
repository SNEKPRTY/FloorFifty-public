// @vitest-environment node
/**
 * The beat clock.
 *
 * Two properties matter and the rest is arithmetic. It is pure -- the same
 * tick always gives the same phase, so two clients agree without talking and a
 * replay looks the way the race looked. And it is derived from the tick alone,
 * so nothing about audio playback can move it.
 */

import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import {
  BEATS_PER_BAR,
  PULSE,
  beatPhaseAt,
  crossedBeat,
  pulseAt,
  ticksPerBeat,
  type SongTiming,
} from "../../apps/client/src/lib/beat-clock";

/** The slice's authored song, as measured. */
const SONG: SongTiming = { bpm: 146, beatOffsetTicks: 24 };

/**
 * The first tick at or after beat `n`.
 *
 * A beat is 24.6575 ticks at this tempo, so beat boundaries fall between
 * ticks rather than on them. Rounding to the nearest tick would sometimes land
 * just *below* a boundary and report the previous beat -- which is correct
 * behaviour being asked the wrong question.
 */
const tickAtBeat = (beat: number): number =>
  Math.ceil(SONG.beatOffsetTicks + beat * ticksPerBeat(SONG.bpm));

describe("ticksPerBeat", () => {
  it("converts tempo into simulation ticks", () => {
    // 146 BPM is 2.4333 beats a second, so a beat is 24.6575 ticks at 60 Hz.
    expect(ticksPerBeat(146)).toBeCloseTo(24.6575, 4);
    expect(ticksPerBeat(120)).toBe(30);
    expect(ticksPerBeat(TICK_HZ)).toBe(60);
  });
});

describe("beatPhaseAt", () => {
  it("puts beat zero exactly on the authored offset", () => {
    const at = beatPhaseAt(SONG.beatOffsetTicks, SONG);
    expect(at.beat).toBe(0);
    expect(at.phase).toBe(0);
    expect(at.beatInBar).toBe(0);
    expect(at.bar).toBe(0);
  });

  it("counts backwards before the first downbeat rather than clamping", () => {
    // A countdown runs before the music's first beat; that is an ordinary
    // state, and folding it onto zero would freeze the pulse there.
    const at = beatPhaseAt(0, SONG);
    expect(at.beat).toBeLessThan(0);
    expect(at.phase).toBeGreaterThanOrEqual(0);
    expect(at.phase).toBeLessThan(1);
  });

  it("keeps beat-in-bar a real index on either side of the downbeat", () => {
    for (let tick = 0; tick < 400; tick += 1) {
      const { beatInBar } = beatPhaseAt(tick, SONG);
      expect(Number.isInteger(beatInBar)).toBe(true);
      expect(beatInBar).toBeGreaterThanOrEqual(0);
      expect(beatInBar).toBeLessThan(BEATS_PER_BAR);
    }
  });

  it("advances one beat per beat-length of ticks", () => {
    for (const beat of [1, 7, 64, 293]) {
      expect(beatPhaseAt(tickAtBeat(beat), SONG).beat).toBe(beat);
    }
  });

  it("starts a new bar every four beats", () => {
    const at = beatPhaseAt(tickAtBeat(8), SONG);
    expect(at.beat).toBe(8);
    expect(at.bar).toBe(2);
    expect(at.beatInBar).toBe(0);
  });

  it("is pure: the same tick always gives the same phase", () => {
    // The property two clients rely on to agree about the beat without ever
    // exchanging a message about it.
    for (const tick of [0, 1, 37, 1_500, 60_000]) {
      expect(beatPhaseAt(tick, SONG)).toEqual(beatPhaseAt(tick, SONG));
    }
  });

  it("holds its phase over a race's worth of ticks without drifting", () => {
    // Three laps is about 48 s. A clock that accumulated error per tick rather
    // than deriving from it would be audibly late by the finish.
    const ticks = TICK_HZ * 60;
    const perBeat = ticksPerBeat(SONG.bpm);
    const expected = Math.floor((ticks - SONG.beatOffsetTicks) / perBeat);

    expect(beatPhaseAt(ticks, SONG).beat).toBe(expected);
  });
});

describe("crossedBeat", () => {
  it("fires exactly once per beat across a run of ticks", () => {
    const ticks = 600;

    let crossings = 0;
    for (let tick = 1; tick <= ticks; tick += 1) {
      if (crossedBeat(tick - 1, tick, SONG)) crossings += 1;
    }

    const first = beatPhaseAt(0, SONG).beat;
    const last = beatPhaseAt(ticks, SONG).beat;
    expect(crossings).toBe(last - first);
  });
});

describe("pulseAt", () => {
  it("peaks on the beat", () => {
    const onBeat = tickAtBeat(4);
    const offBeat = onBeat + Math.round(ticksPerBeat(SONG.bpm) / 2);

    expect(pulseAt(onBeat, SONG)).toBeGreaterThan(pulseAt(offBeat, SONG));
  });

  it("gives the downbeat more weight than an ordinary beat", () => {
    const downbeat = tickAtBeat(4);
    const ordinary = tickAtBeat(5);

    expect(beatPhaseAt(downbeat, SONG).beatInBar).toBe(0);
    expect(beatPhaseAt(ordinary, SONG).beatInBar).toBe(1);
    expect(pulseAt(downbeat, SONG)).toBeGreaterThan(pulseAt(ordinary, SONG));
  });

  it("stays inside its declared bounds at every tick of a race", () => {
    for (let tick = 0; tick <= TICK_HZ * 60; tick += 1) {
      const value = pulseAt(tick, SONG);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(PULSE.downbeatStrength);
    }
  });

  it("is already rising before the beat arrives", () => {
    // The lead-in. A pulse that began on the beat would read as late.
    const perBeat = ticksPerBeat(SONG.bpm);
    const justBefore = tickAtBeat(8) - Math.round(perBeat * PULSE.leadIn * 0.5);

    expect(pulseAt(justBefore, SONG)).toBeGreaterThan(0);
  });
});
