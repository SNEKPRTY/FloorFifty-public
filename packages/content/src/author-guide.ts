/**
 * The generated part of the author guide.
 *
 * The tunable table is the one section of `docs/content-authoring.md` that
 * can silently go wrong: a range changes in `common/tuning.ts`, the guide
 * still promises the old one, and an author writes a value the compiler then
 * refuses for a reason the documentation denies. So it is generated from the
 * declarations and verified in CI, between markers, with every other section
 * hand-written.
 */

import { readFile, writeFile } from "node:fs/promises";
import type { ResolvedTuning, TunableName, TUNABLES } from "@floor-fifty/shared/common/tuning";
import type { Diagnostic } from "./diagnostics";

export const BEGIN_MARKER = "<!-- BEGIN GENERATED TUNABLES -->";
export const END_MARKER = "<!-- END GENERATED TUNABLES -->";

type Declarations = typeof TUNABLES;

/** Every tunable once, sorted by name, with its declaration and shipped value. */
export function renderTunableTable(
  declarations: Declarations,
  authored: ResolvedTuning,
): string {
  const rows = (Object.keys(declarations) as TunableName[])
    .sort()
    .map((name) => {
      const declaration = declarations[name];
      return `| \`${name}\` | ${declaration.type} | ${declaration.min} to ${declaration.max} | ${authored[name]} |`;
    });

  return [
    "| Name | Type | Inclusive range | Value in `content/tuning.toml` |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** The guide with its generated section replaced, or a reason it cannot be. */
function withTable(
  guide: string,
  declarations: Declarations,
  authored: ResolvedTuning,
): string | undefined {
  const begin = guide.indexOf(BEGIN_MARKER);
  const end = guide.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) return undefined;

  const head = guide.slice(0, begin + BEGIN_MARKER.length);
  const tail = guide.slice(end);
  return `${head}\n\n${renderTunableTable(declarations, authored)}\n\n${tail}`;
}

export async function updateAuthorGuide(
  path: string,
  declarations: Declarations,
  authored: ResolvedTuning,
): Promise<void> {
  const guide = await readFile(path, "utf8");
  const next = withTable(guide, declarations, authored);
  if (next === undefined)
    throw new Error(`${path} is missing its ${BEGIN_MARKER} / ${END_MARKER} markers`);
  if (next !== guide) await writeFile(path, next);
}

/** Reports a stale generated section. Writes nothing, whatever it finds. */
export async function verifyAuthorGuide(
  path: string,
  declarations: Declarations,
  authored: ResolvedTuning,
): Promise<readonly Diagnostic[]> {
  const stale = (message: string): readonly Diagnostic[] => [
    { code: "staleArtifact", file: "docs/content-authoring.md", keyPath: "", message },
  ];

  let guide: string;
  try {
    guide = await readFile(path, "utf8");
  } catch {
    return stale("the author guide is missing; run `pnpm content:docs`");
  }

  const next = withTable(guide, declarations, authored);
  if (next === undefined) return stale(`the author guide is missing its generated-table markers`);
  if (next !== guide)
    return stale("the author guide's tunable table is out of date; run `pnpm content:docs`");

  return [];
}
