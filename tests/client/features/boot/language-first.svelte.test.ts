import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENDONYMS } from "../../../../apps/client/src/features/i18n/locales";
import { installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import LanguageFirst from "../../../../apps/client/src/features/boot/LanguageFirst.svelte";
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

describe("the first visit's language step", () => {
  it("offers Automatic, already chosen, and the six flags", () => {
    const settings = new SettingsStore(memoryStorage());
    undo.push(installLocaleStrategy(settings, () => ["en-US"]));
    component = mount(LanguageFirst, { target: document.body, props: { settings, onContinue: () => undefined } });
    flushSync();
    expect(byTestId("language-first")).not.toBeNull();
    expect((byTestId("first-language-auto") as HTMLInputElement).checked).toBe(true);
    for (const tag of ["en", "ja", "ko", "es-419", "pt-BR", "zh-Hans"]) expect(byTestId(`first-language-${tag}`)).not.toBeNull();
  });

  it("names every language beside its flag, in words a reader can see", () => {
    const settings = new SettingsStore(memoryStorage());
    undo.push(installLocaleStrategy(settings, () => ["en-US"]));
    component = mount(LanguageFirst, { target: document.body, props: { settings, onContinue: () => undefined } });
    flushSync();
    for (const tag of ["en", "ja", "ko", "es-419", "pt-BR", "zh-Hans"] as const) {
      const tile = byTestId(`first-language-${tag}`)!.closest("label")!;
      const name = [...tile.querySelectorAll("span")].find((span) => !span.classList.contains("sr-only") && span.textContent?.trim() === ENDONYMS[tag]);
      expect(name, tag).toBeDefined();
    }
  });

  it("switches the game to a flag at once, so the step itself reads in it, and goes on with Continue", async () => {
    const settings = new SettingsStore(memoryStorage());
    undo.push(installLocaleStrategy(settings, () => ["en-US"]));
    const onContinue = vi.fn();
    component = mount(LanguageFirst, { target: document.body, props: { settings, onContinue } });
    flushSync();
    const before = byTestId("language-first-continue")!.textContent!.trim();

    byTestId("first-language-ja")!.click();
    await tick();
    await vi.waitFor(() => expect(settings.value.locale).toBe("ja"));
    flushSync();

    expect(byTestId("language-first-continue")!.textContent!.trim()).not.toBe(before);
    expect(onContinue).not.toHaveBeenCalled();
    byTestId("language-first-continue")!.click();
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
