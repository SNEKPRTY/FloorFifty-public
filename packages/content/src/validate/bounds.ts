/**
 * Tuning bounds validation.
 *
 * `TUNABLES` is the only source of truth for a range, a type, and a default,
 * and it is passed in rather than imported at the point of use so a test can
 * pin behaviour against a declaration set it controls.
 *
 * `tuning.toml` must name every tunable; stage and mode layers are partial
 * overrides. Every layer is checked independently and completely, so one save
 * reports every bad number rather than the first.
 */

import type { TunableDeclaration, TunableName, TUNABLES } from "@floor-fifty/shared/common/tuning";
import { type Diagnostic, sortDiagnostics } from "../diagnostics";
import type { Located, ParsedContent } from "../types";

/**
 * Code-only names an author might reasonably try.
 *
 * Not derivable from `TUNABLES` -- that is the point of the list. It exists so
 * that typing `TICK_HZ` is answered with "this is an invariant" rather than
 * "no such field", which sends the author looking for a spelling mistake.
 *
 * Adding a constant to `lib/constants.ts` that an author could plausibly
 * type means adding it here too. It is a courtesy over `unknownField`, never a
 * second source of truth for the values themselves.
 */
export const AUTHORING_INVARIANTS = [
  "TICK_HZ",
  "TICK_MS",
  "TICK_SECONDS",
  "SNAPSHOT_HZ",
  "VIEWPORT",
  "VIEWPORT_WIDTH",
  "VIEWPORT_HEIGHT",
  "MAX_PLAYERS",
  "PROTOCOL_VERSION",
  "COUNTDOWN_TICKS",
  "RECONNECT_GRACE_TICKS",
] as const;

const invariants = new Set<string>(AUTHORING_INVARIANTS);

type Declarations = typeof TUNABLES;

/**
 * Checks one authored layer against the declarations.
 *
 * Invariants are rejected before unknown names so that the more specific
 * answer wins, then integer declarations, then the inclusive range.
 */
function checkLayer(
  layer: Located<Readonly<Record<string, number>>>,
  declarations: Declarations,
  complete: boolean,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const refuse = (code: Diagnostic["code"], keyPath: string, message: string): void => {
    diagnostics.push({ code, file: layer.file, keyPath, message });
  };

  for (const [name, value] of Object.entries(layer.value)) {
    if (invariants.has(name)) {
      refuse(
        "invariantNotAuthorable",
        name,
        `${name} is a code-only invariant and cannot be authored`,
      );
      continue;
    }

    const declaration: TunableDeclaration | undefined = declarations[name as TunableName];
    if (declaration === undefined) {
      refuse("unknownField", name, `unknown tunable: ${name}`);
      continue;
    }

    if (declaration.type === "int" && !Number.isInteger(value)) {
      refuse("invalidType", name, `${name} is declared int, received ${value}`);
      continue;
    }

    if (value < declaration.min || value > declaration.max)
      refuse(
        "outOfRange",
        name,
        `expected ${declaration.min}..${declaration.max}, received ${value}`,
      );
  }

  if (!complete) return diagnostics;

  for (const name of Object.keys(declarations)) {
    if (name in layer.value) continue;
    refuse("missingField", name, `base tuning must declare ${name}`);
  }

  return diagnostics;
}

export function validateBounds(
  parsed: ParsedContent,
  declarations: Declarations,
): readonly Diagnostic[] {
  return sortDiagnostics([
    ...checkLayer(parsed.tuning, declarations, true),
    ...parsed.stages.flatMap((stage) =>
      checkLayer({ file: stage.file, value: stage.value.courseTuning }, declarations, false),
    ),
    ...parsed.modes.flatMap((mode) =>
      checkLayer({ file: mode.file, value: mode.value.tuning }, declarations, false),
    ),
  ]);
}
