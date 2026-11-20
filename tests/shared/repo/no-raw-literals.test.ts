/**
 * No `.svelte` file under `apps/client/src` holds copy (languages spec §8.1):
 * every word a player reads comes from the catalogue. What counts as copy, and
 * what is allowed, is `raw-literals.ts`.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { rawLiterals } from "./raw-literals";

const ROOT = "apps/client/src";

async function svelteFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "paraglide" ? [] : svelteFiles(path);
      return entry.name.endsWith(".svelte") ? [path] : [];
    }),
  );
  return nested.flat();
}

describe("no raw literals in Svelte", () => {
  it("finds no copy in any component", async () => {
    const offences: string[] = [];
    for (const path of await svelteFiles(ROOT)) offences.push(...rawLiterals(relative(ROOT, path), await readFile(path, "utf8")));
    expect(offences).toEqual([]);
  });
});
