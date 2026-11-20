/**
 * Juice validation.
 *
 * `juice.toml` may give a stage its own dust swatch (polish spec §4.2). The
 * schema already checks the role is a palette role; this pass checks the
 * stage is one the tree declares, so a renamed stage cannot leave a dead key.
 */

import type { Diagnostic } from "../diagnostics";
import type { ParsedContent } from "../types";

/** Every `[palette.stages.<id>]` names a stage the tree declares. */
export function validateJuice(parsed: ParsedContent): readonly Diagnostic[] {
  const stageIds = new Set<string>(parsed.stages.map((stage) => stage.value.id));
  return Object.keys(parsed.juice.value.palette.stages)
    .filter((id) => !stageIds.has(id))
    .map((id) => ({
      code: "unknownReference" as const,
      file: parsed.juice.file,
      keyPath: `palette.stages.${id}`,
      message: `no stage declares the id ${id}`,
    }));
}
