/**
 * Reference validation.
 *
 * The catalog is the public set, so every one of these failures is a menu row
 * that would otherwise point at nothing or at the wrong kind of thing.
 */

import { describe, expect, it } from "vitest";
import { parseSources } from "@floor-fifty/content/parse";
import { readSources } from "@floor-fifty/content/read-sources";
import { validateAliases } from "@floor-fifty/content/validate/aliases";
import { validateBounds } from "@floor-fifty/content/validate/bounds";
import { validateReferences } from "@floor-fifty/content/validate/references";
import { asContentId } from "@floor-fifty/shared/content/game-content";
import { TUNABLES } from "@floor-fifty/shared/common/tuning";
import {
  INVALID_SOURCE_ROOT,
  manifestWithAliases,
  parsedWithCatalogStages,
  parsedWithDuplicateIds,
  parsedWithStory,
  validParsed,
} from "../support";

describe("validateReferences", () => {
  it("accepts the valid tree, drafts and all", () => {
    expect(validateReferences(validParsed())).toEqual([]);
  });

  it.each([
    [parsedWithDuplicateIds(), "duplicateId"],
    [parsedWithCatalogStages(["rooftops", "rooftops"]), "duplicateCatalogEntry"],
    [parsedWithCatalogStages(["scarlet"]), "wrongKind"],
    [parsedWithCatalogStages(["nowhere"]), "unknownReference"],
  ] as const)("rejects invalid references", (parsed, code) => {
    expect(validateReferences(parsed)).toContainEqual(expect.objectContaining({ code }));
  });
});

describe("the story's stages, songs and speakers", () => {
  it("refuses a chapter naming a stage that does not exist", () => {
    expect(validateReferences(parsedWithStory({ stageId: "nowhere" }))).toContainEqual(
      expect.objectContaining({ code: "unknownReference", file: "content/story.toml", keyPath: "chapters.0.stageId" }),
    );
  });

  it("refuses a chapter naming a song that does not exist", () => {
    expect(validateReferences(parsedWithStory({ songId: "nowhere" }))).toContainEqual(
      expect.objectContaining({ code: "unknownReference", file: "content/story.toml", keyPath: "chapters.0.songId" }),
    );
  });

  it("accepts a chapter song a pack lists: an open song is the story's to play", () => {
    expect(validateReferences(parsedWithStory({ songId: "dusk-run" }))).not.toContainEqual(
      expect.objectContaining({ keyPath: "chapters.0.songId" }),
    );
  });

  it("refuses a chapter song that is earned by an unlock", () => {
    const parsed = validParsed();
    const locked = {
      ...parsed,
      songs: parsed.songs.map((song) =>
        song.value.id === "dusk-run" ? { ...song, value: { ...song.value, unlock: asContentId("any-match") } } : song,
      ),
    };
    const withSong = { ...locked, story: { ...locked.story, value: { ...locked.story.value, chapters: locked.story.value.chapters.map((chapter) => ({ ...chapter, songId: "dusk-run" })) } } };
    expect(validateReferences(withSong)).toContainEqual(
      expect.objectContaining({ code: "wrongKind", file: "content/story.toml", keyPath: "chapters.0.songId" }),
    );
  });

  it("refuses an actor that is not a character", () => {
    const parsed = validParsed();
    const story = {
      ...parsed.story,
      value: { ...parsed.story.value, actors: { pal: { ...parsed.story.value.actors["pal"]!, characterId: "nobody" } } },
    };
    expect(validateReferences({ ...parsed, story })).toContainEqual(
      expect.objectContaining({ code: "unknownReference", file: "content/story.toml", keyPath: "actors.pal.characterId" }),
    );
  });
});

describe("a tree with several independent failures", () => {
  it("reports every one of them from one read", async () => {
    const parsed = parseSources(await readSources(INVALID_SOURCE_ROOT));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const diagnostics = [
      ...validateReferences(parsed.parsed),
      ...validateBounds(parsed.parsed, TUNABLES),
      ...validateAliases(parsed.parsed, manifestWithAliases(["ninja.scarlet", "portrait.scarlet"])),
    ];

    expect(new Set(diagnostics.map((diagnostic) => diagnostic.code))).toEqual(
      new Set([
        "duplicateCatalogEntry",
        "unknownReference",
        "missingField",
        "outOfRange",
        "invariantNotAuthorable",
        "unknownAssetAlias",
      ]),
    );
  });
});
