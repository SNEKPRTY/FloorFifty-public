/**
 * The content command.
 *
 * `check` validates and writes nothing; `build` does the same work and then
 * replaces the generated artifact atomically; `watch` builds and then keeps
 * building; `docs` regenerates the author guide's tunable table. The artifact
 * is only ever produced by this command -- nothing else in the repository
 * writes it.
 *
 * `check --verify-artifact` is the repository gate: it proves both the
 * committed artifact and the generated part of the guide still describe the
 * TOML and the shared declarations.
 */

import { resolve } from "node:path";
import { TUNABLES } from "@floor-fifty/shared/common/tuning";
import type { GameContent } from "@floor-fifty/shared/content/game-content";
import { updateAuthorGuide, verifyAuthorGuide } from "../src/author-guide";
import { build } from "../src/build";
import { compile, repoPaths, verifyArtifact } from "../src/compiler";
import { formatDiagnostic } from "../src/diagnostics";
import { verifyContentMessages } from "../src/messages";
import { watch } from "../src/watch";

const [command, ...flags] = process.argv.slice(2);
const paths = repoPaths(process.cwd());
const guidePath = resolve(process.cwd(), "docs/content-authoring.md");

if (command === "watch") {
  /** Both revisions, every time, so a save says which half of it moved. */
  const announce = (content: GameContent): void => {
    console.log(`content ${content.contentRevision}\nruleset ${content.rulesetRevision}`);
  };

  const initial = await build(paths);
  if (!initial.ok)
    initial.diagnostics.forEach((diagnostic) => console.error(formatDiagnostic(diagnostic)));
  else announce(initial.artifact);

  // Stays alive. Diagnostics report and the last valid artifact stands.
  const watcher = watch(paths, announce, (diagnostic) =>
    console.error(formatDiagnostic(diagnostic)),
  );

  // Announced only once the tree is genuinely being watched: Chokidar's first
  // scan is asynchronous, and a save made before it finishes is read as part
  // of the initial state rather than as an edit.
  await watcher.ready;
  console.log("watching content/");

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void watcher.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else if (command === "docs") {
  const result = await compile(paths);
  if (!result.ok) {
    result.diagnostics.forEach((diagnostic) => console.error(formatDiagnostic(diagnostic)));
    process.exitCode = 1;
  } else {
    await updateAuthorGuide(guidePath, TUNABLES, result.artifact.content.baseTuning);
  }
} else if (command !== "check" && command !== "build") {
  console.error("usage: content <check|build|watch|docs> [--verify-artifact]");
  process.exitCode = 2;
} else {
  const result = command === "build" ? await build(paths) : await compile(paths);
  if (!result.ok) {
    result.diagnostics.forEach((diagnostic) => console.error(formatDiagnostic(diagnostic)));
    process.exitCode = 1;
  } else if (command === "check" && flags.includes("--verify-artifact")) {
    // Both are reported before the exit code is chosen, so one command tells
    // an author everything that is stale rather than only the first thing.
    const diagnostics = [
      ...(await verifyArtifact(paths)),
      ...(await verifyContentMessages(paths, result.artifact.content)),
      ...(await verifyAuthorGuide(guidePath, TUNABLES, result.artifact.content.baseTuning)),
    ];
    diagnostics.forEach((diagnostic) => console.error(formatDiagnostic(diagnostic)));
    if (diagnostics.length > 0) process.exitCode = 1;
  }
}
