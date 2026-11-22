/**
 * Art alias validation.
 *
 * The manifest owns every fact about an asset; this pass only asks whether the
 * name an author typed exists in it.
 */

import { describe, expect, it } from "vitest";
import { validateAliases } from "@floor-fifty/content/validate/aliases";
import { manifestWithAliases, parsedWithPortrait, validParsed } from "../support";

const EVERY_ALIAS = [
  "ninja.scarlet",
  "ninja.cyan",
  "ninja.gold",
  "ninja.violet",
  "portrait.scarlet",
  "portrait.cyan",
  "portrait.gold",
  "portrait.violet",
  ...["scarlet", "cyan", "gold", "violet"].flatMap((seat) => [`portrait.${seat}Win`, `portrait.${seat}Lose`]),
  "world.platform",
  "menu.backdrop",
  "world.clouds",
  "world.cityFar",
  "world.cityMid",
  "world.cityNear",
  "world.lanterns",
  "world.rooftopDetails",
  "world.rooftopProps",
  "still.rooftopsPreview",
  "music.duskRun",
  "music.duskRunPreview",
  "cover.duskRun",
  "cover.duskRunLarge",
  "cover.duskRunFull",
  "world.dawnSky",
  "world.dawnMist",
  "world.dawnNear",
  "music.tutorial",
];

describe("validateAliases", () => {
  it("accepts a tree whose every alias the manifest carries", () => {
    expect(validateAliases(validParsed(), manifestWithAliases(EVERY_ALIAS))).toEqual([]);
  });

  it("flattens manifest bundles through allAssets", () => {
    expect(
      validateAliases(parsedWithPortrait("missing"), manifestWithAliases(["ninja.scarlet"])),
    ).toContainEqual(
      expect.objectContaining({ code: "unknownAssetAlias", keyPath: "portraitAliases.scarlet" }),
    );
  });

  it("names a stage theme alias by its nested key", () => {
    expect(validateAliases(validParsed(), manifestWithAliases([]))).toContainEqual(
      expect.objectContaining({
        code: "unknownAssetAlias",
        file: "content/stages/rooftops.toml",
        keyPath: "theme.backdropAlias",
      }),
    );
  });
});

describe("the stage's optional aliases", () => {
  it("refuses a misspelled light or select still", () => {
    const parsed = validParsed();
    const stage = parsed.stages[0]!;
    const named = {
      ...parsed,
      stages: [
        {
          ...stage,
          value: {
            ...stage.value,
            theme: {
              ...stage.value.theme,
              lightAlias: "world.nope1",
              previewAlias: "select.nope2",
            },
          },
        },
      ],
    };
    const keyPaths = validateAliases(named, manifestWithAliases(EVERY_ALIAS)).map((d) => d.keyPath);

    expect(keyPaths).toEqual(
      expect.arrayContaining(["theme.lightAlias", "theme.previewAlias"]),
    );
  });

  it("says nothing about an alias the theme does not name", () => {
    const parsed = validParsed();
    const stage = parsed.stages[0]!;
    const { previewAlias: _preview, ...theme } = stage.value.theme;
    const bare = { ...parsed, stages: [{ ...stage, value: { ...stage.value, theme } }] };
    const withoutStills = EVERY_ALIAS.filter((alias) => !alias.startsWith("still.rooftops"));
    expect(validateAliases(bare, manifestWithAliases(withoutStills))).toEqual([]);
  });
});

describe("the stage's layer list", () => {
  const withTheme = (extra: Record<string, unknown>) => {
    const parsed = validParsed();
    const stage = parsed.stages[0]!;
    return {
      ...parsed,
      stages: [{ ...stage, value: { ...stage.value, theme: { ...stage.value.theme, ...extra } } }],
    };
  };

  it("checks every layer's alias, named by its index", () => {
    const diagnostics = validateAliases(
      withTheme({
        layers: [
          { alias: "world.cityFar", plate: "city", depth: 0.15, sink: 240, extend: "skirt" },
          { alias: "world.citeNear", plate: "city", depth: 0.35, sink: 290, extend: "skirt" },
        ],
      }),
      manifestWithAliases(EVERY_ALIAS),
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "unknownAssetAlias", keyPath: "theme.layers[1].alias" }),
    ]);
  });

  it("checks the ambience bed", () => {
    expect(
      validateAliases(withTheme({ ambienceAlias: "ambience.snowShrin" }), manifestWithAliases(EVERY_ALIAS)),
    ).toEqual([expect.objectContaining({ code: "unknownAssetAlias", keyPath: "theme.ambienceAlias" })]);
  });
});
