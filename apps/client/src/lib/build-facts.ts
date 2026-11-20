/**
 * The build this bundle is, as `tools/build-stamp.ts` folded it in. Compared
 * with the server's at boot and sent with every join (release readiness §4).
 */

import { DEV_BUILD_ID, type BuildFacts } from "@floor-fifty/shared/common/build";
import { PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";

declare const __FF_BUILD_ID__: string | undefined;
declare const __FF_RULESET_REVISION__: string | undefined;

/** A test or a vite-node run has no define, and reads as a dev build. */
export const CLIENT_BUILD: BuildFacts = {
  buildId: typeof __FF_BUILD_ID__ === "string" ? __FF_BUILD_ID__ : DEV_BUILD_ID,
  protocolVersion: PROTOCOL_VERSION,
  rulesetRevision: typeof __FF_RULESET_REVISION__ === "string" ? __FF_RULESET_REVISION__ : DEV_BUILD_ID,
};
