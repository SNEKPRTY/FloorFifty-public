/**
 * `pnpm assets:check`.
 *
 * Parses the committed manifest and validates every declared asset against the
 * files on disk, then exits non-zero on the first contract violation so the
 * check is usable as a release gate and as a CI step.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArtManifest } from "./manifest-schema";
import { formatValidationResult, validateAssets } from "./validate-assets";

/** Assets live beside this package rather than at a path a caller passes in. */
const ASSET_ROOT = resolve(import.meta.dirname, "..", "assets");

function main(): void {
  const manifest = parseArtManifest(
    JSON.parse(readFileSync(resolve(ASSET_ROOT, "art-manifest.json"), "utf8")),
  );
  const result = validateAssets(ASSET_ROOT, manifest);

  process.stdout.write(`${formatValidationResult(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

main();
