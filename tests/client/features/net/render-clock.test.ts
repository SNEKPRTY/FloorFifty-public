/**
 * The render clock decides which moment of the race is on screen. It has to
 * advance with the display rather than with packet arrival, or interpolation
 * degrades into a step per snapshot.
 */

import { describe, expect, it } from "vitest";
import { INTERPOLATION_DELAY_TICKS } from "../../../../apps/client/src/lib/constants";
import {
  MAX_INTERPOLATION_DELAY_TICKS,
  RenderClock,
} from "../../../../apps/client/src/features/net/render-clock";

const FRAME_MS = 1000 / 60;
/** Ticks a frame covers at the nominal rate: the sim and the display share 60 Hz. */
const FRAME_TICKS = 1;

describe("before any authority has arrived", () => {
  it("has no moment to draw", () => {
    expect(new RenderClock().advance(FRAME_MS)).toBeUndefined();
  });
});

describe("the first authority tick", () => {
  it("places the clock an interpolation delay behind it", () => {
    const clock = new RenderClock();
    clock.observe(30);
    expect(clock.advance(0)).toBeCloseTo(30 - INTERPOLATION_DELAY_TICKS);
  });
});

describe("between two authority snapshots", () => {
  it("advances with rendered time rather than holding still", () => {
    const clock = new RenderClock();
    clock.observe(30);

    const first = clock.advance(FRAME_MS)!;
    const second = clock.advance(FRAME_MS)!;

    expect(second).toBeGreaterThan(first);
  });

  it("advances at the nominal rate while authority keeps pace", () => {
    const clock = new RenderClock();
    clock.observe(30);
    const start = clock.advance(0)!;

    // Three rendered frames and the snapshot that covers them.
    for (let frame = 0; frame < 3; frame += 1) clock.advance(FRAME_MS);
    clock.observe(33);

    expect(clock.advance(0)! - start).toBeCloseTo(3 * FRAME_TICKS, 1);
  });
});

describe("when the clock has drifted from authority", () => {
  it("closes the gap faster than the nominal rate", () => {
    const behind = new RenderClock();
    behind.observe(30);
    behind.advance(0);
    // Authority has run further ahead than the frames drawn account for.
    behind.observe(39);

    const before = behind.advance(0)!;
    const moved = behind.advance(FRAME_MS)! - before;

    expect(moved).toBeGreaterThan(FRAME_TICKS);
  });

  it("never skews the rate enough for a player to see it", () => {
    const clock = new RenderClock();
    clock.observe(30);
    clock.advance(0);
    clock.observe(39);

    const before = clock.advance(0)!;
    const moved = clock.advance(FRAME_MS)! - before;

    // Saturated at the cap here, so the comparison needs float slack.
    expect(moved).toBeLessThanOrEqual(FRAME_TICKS * 1.1 + 1e-9);
  });
});

describe("a gap too large to ease across", () => {
  it("snaps, as a restarted race or a resumed tab produces", () => {
    const clock = new RenderClock();
    clock.observe(30);
    clock.advance(FRAME_MS);

    clock.observe(600);

    expect(clock.advance(0)).toBeCloseTo(600 - INTERPOLATION_DELAY_TICKS);
  });
});

describe("reading the clock without advancing it", () => {
  it("has nothing to report before the first authority tick", () => {
    expect(new RenderClock().current()).toBeUndefined();
  });

  it("reports the moment being drawn without moving it", () => {
    const clock = new RenderClock();
    clock.observe(30);
    clock.advance(FRAME_MS);

    const first = clock.current();
    expect(clock.current()).toBe(first);
  });
});

describe("where authority is on this same clock", () => {
  it("has nothing to report before the first authority tick", () => {
    expect(new RenderClock().authorityTick()).toBeUndefined();
  });

  it("undoes the interpolation delay the drawn moment carries", () => {
    const clock = new RenderClock();
    clock.observe(30);
    clock.advance(FRAME_MS);

    expect(clock.authorityTick()).toBeCloseTo(clock.current()! + INTERPOLATION_DELAY_TICKS);
  });

  it("estimates the room's own tick, which the prediction steps up to", () => {
    const clock = new RenderClock();
    clock.observe(30);

    // The drawn moment starts an interpolation delay behind authority, so
    // undoing it lands back on the tick that was observed.
    expect(clock.authorityTick()).toBeCloseTo(30);
  });

  it("keeps pace with a room whose clock is not exactly 60 Hz", () => {
    // The defect this accessor exists to prevent: a prediction counting
    // rendered frames gains about a tick a second on a 58.9 Hz room, for the
    // whole race. Read from here instead, the estimate tracks authority's real
    // rate, because every snapshot re-anchors it.
    const SERVER_HZ = 58.9;
    const clock = new RenderClock();
    let owed = 0;
    let tick = 0;
    clock.observe(tick);

    for (let frame = 0; frame < 60 * 30; frame += 1) {
      owed += (SERVER_HZ * FRAME_MS) / 1000;
      while (owed >= 1) {
        owed -= 1;
        tick += 1;
        if (tick % 3 === 0) clock.observe(tick);
      }
      clock.advance(FRAME_MS);
    }

    // Half a second is what the frame-counting version had accumulated by
    // here; this stays inside a snapshot interval of it.
    expect(Math.abs(clock.authorityTick()! - tick)).toBeLessThan(3);
  });
});

