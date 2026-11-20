/**
 * The compiler.
 *
 * Reads, parses, validates, and assembles -- and writes nothing. Every pass
 * runs even when an earlier one failed, so one save reports every independent
 * problem rather than the first file the compiler happened to open.
 *
 * `verifyArtifact` is the stronger repository check. It rebuilds in memory and
 * compares complete canonical bytes, which proves the envelope, both derived
 * hashes, and the payload all still describe the TOML on disk.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArtManifest } from "@floor-fifty/asset-contract/manifest-schema";
import { TUNABLES } from "@floor-fifty/shared/common/tuning";
import type { GameContent } from "@floor-fifty/shared/content/game-content";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import { buildPayload, serializeArtifact, type Canonical } from "./canonicalize";
import { type Diagnostic, sortDiagnostics } from "./diagnostics";
import { parseSources } from "./parse";
import { MissingSourceError, readSources } from "./read-sources";
import type { RawSourceTree } from "./types";
import { buildArtifact } from "./revisions";
import { validateAliases } from "./validate/aliases";
import { validateStills } from "./validate/stills";
import { validateBounds } from "./validate/bounds";
import { validateCourses } from "./validate/course";
import { validateEventRouting } from "./validate/event-routing";
import { validateFlow } from "./validate/flow";
import { validateJuice } from "./validate/juice";
import { validateSetPieces } from "./validate/set-pieces";
import { validateModes } from "./validate/modes";
import { validateReferences } from "./validate/references";

export type CompilerPaths = {
  readonly sourceRoot: string;
  readonly manifestPath: string;
  readonly artifactPath: string;
  /** The authored words as a message catalogue (`messages.ts`), written beside the artifact. */
  readonly messagesPath: string;
};

export type CompileResult =
  | { readonly ok: true; readonly artifact: GameContent; readonly canonical: Canonical }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** Where the three inputs live relative to a repository checkout. */
export const repoPaths = (root: string): CompilerPaths => ({
  sourceRoot: resolve(root, "content"),
  manifestPath: resolve(root, "packages/asset-contract/assets/art-manifest.json"),
  artifactPath: resolve(root, "content/generated/content.json"),
  messagesPath: resolve(root, "apps/client/messages/content/en.json"),
});

export async function compile(paths: CompilerPaths): Promise<CompileResult> {
  // A deleted or renamed source is an authoring mistake, so it leaves here as
  // a diagnostic like every other one. Letting it reject would make the one
  // gate CI runs first answer with a stack trace instead of the file to
  // restore -- and would take the development watcher's recovery path with it.
  let tree: RawSourceTree;
  try {
    tree = await readSources(paths.sourceRoot);
  } catch (error) {
    if (!(error instanceof MissingSourceError)) throw error;
    return {
      ok: false,
      diagnostics: [
        {
          code: "missingField",
          file: error.file,
          keyPath: "",
          message: "this file is required and could not be read",
        },
      ],
    };
  }

  const parsed = parseSources(tree);
  if (!parsed.ok) return parsed;

  const manifest = parseArtManifest(JSON.parse(await readFile(paths.manifestPath, "utf8")));
  const diagnostics = sortDiagnostics([
    ...validateFlow(parsed.parsed.flow),
    ...validateEventRouting(parsed.parsed.eventRouting),
    ...validateReferences(parsed.parsed),
    ...validateBounds(parsed.parsed, TUNABLES),
    ...validateCourses(parsed.parsed),
    ...validateModes(parsed.parsed),
    ...validateAliases(parsed.parsed, manifest),
    ...validateStills(parsed.parsed),
    ...validateJuice(parsed.parsed),
    ...validateSetPieces(parsed.parsed),
  ]);
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const artifact = buildArtifact(buildPayload(parsed.parsed));
  return { ok: true, artifact, canonical: serializeArtifact(artifact) };
}

/**
 * Compares the committed artifact against a fresh in-memory build.
 *
 * A missing, unreadable, undecodable, or merely differently formatted file is
 * the same answer -- `staleArtifact` -- because the remedy is the same one
 * command either way.
 */
export async function verifyArtifact(paths: CompilerPaths): Promise<readonly Diagnostic[]> {
  const result = await compile(paths);
  if (!result.ok) return result.diagnostics;

  const stale = (message: string): readonly Diagnostic[] => [
    { code: "staleArtifact", file: "content/generated/content.json", keyPath: "", message },
  ];

  let committed: string;
  try {
    committed = await readFile(paths.artifactPath, "utf8");
  } catch {
    return stale("the generated artifact is missing; run `pnpm content:build`");
  }

  try {
    parseGameContentArtifact(JSON.parse(committed));
  } catch (error) {
    return stale(
      `the generated artifact does not decode (${error instanceof Error ? error.message : String(error)}); run \`pnpm content:build\``,
    );
  }

  if (committed !== result.canonical.json)
    return stale("the generated artifact does not match the authored TOML; run `pnpm content:build`");

  return [];
}
