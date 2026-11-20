import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as m from "../../../../apps/client/src/paraglide/messages.js";

// Audit S18: the tutorial taught only finite races, and Survival, the default mode, was taught nowhere in it. Owner's
// string E, 2026-11-14: the end card says "Most races are Survival: stay above the rising edge. Fall below it and you
// are out." The end card is the dialog TutorialPrompt shows when the last step is done.
describe("the tutorial's end card", () => {
  it("teaches Survival, the default mode: the rising edge, and going out", () => {
    // Copy audit (audit/onboarding-copy U1, S8), applied at the coordinator's word: she sees lava, never "the rising
    // edge" or the name Survival, and a title ends with nothing.
    expect(m.tutorial_ready_title()).toBe("You are ready");
    expect(m.tutorial_ready_body()).toBe("In most races, lava rises from below. Stay above it. If it reaches you, you are out.");
  });
});

// Audit S18, the Owner's "A works" (2026-11-14): "replace 'finite races' in the tutorial with plain names that match
// the mode chooser (e.g. 'In races to floor 20 or 50, ...')". "Finite" is a word the game uses nowhere else.
describe("the tutorial's words for the races that end at a floor", () => {
  const read = (file: string): string => readFileSync(join(__dirname, "../../../..", file), "utf8");
  const ui = JSON.parse(read("apps/client/messages/ui/en.json")) as Record<string, string>;

  it("never says finite to a player", () => {
    for (const [key, text] of Object.entries(ui)) {
      if (key === "ready_mode_finite_tagline") continue; // the key is a name in the code; its words say no such thing
      expect(JSON.stringify(text), key).not.toMatch(/finite/i);
    }
    const tutorial = read("content/tutorial.toml").split("\n").filter((line) => line.startsWith("prompt."));
    for (const line of tutorial) expect(line).not.toMatch(/finite/i);
  });

  it("names them as the mode chooser does", () => {
    expect(ui["tutorial_touch_restart"]).toBe("In 20- and 50-floor races, tap the timer to start again.");
    expect(ui["lobby_tutorial_offer"]).toBe("New here? Practice the controls in a short climb.");
    expect(ui["tutorial_practice_label"]).toBe("Climb practice");
  });

  // First-race spec §1: the restart and fill-the-counter lessons leave the tutorial for the first 20- or 50-floor race's
  // hints, and its last step is Survival's lava, said the same on every input.
  it("says the survive step the same on every input, and has no restart or fill-the-counter step", () => {
    const toml = read("content/tutorial.toml");
    const survive = /kind = "survive"\nprompt\.keyboard = "(.*)"\nprompt\.gamepad = "(.*)"\nprompt\.touch = "(.*)"/.exec(toml);
    expect(survive).not.toBeNull();
    const prompts = survive!.slice(1);
    expect(new Set(prompts).size).toBe(1);
    expect(prompts[0]).toBe(m.content_tutorial_survive_keyboard());
    expect(toml).not.toMatch(/kind = "(reset|reach)"/);
  });
});
