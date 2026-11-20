// @vitest-environment node
/**
 * The feel layer (A/V polish plan, G1–G6): what a slam, a fall and the finish
 * do to the shake, the zoom, the flash, the fast-fall's lines, the camera's
 * lead, the panel's aberration and the controller.
 */

import { describe, expect, it } from "vitest";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { GENERATED_CONTENT } from "../../../../../apps/server/src/content/generated-content";
import { FeelDirector, type FeelFrame } from "../../../../../apps/client/src/features/race/juice/feel-director";
import type { HapticKind } from "../../../../../apps/client/src/features/platform/haptics";

const FEEL = GENERATED_CONTENT.content.juice.feel;
const FAST_FALL = 1341;
const me = "me" as PlayerId;
const them = "them" as PlayerId;

function harness(reduced = false) {
  const shakes: Array<[number, number]> = [];
  const punches: number[] = [];
  const leads: number[] = [];
  const impacts: number[] = [];
  const falls: number[] = [];
  const aberrations: number[] = [];
  const pulses: HapticKind[] = [];
  const director = new FeelDirector({
    view: {
      setShake: (x, y) => void shakes.push([x, y]),
      setPunch: (share) => void punches.push(share),
      setLookAhead: (units) => void leads.push(units),
      setImpact: (alpha) => void impacts.push(alpha),
      setFall: (share) => void falls.push(share),
      setAberration: (extra) => void aberrations.push(extra),
    },
    feel: () => FEEL,
    fastFall: FAST_FALL,
    reduced: () => reduced,
    haptic: (kind) => void pulses.push(kind),
  });
  return { director, shakes, punches, leads, impacts, falls, aberrations, pulses };
}

const slam = (playerId: PlayerId, y = 100) => ({ kind: "slam" as const, playerId, x: 0, y, fromX: 0, key: `${playerId}:slam:${y}` });

const frame = (nowMs: number, extra: Partial<FeelFrame> = {}): FeelFrame => ({
  nowMs,
  localId: me,
  local: { y: 100, vy: 0 },
  // The view as a camera centred on the local racer, 270 units either way.
  onScreen: (y) => Math.abs(y - 100) <= 270,
  moments: [],
  reached: [],
  ...extra,
});

