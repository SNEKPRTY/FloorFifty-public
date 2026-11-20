import { describe, expect, it } from "vitest";
import { hudCeiling } from "../../../../apps/client/src/features/race/hud-ceiling";

const rect = (top: number, left: number, width: number, height: number) =>
  ({ top, left, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

describe("hudCeiling (owner: the HUD covered the pop-up words)", () => {
  it("is the bottom of the lowest chip in the top half, not a banner or a chip in the bottom half", () => {
    const overlay = document.createElement("div");
    overlay.innerHTML = `<div data-testid="race-hud">
      <span id="floors" class="ff-aq-hud"></span>
      <div id="roster" class="ff-aq-hud"></div>
      <p id="banner" class="ff-hud__lap-banner"></p>
      <ol id="pips" class="ff-aq-hud"></ol>
      <button data-testid="pause-open"></button>
    </div>`;
    document.body.append(overlay);
    overlay.getBoundingClientRect = () => rect(20, 0, 1280, 720);
    const set = (selector: string, value: DOMRect) => (overlay.querySelector<HTMLElement>(selector)!.getBoundingClientRect = () => value);
    set("#floors", rect(32, 12, 116, 64));
    set("#roster", rect(32, 990, 280, 70));
    set("#banner", rect(200, 300, 600, 300));
    set("#pips", rect(620, 0, 1280, 80));
    set('[data-testid="pause-open"]', rect(32, 200, 64, 80));
    expect(hudCeiling(overlay)).toBe(92);
    overlay.remove();
  });

  it("is 0 with no HUD", () => {
    const overlay = document.createElement("div");
    document.body.append(overlay);
    expect(hudCeiling(overlay)).toBe(0);
    overlay.remove();
  });
});
