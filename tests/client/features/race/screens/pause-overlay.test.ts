/**
 * Pausing a networked race (launch polish §3.1.1, "Pause").
 *
 * The room keeps racing on the server, so a pause is an overlay over a race
 * that goes on: it releases input, says so, and draws the race underneath.
 */

import { flushSync } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { applyLocale, installLocaleStrategy } from "../../../../../apps/client/src/features/i18n/strategy";
import { SettingsStore } from "../../../../../apps/client/src/features/profile/store/settings.svelte";
import { gameplayWithFakeNetwork } from "../../../support/fakes/screens";
import { fakeSettings, memoryStorage } from "../../../support/fakes/settings";

let exit: (() => void) | undefined;
afterEach(() => {
  exit?.();
  exit = undefined;
});

const race = async (options: Parameters<typeof gameplayWithFakeNetwork>[0] = {}) => {
  const gameplay = await gameplayWithFakeNetwork(options);
  exit = () => gameplay.screen.exit();
  return gameplay;
};

describe("pausing a networked race", () => {
  it("opens on Escape, says the race continues, and releases input", async () => {
    const gameplay = await race();
    gameplay.screen["input"].set("left", true, "keyboard");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(gameplay.screen.isPaused()).toBe(true);
    expect(gameplay.overlay.querySelector('[data-testid="pause-overlay"]')?.textContent).toContain("Race continues");
    expect(gameplay.screen["input"].frame.left).toBe(false);
  });

  it("resumes on Escape again and on Resume", async () => {
    const gameplay = await race();
    gameplay.click("pause-open");
    gameplay.click("pause-resume");
    expect(gameplay.screen.isPaused()).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(gameplay.screen.isPaused()).toBe(false);
  });

  it("closes through the dialog's own Escape without toggling twice", async () => {
    const gameplay = await race();
    gameplay.click("pause-open");
    const dialog = gameplay.overlay.querySelector<HTMLElement>('[data-testid="pause-overlay"]')!;
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(gameplay.screen.isPaused()).toBe(false);
  });

  it("leaves the room only after confirming, then asks the flow for the title", async () => {
    const gameplay = await race();
    gameplay.click("pause-open");
    gameplay.click("pause-leave");
    expect(gameplay.network.calls).not.toContain("leaveRoom");
    gameplay.click("pause-leave-confirm");
    await gameplay.settle();
    expect(gameplay.network.calls).toContain("leaveRoom");
    expect(gameplay.lastPublished()).toBe("ui.leave-race-settled");
  });

  it("mutes from the overlay, in words as well as state", async () => {
    const settings = fakeSettings();
    const gameplay = await race({ settings });
    gameplay.click("pause-open");
    gameplay.click("pause-mute");
    expect(settings.value.audio.muted).toBe(true);
    expect(gameplay.overlay.querySelector('[data-testid="pause-mute"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps drawing the race under the overlay", async () => {
    const gameplay = await race();
    gameplay.click("pause-open");
    expect(() => gameplay.screen.draw(16)).not.toThrow();
    expect(gameplay.screen.isMounted()).toBe(true);
  });

  it("rebuilds the backdrop when quality changes while paused (review focus 5)", async () => {
    const settings = fakeSettings();
    const gameplay = await race({ settings });
    gameplay.click("pause-open");
    settings.update({ display: { quality: "low" } });
    gameplay.screen.draw(16);
    expect(gameplay.screen.isPaused()).toBe(true);
    // One live lease: the old build released its lease before the new one
    // took one, so nothing leaked under the overlay.
    expect(gameplay.stage.leases.filter((lease) => lease.destroys === 0)).toHaveLength(1);
    expect(gameplay.stage.leases.length).toBeGreaterThanOrEqual(2);
  });

  it("switches language mid-race without remounting or leaving (languages plan, review focus 1)", async () => {
    const settings = new SettingsStore(memoryStorage());
    const undo = installLocaleStrategy(settings, () => ["en-US"]);
    try {
      const gameplay = await race({ settings });
      gameplay.click("pause-open");
      const hud = gameplay.overlay.querySelector('[data-testid="race-hud"]');
      const overlay = gameplay.overlay.querySelector('[data-testid="pause-overlay"]');
      expect(hud).not.toBeNull();

      await applyLocale("ja");
      flushSync();

      expect(document.documentElement.contains(hud)).toBe(true);
      expect(gameplay.overlay.querySelector('[data-testid="race-hud"]')).toBe(hud);
      expect(gameplay.overlay.querySelector('[data-testid="pause-overlay"]')).toBe(overlay);
      expect(gameplay.screen.isPaused()).toBe(true);
      expect(gameplay.network.calls).not.toContain("leaveRoom");
    } finally {
      undo();
    }
  });

  it("keeps the race's status line under the title, which is the dialog's heading", async () => {
    const gameplay = await race();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const dialog = gameplay.overlay.querySelector<HTMLElement>('[data-testid="pause-overlay"]')!;
    expect(dialog.querySelector('[role="status"]')?.textContent).toContain("Race continues");
    const heading = document.getElementById(dialog.getAttribute("aria-labelledby")!)!;
    expect(heading.textContent).toBe("Paused");
  });
});
