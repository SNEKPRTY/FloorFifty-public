import { describe, expect, it } from "vitest";
import { parseSources } from "@floor-fifty/content/parse";
import { validateReferences } from "@floor-fifty/content/validate/references";
import { validateStills } from "@floor-fifty/content/validate/stills";
import { buildPayload } from "@floor-fifty/content/canonicalize";
import type { RawSourceTree } from "@floor-fifty/content/types";
import { validSong, validStage, validTree, validTreeWith, withCatalog } from "./support";

const codes = (tree: RawSourceTree) => {
  const result = parseSources(tree);
  if (!result.ok) return result.diagnostics.map((diagnostic) => diagnostic.code);
  return validateReferences(result.parsed).map((diagnostic) => diagnostic.code);
};

const PACKS = (characters: string) => `modes = []
[[packs]]
id = "base"
title = "Base"
stages = ["rooftops"]
songs = ["dusk-run"]
characters = ${characters}
`;

/** A character file whose unlock condition unlocks.toml does not declare. */
const locked = {
  file: "content/characters/ninja-locked.toml",
  text: 'id = "ninja-locked"\ndisplayName = "Locked"\nunlock = "games-99"\n[sheetAliases]\nscarlet = "ninja.scarlet"\ncyan = "ninja.cyan"\ngold = "ninja.gold"\nviolet = "ninja.violet"\n[portraitAliases]\nscarlet = "portrait.scarlet"\ncyan = "portrait.cyan"\ngold = "portrait.gold"\nviolet = "portrait.violet"\n',
};

describe("packs", () => {
  it("accepts a catalog of packs", () => {
    expect(codes(withCatalog(validTree(), PACKS(`["ninja"]`)))).toEqual([]);
  });

  it("refuses an item filed in two packs", () => {
    const twice = `${PACKS(`["ninja"]`)}
[[packs]]
id = "more"
title = "More"
dlc = true
characters = ["ninja"]
`;
    expect(codes(withCatalog(validTree(), twice))).toContain("duplicateCatalogEntry");
  });

  it("refuses a pack that names an item nobody declares", () => {
    expect(codes(withCatalog(validTree(), PACKS(`["ninja", "nobody"]`)))).toContain("unknownReference");
  });

  it("refuses a song in a pack that has no cover", () => {
    const tree = validTreeWith("content/songs/dusk-run.toml", validSong.replace(/^coverAlias = .*\n/m, ""));
    expect(codes(tree)).toContain("missingField");
  });

  it("refuses a song whose unlock nobody declares", () => {
    const tree = validTreeWith("content/songs/dusk-run.toml", `${validSong}unlock = "games-99"\n`);
    expect(codes(tree)).toContain("unknownReference");
  });

  it("accepts a song earned by a declared condition", () => {
    const tree = validTreeWith("content/songs/dusk-run.toml", `${validSong}unlock = "games-5"\n`);
    expect(codes(tree)).toEqual([]);
  });

  it("refuses an unlock nobody declares", () => {
    const tree = withCatalog(validTree(), PACKS(`["ninja-locked"]`));
    expect(codes({ ...tree, characters: [...tree.characters, locked] })).toContain("unknownReference");
  });

  it("emits packs, and flat lists in pack order", () => {
    const result = parseSources(validTree());
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const payload = buildPayload(result.parsed);
    expect(payload.packs.map((pack) => pack.id)).toEqual(["base"]);
    expect(payload.characters.map((character) => character.id)).toEqual(payload.packs.flatMap((pack) => pack.characters));
  });

  it("refuses a catalogued stage without its select still", () => {
    const result = parseSources(validTree());
    if (!result.ok) throw new Error("fixture");
    // The catalogued stage; the fixture's Dawn is the tutorial's, and a draft.
    const stages = result.parsed.stages.map((stage) =>
      stage.value.id === "rooftops"
        ? { ...stage, value: { ...stage.value, theme: { ...stage.value.theme, previewAlias: undefined } } }
        : stage,
    );
    const codes = validateStills({ ...result.parsed, stages }).map((diagnostic) => diagnostic.code);
    expect(codes).toContain("missingStill");
  });

  it("refuses the retired 16:9 tile: nothing draws it, so a theme may not name one", () => {
    const tree = validTreeWith(
      "content/stages/rooftops.toml",
      validStage.replace('previewAlias = "still.rooftopsPreview"', 'previewAlias = "still.rooftopsPreview"\nthumbAlias = "still.rooftopsThumb"'),
    );
    const result = parseSources(tree);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "unknownField", keyPath: "theme.thumbAlias" }));
  });

  it("lets a draft stage go without a still", () => {
    const result = parseSources(validTree());
    if (!result.ok) throw new Error("fixture");
    expect(validateStills(result.parsed)).toEqual([]);
  });

  it("refuses a stage unlock that unlocks.toml does not declare", () => {
    const result = parseSources(validTree());
    if (!result.ok) throw new Error("fixture");
    const [first, ...rest] = result.parsed.stages;
    const locked = { ...first!, value: { ...first!.value, unlock: "games-99" as never } };
    const codes = validateReferences({ ...result.parsed, stages: [locked, ...rest] }).map((diagnostic) => diagnostic.code);
    expect(codes).toContain("unknownReference");
  });
});
