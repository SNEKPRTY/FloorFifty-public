/**
 * Every panel is the one glass panel (Owner, 2026-11-19 01:08Z: "we should never use a non-glossy
 * panel"; the lobby panels, the splash loading bar, results, the replay's position bar and the
 * tutorial's HUD were solid). A surface is glass by wearing `ff-aquarian-panel` (or the HUD's
 * `ff-aq-hud`), the one shared rule, never by a fill of its own.
 */

import { describe, expect, it } from "vitest";
import { readClient } from "../../support/client-source";

const component = (name: string): string => readClient(name).replace(/\/\*[\s\S]*?\*\//g, "");
/** The declarations of the rule for `selector` in a component's style block. */
const rule = (source: string, selector: string): string =>
  new RegExp(`${selector.replace(/[.[\]"=]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? "";

describe("the glass panel, shared", () => {
  it("is what a Chip is, so the ready room, results and the replay bar are glass", () => {
    const chip = component("Chip.svelte");
    expect(chip).toMatch(/<Panel class="chip /);
    // No fill of its own to cover the glass.
    expect(chip).not.toMatch(/background:/);
  });

  it("is the splash's loading bar and its ready line", () => {
    expect(component("ProgressBar.svelte")).toMatch(/<Panel[\s\S]*?class="ff-progress"/);
    expect(rule(component("ProgressBar.svelte"), ":global(.ff-progress)")).not.toMatch(/background:/);
    const splash = component("SplashRoot.svelte");
    expect(splash).toMatch(/<Panel class="ff-splash__start"/);
    expect(rule(splash, '.ff-splash__ready[data-ready="true"]')).not.toMatch(/background:/);
  });

  it("is the replay's hint and the rotate hint", () => {
    expect(component("ReplayControls.svelte")).toMatch(/<Toast [^>]*class="ff-replay-hint__pill"/);
    expect(rule(component("ReplayControls.svelte"), ":global(.ff-replay-hint__pill)")).not.toMatch(/background:/);
    expect(component("RotateHint.svelte")).toMatch(/<Toast /);
  });

  it("is the title's tagline strip, the version tag and the lobby's touch help (review R36)", () => {
    const hero = component("MenuHero.svelte");
    expect(hero).toMatch(/<Panel [^>]*class="ff-tagline"/);
    expect(rule(hero, ":global(.ff-tagline)")).not.toMatch(/background:/);
    const title = component("TitleRoot.svelte");
    expect(title).toMatch(/<Panel [^>]*class="ff-title__version"/);
    expect(rule(title, ":global(.ff-title__version)")).not.toMatch(/background:/);
    const connect = component("ConnectPanel.svelte");
    expect(connect).toMatch(/<Panel [^>]*class="ff-aq-secondary ff-help-touch /);
    expect(rule(connect, ":global(.ff-help-touch)")).not.toMatch(/background:/);
  });

  it("is the ready room's code row, and Mute beside it keeps its word (review R11)", () => {
    const code = component("RoomCode.svelte");
    expect(code).toMatch(/<Panel [^>]*class="ff-room-code /);
    expect(code).not.toMatch(/background:|text-shadow:/);
    const mute = component("MuteButton.svelte");
    expect(mute).not.toMatch(/clip-path/);
  });
});
