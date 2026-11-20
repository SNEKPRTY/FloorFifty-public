import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import { oneModuleMessages } from "../../tests/client/support/one-module-messages";

/**
 * Keeps `node:*` imports real inside a jsdom test.
 *
 * Vite's Environment API labels jsdom a `client` consumer, and a client
 * consumer resolves a node builtin to an empty module -- so a spec that reads a
 * fixture with `readFile` or joins a path with `resolve` gets `undefined` and
 * dies at module load, with only a `has been externalized for browser
 * compatibility` warning to explain it. Marking these ids external hands them
 * to Node's own loader instead, which is what they are: the tests run on Node.
 *
 * `enforce: "pre"` is what makes it win -- Vite's internal resolver stubs the
 * id otherwise, before any later plugin is consulted.
 */
const nodeBuiltins = {
  name: "ff-node-builtins",
  enforce: "pre",
  resolveId(id: string) {
    if (id.startsWith("node:")) return { id, external: true };
    return null;
  },
} as const;

export default defineConfig({
  // The same compiler the build uses, so a component is never tested in a form
  // it is not shipped in.
  plugins: [nodeBuiltins, oneModuleMessages(), svelte()],
  // Svelte publishes a browser entry and a server entry. Under jsdom the
  // default resolution picks the server one, which renders to a string and
  // never mounts, so a mounted component would have no DOM to assert against.
  resolve: { conditions: ["browser"] },
  test: {
    name: "client",
    // Screen lifecycle, input aggregation, and touch controls all address the
    // DOM directly, so the client project runs against jsdom.
    environment: "jsdom",
    include: ["../../tests/client/**/*.test.ts"],
    // The message catalogues, compiled before the first file is collected.
    globalSetup: ["../../tests/client/support/i18n-global-setup.ts"],
    setupFiles: [
      "../../tests/client/support/setup.ts",
      "../../tests/client/support/svelte-setup.ts",
    ],
  },
});
