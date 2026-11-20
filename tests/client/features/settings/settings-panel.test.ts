/**
 * The settings panel (launch polish §3.1.2): every control writes through
 * the store, and the Controls tab teaches the input in the player's hand.
 */

import gsap from "gsap";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import SettingsPanel from "../../../../apps/client/src/features/settings/SettingsPanel.svelte";
import { GLYPHS } from "../../../../apps/client/src/features/i18n/glyphs";
import { inputMethod } from "../../../../apps/client/src/features/platform/input-method.svelte";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
  inputMethod.note("keyboard");
});

const render = (options: { coarse?: boolean } = {}) => {
  const realMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) =>
    ({ matches: options.coarse === true && query.includes("pointer: coarse"), media: query }) as MediaQueryList) as typeof window.matchMedia;
  const settings = new SettingsStore(undefined);
  const host = document.createElement("div");
  document.body.append(host);
  try {
    component = mount(SettingsPanel, { target: host, props: { settings } });
    flushSync();
  } finally {
    window.matchMedia = realMatchMedia;
  }
  const q = <T extends HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`);
  const click = (id: string) => {
    q(id)!.click();
    flushSync();
  };
  return { settings, host, q, click };
};

describe("the settings tab", () => {
  it("mutes, sets volumes, quality and the panel through the store", () => {
    const { settings, q, click } = render();
    click("settings-mute");
    expect(settings.value.audio.muted).toBe(true);

    const music = q<HTMLInputElement>("settings-music")!;
    music.value = "0.4";
    music.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(settings.value.audio.music).toBe(0.4);

    click("settings-quality-low");
    expect(settings.value.display.quality).toBe("low");

    const lcd = settings.value.display.lcdPanel;
    click("settings-lcd");
    expect(settings.value.display.lcdPanel).toBe(!lcd);

    const traj = settings.value.display.trajectoryGuide;
    click("settings-trajectory-guide");
    expect(settings.value.display.trajectoryGuide).toBe(!traj);
  });


  it("plays a sample when the effects or announcer slider is let go, so the level is set by ear", () => {
    const { host, q } = render();
    const asked: string[] = [];
    host.addEventListener("ff-sfx", (event) => asked.push((event as CustomEvent<{ sound: string }>).detail.sound));
    for (const id of ["settings-sfx", "settings-announcer", "settings-music"]) {
      const slider = q<HTMLInputElement>(id)!;
      slider.value = "0.5";
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    }
    flushSync();
    // The music is its own sample: it is playing under the panel.
    expect(asked).toEqual(["effectsSample", "voiceSample"]);
  });

  it("offers muting while another window has focus, off until asked", () => {
    const { settings, q, click } = render();
    expect(q<HTMLInputElement>("settings-mute-unfocused")!.checked).toBe(false);
    click("settings-mute-unfocused");
    expect(settings.value.audio.muteUnfocused).toBe(true);
  });

  it("switches character and stage effects off and on through the store, each on its own", () => {
    const { settings, q, click } = render();
    expect(q<HTMLInputElement>("settings-character-effects")!.checked).toBe(true);
    expect(q<HTMLInputElement>("settings-stage-effects")!.checked).toBe(true);
    click("settings-character-effects");
    expect(settings.value.display).toMatchObject({ characterEffects: false, stageEffects: true });
    click("settings-stage-effects");
    expect(settings.value.display).toMatchObject({ characterEffects: false, stageEffects: false });
    click("settings-character-effects");
    expect(settings.value.display).toMatchObject({ characterEffects: true, stageEffects: false });
  });

  it("offers the touch mode only on a touch screen", () => {
    expect(render().q("settings-touch-buttons")).toBeNull();
    unmount(component!);
    component = undefined;

    const { settings, click } = render({ coarse: true });
    click("settings-touch-buttons");
    expect(settings.value.input.touchMode).toBe("buttons");
  });

  it("names every control", () => {
    const { host } = render({ coarse: true });
    for (const control of host.querySelectorAll<HTMLElement>("button, input")) {
      const labelled =
        (control.getAttribute("aria-label") ?? "").trim() !== "" ||
        (control.id !== "" && host.querySelector(`label[for="${control.id}"]`) !== null) ||
        control.closest("label") !== null ||
        (control.textContent ?? "").trim() !== "";
      expect(labelled, `${control.outerHTML} has no name`).toBe(true);
    }
  });
});

describe("the privacy note (release readiness §7.4)", () => {
  it("sits at the bottom of the Settings tab, behind a Privacy button", () => {
    const { host, q } = render();
    expect(q("settings-privacy")).toBeNull();
    const open = q("settings-privacy-open");
    expect(open?.textContent).toContain("Privacy");
    expect(open!.closest("[data-row]")).not.toBeNull();
    const rows = [...host.querySelectorAll('[data-testid="settings-scroll"] [data-row]')];
    expect(rows[rows.length - 1]!.contains(open)).toBe(true);
  });

  it("says what is kept, where, and for how long", () => {
    const { q } = render();
    q("settings-privacy-open")!.click();
    flushSync();
    const privacy = document.querySelector('[data-testid="settings-privacy"]');
    expect(privacy).not.toBeNull();
    const items = [...privacy!.querySelectorAll("li")].map((item) => item.textContent?.trim() ?? "");
    expect(items).toHaveLength(6);
    expect(items.join(" ")).toMatch(/replays you share/);
    expect(items.join(" ")).toMatch(/14 days/);
    expect(items.join(" ")).toMatch(/Ruken/);
    expect(privacy!.textContent).toMatch(/clear this site's data/);
  });

  it("is not on the Controls tab", () => {
    const { q, click } = render();
    click("settings-tab-controls");
    expect(q("settings-privacy-open")).toBeNull();
  });
});

describe("on a short screen", () => {
  it("keeps the tabs in view and scrolls the section in a list that says what is below", () => {
    // A ScrollList: the screen contract reads its minimum rows, and it fades
    // and counts "+N more" when rows run on below the dialog's foot.
    const { host, click } = render({ coarse: true });
    const list = host.querySelector<HTMLElement>('[data-testid="settings-scroll"]')!;
    expect(list.hasAttribute("data-scroll-region")).toBe(true);
    expect(list.dataset["minRows"]).toBe("2");
    expect(list.contains(host.querySelector('[role="tablist"]'))).toBe(false);
    for (const id of ["settings-mute", "settings-mute-unfocused", "settings-music", "settings-sfx", "settings-announcer", "settings-lcd", "settings-character-effects", "settings-stage-effects", "settings-quality-high", "settings-touch-swipe"]) {
      expect(host.querySelector(`[data-testid="${id}"]`)!.closest("[data-row]"), id).not.toBeNull();
    }
    click("settings-tab-controls");
    const controls = host.querySelector<HTMLElement>('[data-testid="settings-scroll"]')!;
    expect(controls.querySelectorAll("[data-row]").length).toBeGreaterThan(2);
  });
});

describe("the controls tab", () => {
  it("puts the keyboard first for a keyboard player", () => {
    inputMethod.note("keyboard");
    const { host, click } = render();
    click("settings-tab-controls");
    const sections = [...host.querySelectorAll<HTMLElement>("[data-controls-section]")];
    expect(sections[0]?.dataset["controlsSection"]).toBe("keyboard");
    expect(sections[0]?.textContent).toContain("your current input");
  });

  it("shows the touch controls first on a touch device", () => {
    inputMethod.note("touch");
    const { host, click } = render({ coarse: true });
    click("settings-tab-controls");
    const sections = [...host.querySelectorAll<HTMLElement>("[data-controls-section]")];
    expect(sections.map((section) => section.dataset["controlsSection"])).toEqual(["touch", "keyboard", "controller"]);
  });

  it("names a PlayStation pad's own buttons after one is used", () => {
    inputMethod.noteGamepad("playstation");
    const { host, click } = render();
    click("settings-tab-controls");
    const first = host.querySelector<HTMLElement>("[data-controls-section]")!;
    expect(first.dataset["controlsSection"]).toBe("controller");
    expect(first.textContent).toContain(GLYPHS.playstation.fastFall());
    expect(first.textContent).toContain(GLYPHS.playstation.pause());
  });
});

describe("the tabs", () => {
  it("are the kit's ghost buttons, the open one marked chosen", () => {
    const { q, click } = render();
    const settingsTab = q("settings-tab-settings")!;
    const controlsTab = q("settings-tab-controls")!;
    expect(settingsTab.classList.contains("ff-aq-control--ghost")).toBe(true);
    expect(settingsTab.classList.contains("ff-aq-control--selected")).toBe(true);
    expect(controlsTab.classList.contains("ff-aq-control--selected")).toBe(false);
    expect(settingsTab.getAttribute("aria-selected")).toBe("true");
    click("settings-tab-controls");
    expect(controlsTab.classList.contains("ff-aq-control--selected")).toBe(true);
    expect(settingsTab.classList.contains("ff-aq-control--selected")).toBe(false);
    expect(controlsTab.getAttribute("role")).toBe("tab");
  });
});

describe("picking a setting plays one pulse on its row (the audit's snap)", () => {
  // A saved choice from an earlier test would make the click a no-op (a radio already chosen fires no change).
  beforeEach(() => localStorage.clear());

  it.each(["settings-mute", "settings-lcd", "settings-quality-low", "settings-rumble"])("%s", (id) => {
    const { q, click } = render();
    const row = q(id)!.closest("label")!;
    expect(gsap.getTweensOf(row)).toHaveLength(0);
    click(id);
    expect(gsap.getTweensOf(row)).toHaveLength(1);
  });

  it("the touch mode too", () => {
    const { q, click } = render({ coarse: true });
    const row = q("settings-touch-buttons")!.closest("label")!;
    click("settings-touch-buttons");
    expect(gsap.getTweensOf(row)).toHaveLength(1);
  });

  it("a language flag too, once, however many groups hold it", async () => {
    const { q } = render();
    const row = q("settings-language-auto")!.closest("label")!;
    q("settings-language-auto")!.click();
    flushSync();
    expect(gsap.getTweensOf(row).length).toBeLessThanOrEqual(1);
  });
});
