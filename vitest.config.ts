import { defineConfig } from "vitest/config";

// Vitest projects are declared here rather than in a `vitest.workspace.ts`
// file, which is deprecated as of Vitest 3.2. The glob picks up every
// workspace package that carries its own vitest config, so a later initiative
// adding `packages/content` joins the run without editing this file.
// `deploy` holds the release scripts' tests (phase 7a).
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*", "deploy"],
  },
});
