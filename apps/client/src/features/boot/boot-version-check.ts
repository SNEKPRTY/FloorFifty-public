/**
 * Compares this bundle with the server before the title shows (release
 * readiness §4.2), so a stale tab learns it is stale before its player types
 * a name. The join check stays the authority: anything unreadable here passes.
 */

import { z } from "zod";
import type { BuildFacts } from "@floor-fifty/shared/common/build";
import { versionVerdict } from "@floor-fifty/shared/common/refusals";
import { recoverableError, type RecoverableError } from "../net/error-view";

const healthFacts = z.object({
  buildId: z.string(),
  protocolVersion: z.number(),
  rulesetRevision: z.string(),
});

export async function checkBootVersion(
  fetchHealth: () => Promise<unknown>,
  facts: BuildFacts,
): Promise<RecoverableError | undefined> {
  let server: BuildFacts;
  try {
    const parsed = healthFacts.safeParse(await fetchHealth());
    if (!parsed.success) return undefined;
    server = parsed.data;
  } catch {
    return undefined;
  }
  const verdict = versionVerdict(facts, server);
  return verdict === "VERSION_MISMATCH" || verdict === "SERVER_UPDATING" ? recoverableError(verdict) : undefined;
}

/**
 * Starts the check and returns at once: the check is advice and the join is
 * the authority, so a slow /health never holds the title back. A stale build
 * is reported whenever the answer comes; the menu shows it on entry.
 */
export function startBootVersionCheck(
  fetchHealth: () => Promise<unknown>,
  facts: BuildFacts,
  report: (error: RecoverableError) => void,
): void {
  void checkBootVersion(fetchHealth, facts).then((stale) => {
    if (stale !== undefined) report(stale);
  });
}
