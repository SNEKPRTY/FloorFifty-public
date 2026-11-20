/**
 * The portrait rotate hint (launch polish spec 2.5).
 *
 * Shown once, as a small toast under the race timer on a phone held upright;
 * dismissed for good on this device, by OK or by fading on its own; and never
 * a reason for the HUD to fail to render when storage is unavailable.
 */

import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RotateHint from "../../../../apps/client/src/features/race/RotateHint.svelte";
import { SETTINGS_KEY } from "../../../../apps/client/src/features/profile/settings";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";
import { RaceHudView } from "../../../../apps/client/src/features/race/race-hud.svelte";
import type { FormFactor } from "../../../../apps/client/src/features/platform/form-factor";
import { setReducedMotion } from "../../support/motion";
import { lobbyWithFakeNetwork } from "../../support/fakes/screens";
import { fakeStage } from "../../support/fakes/stage";
import { lobbySnapshot } from "../../support/snapshots";

/** A Storage that remembers, or one that throws on every call. */
const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
};
const broken: Pick<Storage, "getItem" | "setItem"> = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

// The hint is a kit toast that falls out as it retires; these tests ask whether it is gone, so it
// leaves at once (the fall itself is the toast's own test, and the one below).
beforeEach(() => setReducedMotion(true));

let host: HTMLElement | undefined;
let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  host?.remove();
  component = undefined;
});

const render = (props: { portrait: boolean; storage: Pick<Storage, "getItem" | "setItem">; lingerMs?: number }) => {
  host = document.createElement("div");
  document.body.append(host);
  component = mount(RotateHint, {
    target: host,
    props: {
      portrait: props.portrait,
      settings: new SettingsStore(props.storage),
      ...(props.lingerMs === undefined ? {} : { lingerMs: props.lingerMs }),
    },
  });
  flushSync();
  return host;
};

describe("the rotate hint", () => {
  it("shows in portrait and not in landscape", () => {
    expect(render({ portrait: true, storage: memory() }).textContent).toContain("Turn your phone for a bigger view");
    unmount(component!);
    component = undefined;
    expect(render({ portrait: false, storage: memory() }).querySelector('[data-testid="rotate-hint"]')).toBeNull();
  });

  it("stays hidden once dismissed", () => {
    const storage = memory();
    const view = render({ portrait: true, storage });
    const button = view.querySelector<HTMLButtonElement>('[data-testid="rotate-hint-dismiss"]')!;

    button.click();
    flushSync();

    expect(view.querySelector('[data-testid="rotate-hint"]')).toBeNull();
    unmount(component!);
    component = undefined;
    expect(render({ portrait: true, storage }).querySelector('[data-testid="rotate-hint"]')).toBeNull();
  });

  it("falls out instead of vanishing: inert from its first frame", () => {
    setReducedMotion(false);
    const view = render({ portrait: true, storage: memory() });
    view.querySelector<HTMLButtonElement>('[data-testid="rotate-hint-dismiss"]')!.click();
    flushSync();

    const leaving = view.querySelector<HTMLElement>('[data-testid="rotate-hint"]');
    expect(leaving).not.toBeNull();
    expect(leaving?.inert).toBe(true);
  });

  it("still renders, and still dismisses for this visit, without storage", () => {
    const view = render({ portrait: true, storage: broken });
    expect(view.querySelector('[data-testid="rotate-hint"]')).not.toBeNull();

    view.querySelector<HTMLButtonElement>('[data-testid="rotate-hint-dismiss"]')!.click();
    flushSync();

    expect(view.querySelector('[data-testid="rotate-hint"]')).toBeNull();
  });
});

describe("fading on its own", () => {
  afterEach(() => void vi.useRealTimers());

  it("retires itself after a few seconds, for good", () => {
    vi.useFakeTimers();
    const storage = memory();
    const view = render({ portrait: true, storage, lingerMs: 1000 });
    expect(view.querySelector('[data-testid="rotate-hint"]')).not.toBeNull();

    vi.advanceTimersByTime(1000);
    flushSync();

    expect(view.querySelector('[data-testid="rotate-hint"]')).toBeNull();
    expect(new SettingsStore(storage).value.seen.rotateHint).toBe(true);
  });
});

describe("where it shows (responsive parity spec §5.6)", () => {
  const hudAs = (formFactor: FormFactor, portrait: boolean, settings = new SettingsStore(memory())) => {
    const stage = fakeStage();
    stage.emitViewport({ ...stage.viewport, formFactor, portrait });
    const view = new RaceHudView(stage, { settings, hint: "rotate" });
    flushSync();
    return { stage, view };
  };

  it("shares the one toast slot with the swipe coach, never both at once", () => {
    const stage = fakeStage();
    stage.emitViewport({ ...stage.viewport, formFactor: "phone-portrait", portrait: true });
    const view = new RaceHudView(stage, { settings: new SettingsStore(memory()), hint: "swipe" });
    flushSync();
    expect(stage.overlay.querySelectorAll(".ff-hud__toast")).toHaveLength(1);
    expect(stage.overlay.querySelector('.ff-hud__toast [data-testid="swipe-coach"]')).not.toBeNull();
    expect(stage.overlay.querySelector('[data-testid="rotate-hint"]')).toBeNull();
    view.destroy();
  });

  it("sits under the timer in a phone held upright's race HUD", () => {
    const { stage, view } = hudAs("phone-portrait", true);
    const hint = stage.overlay.querySelector<HTMLElement>('[data-testid="rotate-hint"]');
    expect(hint).not.toBeNull();
    expect(hint!.closest("[data-hud-metrics]")).not.toBeNull();
    expect(hint!.closest(".ff-hud__toast")).not.toBeNull();
    view.destroy();
  });

  it("never tells a tablet held upright, or a landscape screen, to turn", () => {
    for (const [factor, portrait] of [
      ["tablet-portrait", true],
      ["phone-landscape", false],
      ["desktop", false],
    ] as const) {
      const { stage, view } = hudAs(factor, portrait);
      expect(stage.overlay.querySelector('[data-testid="rotate-hint"]')).toBeNull();
      view.destroy();
    }
  });

  it("stays dismissed after the player changes another setting", () => {
    // One store owns the key: a dismissal written around it was overwritten
    // by the store's next save, and the hint came back on every visit.
    const storage = memory();
    const settings = new SettingsStore(storage);
    const { stage, view } = hudAs("phone-portrait", true, settings);

    stage.overlay.querySelector<HTMLButtonElement>('[data-testid="rotate-hint-dismiss"]')!.click();
    flushSync();
    settings.update({ audio: { muted: true } });

    expect(stage.overlay.querySelector('[data-testid="rotate-hint"]')).toBeNull();
    expect(new SettingsStore(storage).value.seen.rotateHint).toBe(true);
    view.destroy();
  });

  it("is no longer part of the ready room", async () => {
    localStorage.removeItem(SETTINGS_KEY);
    const menu = await lobbyWithFakeNetwork();
    menu.receiveSnapshot(lobbySnapshot(1));
    flushSync();
    expect(menu.query("rotate-hint")).toBeNull();
    menu.screen.exit();
  });
});
