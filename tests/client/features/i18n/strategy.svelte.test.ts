import { flushSync } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { bindDocumentLocale } from "../../../../apps/client/src/features/i18n/document.svelte";
import { activeLocale, applyLocale, browserLanguages, installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";
import { memoryStorage } from "../../support/fakes/settings";

let teardown: Array<() => void> = [];
afterEach(() => {
  teardown.forEach((undo) => undo());
  teardown = [];
});

describe("the custom-settings strategy (languages spec §3.4)", () => {
  // First in the file: the runtime echoes into setLocale only on its very
  // first getLocale, and that echo must not become a saved choice.
  it("never saves the detected locale as a choice when the runtime echoes it", () => {
    const settings = new SettingsStore(memoryStorage());
    teardown.push(installLocaleStrategy(settings, () => ["ja-JP"]));
    expect(activeLocale()).toBe("ja");
    expect(settings.value.locale).toBeNull();
  });

  it("answers the saved choice", () => {
    const settings = new SettingsStore(memoryStorage());
    settings.update({ locale: "ko" });
    teardown.push(installLocaleStrategy(settings, () => ["ja-JP"]));
    expect(activeLocale()).toBe("ko");
  });

  it("answers the detected locale while the choice is Automatic, on every read", () => {
    const settings = new SettingsStore(memoryStorage());
    let languages = ["pt-PT"];
    teardown.push(installLocaleStrategy(settings, () => languages));
    expect(activeLocale()).toBe("pt-BR");
    languages = ["zh-TW"];
    expect(activeLocale()).toBe("zh-Hans");
  });

  it("applyLocale writes the store, and null returns to Automatic", async () => {
    const settings = new SettingsStore(memoryStorage());
    teardown.push(installLocaleStrategy(settings, () => ["en-US"]));
    await applyLocale("ja");
    expect(settings.value.locale).toBe("ja");
    expect(activeLocale()).toBe("ja");
    await applyLocale(null);
    expect(settings.value.locale).toBeNull();
    expect(activeLocale()).toBe("en");
  });

  it("saves an explicit pick even when it is the language Automatic already shows (final review 1)", async () => {
    const settings = new SettingsStore(memoryStorage());
    teardown.push(installLocaleStrategy(settings, () => ["ja-JP"]));
    expect(activeLocale()).toBe("ja");
    await applyLocale("ja");
    expect(settings.value.locale).toBe("ja");
  });

  it("lets the last of several overlapping picks win, whatever order their faces load in (final review 2)", async () => {
    const settings = new SettingsStore(memoryStorage());
    teardown.push(installLocaleStrategy(settings, () => ["en"]));
    // A CJK face that takes a while to arrive, as on a first visit.
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const fonts = { load: () => slow.then(() => []) } as unknown as FontFaceSet;
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    try {
      const results = [applyLocale("ja"), applyLocale("es-419")];
      release();
      expect(await Promise.all(results)).toEqual([false, true]);
      expect(settings.value.locale).toBe("es-419");
      expect(activeLocale()).toBe("es-419");
    } finally {
      delete (document as { fonts?: unknown }).fonts;
    }
  });

  it("never navigates the page", async () => {
    const before = window.location.href;
    const settings = new SettingsStore(memoryStorage());
    teardown.push(installLocaleStrategy(settings, () => ["en"]));
    await applyLocale("es-419");
    expect(window.location.href).toBe(before);
  });
});

describe("bindDocumentLocale", () => {
  it("keeps <html lang> and the title on the active locale", async () => {
    const settings = new SettingsStore(memoryStorage());
    teardown.push(installLocaleStrategy(settings, () => ["en"]));
    teardown.push(bindDocumentLocale(document));
    flushSync();
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("Floor Fifty");
    await applyLocale("zh-Hans");
    flushSync();
    expect(document.documentElement.lang).toBe("zh-Hans");
  });
});

describe("the browser's languages", () => {
  it("falls back to navigator.language when navigator.languages is empty, as some WebViews report it", () => {
    expect(browserLanguages({ languages: [], language: "ja-JP" })).toEqual(["ja-JP"]);
    expect(browserLanguages({ languages: ["ko-KR", "en"], language: "ko-KR" })).toEqual(["ko-KR", "en"]);
  });
});
