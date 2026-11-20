/**
 * The select screen's still.
 *
 * A stage offered in the select screen needs its preview (select spec §4.5).
 * Only catalogued stages are held to it: a draft, or the tutorial's own
 * stage, is never offered, so it may go without.
 */

import { type Diagnostic, sortDiagnostics } from "../diagnostics";
import type { ParsedContent } from "../types";

export function validateStills(parsed: ParsedContent): readonly Diagnostic[] {
  const catalogued = new Set(parsed.catalog.value.stages);
  const diagnostics: Diagnostic[] = [];
  for (const stage of parsed.stages) {
    if (!catalogued.has(stage.value.id)) continue;
    if (stage.value.theme.previewAlias === undefined)
      diagnostics.push({
        code: "missingStill",
        file: stage.file,
        keyPath: "theme.previewAlias",
        message: "a stage in a pack needs theme.previewAlias",
      });
  }
  return sortDiagnostics(diagnostics);
}
