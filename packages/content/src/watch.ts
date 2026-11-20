/**
 * The development watcher.
 *
 * It calls exactly the same atomic build path as `pnpm content:build`, so a
 * save produces the same bytes a commit would. Nothing about reload is a
 * second, looser code path.
 *
 * Two properties matter more than speed. Builds are serialized on one promise
 * chain, so two saves in quick succession cannot rename out of order and
 * leave the older artifact on disk. And content is published to the callback
 * only after the rename succeeded, so an invalid edit reports diagnostics,
 * keeps the previous bytes, and keeps the watcher alive for the fix.
 */

import chokidar from "chokidar";
import type { GameContent } from "@floor-fifty/shared/content/game-content";
import { build } from "./build";
import type { CompilerPaths } from "./compiler";
import type { Diagnostic } from "./diagnostics";

export type ContentWatcher = {
  /**
   * Resolves once the tree is actually being watched.
   *
   * Chokidar's first scan is asynchronous, and an edit that lands during it
   * is treated as part of the initial state and never reported. A caller
   * that edits immediately after starting -- a test, or someone who saves
   * the moment the dev server prints its port -- would otherwise lose that
   * first save.
   */
  readonly ready: Promise<void>;
  close(): Promise<void>;
};

/** Long enough to collapse an editor's write burst, short enough to feel live. */
const DEBOUNCE_MS = 50;

const isSource = (path: string): boolean =>
  path.endsWith(".toml") && !path.endsWith(".toml.example");

export function watch(
  paths: CompilerPaths,
  onContent: (content: GameContent) => void,
  onDiagnostic: (diagnostic: Diagnostic) => void,
): ContentWatcher {
  // The directory is watched and paths are filtered here rather than through
  // a glob: the repository path may contain characters a glob would read as
  // syntax, and the filter says plainly what a source file is.
  const watcher = chokidar.watch(paths.sourceRoot, { ignoreInitial: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();

  const rebuild = (): void => {
    chain = chain
      .then(async () => {
        const result = await build(paths);
        if (result.ok) onContent(result.artifact);
        else result.diagnostics.forEach(onDiagnostic);
      })
      .catch((error: unknown) => {
        // A read or write failure, rather than a content failure. The watcher
        // survives it: the next save is the retry.
        onDiagnostic({
          code: "invalidArtifact",
          file: "content",
          keyPath: "",
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  watcher.on("all", (_event, path) => {
    if (!isSource(path)) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(rebuild, DEBOUNCE_MS);
  });

  const ready = new Promise<void>((resolve) => watcher.once("ready", () => resolve()));

  return {
    ready,
    async close() {
      if (timer !== undefined) clearTimeout(timer);
      await watcher.close();
      // Let a build already in flight finish, so nothing renames into a
      // directory a test is about to remove.
      await chain;
    },
  };
}
