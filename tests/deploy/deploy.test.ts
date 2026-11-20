import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeBox, type Box } from "./support/stubs";

/** Packs a release tarball the way build-release does. */
function tarball(buildId: string): string {
  const stage = mkdtempSync(join(tmpdir(), "ff-release-"));
  mkdirSync(join(stage, "server/dist"), { recursive: true });
  mkdirSync(join(stage, "client"), { recursive: true });
  writeFileSync(join(stage, "server/dist/main.js"), "");
  writeFileSync(join(stage, "client/index.html"), "<title>Floor Fifty</title>");
  writeFileSync(join(stage, "release.json"), JSON.stringify({ buildId }));
  const out = join(stage, "..", `${buildId.replace(/\W/g, "_")}-${Date.now()}.tgz`);
  spawnSync("tar", ["-czf", out, "-C", stage, "."]);
  return out;
}

/** Packs a release build the way build-tag does: build.json and a client, no server. */
function buildTarball(
  build: { buildId: string; tag: string; title: string; commit: string; protocolVersion?: number; rulesetRevision?: string },
  page = "<title>Floor Fifty</title>"): string {
  const stage = mkdtempSync(join(tmpdir(), "ff-build-"));
  mkdirSync(join(stage, "client"), { recursive: true });
  writeFileSync(join(stage, "client/index.html"), page);
  writeFileSync(join(stage, "build.json"), JSON.stringify(build));
  const out = join(stage, "..", `${build.buildId.replace(/\W/g, "_")}-${Date.now()}.tgz`);
  spawnSync("tar", ["-czf", out, "-C", stage, "."]);
  return out;
}

type Index = {
  live: string;
  server?: { protocolVersion: number; rulesetRevision: string };
  builds: { buildId: string; tag: string; title: string; commit: string; builtAt: string; url: string; playable?: boolean }[];
};

/** Stands a server in for the box's curl: /health answers `health`, as the live colour would. */
function serverHealth(box: Box, health: { protocolVersion: number; rulesetRevision: string }): void {
  writeFileSync(
    join(box.bin, "curl"),
    `#!/usr/bin/env bash\necho "curl $*" >> "$STUB_LOG"\ncase "$*" in *"/health"*) echo '${JSON.stringify({ ok: true, ...health })}' ;; esac\nexit "\${STUB_CURL_EXIT:-0}"\n`,
  );
}

