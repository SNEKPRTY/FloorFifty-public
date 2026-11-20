/**
 * Production entry point.
 *
 * It does three things: decode the committed artifact, put it in a store, and
 * start the server. There is no watcher and no compiler here -- reload is a
 * development concern and lives in `dev.ts`.
 *
 * Detected by the absence of Vitest rather than by comparing `process.argv[1]`
 * to this file: a runner such as `vite-node` puts its own path there, so the
 * argv check silently never fires and the server never starts.
 */

import { ContentStore } from "./content/content-store";
import { GENERATED_CONTENT } from "./content/generated-content";
import { createColyseusRaceServer } from "./colyseus-server";
import { telemetryFromEnvironment } from "./telemetry-config";
import { drainOnSigterm } from "./drain";
import { proxySourceFromEnv } from "./gate/client-ip";
import { forbiddenInProduction, installCrashHandlers } from "./process-safety";

if (process.env["VITEST"] === undefined) {
  const forbidden = forbiddenInProduction(process.env);
  if (forbidden.length > 0) {
    process.stderr.write(`refusing to start in production with ${forbidden.join(", ")} set\n`);
    process.exit(1);
  }
  installCrashHandlers(process, (code) => process.exit(code), (line) => process.stderr.write(`${line}\n`));

  const port = Number(process.env["PORT"] ?? 3_000);
  const maxRooms = Number(process.env["MAX_ROOMS"]);
  const allowedOrigins = process.env["FLOOR_FIFTY_ALLOWED_ORIGINS"];
  void createColyseusRaceServer({
    port,
    contentStore: new ContentStore(GENERATED_CONTENT),
    telemetry: telemetryFromEnvironment(process.env),
    // "fly" behind Fly.io (fly.toml); the default is Caddy (process-safety.ts refuses a Fly Machine without it).
    proxy: proxySourceFromEnv(process.env),
    // Both are required in production (process-safety.ts); in dev, unset means open.
    ...(Number.isInteger(maxRooms) && maxRooms > 0 ? { maxRooms } : {}),
    ...(allowedOrigins === undefined ? {} : { allowedOrigins }),
  }).then((server) => {
    process.stdout.write(`floor-fifty server listening on ${server.port}\n`);
    // A deploy stops this process with SIGTERM once the next build is serving
    // (deploy/bin/activate); systemd allows the drain its full cap.
    drainOnSigterm(server, process, (code) => process.exit(code), (line) => process.stdout.write(`${line}\n`));
  });
}
