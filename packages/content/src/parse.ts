/**
 * Parsing the authored tree.
 *
 * The only module in the repository that imports a TOML parser. Everything
 * downstream works on typed values, which is what keeps the format an
 * authoring detail rather than a runtime dependency.
 *
 * This pass answers shape questions only: is the file TOML, does it carry the
 * fields its kind declares, are they the right types, and are the names ones
 * the client implements. Graph completeness, capability pairings, references,
 * bounds, and aliases all belong to `validate/`.
 */

import { TomlError, parse as parseToml } from "smol-toml";
import type { z } from "zod";
import type { ContentResultCode } from "@floor-fifty/shared/content/game-content";
import { type Diagnostic, sortDiagnostics } from "./diagnostics";
import { catalogSchema } from "./schema/catalog";
import { characterSchema } from "./schema/character";
import { eventRoutingSchema } from "./schema/event-routing";
import { flowSchema } from "./schema/flow";
import { modeSchema } from "./schema/mode";
import { songSchema } from "./schema/song";
import { stageSchema } from "./schema/stage";
import { tuningMapSchema } from "./schema/tuning";
import { tutorialSchema } from "./schema/tutorial";
import { unlocksSchema } from "./schema/unlocks";
import { blockedNamesSchema } from "./schema/blocked-names";
import { juiceSchema } from "./schema/juice";
import type {
  CatalogSource,
  Located,
  ParseResult,
  ParsedContent,
  RawSourceTree,
  SourceFile,
} from "./types";

/**
 * What kind of file produced an issue.
 *
 * The kind decides which stable code a plain schema failure maps to, so that
 * an author fixing `events.toml` always reads `invalidEventRoute` rather than
 * a generic type complaint.
 */
type SourceKind =
  | "tuning"
  | "flow"
  | "eventRouting"
  | "catalog"
  | "unlocks"
  | "blockedNames"
  | "juice"
  | "tutorial"
  | "character"
  | "stage"
  | "song"
  | "mode";

/** Song fields whose failures are beat metadata rather than plain types. */
const BEAT_FIELDS = new Set(["bpm", "beatOffsetTicks", "loopStartMs", "loopEndMs", "previewStartMs", "previewEndMs", "resultsStartMs", "resultsEndMs"]);

const keyPathOf = (path: readonly PropertyKey[]): string => path.map(String).join(".");

/** The authored value at a Zod path, for telling "absent" from "wrong". */
function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current = root;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function codeFor(kind: SourceKind, path: readonly PropertyKey[], absent: boolean): ContentResultCode {
  if (absent) return "missingField";
  if (kind === "song" && path.some((key) => BEAT_FIELDS.has(String(key))))
    return "invalidBeatMetadata";
  if (kind === "flow") return "invalidFlow";
  if (kind === "eventRouting") return "invalidEventRoute";
  return "invalidType";
}

/**
 * Turns one file's schema failure into diagnostics an author can act on.
 *
 * An unrecognised-keys issue becomes one diagnostic per key, because reporting
 * "two unknown fields" and naming neither is how a typo survives a fix.
 */
function toDiagnostics(
  source: SourceFile,
  kind: SourceKind,
  document: unknown,
  issues: readonly z.core.$ZodIssue[],
): Diagnostic[] {
  return issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys")
      return issue.keys.map((key) => ({
        code: "unknownField" as const,
        file: source.file,
        keyPath: keyPathOf([...issue.path, key]),
        message: `unknown field: ${key}`,
      }));

    const absent = issue.code === "invalid_type" && valueAt(document, issue.path) === undefined;
    return [
      {
        code: codeFor(kind, issue.path, absent),
        file: source.file,
        keyPath: keyPathOf(issue.path),
        message: issue.message,
      },
    ];
  });
}

type FileResult<T> =
  | { readonly ok: true; readonly located: Located<T> }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

function parseFile<T>(
  source: SourceFile,
  kind: SourceKind,
  schema: z.ZodType<T, unknown>,
): FileResult<T> {
  let document: unknown;
  try {
    document = parseToml(source.text);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "invalidType",
          file: source.file,
          keyPath: "document",
          message: `invalid TOML: ${error instanceof TomlError || error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const result = schema.safeParse(document);
  if (!result.success)
    return { ok: false, diagnostics: toDiagnostics(source, kind, document, result.error.issues) };
  return { ok: true, located: { file: source.file, value: result.data } };
}

/** The catalog with its packs flattened, in pack order, for every later pass. */
const flatCatalog = (value: z.infer<typeof catalogSchema>): CatalogSource => ({
  modes: value.modes,
  packs: value.packs,
  characters: value.packs.flatMap((pack) => pack.characters),
  stages: value.packs.flatMap((pack) => pack.stages),
  songs: value.packs.flatMap((pack) => pack.songs),
});

/**
 * Parses every authored file, reporting all independent failures at once.
 *
 * One save is one round trip for an author, so a tree with four broken files
 * reports four files rather than the first one it happened to open.
 */
export function parseSources(tree: RawSourceTree): ParseResult {
  const diagnostics: Diagnostic[] = [];

  const single = <T,>(source: SourceFile, kind: SourceKind, schema: z.ZodType<T, unknown>) => {
    const result = parseFile(source, kind, schema);
    if (result.ok) return result.located;
    diagnostics.push(...result.diagnostics);
    return undefined;
  };

  const many = <T,>(sources: readonly SourceFile[], kind: SourceKind, schema: z.ZodType<T, unknown>) =>
    sources.flatMap((source) => {
      const located = single(source, kind, schema);
      return located === undefined ? [] : [located];
    });

  const tuning = single(tree.tuning, "tuning", tuningMapSchema);
  const flow = single(tree.flow, "flow", flowSchema);
  const eventRouting = single(tree.eventRouting, "eventRouting", eventRoutingSchema);
  const authoredCatalog = single(tree.catalog, "catalog", catalogSchema);
  const catalog: Located<CatalogSource> | undefined =
    authoredCatalog === undefined
      ? undefined
      : { file: authoredCatalog.file, value: flatCatalog(authoredCatalog.value) };
  const authoredUnlocks = single(tree.unlocks, "unlocks", unlocksSchema);
  const unlocks: Located<ParsedContent["unlocks"]["value"]> | undefined =
    authoredUnlocks === undefined
      ? undefined
      : { file: authoredUnlocks.file, value: authoredUnlocks.value.unlocks };
  const authoredBlockedNames = single(tree.blockedNames, "blockedNames", blockedNamesSchema);
  const blockedNames: Located<readonly string[]> | undefined =
    authoredBlockedNames === undefined
      ? undefined
      : { file: authoredBlockedNames.file, value: authoredBlockedNames.value.words };
  const juice = single(tree.juice, "juice", juiceSchema);
  const tutorial = single(tree.tutorial, "tutorial", tutorialSchema);
  const characters = many(tree.characters, "character", characterSchema);
  const stages = many(tree.stages, "stage", stageSchema);
  const songs = many(tree.songs, "song", songSchema);
  const modes = many(tree.modes, "mode", modeSchema);

  if (
    diagnostics.length > 0 ||
    tuning === undefined ||
    flow === undefined ||
    eventRouting === undefined ||
    catalog === undefined ||
    unlocks === undefined ||
    blockedNames === undefined ||
    juice === undefined ||
    tutorial === undefined
  )
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) };

  const parsed: ParsedContent = {
    tuning,
    flow,
    eventRouting,
    catalog,
    unlocks,
    blockedNames,
    juice,
    tutorial,
    characters,
    stages,
    songs,
    modes,
  };
  return { ok: true, parsed };
}
