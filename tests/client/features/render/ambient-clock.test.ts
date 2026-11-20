// @vitest-environment node
/**
 * The ambient clock.
 *
 * Every case here is a failure that shipped somewhere else first, in a form
 * that is invisible until someone leaves a tab in the background for a minute
 * and comes back to find the sky somewhere else.
 */

import { describe, expect, it } from "vitest";
import { AMBIENT_DELTA_CLAMP_MS, AmbientClock } from "../../../../apps/client/src/features/render/ambient-clock";
import { DAWN_REFRACTION_STILL_SECONDS } from "../../../../apps/client/src/features/render/filters/dawn-refraction";

describe("the ambient clock", () => {
  it("advances by the delta it is handed", () => {
    const clock = new AmbientClock();
    expect(clock.advance(100)).toBeCloseTo(0.1);
    expect(clock.advance(50)).toBeCloseTo(0.15);
    expect(clock.seconds).toBeCloseTo(0.15);
  });

  it("clamps a long frame rather than letting it teleport the phase", () => {
    // A garbage collection, a compositor stall, a breakpoint hit while the tab
    // was open. None of them is time the player watched, and the optics must
    // not lurch by the amount they lasted.
    const clock = new AmbientClock();
    clock.advance(5_000);

    expect(clock.seconds).toBeCloseTo(AMBIENT_DELTA_CLAMP_MS / 1_000);
  });

  it("ignores a negative delta", () => {
    const clock = new AmbientClock();
    clock.advance(100);
    clock.advance(-500);
    expect(clock.seconds).toBeCloseTo(0.1);
  });

  it("freezes while hidden and discards the first delta after a resume", () => {
    // The whole shape of the tab case: the absence must cost nothing, and the
    // enormous delta waiting on the other side of it must be thrown away rather
    // than clamped into a jump.
    const clock = new AmbientClock();
    clock.advance(100);
    clock.setHidden(true);
    clock.advance(8_000);
    expect(clock.seconds).toBeCloseTo(0.1);

    clock.setHidden(false);
    clock.advance(8_000); // the first resumed delta is discarded
    expect(clock.seconds).toBeCloseTo(0.1);

    clock.advance(100);
    expect(clock.seconds).toBeCloseTo(0.2);
  });

  it("ignores a visibility change it already knew about", () => {
    // Reporting `hidden` twice is not a resume, and treating it as one would
    // eat a real frame every time.
    const clock = new AmbientClock();
    clock.setHidden(true);
    clock.setHidden(true);
    clock.setHidden(false);
    clock.advance(1_000); // discarded: the resume
    clock.advance(100);
    expect(clock.seconds).toBeCloseTo(0.1);
  });

  it("freezes at the still pose under reduced motion", () => {
    const clock = new AmbientClock();
    clock.setReducedMotion(true);

    // The still pose, not zero and not wherever it happened to be: reduced
    // motion means the picture arrives, never that it disappears.
    expect(clock.advance(100)).toBe(DAWN_REFRACTION_STILL_SECONDS);
    expect(clock.seconds).toBe(DAWN_REFRACTION_STILL_SECONDS);
    expect(clock.advance(10_000)).toBe(DAWN_REFRACTION_STILL_SECONDS);
  });

  it("freezes immediately when the preference turns on mid-session", () => {
    const clock = new AmbientClock();
    clock.advance(500);
    clock.setReducedMotion(true);

    // Visible on the frame the setting changed, not on the next tick.
    expect(clock.seconds).toBe(DAWN_REFRACTION_STILL_SECONDS);
  });

  it("resumes without catch-up when the preference turns off", () => {
    const clock = new AmbientClock();
    clock.setReducedMotion(true);
    clock.advance(100);
    clock.setReducedMotion(false);

    clock.advance(8_000); // discarded, exactly as a tab resume is
    expect(clock.seconds).toBe(DAWN_REFRACTION_STILL_SECONDS);

    clock.advance(100);
    expect(clock.seconds).toBeCloseTo(DAWN_REFRACTION_STILL_SECONDS + 0.1);
  });

  it("stops entirely while hidden, even under reduced motion", () => {
    const clock = new AmbientClock();
    clock.setReducedMotion(true);
    clock.setHidden(true);
    clock.advance(100);

    // Hidden wins: nothing moves while the player is not looking, including a
    // freeze that would otherwise land off screen.
    expect(clock.seconds).toBe(DAWN_REFRACTION_STILL_SECONDS);
  });
});
