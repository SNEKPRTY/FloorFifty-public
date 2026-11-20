/**
 * Set piece validation (Wonder spec §6.4).
 *
 * The schema already checks each kind's fields, floors and moods; this pass
 * checks that every layer a set piece names is one its own stage's theme
 * draws, so a renamed layer cannot leave a sweep that moves nothing.
 */

import type { Diagnostic } from "../diagnostics";
import type { ParsedContent } from "../types";

/** Every layer a set piece names is in its stage's `[[theme.layers]]`. */
export function validateSetPieces(parsed: ParsedContent): readonly Diagnostic[] {
  return parsed.stages.flatMap((stage) => {
    const drawn = new Set(stage.value.theme.layers.map((layer) => layer.alias));
    return (stage.value.theme.setPieces ?? []).flatMap((piece, index) => {
      const named = "layers" in piece && piece.layers !== undefined ? piece.layers : [];
      return named
        .filter((alias) => !drawn.has(alias))
        .map((alias) => ({
          code: "unknownReference" as const,
          file: stage.file,
          keyPath: `theme.setPieces.${index}.layers`,
          message: `set piece at floor ${piece.floor} names ${alias}, which this stage's theme does not draw`,
        }));
    });
  });
}
