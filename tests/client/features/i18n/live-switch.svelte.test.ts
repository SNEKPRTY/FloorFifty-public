import { ENDONYMS } from "../../../../apps/client/src/features/i18n/locales";
import gsap from "gsap";
import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindDocumentLocale } from "../../../../apps/client/src/features/i18n/document.svelte";
import { installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import SettingsPanel from "../../../../apps/client/src/features/settings/SettingsPanel.svelte";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";
import { memoryStorage } from "../../support/fakes/settings";

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
let undo: Array<() => void> = [];
let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  undo.forEach((u) => u());
  undo = [];
  document.body.innerHTML = "";
});

describe("the live switch (languages spec §8.1)", () => {
  it("picks 日本語: the choice is saved, <html lang> is ja, focus stays, and the region announces once", async () => {
    const settings = new SettingsStore(memoryStorage());
    undo.push(installLocaleStrategy(settings, () => ["en-US"]), bindDocumentLocale(document));
    const reloads = window.location.href;
    component = mount(SettingsPanel, { target: document.body, props: { settings } });
    flushSync();
    const tabBefore = byTestId("settings-tab-settings")!.textContent!.trim();

    const ja = byTestId("settings-language-ja") as HTMLInputElement;
    // jsdom lays nothing out, so GSAP's first read of the picked row's transform lifts it out of the
    // page and back, which drops focus from the radio inside: read it first (a jsdom artefact; a real
    // browser keeps focus, `tests/e2e/motion-edges.spec.ts`, "picking a language ... keeps the focus").
    gsap.set(ja.closest("label"), { scale: 1 });
    ja.focus();
    ja.click();
    await tick();
    flushSync();

    expect(settings.value.locale).toBe("ja");
    expect(document.documentElement.lang).toBe("ja");
    expect(document.activeElement).toBe(byTestId("settings-language-ja"));
    // The same element, now in Japanese: re-worded in place, not remounted.
    expect(tabBefore).toBe("Settings");
    expect(byTestId("settings-tab-settings")!.textContent!.trim()).toBe("設定");
    // Said once the new face has loaded and the switch applied: awaited, not counted in ticks.
    await vi.waitFor(() => expect(byTestId("settings-announcer-region")!.textContent!.trim()).toContain("日本語"));
    expect(window.location.href).toBe(reloads);
  });

  it("lists Automatic with the detected endonym, then the six endonyms each in its own lang", () => {
    const settings = new SettingsStore(memoryStorage());
    undo.push(installLocaleStrategy(settings, () => ["ko-KR"]));
    component = mount(SettingsPanel, { target: document.body, props: { settings } });
    flushSync();
    expect(byTestId("settings-language-auto")!.closest("label")!.textContent).toContain("한국어");
    const tags = [
      ["en", "English"],
      ["ja", "日本語"],
      ["ko", "한국어"],
      ["es-419", "Español"],
      ["pt-BR", "Português (Brasil)"],
      ["zh-Hans", "简体中文"],
    ];
    for (const [tag, name] of tags) {
      const option = byTestId(`settings-language-${tag}`)!.closest("label")!;
      expect(option.getAttribute("lang")).toBe(tag);
      expect(option.textContent).toContain(name);
    }
    const order = [...document.querySelectorAll<HTMLInputElement>('input[name="ff-language"]')].map((input) => input.dataset["testid"]);
    expect(order).toEqual(["settings-language-auto", ...tags.map(([tag]) => `settings-language-${tag}`)]);
  });

  it("draws each language as its country's flag, and names it beside the flag", () => {
    const settings = new SettingsStore(memoryStorage());
    undo.push(installLocaleStrategy(settings, () => ["en-US"]));
    component = mount(SettingsPanel, { target: document.body, props: { settings } });
    flushSync();
    const flags = { en: "us", ja: "jp", ko: "kr", "es-419": "mx", "pt-BR": "br", "zh-Hans": "cn" };
    for (const [tag, country] of Object.entries(flags)) {
      const option = byTestId(`settings-language-${tag}`)!.closest("label")!;
      const flag = option.querySelector("svg")!;
      expect(flag.dataset["flag"]).toBe(country);
      expect(flag.getAttribute("aria-hidden")).toBe("true");
      // The name is written beside the flag, for everyone, and is the radio's accessible name.
      const said = [...option.querySelectorAll<HTMLElement>(":not(svg *)")].filter((el) => el.children.length === 0 && el.textContent!.trim() !== "");
      expect(said.map((el) => el.textContent!.trim())).toEqual([ENDONYMS[tag as keyof typeof ENDONYMS]]);
      expect(said.every((el) => !el.className.includes("sr-only"))).toBe(true);
    }
    // Automatic is a word alone, with no flag; screen readers hear the language it answers.
    const automatic = byTestId("settings-language-auto")!.closest("label")!;
    expect(automatic.querySelector("svg")).toBeNull();
    expect(automatic.textContent).toContain("Automatic");
    expect(automatic.querySelector<HTMLElement>(".sr-only")!.textContent).toBe("English");
  });

  it("checks Automatic until a language is picked, and picking Automatic clears the choice", async () => {
    const settings = new SettingsStore(memoryStorage());
    undo.push(installLocaleStrategy(settings, () => ["en"]));
    component = mount(SettingsPanel, { target: document.body, props: { settings } });
    flushSync();
    expect((byTestId("settings-language-auto") as HTMLInputElement).checked).toBe(true);

    byTestId("settings-language-ko")!.click();
    await tick();
    expect(settings.value.locale).toBe("ko");

    byTestId("settings-language-auto")!.click();
    await tick();
    expect(settings.value.locale).toBeNull();
  });

  it("sits first on the Settings tab", () => {
    const settings = new SettingsStore(memoryStorage());
    undo.push(installLocaleStrategy(settings, () => ["en"]));
    component = mount(SettingsPanel, { target: document.body, props: { settings } });
    flushSync();
    const firstGroup = document.querySelector('[role="tabpanel"] fieldset');
    expect(firstGroup?.querySelector('[data-testid="settings-language-auto"]')).not.toBeNull();
  });
});
