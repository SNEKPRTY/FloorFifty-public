/**
 * Paraglide's compiler options, once.
 *
 * Vite (dev and build), the Vitest global setup and `pnpm i18n:compile` all
 * compile the same project into the same folder with the same strategy, so a
 * clean checkout type-checks, tests and builds identically. The paths are
 * absolute because Vitest runs from the repo root and Vite from `apps/client`.
 */

import { fileURLToPath } from "node:url";
import type { CompilerOptions } from "@inlang/paraglide-js";

export const PARAGLIDE = {
  project: fileURLToPath(new URL("./project.inlang", import.meta.url)),
  outdir: fileURLToPath(new URL("./src/paraglide", import.meta.url)),
  // The saved choice (or detection while it is Automatic) always answers, so
  // the two built-ins only ever serve a page that never installed the store:
  // a unit test, or a crash before boot.
  strategy: ["custom-settings", "preferredLanguage", "baseLocale"],
  emitTsDeclarations: true,
  emitGitIgnore: false,
  emitReadme: false,
  emitPrettierIgnore: false,
} satisfies CompilerOptions;
