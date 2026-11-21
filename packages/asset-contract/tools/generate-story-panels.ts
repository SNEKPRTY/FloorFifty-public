/**
 * `pnpm assets:story`: the command around `story-panels.ts`, which holds the
 * work and its usage. A separate file because `vite-node` sets
 * `process.argv[1]` to its own entry, so a module cannot tell whether it was
 * run or imported; this one is only ever run.
 */

import { runStoryPanels } from "./story-panels";

try {
  await runStoryPanels(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