describe("deploy", () => {
  it("unpacks the release, activates it, then points the client at it", () => {
    const box = makeBox();
    const result = box.run("deploy", [tarball("202609261200-aaaaaaa")]);

    expect(result.status).toBe(0);
    expect(existsSync(join(box.root, "releases/202609261200-aaaaaaa/client/index.html"))).toBe(true);
    expect(readlinkSync(join(box.root, "client"))).toBe(join(box.root, "releases/202609261200-aaaaaaa/client"));
    expect(box.read("live")).toBe("blue");
  });

  // Caddy runs as its own user; mktemp -d makes 0700 folders, and a release
  // owned by root at 0700 answered every /builds/<id>/ request with a 403.
  it("leaves the release readable by the web server", () => {
    const box = makeBox();
    expect(box.run("deploy", [tarball("202609261200-aaaaaaa")]).status).toBe(0);
    expect(statSync(join(box.root, "releases/202609261200-aaaaaaa")).mode & 0o777).toBe(0o755);
  });

  it("leaves the client where it was when activation fails", () => {
    const box = makeBox();
    const result = box.run("deploy", [tarball("202609261200-aaaaaaa")], { STUB_CURL_EXIT: "7" });
    expect(result.status).toBe(1);
    expect(existsSync(join(box.root, "client"))).toBe(false);
  });

  // Rollback history: the ten newest releases stay. They are no longer listed
  // for the owner's site; the release builds below are.
  it("keeps the ten newest releases, never the live or previous one, and lists none of them", { timeout: 120_000 }, () => {
    const box = makeBox();
    const ids = Array.from({ length: 12 }, (_, index) => `2026092612${String(index).padStart(2, "0")}-aaaaaa${index.toString(16)}`);
    for (const id of ids) expect(box.run("deploy", [tarball(id)], { FF_BUILDS_BASE: "https://staging.test" }).status).toBe(0);

    const kept = readdirSync(join(box.root, "releases")).filter((name) => !name.startsWith(".")).sort();
    expect(kept).toEqual(ids.slice(2));

    const index = JSON.parse(readFileSync(join(box.root, "builds-index.json"), "utf8")) as Index;
    expect(index.live).toBe(ids[11]);
    expect(index.builds).toEqual([]);
  });

  it("never prunes the release a rollback would return to, however old", { timeout: 120_000 }, () => {
    const box = makeBox();
    const env = { FF_BUILDS_BASE: "https://staging.test" };
    const old = "202609260000-0000000";
    box.run("deploy", [tarball(old)], env);
    const ids = Array.from({ length: 9 }, (_, index) => `2026092613${String(index).padStart(2, "0")}-bbbbbb${index.toString(16)}`);
    for (const id of ids) box.run("deploy", [tarball(id)], env);
    // Roll all the way back to the oldest, then deploy forward: the oldest is
    // now `previous`, eleventh by age, and still the one a rollback returns to.
    expect(box.run("activate", [old]).status).toBe(0);
    box.run("deploy", [tarball("202609261400-ccccccc")], env);
    expect(box.read("previous")).toBe(old);
    expect(existsSync(join(box.root, "releases", old))).toBe(true);
  });

  // The dev build hosts (release readiness D-R6): each GitHub release's client,
  // built by build-tag, served at /builds/<id>/ and listed for the owner's site.
  it.each(["v0.10.0", "v1.0.0-rc.1"])("installs %s at builds/<id>/ without touching the live release", (tag) => {
    const box = makeBox();
    const build = { buildId: "202610051537-eef8245", tag, title: "Phase 7b complete", commit: "eef8245" };
    const result = box.run("deploy", [buildTarball(build)], { FF_BUILDS_BASE: "https://staging.test" });

    expect(result.status).toBe(0);
    expect(existsSync(join(box.root, "builds/202610051537-eef8245/client/index.html"))).toBe(true);
    expect(existsSync(join(box.root, "client"))).toBe(false);
    // It reads the live server's health for the index, and starts, stops and reloads nothing.
    expect(box.log()).toEqual(["curl -fsS --max-time 5 http://127.0.0.1:3001/health"]);
    const index = JSON.parse(readFileSync(join(box.root, "builds-index.json"), "utf8")) as Index;
    expect(index.builds).toEqual([
      { ...build, builtAt: "2026-10-05T15:37:00.000Z", url: "https://staging.test/builds/202610051537-eef8245/" },
    ]);
  });

  // A build is Defunct only when the live server would refuse it: the site
  // locks a row on `playable: false`, and no longer on age alone.
  it("marks each build playable by whether the live server speaks its protocol and ruleset", () => {
    const box = makeBox();
    serverHealth(box, { protocolVersion: 18, rulesetRevision: "rules-b" });
    writeFileSync(join(box.root, "live"), "green");
    const env = { FF_BUILDS_BASE: "https://staging.test" };
    const builds = [
      { buildId: "202610010000-aaaaaaa", tag: "v0.9.0", title: "old protocol", commit: "aaaaaaa", protocolVersion: 17, rulesetRevision: "rules-a" },
      { buildId: "202610020000-bbbbbbb", tag: "v0.10.0", title: "old rules", commit: "bbbbbbb", protocolVersion: 18, rulesetRevision: "rules-a" },
      { buildId: "202610030000-ccccccc", tag: "v0.10.1", title: "same server", commit: "ccccccc", protocolVersion: 18, rulesetRevision: "rules-b" },
      { buildId: "202610040000-ddddddd", tag: "v0.10.2", title: "same server", commit: "ddddddd", protocolVersion: 18, rulesetRevision: "rules-b" },
      { buildId: "202610050000-eeeeeee", tag: "v0.10.3", title: "built before builds said", commit: "eeeeeee" },
    ];
    for (const build of builds) expect(box.run("deploy", [buildTarball(build)], env).status).toBe(0);

    const index = JSON.parse(readFileSync(join(box.root, "builds-index.json"), "utf8")) as Index;
    expect(index.server).toEqual({ protocolVersion: 18, rulesetRevision: "rules-b" });
    expect(Object.fromEntries(index.builds.map((build) => [build.tag, build.playable]))).toEqual({
      "v0.10.3": undefined,
      "v0.10.2": true,
      "v0.10.1": true,
      "v0.10.0": false,
      "v0.9.0": false,
    });
    // It asked the live colour's own server.
    expect(box.log()).toContain("curl -fsS --max-time 5 http://127.0.0.1:3002/health");
  });

  it("says nothing of playable when the live server does not answer", () => {
    const box = makeBox();
    const build = { buildId: "202610030000-ccccccc", tag: "v0.10.1", title: "t", commit: "ccccccc", protocolVersion: 18, rulesetRevision: "rules-b" };
    expect(box.run("deploy", [buildTarball(build)], { FF_BUILDS_BASE: "https://staging.test", STUB_CURL_EXIT: "7" }).status).toBe(0);
    const index = JSON.parse(readFileSync(join(box.root, "builds-index.json"), "utf8")) as Index;
    expect(index.server).toBeUndefined();
    expect(index.builds[0]!.playable).toBeUndefined();
  });

  it("replaces a release build that is installed again", () => {
    const box = makeBox();
    const build = { buildId: "202610051537-eef8245", tag: "v0.10.0", title: "Phase 7b complete", commit: "eef8245" };
    box.run("deploy", [buildTarball(build, "first")]);
    expect(box.run("deploy", [buildTarball(build, "second")]).status).toBe(0);
    expect(box.read("builds/202610051537-eef8245/client/index.html")).toBe("second");
    expect(readdirSync(join(box.root, "builds"))).toEqual(["202610051537-eef8245"]);
  });

  it("keeps every release build, lists the ten newest, and never prunes one", { timeout: 120_000 }, () => {
    const box = makeBox();
    const env = { FF_BUILDS_BASE: "https://staging.test" };
    const ids = Array.from({ length: 12 }, (_, index) => `2026092612${String(index).padStart(2, "0")}-dddddd${index.toString(16)}`);
    for (const [index, buildId] of ids.entries()) {
      expect(box.run("deploy", [buildTarball({ buildId, tag: `v0.${index}.0`, title: `Phase ${index}`, commit: buildId.slice(-7) })], env).status).toBe(0);
    }
    for (let index = 0; index < 11; index += 1) box.run("deploy", [tarball(`2026092613${String(index).padStart(2, "0")}-eeeeee${index.toString(16)}`)], env);

    expect(readdirSync(join(box.root, "builds")).sort()).toEqual(ids);
    const index = JSON.parse(readFileSync(join(box.root, "builds-index.json"), "utf8")) as Index;
    expect(index.builds.map((build) => build.tag)).toEqual(Array.from({ length: 10 }, (_, i) => `v0.${11 - i}.0`));
  });

  it("refuses a release build that is not one", () => {
    const box = makeBox();
    const bad = { buildId: "../../etc", tag: "v0.10.0", title: "x", commit: "eef8245" };
    expect(box.run("deploy", [buildTarball(bad)]).status).toBe(2);
    const noTag = { buildId: "202610051537-eef8245", tag: "", title: "x", commit: "eef8245" };
    expect(box.run("deploy", [buildTarball(noTag)]).status).toBe(2);
    expect(existsSync(join(box.root, "builds/202610051537-eef8245"))).toBe(false);
  });

  it("refuses a release whose build ID is not a build ID", () => {
    const box = makeBox();
    const result = box.run("deploy", [tarball("../../etc")]);
    expect(result.status).toBe(2);
    expect(box.log()).toEqual([]);
  });
});
