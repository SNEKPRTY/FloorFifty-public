/**
 * The version the title shows, so a player can say what they are on. It is
 * the client package's version; the build stamp (release readiness §4.1) is
 * for the servers, not the screen.
 */

import { version } from "../../package.json";

export const VERSION_TAG = `v${version}`;
