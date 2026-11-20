import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const WORKSPACES = ["package.json", "apps/client/package.json", "apps/server/package.json", "packages/shared/package.json"];

const versionOf = (dir: string, file: string): string => (JSON.parse(readFileSync(join(dir, file), "utf8")) as { version: string }).version;

/** A scratch repo laid out as this one, every package at `version`, committed and tagged `tag`. */
function repo(version: string, tag?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ff-version-"));
  for (const file of WORKSPACES) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), `${JSON.stringify({ name: file, version, private: true }, null, 2)}\n`);
  }
  const git = (...args: string[]): void => {
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });
  };
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "packages");
  if (tag !== undefined) git("tag", tag);
  return dir;
}

const run = (script: string, args: string[], cwd: string) =>
  spawnSync(join(ROOT, "deploy/bin", script), args, { cwd, encoding: "utf8" });

describe("the version the title shows, in step with the releases", () => {
  it("is one version across every workspace package", () => {
    const versions = new Set(WORKSPACES.map((file) => versionOf(ROOT, file)));
    expect([...versions]).toHaveLength(1);
  });

  it("bump-version sets every workspace package to the version named", () => {
    const dir = repo("0.10.1");
    const result = run("bump-version", ["0.10.2"], dir);
    expect(result.status, result.stderr).toBe(0);
    expect(WORKSPACES.map((file) => versionOf(dir, file))).toEqual(WORKSPACES.map(() => "0.10.2"));
  });

  it("bump-version takes a release candidate, and check-version holds its tag to it", () => {
    const dir = repo("0.11.1");
    const result = run("bump-version", ["1.0.0-rc.1"], dir);
    expect(result.status, result.stderr).toBe(0);
    expect(versionOf(dir, "apps/client/package.json")).toBe("1.0.0-rc.1");
    expect(run("check-version", ["v1.0.0-rc.1"], repo("1.0.0-rc.1", "v1.0.0-rc.1")).status).toBe(0);
  });

  it("bump-version refuses what is not a version", () => {
    const dir = repo("0.10.1");
    expect(run("bump-version", ["v0.10.2"], dir).status).toBe(2);
    expect(run("bump-version", ["1.0.0-beta"], dir).status).toBe(2);
    expect(versionOf(dir, "package.json")).toBe("0.10.1");
  });

  it("check-version passes a tag whose packages say its version", () => {
    const result = run("check-version", ["v0.10.2"], repo("0.10.2", "v0.10.2"));
    expect(result.status, result.stderr).toBe(0);
  });

  it("check-version refuses a tag cut before the bump, and says what to run", () => {
    const result = run("check-version", ["v0.10.2"], repo("0.10.1", "v0.10.2"));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/0\.10\.1/);
    expect(result.stderr).toMatch(/bump-version 0\.10\.2/);
  });
});
