import { afterEach, describe, expect, it } from "vitest";
import { applyLocale, installLocaleStrategy } from "../../../../../apps/client/src/features/i18n/strategy";
import { SettingsStore } from "../../../../../apps/client/src/features/profile/store/settings.svelte";
import { FONT_WORDMARK, fontUiFor } from "../../../../../apps/client/src/features/i18n/fonts";
import { wordFont, wordText } from "../../../../../apps/client/src/features/race/juice/word-text";
import { GENERATED_CONTENT } from "../../../../../apps/server/src/content/generated-content";
import { memoryStorage } from "../../../support/fakes/settings";

const WORDS = GENERATED_CONTENT.content.juice.words;

let teardown: Array<() => void> = [];
afterEach(() => {
  teardown.forEach((undo) => undo());
  teardown = [];
});

/** Puts the page in `locale`, through the settings strategy the app installs. */
async function inLocale(locale: "en" | "ja" | "es-419"): Promise<void> {
  const settings = new SettingsStore(memoryStorage());
  teardown.push(installLocaleStrategy(settings, () => ["en-US"]));
  await applyLocale(locale);
}

describe("word text (Wonder spec §5.2)", () => {
  it("says each word in English", async () => {
    await inLocale("en");
    expect(wordText({ kind: "slam" }, WORDS)).toBe("SLAM!");
    expect(wordText({ kind: "streak", count: 3 }, WORDS)).toBe("×3");
    expect(wordText({ kind: "streak", count: 5 }, WORDS)).toBe("×5 NICE!");
    expect(wordText({ kind: "streak", count: 10 }, WORDS)).toBe("×10 GREAT!");
    expect(wordText({ kind: "skip" }, WORDS)).toBe("SKIP!");
    expect(wordText({ kind: "pass" }, WORDS)).toBe("PASS!");
    expect(wordText({ kind: "lead" }, WORDS)).toBe("1ST!");
    expect(wordText({ kind: "lap", lap: 2 }, WORDS)).toBe("LAP 2!");
    expect(wordText({ kind: "finalAscent" }, WORDS)).toBe("FINAL ASCENT!");
    expect(wordText({ kind: "lastFloor" }, WORDS)).toBe("LAST FLOOR!");
    expect(wordText({ kind: "place", place: 1 }, WORDS)).toBe("1ST!");
    expect(wordText({ kind: "place", place: 3 }, WORDS)).toBe("3rd");
    expect(wordText({ kind: "whoops" }, WORDS)).toBe("Whoops!");
    expect(wordText({ kind: "back" }, WORDS)).toBe("BACK!");
  });

  it("says them in Japanese, upright in Noto", async () => {
    await inLocale("ja");
    expect(wordText({ kind: "lap", lap: 2 }, WORDS)).toBe("2周目！");
    expect(wordText({ kind: "place", place: 3 }, WORDS)).toBe("3位");
    expect(wordFont("ja")).toEqual({ family: fontUiFor("ja"), weight: "600", skew: false });
  });

  it("slants Latin words in Fraunces 900", () => {
    expect(wordFont("es-419")).toEqual({ family: FONT_WORDMARK, weight: "900", skew: true });
    expect(wordFont("en")).toEqual({ family: FONT_WORDMARK, weight: "900", skew: true });
  });
});
