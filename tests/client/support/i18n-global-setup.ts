/**
 * Compiles the message catalogues once before the client suite runs, so every
 * test imports the same generated `paraglide/` the build would. A global setup
 * rather than the Vite plugin: it finishes before the first test file is
 * collected, where a plugin's build hook is not guaranteed to.
 */

import { compile } from "@inlang/paraglide-js";
import { PARAGLIDE } from "../../../apps/client/i18n.config";

export default async function setup(): Promise<void> {
  await compile(PARAGLIDE);
}
