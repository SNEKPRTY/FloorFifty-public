// @vitest-environment node
import { describe, expect, it } from "vitest";
import { feelIsReduced } from "../../../../../apps/client/src/features/race/juice/feel-reduced";

/**
 * Audit S8: the photosensitivity warning offers "Character effects" and "Stage
 * effects", and Settings explains Character effects as the racers' squash, dust,
 * camera shake and pop-up words. The `FeelDirector`, which owns camera shake,
 * the punch, the white impact flash and the lens aberration, was built with the
 * device's reduced-motion setting and nothing else, so a player who unticked
 * both still got a shake and a flash on every slam and at the finish.
 */

describe("when the feel director holds still (audit S8)", () => {
  const live = (reducedMotion: boolean, characterEffects: boolean) => {
    const state = { reducedMotion, characterEffects };
    return { state, reduced: feelIsReduced({ reducedMotion: () => state.reducedMotion, characterEffects: () => state.characterEffects }) };
  };

  it("plays the feel with character effects on and no reduced-motion setting", () => {
    expect(live(false, true).reduced()).toBe(false);
  });

  it("holds still when the device asks for reduced motion", () => {
    expect(live(true, true).reduced()).toBe(true);
  });

  it("holds still when Character effects is unticked", () => {
    expect(live(false, false).reduced()).toBe(true);
  });

  it("reads the setting at the moment of use, so unticking it mid-race takes hold", () => {
    const { state, reduced } = live(false, true);
    expect(reduced()).toBe(false);
    state.characterEffects = false;
    expect(reduced()).toBe(true);
    state.characterEffects = true;
    expect(reduced()).toBe(false);
  });
});
