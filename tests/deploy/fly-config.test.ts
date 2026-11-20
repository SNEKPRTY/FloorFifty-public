import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { DRAIN_MAX_MS } from "../../apps/server/src/drain";
import { proxySourceFromEnv } from "../../apps/server/src/gate/client-ip";
import { forbiddenInProduction } from "../../apps/server/src/process-safety";

/**
 * fly.toml and the Dockerfile are production's whole deploy surface, and the
 * ways they go wrong are silent: a second Machine, an idle stop, the wrong
 * signal. These pin the values (finish for launch spec §2.1 to §2.4), and tie
 * the file to the server's own production guard.
 */
const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), "utf8");

type FlyToml = {
  app: string;
  primary_region: string;
  kill_signal: string;
  kill_timeout: number;
  build: { dockerfile: string };
  deploy: { strategy: string };
  env: Record<string, string>;
  http_service: {
    internal_port: number;
    force_https: boolean;
    auto_stop_machines: string;
    auto_start_machines: boolean;
    min_machines_running: number;
    checks: { path: string; method: string; grace_period: string }[];
  };
  vm: { cpu_kind: string; cpus: number; memory: string }[];
};

const fly = parse(read("fly.toml")) as unknown as FlyToml;

describe("fly.toml", () => {
  it("stops the server with SIGTERM, which is the signal that drains its races", () => {
    expect(fly.kill_signal).toBe("SIGTERM");
  });

  it("gives the drain its whole cap inside Fly's 300 s kill timeout", () => {
    expect(fly.kill_timeout).toBeLessThanOrEqual(300);
    expect(fly.kill_timeout).toBeGreaterThanOrEqual(DRAIN_MAX_MS / 1000 + 30);
  });

  it("is one always-on Machine, deployed blue and green, in Chicago", () => {
    expect(fly.http_service.auto_stop_machines).toBe("off");
    expect(fly.http_service.auto_start_machines).toBe(false);
    expect(fly.http_service.min_machines_running).toBe(1);
    expect(fly.deploy.strategy).toBe("bluegreen");
    expect(fly.primary_region).toBe("ord");
    expect(fly.vm).toEqual([{ cpu_kind: "shared", cpus: 2, memory: "512MB" }]);
  });

  it("checks /ready, which bluegreen needs before it moves traffic", () => {
    expect(fly.http_service.checks).toHaveLength(1);
    expect(fly.http_service.checks[0]).toMatchObject({ path: "/ready", method: "GET" });
  });

  it("listens where the Dockerfile exposes", () => {
    expect(fly.http_service.internal_port).toBe(3000);
    expect(fly.env["PORT"]).toBe("3000");
    expect(read("Dockerfile")).toMatch(/^EXPOSE 3000$/m);
    expect(fly.build.dockerfile).toBe("Dockerfile");
  });

  // Audit S5: every production guard hangs on NODE_ENV. The next check returns
  // [] for an environment that lacks it unless Fly says it is a Fly Machine,
  // so this one stands on its own.
  it("sets NODE_ENV=production", () => {
    expect(fly.env["NODE_ENV"]).toBe("production");
  });

  it("passes the server's own production guard, as a Fly Machine", () => {
    expect(forbiddenInProduction({ ...fly.env, FLY_APP_NAME: fly.app })).toEqual([]);
    expect(proxySourceFromEnv(fly.env)).toBe("fly");
  });

  it("starts with a room cap and an origin list that is not an open door", () => {
    // The load test sized 10 for the shared-cpu-2x 512 MB Machine (docs/release.md).
    expect(Number(fly.env["MAX_ROOMS"])).toBeGreaterThanOrEqual(10);
    expect(fly.env["FLOOR_FIFTY_ALLOWED_ORIGINS"]).toMatch(/^https:\/\/\S+$/);
    expect(fly.env["FLOOR_FIFTY_ALLOWED_ORIGINS"]).not.toContain("*");
  });

  it("lets in Ruken's test site, where every test game is served (RukenApp cloudflare/games/wrangler.jsonc)", () => {
    const origins = fly.env["FLOOR_FIFTY_ALLOWED_ORIGINS"]!.split(",").map((o) => o.trim());
    expect(origins).toContain("https://ruken-games.ruken-beta.workers.dev");
    expect(origins.filter((o) => o.endsWith(".invalid"))).toEqual([]);
  });

  it("holds no secret", () => {
    expect(Object.keys(fly.env).filter((name) => /TOKEN|SECRET|KEY|PASSWORD/i.test(name))).toEqual([]);
  });
});

describe("the Dockerfile", () => {
  const dockerfile = read("Dockerfile");

  it("runs Node 24, which the server's engines require", () => {
    expect(dockerfile.match(/^FROM node:(\d+)/gm)).toEqual(["FROM node:24", "FROM node:24"]);
  });

  it("does not run as root", () => {
    expect(dockerfile).toMatch(/^USER node$/m);
  });

  it("starts node itself, in exec form, so it is PID 1 and gets SIGTERM", () => {
    expect(dockerfile).toMatch(/^CMD \["node", "--max-old-space-size=320", "dist\/main\.js"\]$/m);
  });

  it("refuses to build without a build id", () => {
    expect(dockerfile).toMatch(/^ARG FLOOR_FIFTY_BUILD_ID$/m);
    expect(dockerfile).toMatch(/test -n "\$FLOOR_FIFTY_BUILD_ID"/);
  });

  it("copies no environment file into the image", () => {
    expect(read(".dockerignore")).toMatch(/^\.env$/m);
    expect(dockerfile).not.toMatch(/COPY .*\.env/);
  });
});
