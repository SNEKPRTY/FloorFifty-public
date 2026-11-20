/**
 * `release.json`: what a release is, so a box can say what it runs and a
 * rollback can be checked against what was built (release readiness §5.1).
 */

import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export type ReleaseManifest = {
  buildId: string;
  environment: string;
  commit: string;
  nodeVersion: string;
  files: Record<string, string>;
};

/**
 * Every file and symlink under `dir`. A symlink is an entry of its own and is
 * never followed: `pnpm deploy` lays the server's node_modules out as links
 * into its store, which is already in the tree, and tar keeps them as links.
 */
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)]))),
  );
  return nested.flat();
}

export async function buildManifest(
  dir: string,
  facts: { buildId: string; environment: string; commit: string },
): Promise<ReleaseManifest> {
  const paths = (await walk(dir))
    .map((file) => relative(dir, file).split(sep).join("/"))
    .filter((path) => path !== "release.json")
    .sort();
  const files: Record<string, string> = {};
  for (const path of paths) {
    const full = join(dir, path);
    // A link is hashed by where it points, so a release that repoints one
    // changes its manifest without a directory being read as a file.
    const content = (await lstat(full)).isSymbolicLink() ? `symlink:${await readlink(full)}` : await readFile(full);
    files[path] = createHash("sha256").update(content).digest("hex");
  }
  return { ...facts, nodeVersion: process.version, files };
}
