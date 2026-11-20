/**
 * The development watcher.
 *
 * The behaviour worth pinning is recovery: a bad save must report, keep the
 * last good bytes, and leave the watcher alive, so the fix is one more save
 * rather than a restarted process.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CompilerPaths } from "@floor-fifty/content/compiler";
import { build } from "@floor-fifty/content/build";
import type { Diagnostic } from "@floor-fifty/content/diagnostics";
import { watch, type ContentWatcher } from "@floor-fifty/content/watch";
import type { GameContent } from "@floor-fifty/shared/content/game-content";
import { temporaryContentPaths } from "./support";

const watchers: ContentWatcher[] = [];

afterEach(async () => {
  for (const watcher of watchers.splice(0)) await watcher.close();
});

/**
 * Waits out the watcher's first moments, then forgets what it saw.
 *
 * A freshly populated directory has just generated real filesystem events,
 * and the platform may deliver them once watching begins -- `ignoreInitial`
 * suppresses the scan, not the backlog. Every test here is about what a
 * later, deliberate edit does, so each one starts from quiet.
 */
async function quiet(...recorders: { length: number }[]): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  for (const recorder of recorders) recorder.length = 0;
}

/** Polls until `predicate` holds, or gives up with a readable failure. */
async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const editCharacterName = (paths: CompilerPaths, name: string): Promise<void> =>
  writeFile(
    join(paths.sourceRoot, "characters", "ninja.toml"),
    [
      'id = "ninja"',
      `displayName = "${name}"`,
      "[sheetAliases]",
      'scarlet = "ninja.scarlet"',
      'cyan = "ninja.cyan"',
      'gold = "ninja.gold"',
      'violet = "ninja.violet"',
      "[portraitAliases]",
      'scarlet = "portrait.scarlet"',
      'cyan = "portrait.cyan"',
      'gold = "portrait.gold"',
      'violet = "portrait.violet"',
      "",
    ].join("\n"),
  );

async function editGravity(paths: CompilerPaths, gravity: number): Promise<void> {
  const file = join(paths.sourceRoot, "tuning.toml");
  const text = await readFile(file, "utf8");
  await writeFile(file, text.replace(/GRAVITY = -?[\d.]+/, `GRAVITY = ${gravity}`));
}

describe("watch", () => {
  it("publishes valid builds, retains invalid bytes, and recovers", async () => {
    const paths = await temporaryContentPaths();
    await build(paths);

    const seen: GameContent[] = [];
    const diagnostics: Diagnostic[] = [];
    const watcher = watch(paths, (content) => seen.push(content), (d) => diagnostics.push(d));
    watchers.push(watcher);
    await watcher.ready;
    await quiet(seen, diagnostics);

    await editCharacterName(paths, "Ninja Two");
    await waitFor(() => seen.length === 1, "the first successful rebuild");
    const good = await readFile(paths.artifactPath, "utf8");
    expect(good).toContain("Ninja Two");

    await editGravity(paths, -5000);
    await waitFor(() => diagnostics.length > 0, "a diagnostic for the bad value");
    expect(diagnostics[0]?.code).toBe("outOfRange");
    expect(await readFile(paths.artifactPath, "utf8")).toBe(good);
    expect(seen).toHaveLength(1);

    await editGravity(paths, -300);
    await waitFor(() => seen.length === 2, "recovery on the next valid save");
    expect(await readFile(paths.artifactPath, "utf8")).not.toBe(good);
  });

  it("ignores a file that is not an authored source", async () => {
    const paths = await temporaryContentPaths();
    await build(paths);

    const seen: GameContent[] = [];
    const watcher = watch(paths, (content) => seen.push(content), () => {});
    watchers.push(watcher);
    await watcher.ready;
    await quiet(seen);

    await writeFile(join(paths.sourceRoot, "examples", "note.toml.example"), "id = 'x'\n");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(seen).toEqual([]);
  });
});
