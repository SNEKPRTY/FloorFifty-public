#!/usr/bin/env node
// Lists the release builds on this box (one per GitHub release, installed by
// deploy from build-tag's tarball), newest first, as JSON on stdout (release
// readiness D-R6): the owner's site turns it into the Floor Fifty page's build
// rows, each a link to that release's own client.
//
// Usage: builds-index.mjs <root> <base-url> [limit]
//
// Plain JavaScript, because it runs on the box, which has Node and nothing
// else of the toolchain.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BUILD_ID = /^([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})-[0-9a-f]{7,40}$/;

const [root, base, limitArg] = process.argv.slice(2);
if (root === undefined || base === undefined) {
  process.stderr.write("usage: builds-index.mjs <root> <base-url> [limit]\n");
  process.exit(2);
}
const limit = Number(limitArg ?? 10);

const read = (path) => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
};

// The live server's /health, as deploy fetched it: a build is playable when
// the server speaks its protocol and its ruleset, the two a join checks.
let server;
try {
  const health = JSON.parse(read(join(root, ".server-health.json")) ?? "null");
  if (typeof health?.protocolVersion === "number" && typeof health?.rulesetRevision === "string") {
    server = { protocolVersion: health.protocolVersion, rulesetRevision: health.rulesetRevision };
  }
} catch {
  // An unreadable answer says nothing.
}

/** True or false when the build and the server both say; otherwise unsaid. */
const playable = (build) => {
  if (server === undefined || typeof build.protocolVersion !== "number") return undefined;
  if (build.protocolVersion !== server.protocolVersion) return false;
  if (typeof build.rulesetRevision !== "string") return undefined;
  return build.rulesetRevision === server.rulesetRevision;
};

const dir = join(root, "builds");
let ids = [];
try {
  ids = readdirSync(dir);
} catch {
  // No release build has been installed yet.
}

const builds = ids
  .filter((id) => BUILD_ID.test(id))
  .sort()
  .reverse()
  .slice(0, limit)
  .map((buildId) => {
    const [, year, month, day, hour, minute] = BUILD_ID.exec(buildId);
    let build = {};
    try {
      build = JSON.parse(read(join(dir, buildId, "build.json")) ?? "{}");
    } catch {
      // A build without a readable manifest is still listed by its id.
    }
    return {
      buildId,
      tag: String(build.tag ?? ""),
      title: String(build.title ?? ""),
      commit: String(build.commit ?? ""),
      builtAt: new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute)).toISOString(),
      url: `${base.replace(/\/$/, "")}/builds/${buildId}/`,
      ...(playable(build) === undefined ? {} : { playable: playable(build) }),
    };
  });

process.stdout.write(
  `${JSON.stringify({ generatedAt: new Date().toISOString(), live: read(join(root, "current")) ?? "", ...(server === undefined ? {} : { server }), builds }, null, 2)}\n`,
);
