/**
 * Art alias validation.
 *
 * The manifest owns everything about an asset: the file behind it, its pixel
 * dimensions, its palette roles, and its provenance. This pass asks one
 * question and no others -- does the name an author typed appear in the
 * manifest at all.
 *
 * It reads no binary and opens no file. That separation is what lets the art
 * pipeline and the content pipeline evolve without either one having an
 * opinion about the other's rules.
 */

import { allAssets, type ArtManifest } from "@floor-fifty/asset-contract/manifest-schema";
import { type Diagnostic, sortDiagnostics } from "../diagnostics";
import type { ParsedContent } from "../types";

export function validateAliases(
  parsed: ParsedContent,
  manifest: ArtManifest,
): readonly Diagnostic[] {
  const known = new Set(allAssets(manifest).map(({ asset }) => asset.alias));
  const diagnostics: Diagnostic[] = [];

  const check = (file: string, keyPath: string, alias: string): void => {
    if (known.has(alias)) return;
    diagnostics.push({
      code: "unknownAssetAlias",
      file,
      keyPath,
      message: `no asset in the manifest is aliased ${alias}`,
    });
  };

  for (const character of parsed.characters) {
    for (const [colour, alias] of Object.entries(character.value.sheetAliases))
      check(character.file, `sheetAliases.${colour}`, alias);
    // A portrait is three assets: the neutral bust and its win and lose moods.
    for (const [colour, alias] of Object.entries(character.value.portraitAliases))
      for (const mood of ["", "Win", "Lose"]) check(character.file, `portraitAliases.${colour}`, `${alias}${mood}`);
  }

  for (const stage of parsed.stages) {
    check(stage.file, "platformAlias", stage.value.platformAlias);
    check(stage.file, "theme.backdropAlias", stage.value.theme.backdropAlias);

    // The optional aliases, checked when they are named. "Optional" is a
    // statement about the composition -- a theme may have no light of its own
    // -- and not about spelling: a pass that skipped these would let a
    // misspelled alias ship as a deliberate omission, which is the one outcome
    // nobody would look at again.
    const { layers, ...theme } = stage.value.theme;
    for (const key of ["lightAlias", "previewAlias", "ambienceAlias"] as const) {
      const alias = theme[key];
      if (alias !== undefined) check(stage.file, `theme.${key}`, alias);
    }
    layers.forEach((layer, index) => check(stage.file, `theme.layers[${index}].alias`, layer.alias));
  }

  const catalogued = new Set<string>(parsed.catalog.value.songs);
  for (const song of parsed.songs) {
    check(song.file, "audioAlias", song.value.audioAlias);
    // A song in a pack is previewed on the jukebox from its own short clip.
    if (catalogued.has(song.value.id)) check(song.file, "audioAlias", `${song.value.audioAlias}Preview`);
    // A cover is three assets: the 192 px tile, the 640 px panel and the 1200 px reveal.
    const { coverAlias } = song.value;
    if (coverAlias !== undefined) for (const size of ["", "Large", "Full"]) check(song.file, "coverAlias", `${coverAlias}${size}`);
  }

  return sortDiagnostics(diagnostics);
}
