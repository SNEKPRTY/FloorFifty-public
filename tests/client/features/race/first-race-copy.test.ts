import { describe, expect, it } from "vitest";
import * as m from "../../../../apps/client/src/paraglide/messages.js";

// The one test that spells out the English of a first race's words. Every other
// test reads them from the catalogue (`m.<key>()`), so a changed word changes
// this file alone. The words are the Owner's (first-race plan, "Words", 2026-11-14).
describe("a first race's words", () => {
  it("says them as the Owner approved them", () => {
    expect(m.race_start_press()).toBe("Press any key to start");
    expect(m.race_start_tap()).toBe("Tap to start");
    expect(m.race_out_line()).toBe("The lava caught you. Last racer standing wins.");
    expect(m.race_hint_edge()).toBe("Stay above the lava.");
    expect(m.race_hint_floors()).toBe("Land on every floor to the top. Missed one? Go back down and land on it.");
    expect(m.race_hint_restart_keyboard()).toBe("Press R to start again from the bottom.");
    expect(m.race_hint_restart_gamepad({ glyph: "X" })).toBe("Press X to start again from the bottom.");
    expect(m.race_hint_restart_touch()).toBe("Tap the timer to start again from the bottom.");
  });

  it("calls it lava on the Survival swipe coach, never the rising edge", () => {
    expect(m.shell_swipe_coach_survival()).toBe("Drag to steer · flick down to fast fall · stay above the lava");
    // The ready room's Survival rules are the Owner's own wording ("14. A", on main); mode-guidance.test.ts pins them.
  });
});
