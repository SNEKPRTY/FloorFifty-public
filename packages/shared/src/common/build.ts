/**
 * What a build is, as client and server both stamp it (release readiness §4.1).
 *
 * A build id is `<yyyymmddHHMM>-<short sha>` in UTC, so ids sort by time as
 * strings. `dev` is any build `build-release` did not make; it is never older
 * or newer than anything, so it is never refused for its order.
 */

export type BuildFacts = { buildId: string; protocolVersion: number; rulesetRevision: string };

export const DEV_BUILD_ID = "dev";

/** The shape `deploy/bin/build-release` writes and `deploy/bin/activate` checks. */
export const BUILD_ID_PATTERN = /^[0-9]{12}-[0-9a-f]{7,40}$/;

export function compareBuildIds(a: string, b: string): -1 | 0 | 1 {
  if (!BUILD_ID_PATTERN.test(a) || !BUILD_ID_PATTERN.test(b) || a === b) return 0;
  return a < b ? -1 : 1;
}
