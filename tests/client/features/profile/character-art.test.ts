// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import { portraitAliasFor, sheetAliasFor } from "../../../../apps/client/src/features/profile/character-art";

const { content } = parseGameContentArtifact(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../content/generated/content.json"), "utf8")),
);

describe("character art", () => {
  it("names the body's sheet in the seat's colour", () => {
    expect(sheetAliasFor(content, "frog", "cyan")).toBe("frog.cyan");
    expect(sheetAliasFor(content, "ninja", "scarlet")).toBe("ninja.scarlet");
  });

  it("falls back to the ninja for ?, an unknown body, or no content", () => {
    expect(sheetAliasFor(content, "?", "gold")).toBe("ninja.gold");
    expect(sheetAliasFor(content, "ghost", "gold")).toBe("ninja.gold");
    expect(sheetAliasFor(undefined, "frog", "gold")).toBe("ninja.gold");
  });

  it("names the bust per mood", () => {
    expect(portraitAliasFor(content, "frog", "scarlet", "neutral")).toBe("portrait.frogScarlet");
    expect(portraitAliasFor(content, "frog", "scarlet", "win")).toBe("portrait.frogScarletWin");
    expect(portraitAliasFor(content, "ninja", "violet", "lose")).toBe("portrait.violetLose");
  });
});
