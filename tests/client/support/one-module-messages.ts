/**
 * Serves Paraglide's message catalogue to the client tests as one module.
 *
 * The compiler writes one file per message (over 400) and an `_index.js` that
 * re-exports each. Every client test file runs in its own module graph, so a
 * file that imported `m` paid for loading all of those modules again: about
 * 0.6 s of CPU per file, the largest share of the suite's collect time. Here
 * `_index.js` becomes the same files joined into one: their imports (the
 * runtime and the registry) hoisted once, their code unchanged. Each message's
 * locals are prefixed with its own name, so nothing collides.
 *
 * The build still loads the compiler's own files. The client project's
 * `one-module-messages` test checks every message gives the same text both
 * ways, in every locale.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const INDEX = "/paraglide/messages/_index.js";
const REEXPORT = /^export \* from '\.\/(.+?\.js)'$/gm;
const IMPORT = /^import .*$/gm;

/** The catalogue in `folder` as one module's code. */
export function mergedMessages(folder: string): string {
  const index = readFileSync(join(folder, "_index.js"), "utf8");
  const imports = new Set<string>();
  const bodies = [...index.matchAll(REEXPORT)].map(([, file]) =>
    readFileSync(join(folder, file!), "utf8").replace(IMPORT, (line) => {
      imports.add(line.replace(/;$/, ""));
      return "";
    }),
  );
  return [...imports, ...bodies].join("\n");
}

export const oneModuleMessages = (): Plugin => ({
  name: "ff-one-module-messages",
  enforce: "pre",
  load(id) {
    const path = id.split("?")[0]!;
    if (!path.endsWith(INDEX)) return null;
    return mergedMessages(path.slice(0, -"/_index.js".length));
  },
});
