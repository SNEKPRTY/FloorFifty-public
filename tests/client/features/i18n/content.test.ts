import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { characterName, packTitle, stageName, storyPrompt, unlockHint } from "../../../../apps/client/src/features/i18n/content";
import { chipWords } from "../../../../apps/client/src/features/story/control-chip";
import { GLYPH_MARKER, promptWordsFromText } from "../../../../apps/client/src/features/race/prompt-words";

describe("authored words in the active locale (languages spec §4.2)", () => {
  it("names an item from its message", () => {
    expect(stageName({ id: "snow-shrine", displayName: "Snow Shrine" })).toBe("Snow Shrine");
    expect(characterName({ id: "kitsune", displayName: "Kitsune" })).toBe("Kitsune");
    expect(packTitle({ id: "friends", title: "Friends" })).toBe("Friends");
    expect(unlockHint({ id: "games-5", hint: "Finish 5 races" })).toBe("Finish 5 races");
  });

  it("falls back to the authored English for an item with no message, and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(stageName({ id: "no-such-stage", displayName: "Authored" })).toBe("Authored");
    expect(stageName({ id: "no-such-stage", displayName: "Authored" })).toBe("Authored");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("resolves every key the content build generates", async () => {
    const generated = JSON.parse(await readFile("apps/client/messages/content/en.json", "utf8")) as Record<string, string>;
    const keys = Object.keys(generated).filter((key) => key.startsWith("content_story_prompt_"));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const [, , , ...rest] = key.split("_");
      const method = rest.pop()!;
      const kind = rest.join("_").replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
      expect(storyPrompt(kind, method, "authored", GLYPH_MARKER), key).toBe(generated[key]!.replaceAll("{glyph}", GLYPH_MARKER));
    }
  });
});

describe("the glyph marker (languages spec §4.3)", () => {
  it("draws the glyph where the translator put the marker", () => {
    expect(promptWordsFromText(`Press ${GLYPH_MARKER} to fall`, "A")).toEqual({ before: "Press ", glyph: "A", after: " to fall" });
    expect(promptWordsFromText(`${GLYPH_MARKER}で落下`, "A")).toEqual({ before: "", glyph: "A", after: "で落下" });
  });

  it("draws it after the sentence when the marker was dropped", () => {
    expect(promptWordsFromText("Fall fast", "A")).toEqual({ before: "Fall fast ", glyph: "A", after: "" });
  });

  it("draws it once when the marker was doubled, and never shows the marker", () => {
    const words = promptWordsFromText(`${GLYPH_MARKER} then ${GLYPH_MARKER}`, "A");
    expect(words.glyph).toBe("A");
    expect(`${words.before}${words.after}`).not.toContain(GLYPH_MARKER);
  });

  it("names the button in words when there is no glyph", () => {
    expect(promptWordsFromText(`Press ${GLYPH_MARKER}`, undefined)).toEqual({ before: "Press the button", after: "" });
  });

  it("words a chip for the controls in hand, through the catalogue", () => {
    const prompts = {
      move: { keyboard: "k", gamepad: "g", touch: "t", buttons: "b" },
      fastFall: { keyboard: "kb", gamepad: "{glyph} to drop fast", touch: "t", buttons: "b" },
    };
    expect(chipWords(prompts, "fastFall", "gamepad", "swipe", "A / RT")).toEqual({ before: "", glyph: "A / RT", after: " to drop fast" });
    expect(chipWords(prompts, "fastFall", "touch", "buttons", undefined).before).toBe("Hold the down arrow to drop fast");
  });
});
