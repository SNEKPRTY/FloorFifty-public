/**
 * A throwaway box for the deploy scripts.
 *
 * Each test gets a temporary root standing in for `/srv/floor-fifty`, an
 * upstream file standing in for Caddy's, and a `bin/` of stub `systemctl`,
 * `caddy` and `curl` that append their arguments to a log and exit with
 * whatever the test asked for. The real scripts run unmodified against it.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../../..", import.meta.url));

export type Box = {
  root: string;
  /** The stubs' directory, first on PATH; a test may replace a stub in it. */
  bin: string;
  upstream: string;
  log: () => string[];
  run: (script: string, args: string[], env?: Record<string, string>) => { status: number; stderr: string };
  read: (relative: string) => string | undefined;
};

const STUB = (name: string) => `#!/usr/bin/env bash
echo "${name} $*" >> "$STUB_LOG"
exit "\${STUB_${name.toUpperCase()}_EXIT:-0}"
`;

export function makeBox(): Box {
  const dir = mkdtempSync(join(tmpdir(), "ff-box-"));
  const root = join(dir, "srv");
  const bin = join(dir, "bin");
  const logFile = join(dir, "calls.log");
  mkdirSync(join(root, "releases"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(logFile, "");
  for (const name of ["systemctl", "caddy", "curl"]) {
    writeFileSync(join(bin, name), STUB(name));
    chmodSync(join(bin, name), 0o755);
  }
  const upstream = join(dir, "upstream.caddy");

  return {
    root,
    bin,
    upstream,
    log: () => readFileSync(logFile, "utf8").split("\n").filter((line) => line !== ""),
    read: (relative) => {
      const path = join(root, relative);
      return existsSync(path) ? readFileSync(path, "utf8").trim() : undefined;
    },
    run: (script, args, env = {}) => {
      const result = spawnSync("bash", [join(REPO, "deploy/bin", script), ...args], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env["PATH"] ?? ""}`,
          STUB_LOG: logFile,
          FF_ROOT: root,
          FF_CADDY_UPSTREAM: upstream,
          FF_CADDYFILE: join(dir, "Caddyfile"),
          // Absent unless a test writes it, so the box's own /etc never leaks in.
          FF_CADDY_ENV: join(dir, "caddy.env"),
          FF_READY_TIMEOUT: "1",
          FF_POLL_SECONDS: "0.1",
          FF_ACTIVATE: join(REPO, "deploy/bin/activate"),
          ...env,
        },
      });
      return { status: result.status ?? -1, stderr: result.stderr };
    },
  };
}

/** Puts a release directory on the box, as `deploy` would have. */
export function addRelease(box: Box, id: string): void {
  mkdirSync(join(box.root, "releases", id, "server"), { recursive: true });
  mkdirSync(join(box.root, "releases", id, "client"), { recursive: true });
}
