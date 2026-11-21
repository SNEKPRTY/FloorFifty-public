/**
 * The compiler end to end.
 *
 * Every test here runs against a throwaway copy of the real authored tree, so
 * a run can invalidate a source file, watch the build refuse it, and leave the
 * repository's own content untouched.
 *
 * The exception is the transcription test, which reads the real tree on
 * purpose: from Task 7 the rooms run on those numbers instead of on
 * `resolveTuning()`, and nothing else in the suite compares the two.
 */

import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompilerPaths } from "@floor-fifty/content/compiler";
import { compile, repoPaths, verifyArtifact } from "@floor-fifty/content/compiler";
import { renderTunableTable, verifyAuthorGuide } from "@floor-fifty/content/author-guide";
import { build } from "@floor-fifty/content/build";
import { TUNABLES, resolveTuning } from "@floor-fifty/shared/common/tuning";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import { REPO_ROOT, temporaryContentPaths } from "./support";

// These tests copy and write temporary file trees. In the gate's CPU pod the disk stalled for more than the 5 s
// default now and then (2026-11-18, run 44413282784), though each takes 3 to 100 ms in a container; 30 s is a
// ceiling for a stalled disk, and a test that really hangs still fails.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const statOrNull = async (path: string): Promise<{ size: number } | null> => {
  try {
    const stats = await stat(path);
    return { size: stats.size };
  } catch {
    return null;
  }
};

/** Temporary files the atomic write may have left behind. */
const temporaries = async (paths: CompilerPaths): Promise<string[]> => {
  const directory = join(paths.sourceRoot, "generated");
  const names = await readdir(directory).catch(() => [] as string[]);
  return names.filter((name) => name.endsWith(".tmp"));
};

/** A song whose `unlock` names no condition: parsed, then refused by validation. */
const writeSongWithUnknownUnlock = (paths: CompilerPaths): Promise<void> =>
  writeFile(
    join(paths.sourceRoot, "songs", "drift.toml"),
    [
      'id = "drift"',
      'unlock = "nowhere"',
      'displayName = "Drift"',
      "bpm = 120.0",
      "beatOffsetTicks = 0",
      "loopStartMs = 0",
      "loopEndMs = 1000",
      'audioAlias = "music.drift"',
      "",
    ].join("\n"),
  );

const invalidCapabilityRoute = `[[routes]]
source = "room.finished"
order = 10
action = "flow.room-racing"
`;

describe("compile and build", () => {
  let paths: CompilerPaths;

  beforeEach(async () => {
    paths = await temporaryContentPaths();
  });

  describe("a bad mode file is refused by the compiler (race-options spec §10.1, audit remediation T7)", () => {
    const write = (body: string): Promise<void> => writeFile(join(paths.sourceRoot, "modes", "infinite.toml"), body);
    const header = 'id = "infinite"\ndisplayName = "Infinite"\n';

    it.each([
      ["an unknown course", `${header}course = "sprint"\nlaps = [1]\n[tuning]\nRACE_TIME_LIMIT_TICKS = 10800\n`],
      ["an endless mode without a limit", `${header}course = "endless"\nlaps = [1]\n[tuning]\nCOURSE_FLOOR_COUNT = 50\n`],
      ["a finite mode with a limit", `${header}course = "finite"\nlaps = [1]\n[tuning]\nRACE_TIME_LIMIT_TICKS = 600\n`],
      ["a bad laps list", `${header}course = "endless"\nlaps = [2]\n[tuning]\nRACE_TIME_LIMIT_TICKS = 10800\n`],
    ])("refuses %s", async (_case, body) => {
      await write(body);
      const result = await compile(paths);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.some((diagnostic) => diagnostic.file === "content/modes/infinite.toml")).toBe(true);
      }
    });
  });

  it("check writes nothing and build writes a decoded artifact", async () => {
    const before = await statOrNull(paths.artifactPath);
    expect((await compile(paths)).ok).toBe(true);
    expect(await statOrNull(paths.artifactPath)).toEqual(before);

    expect((await build(paths)).ok).toBe(true);
    expect(
      parseGameContentArtifact(JSON.parse(await readFile(paths.artifactPath, "utf8")))
        .contentRevision,
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it("retains prior bytes and removes temps after invalid input", async () => {
    await build(paths);
    const good = await readFile(paths.artifactPath, "utf8");

    await writeSongWithUnknownUnlock(paths);
    expect((await build(paths)).ok).toBe(false);
    expect(await readFile(paths.artifactPath, "utf8")).toBe(good);
    expect(await temporaries(paths)).toEqual([]);
  });

  /**
   * A deleted source is an authoring mistake like any other, so it arrives as
   * a diagnostic rather than as a rejected promise: `pnpm content:check` has
   * to name the file an author has to restore, not print a stack trace.
   */
  it("reports a missing required source without replacing good bytes", async () => {
    await build(paths);
    const good = await readFile(paths.artifactPath, "utf8");

    await rm(join(paths.sourceRoot, "tuning.toml"));
    const result = await build(paths);
    expect(result).toEqual(expect.objectContaining({ ok: false }));
    if (!result.ok)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "missingField", file: "content/tuning.toml" }),
      );
    expect(await readFile(paths.artifactPath, "utf8")).toBe(good);
  });

  it("reports invalid routing without replacing good bytes", async () => {
    await build(paths);
    const good = await readFile(paths.artifactPath, "utf8");

    await writeFile(join(paths.sourceRoot, "events.toml"), invalidCapabilityRoute);
    const result = await build(paths);
    expect(result).toEqual(expect.objectContaining({ ok: false }));
    if (!result.ok)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalidEventRoute", file: "content/events.toml" }),
      );
    expect(await readFile(paths.artifactPath, "utf8")).toBe(good);
  });

  it.each(["missing", "malformed", "wrongHash", "differentBytes"] as const)(
    "detects %s committed output",
    async (mutation) => {
      await build(paths);
      const artifact = JSON.parse(await readFile(paths.artifactPath, "utf8")) as Record<
        string,
        unknown
      >;

      if (mutation === "missing") await writeFile(paths.artifactPath, "");
      if (mutation === "malformed")
        await writeFile(paths.artifactPath, JSON.stringify({ schemaVersion: 99 }));
      if (mutation === "wrongHash")
        await writeFile(
          paths.artifactPath,
          JSON.stringify({ ...artifact, contentRevision: "a".repeat(64) }, null, 2),
        );
      if (mutation === "differentBytes")
        await writeFile(paths.artifactPath, `${JSON.stringify(artifact)}\n`);

      expect(await verifyArtifact(paths)).toContainEqual(
        expect.objectContaining({ code: "staleArtifact" }),
      );
    },
  );

  it("accepts output it just wrote", async () => {
    await build(paths);
    expect(await verifyArtifact(paths)).toEqual([]);
  });
});

