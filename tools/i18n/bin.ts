/** `pnpm i18n:draft | export | import | check`: the command line over `cli.ts`, run from the repo root. */

import { runI18n } from "./cli";

process.exitCode = await runI18n(process.argv.slice(2), {
  root: process.cwd(),
  now: () => new Date(),
  log: (line) => console.log(line),
});
