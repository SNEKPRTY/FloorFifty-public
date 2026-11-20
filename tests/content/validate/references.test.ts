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
import { TUNABLES } from "@floor-fifty/shared/common/tuning";
import {
  INVALID_SOURCE_ROOT,
  manifestWithAliases,
  parsedWithCatalogStages,
  parsedWithDuplicateIds,
  parsedWithTutorial,
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

describe("the tutorial's stage and song", () => {
  it("refuses a tutorial naming a stage that does not exist", () => {
    expect(validateReferences(parsedWithTutorial({ stageId: "nowhere" }))).toContainEqual(
      expect.objectContaining({ code: "unknownReference", file: "content/tutorial.toml", keyPath: "stageId" }),
    );
  });

  it("refuses a tutorial naming a song that does not exist", () => {
    expect(validateReferences(parsedWithTutorial({ songId: "nowhere" }))).toContainEqual(
      expect.objectContaining({ code: "unknownReference", file: "content/tutorial.toml", keyPath: "songId" }),
    );
  });

  it("refuses a tutorial song a pack lists, which a room could race", () => {
    expect(validateReferences(parsedWithTutorial({ songId: "dusk-run" }))).toContainEqual(
      expect.objectContaining({ code: "wrongKind", file: "content/tutorial.toml", keyPath: "songId" }),
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