describe("the repository's own content", () => {
  const paths = repoPaths(REPO_ROOT);

  it("ships base tuning identical to the shared declarations", async () => {
    const result = await compile(paths);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.content.baseTuning).toEqual(resolveTuning());
  });

  it("ships a 10-second start wait (first-race spec §2)", async () => {
    const result = await compile(paths);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.content.baseTuning.SURVIVAL_START_WAIT_TICKS).toBe(600);
  });

  it("ships the five-chapter story on its measured seeds (story mode v2 spec)", async () => {
    const result = await compile(paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { chapters, cutscenes, actors } = result.artifact.content.story;
      expect(chapters.map((chapter) => [chapter.id, chapter.stage.id, chapter.song.id, chapter.seed])).toEqual([
        ["lowtown", "dawn", "dawn-tutorial", 862],
        ["city", "rooftops", "moving-on", 139],
        ["deep", "sunken-dome", "farther-from-home", 8],
        ["snow", "snow-shrine", "whats-next", 354],
        ["fifty", "dawn", "we-outside", 70],
      ]);
      expect(cutscenes.map((cutscene) => cutscene.id)).toEqual(["lowtown", "the-city", "the-deep", "together", "the-ledge", "the-top"]);
      expect(Object.keys(actors).sort()).toEqual(["frog", "oni"]);
      expect(chapters.flatMap((chapter) => chapter.teaches)).toEqual(["move", "fastFall"]);
    }
  });

  it("points at the tree, the manifest, and the generated file", () => {
    expect(paths.sourceRoot.endsWith("/content")).toBe(true);
    expect(paths.manifestPath.endsWith("/packages/asset-contract/assets/art-manifest.json")).toBe(
      true,
    );
    expect(paths.artifactPath.endsWith("/content/generated/content.json")).toBe(true);
  });
});

/**
 * The author guide's generated table.
 *
 * A range that drifts between the declarations and the documentation is how
 * an author comes to write a value the compiler refuses for a reason the
 * guide denies, so CI verifies the table rather than trusting it.
 */
describe("the author guide", () => {
  const guide = join(REPO_ROOT, "docs/content-authoring.md");

  it("renders each tunable once in sorted order", () => {
    const table = renderTunableTable(TUNABLES, resolveTuning());
    expect(table.match(/COURSE_FLOOR_COUNT/g)).toHaveLength(1);
    expect(table.indexOf("BOUNCE_VELOCITY")).toBeLessThan(table.indexOf("COURSE_FLOOR_COUNT"));
  });

  it("is current for the declarations and the authored base", async () => {
    const result = await compile(repoPaths(REPO_ROOT));
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(await verifyAuthorGuide(guide, TUNABLES, result.artifact.content.baseTuning)).toEqual(
        [],
      );
  });

  it("reports a stale guide without writing", async () => {
    const before = await readFile(guide, "utf8");

    // An authored base the guide does not describe. Verification says so and
    // leaves the file exactly as it found it.
    expect(
      await verifyAuthorGuide(guide, TUNABLES, resolveTuning({ GRAVITY: -300 })),
    ).toContainEqual(expect.objectContaining({ code: "staleArtifact" }));
    expect(await readFile(guide, "utf8")).toBe(before);
  });
});
