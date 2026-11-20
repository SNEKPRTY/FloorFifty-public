/**
 * `pnpm intake:song`: the command around `intake-song.ts`, which holds the
 * work and its usage. A separate file because `vite-node` runs a script with
 * `process.argv[1]` set to its own entry, so a module cannot tell whether it
 * was run or imported; this one is only ever run.
 */

import { runIntake } from "./intake-song";

try {
  process.stdout.write(`${runIntake(process.argv.slice(2))}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