describe("leaving the race", () => {
  it("forgets the moment, so a later race does not resume an old one", () => {
    const clock = new RenderClock();
    clock.observe(30);
    clock.advance(FRAME_MS);

    clock.clear();

    expect(clock.current()).toBeUndefined();
    expect(clock.authorityTick()).toBeUndefined();
    expect(clock.advance(FRAME_MS)).toBeUndefined();
  });
});

describe("a snapshot republished at a tick already seen", () => {
  it("does not drag the clock back", () => {
    const clock = new RenderClock();
    clock.observe(30);
    for (let frame = 0; frame < 2; frame += 1) clock.advance(FRAME_MS);
    const before = clock.error;

    // An event batch republishes tick 30 two frames after it arrived.
    clock.observe(30);
    expect(clock.error).toBe(before);
  });
});

describe("the interpolation delay on a jittery link", () => {
  /** Snapshots every three ticks, each arriving up to `jitterTicks` late. */
  function run(jitterTicks: (index: number) => number, seconds: number, clock = new RenderClock()) {
    let tick = 0;
    clock.observe(0);
    const pending: { at: number; tick: number }[] = [];
    const delays: number[] = [];
    const authorities: number[] = [];
    for (let frame = 0; frame < 60 * seconds; frame += 1) {
      if (frame % 3 === 0) {
        tick += 3;
        pending.push({ at: frame + jitterTicks(frame / 3), tick });
      }
      while (pending.length > 0 && pending[0]!.at <= frame) clock.observe(pending.shift()!.tick);
      clock.advance(FRAME_MS);
      delays.push(clock.interpolationDelay);
      authorities.push(clock.authorityTick()!);
    }
    return { clock, delays, authorities, tick };
  }

  it("stays at the base delay on a steady link", () => {
    const { clock } = run(() => 0, 5);
    expect(clock.interpolationDelay).toBeCloseTo(INTERPOLATION_DELAY_TICKS, 9);
  });

  it("draws the others further back when snapshots run late, within its bound", () => {
    // Every fourth snapshot is three ticks late: a link a fixed delay freezes on.
    const { clock, delays } = run((index) => (index % 4 === 0 ? 3 : 0), 5);
    expect(clock.interpolationDelay).toBeGreaterThan(INTERPOLATION_DELAY_TICKS + 2);
    expect(Math.max(...delays)).toBeLessThanOrEqual(MAX_INTERPOLATION_DELAY_TICKS);
    // Eased: never more than five percent of a frame's ticks at once.
    for (let index = 1; index < delays.length; index += 1) {
      expect(Math.abs(delays[index]! - delays[index - 1]!)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it("never moves authority to do it, so the input timeline is untouched", () => {
    const steady = run(() => 0, 5);
    const jittery = run((index) => (index % 4 === 0 ? 3 : 0), 5);
    const last = (values: number[]) => values[values.length - 1]!;
    expect(Math.abs(last(jittery.authorities) - last(steady.authorities))).toBeLessThan(1.5);
  });

  it("returns to the base delay once the link steadies", () => {
    const clock = new RenderClock();
    run((index) => (index % 4 === 0 ? 3 : 0), 5, clock);
    const widened = clock.interpolationDelay;
    // Keep observing a steady feed from where the clock stands.
    let tick = Math.round(clock.authorityTick()!);
    for (let frame = 0; frame < 60 * 8; frame += 1) {
      if (frame % 3 === 0) clock.observe((tick += 3));
      clock.advance(FRAME_MS);
    }
    expect(clock.interpolationDelay).toBeLessThan(widened);
    expect(clock.interpolationDelay).toBeCloseTo(INTERPOLATION_DELAY_TICKS, 1);
  });
});

describe("time on the wall clock", () => {
  /** A clock on a time source the test moves by hand. */
  function onWallTime() {
    let now = 0;
    const clock = new RenderClock(() => now);
    return {
      clock,
      wait(ms: number) {
        now += ms;
      },
    };
  }

  it("does not count time that passed before the first snapshot arrived", () => {
    // Entering a race waits most of a second on loading, and the first frame
    // covers that wait -- but the snapshot the clock was set from arrived at
    // its end. Counting the wait again put the clock half a second ahead.
    const { clock, wait } = onWallTime();
    wait(600);
    clock.observe(30);
    wait(1);
    clock.advance(601);
    expect(clock.authorityTick()!).toBeLessThan(30.2);
  });

  it("lands where the freshest snapshot says after a stall, without snapping back and forth", () => {
    // A stall queues snapshots; the frame after it runs first, then the queued
    // burst arrives oldest first. Deciding per snapshot snapped back to the
    // stale ones and forward again: three snaps and inputs stamped late.
    const { clock, wait } = onWallTime();
    clock.observe(30);
    for (let frame = 0; frame < 3; frame += 1) {
      wait(FRAME_MS);
      clock.advance(FRAME_MS);
    }
    wait(600);
    clock.advance(600);
    // The burst: every snapshot the room sent during the stall, at once.
    for (let tick = 36; tick <= 69; tick += 3) clock.observe(tick);
    const snaps: unknown[] = [clock.takeSnap()];
    wait(FRAME_MS);
    clock.advance(FRAME_MS);
    snaps.push(clock.takeSnap());

    expect(snaps.filter((snap) => snap !== undefined).length).toBeLessThanOrEqual(1);
    expect(Math.abs(clock.authorityTick()! - 70)).toBeLessThan(1.5);
  });

  it("does not count a hidden tab's gap twice either", () => {
    const { clock, wait } = onWallTime();
    clock.observe(30);
    wait(FRAME_MS);
    clock.advance(FRAME_MS);
    // Ten seconds hidden: snapshots kept arriving, the last just now.
    wait(10_000);
    clock.observe(630);
    wait(1);
    clock.advance(10_001);
    expect(Math.abs(clock.authorityTick()! - 630)).toBeLessThan(1.1);
    // And every frame after that counts in full.
    wait(FRAME_MS * 3);
    clock.advance(FRAME_MS * 3);
    expect(clock.authorityTick()!).toBeGreaterThan(632.5);
  });
});

describe("a snapshot read later than it arrived", () => {
  it("is anchored at when it arrived, not when it was read", () => {
    // A screen that spends 700 ms building itself reads the newest snapshot
    // only afterwards. Anchored at the read, the race began 42 ticks behind
    // the room, and its first inputs arrived 42 ticks late.
    let now = 0;
    const clock = new RenderClock(() => now);
    now = 700;
    clock.observe(30, 0);
    now = 701;
    clock.advance(1);
    expect(clock.authorityTick()!).toBeCloseTo(30 + 701 / (1000 / 60), 1);
    expect(clock.takeSnap()).toBeUndefined();
  });
});

describe("a snapshot behind the clock", () => {
  /** A clock on a time source the test moves by hand, running at `tick` on `now`. */
  function running() {
    let now = 0;
    const clock = new RenderClock(() => now);
    clock.observe(30);
    const frame = (count = 1) => {
      for (let index = 0; index < count; index += 1) {
        now += FRAME_MS;
        clock.advance(FRAME_MS);
      }
    };
    return {
      clock,
      frame,
      observeAt: (tick: number) => clock.observe(tick),
    };
  }

  it("is a late delivery, not a reason to snap back", () => {
    // A long task on the page holds snapshots back and then delivers them
    // stamped as fresh. The clock, which kept wall time, was right; a snapshot
    // can only have aged in transit, never run ahead, so one far behind the
    // clock is evidence of a late delivery before it is evidence of anything
    // else.
    const { clock, frame, observeAt } = running();
    frame(40);
    observeAt(40);
    frame();
    expect(clock.takeSnap()).toBeUndefined();
    expect(clock.authorityTick()!).toBeGreaterThan(68);
  });

  it("is believed once every snapshot for half a second says so", () => {
    // A room that really did move its timeline back -- time it dropped after
    // a stall -- keeps sending snapshots behind the clock, and the clock
    // follows it back.
    const { clock, frame, observeAt } = running();
    frame(40);
    const start = clock.authorityTick()!;
    let snapped: unknown;
    for (let index = 0; index < 12; index += 1) {
      observeAt(40 + index * 3);
      frame(3);
      snapped ??= clock.takeSnap();
    }
    expect(snapped).toBeDefined();
    expect(clock.authorityTick()!).toBeLessThan(start + 36 - 20);
  });

  it("is snapped forward from at once when ahead: a snapshot is a lower bound", () => {
    const { clock, frame, observeAt } = running();
    frame(3);
    observeAt(60);
    frame();
    expect(clock.takeSnap()?.jump).toBeGreaterThan(20);
    expect(clock.authorityTick()!).toBeGreaterThan(59);
  });
});