describe("the feel layer", () => {
  it("rests still with nothing happening", () => {
    const h = harness();
    h.director.frame(frame(0));
    h.director.frame(frame(16));
    expect(h.shakes.at(-1)).toEqual([0, 0]);
    expect(h.punches.at(-1)).toBe(0);
    expect(h.impacts.at(-1)).toBe(0);
    expect(h.falls.at(-1)).toBe(0);
    expect(h.leads.at(-1)).toBe(0);
    expect(h.aberrations.at(-1)).toBe(0);
  });

  it("answers the local racer's slam with trauma, a punch, a flash, an aberration pulse and a rumble", () => {
    const h = harness();
    h.director.frame(frame(0));
    h.director.frame(frame(16, { moments: [slam(me)] }));
    expect(h.director.trauma).toBeCloseTo(FEEL.shake.slam, 6);
    expect(h.punches.at(-1)).toBeGreaterThan(0);
    // A slam's flash is softer than the finish's: it comes often.
    expect(h.impacts.at(-1)).toBe(FEEL.impact.slam);
    expect(FEEL.impact.slam).toBeLessThan(FEEL.impact.alpha);
    expect(h.aberrations.at(-1)).toBeCloseTo(FEEL.aberration.peak, 6);
    expect(h.pulses).toEqual(["slam"]);
    // The flash is gone after its frames, and the pulse settles over its span.
    h.director.frame(frame(16 + FEEL.impact.ms + 1));
    expect(h.impacts.at(-1)).toBe(0);
    h.director.frame(frame(16 + FEEL.aberration.ms + 1));
    expect(h.aberrations.at(-1)).toBe(0);
  });

  it("springs the punch back to rest", () => {
    const h = harness();
    h.director.frame(frame(0, { moments: [slam(me)] }));
    for (let t = 16; t < 3_000; t += 16) h.director.frame(frame(t));
    expect(Math.abs(h.punches.at(-1)!)).toBeLessThan(1e-3);
  });

  it("never flashes twice inside the gap, whatever slams", () => {
    const h = harness();
    h.director.frame(frame(0, { moments: [slam(me, 100)] }));
    h.director.frame(frame(FEEL.impact.ms + 10));
    h.director.frame(frame(FEEL.impact.ms + 20, { moments: [slam(me, 200)] }));
    expect(h.impacts.at(-1)).toBe(0);
    h.director.frame(frame(FEEL.impact.gapMs + 1, { moments: [slam(me, 300)] }));
    expect(h.impacts.at(-1)).toBe(FEEL.impact.slam);
  });

  it("shakes a little for a rival's slam on screen, and not at all for one off it", () => {
    const near = harness();
    near.director.frame(frame(0, { moments: [slam(them, 200)] }));
    expect(near.director.trauma).toBeCloseTo(FEEL.shake.rivalSlam, 6);
    expect(near.impacts.at(-1)).toBe(0);
    expect(near.pulses).toEqual([]);
    const far = harness();
    far.director.frame(frame(0, { moments: [slam(them, 2_000)] }));
    expect(far.director.trauma).toBe(0);
  });

  it("shakes for the local racer's fall and for the finish, and rumbles the winner hardest", () => {
    const h = harness();
    h.director.frame(frame(0, { reached: [{ type: "playerReset", playerId: me, reason: "fall", id: "r", tick: 1 } as RaceEvent] }));
    expect(h.director.trauma).toBeCloseTo(FEEL.shake.fall, 6);
    h.director.frame(frame(16, { reached: [{ type: "raceFinished", winnerId: me, id: "f", tick: 2 } as RaceEvent] }));
    expect(h.director.trauma).toBeCloseTo(Math.min(1, FEEL.shake.fall - (16 / 1000) * FEEL.shake.decayPerSecond + FEEL.shake.finish), 6);
    expect(h.impacts.at(-1)).toBe(FEEL.impact.alpha);
    expect(h.pulses).toEqual(["fall", "win"]);
  });

  it("draws the fast-fall's lines and leads the camera only past the threshold", () => {
    const h = harness();
    const slow = -FAST_FALL * FEEL.fall.from * 0.9;
    h.director.frame(frame(0, { local: { y: 100, vy: slow } }));
    expect(h.falls.at(-1)).toBe(0);
    expect(h.leads.at(-1)).toBe(0);
    h.director.frame(frame(16, { local: { y: 100, vy: -FAST_FALL } }));
    expect(h.falls.at(-1)).toBe(1);
    expect(h.leads.at(-1)).toBeLessThan(0);
    expect(h.leads.at(-1)).toBeGreaterThanOrEqual(-FEEL.lookAhead.maxUnits);
    // A rise never leads: bounces would bob the camera.
    h.director.frame(frame(32, { local: { y: 100, vy: FAST_FALL } }));
    expect(h.falls.at(-1)).toBe(0);
    expect(h.leads.at(-1)).toBe(0);
  });

  it("keeps everything still under reduced motion, and still rumbles", () => {
    const h = harness(true);
    h.director.frame(frame(0));
    h.director.frame(frame(16, { moments: [slam(me)], local: { y: 100, vy: -FAST_FALL } }));
    expect(h.shakes.at(-1)).toEqual([0, 0]);
    expect(h.punches.at(-1)).toBe(0);
    expect(h.impacts.at(-1)).toBe(0);
    expect(h.falls.at(-1)).toBe(0);
    expect(h.leads.at(-1)).toBe(0);
    expect(h.aberrations.at(-1)).toBe(0);
    expect(h.pulses).toEqual(["slam"]);
  });

  it("does nothing before content has loaded", () => {
    const pulses: HapticKind[] = [];
    const director = new FeelDirector({
      view: { setShake: () => {}, setPunch: () => {}, setLookAhead: () => {}, setImpact: () => {}, setFall: () => {}, setAberration: () => {} },
      feel: () => undefined,
      fastFall: FAST_FALL,
      reduced: () => false,
      haptic: (kind) => void pulses.push(kind),
    });
    expect(() => director.frame(frame(0, { moments: [slam(me)] }))).not.toThrow();
  });

  it("tells the view only what changed: a race at rest never rewrites the panel's uniform", () => {
    const h = harness();
    h.director.frame(frame(0));
    const counts = () => [h.shakes, h.punches, h.leads, h.impacts, h.falls, h.aberrations].map((calls) => calls.length);
    const first = counts();
    for (let t = 16; t < 500; t += 16) h.director.frame(frame(t));
    expect(counts()).toEqual(first);
    h.director.frame(frame(512, { moments: [slam(me)] }));
    expect(h.aberrations.length).toBe(first[5]! + 1);
  });

  it("tells a reduced-motion view it is at rest once, not every frame", () => {
    const h = harness(true);
    for (let t = 0; t < 200; t += 16) h.director.frame(frame(t));
    expect(h.aberrations).toHaveLength(1);
    expect(h.shakes).toHaveLength(1);
  });

  it("settles on a rewind", () => {
    const h = harness();
    h.director.frame(frame(0, { moments: [slam(me)] }));
    h.director.restart();
    expect(h.director.trauma).toBe(0);
  });
});
