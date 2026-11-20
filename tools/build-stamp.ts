/**
 * The constants Vite folds into a bundle so it knows which build it is
 * (release readiness §4.1). Both the client and the server config call this,
 * so they cannot disagree about the id or the ruleset they were built with.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BUILD_ID_PATTERN, DEV_BUILD_ID } from "../packages/shared/src/common/build";

const ARTIFACT = fileURLToPath(new URL("../content/generated/content.json", import.meta.url));

export function buildDefines(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const buildId = env["FLOOR_FIFTY_BUILD_ID"] ?? DEV_BUILD_ID;
  if (buildId !== DEV_BUILD_ID && !BUILD_ID_PATTERN.test(buildId)) {
    throw new Error(`FLOOR_FIFTY_BUILD_ID is not a build id: ${buildId}`);
  }
  const { rulesetRevision } = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { rulesetRevision: string };
  return {
    __FF_BUILD_ID__: JSON.stringify(buildId),
    __FF_RULESET_REVISION__: JSON.stringify(rulesetRevision),
  };
}
