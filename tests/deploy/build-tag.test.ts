import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../../deploy/bin/build-tag");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(tag: string) {
  const dir = mkdtempSync(join(tmpdir(), "ff-build-tag-"));
  dirs.push(dir);
  const repo = join(dir, "repo");
  const bin = join(dir, "bin");
  const out = join(dir, "out");
  for (const path of [repo, bin, out]) mkdirSync(path);
  const files = {
    "deploy/config.env": "FF_DOMAIN=staging.test\n",
    "packages/shared/src/common/constants.ts": "export const PROTOCOL_VERSION = 18;\n",
    "content/generated/content.json": JSON.stringify({ rulesetRevision: "candidate-rules" }),
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(repo, file, ".."), { recursive: true });
    writeFileSync(join(repo, file), text);
  }
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: repo, encoding: "utf8", env: { ...process.env, GIT_COMMITTER_DATE: "2026-10-21T12:00:00Z" },
  });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture", "--date=2026-10-21T12:00:00Z");
  git("tag", tag);
  // Only dependency installation and compilation are external to this test.
  // Git worktrees, tar packaging and the release manifest run for real.
  writeFileSync(join(bin, "pnpm"), `#!/usr/bin/env bash
set -eu
case "$*" in
  'install --frozen-lockfile') ;;
  '-r build') mkdir -p apps/client/dist; echo '<title>Candidate</title>' > apps/client/dist/index.html ;;
  *) exit 17 ;;
esac
`);
  chmodSync(join(bin, "pnpm"), 0o755);
  writeFileSync(join(out, "keep"), "untouched");
  const result = spawnSync("bash", [script, tag, `FloorFifty ${tag}: Ready for review`, out], {
    cwd: repo,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: "utf8",
    timeout: 15_000,
  });
  return { result, out, commit: git("rev-parse", "--short=7", "HEAD").trim() };
}

describe("release clients for the website catalogue", () => {
  it.each(["v1.0.0", "v1.0.0-rc.1"])("packs %s with its identity and server compatibility", (tag) => {
    const { result, out, commit } = fixture(tag);
    expect(result.status, result.stderr).toBe(0);
    const buildId = `202610211200-${commit}`;
    expect(readFileSync(join(out, "build-id"), "utf8").trim()).toBe(buildId);
    const manifest = execFileSync("tar", ["-xOzf", join(out, "build.tgz"), "build.json"], { encoding: "utf8" });
    expect(JSON.parse(manifest)).toEqual({
      buildId, tag, title: "Ready for review", commit, protocolVersion: 18, rulesetRevision: "candidate-rules",
    });
    expect(execFileSync("tar", ["-xOzf", join(out, "build.tgz"), "client/index.html"], { encoding: "utf8" })).toContain("<title>Candidate</title>");
  });

  it.each(["1.0.0", "v1.0.0-rc", "v1.0.0-beta.1", "v1.0.0-rc.1-extra"])("rejects %s before replacing output", (tag) => {
    const { result, out } = fixture(tag);
    expect(result.status).toBe(2);
    expect(readFileSync(join(out, "keep"), "utf8")).toBe("untouched");
    expect(existsSync(join(out, "build.tgz"))).toBe(false);
  });
});
