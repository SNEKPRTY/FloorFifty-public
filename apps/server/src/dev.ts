/**
 * Development entry point.
 *
 * The one server module that knows the compiler exists. It compiles the
 * authored tree in memory at startup and then watches it, so an edit reaches
 * menus and later rooms without a restart -- and, crucially, without touching
 * a room already racing, which reads its content once and never again.
 *
 * It deliberately does not import `main.ts` or the generated JSON. Importing
 * the artifact here would put it in this process's module graph, and every
 * successful build would then trigger a `vite-node --watch` restart that took
 * every live room down with it.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, repoPaths } from "@floor-fifty/content/compiler";
import { formatDiagnostic } from "@floor-fifty/content/diagnostics";
import { watch } from "@floor-fifty/content/watch";
import { ContentStore } from "./content/content-store";
import { createColyseusRaceServer } from "./colyseus-server";
import { telemetryFromEnvironment } from "./telemetry-config";

// Relative to this file rather than to `process.cwd()`: the server is started
// from the repository root and from its own package directory alike.
const paths = repoPaths(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."));

const initial = await compile(paths);
if (!initial.ok) {
  initial.diagnostics.forEach((diagnostic) => console.error(formatDiagnostic(diagnostic)));
  process.exitCode = 1;
} else {
  const store = new ContentStore(initial.artifact);
  const server = await createColyseusRaceServer({
    port: Number(process.env["PORT"] ?? 3_000),
    contentStore: store,
    telemetry: telemetryFromEnvironment(process.env),
  });
  process.stdout.write(`floor-fifty dev server listening on ${server.port}\n`);

  const watcher = watch(
    paths,
    (content) => {
      // Replace first, then announce. A client that refetches on the
      // notification must find the new content already being served.
      store.replace(content);
      // The process-wide notification went with the transport that carried it.
      // `contentRevision` rides room state, and the menu refetches `/content`
      // on a mismatch, which was always the correctness path rather than the
      // optimisation.
      process.stdout.write(`content ${content.contentRevision}\n`);
    },
    (diagnostic) => console.error(formatDiagnostic(diagnostic)),
  );

  // Announced only once the tree is genuinely being watched, so a save made
  // the instant the port appears is not swallowed by the first scan.
  await watcher.ready;
  process.stdout.write("watching content/\n");

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void Promise.all([watcher.close(), server.close()]).then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // `vite-node --watch` answers a server edit by re-running this module in the
  // same process, not by restarting it. Without letting go first, the re-run
  // cannot bind the port -- EADDRINUSE -- while the old server goes on serving
  // the old code, so an edit silently did nothing. The reload waits for this.
  const hot = (import.meta as { hot?: { on(event: string, listener: () => Promise<void>): void } })
    .hot;
  hot?.on("vite:beforeFullReload", async () => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    await Promise.all([watcher.close(), server.close()]);
    process.stdout.write("reloading the dev server\n");
  });
}
