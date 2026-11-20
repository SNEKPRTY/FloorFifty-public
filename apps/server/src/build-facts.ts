/**
 * The build this server bundle is, as `tools/build-stamp.ts` folded it in.
 * The ruleset a room enforces is the loaded artifact's, so only the id and
 * protocol come from here (release readiness §4.1).
 */

import { DEV_BUILD_ID } from "@floor-fifty/shared/common/build";
import { PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";

declare const __FF_BUILD_ID__: string | undefined;

/** vite-node and Vitest have no define, and read as a dev build. */
export const SERVER_BUILD = {
  buildId: typeof __FF_BUILD_ID__ === "string" ? __FF_BUILD_ID__ : DEV_BUILD_ID,
  protocolVersion: PROTOCOL_VERSION,
} as const;
