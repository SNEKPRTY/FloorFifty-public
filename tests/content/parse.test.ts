/**
 * Authored-source parsing.
 *
 * The diagnostic assertions here are about the contract every later suite
 * leans on: a failure names the file an author has to open, the key inside it,
 * and a stable code. The artifact assertions are about the other end of the
 * pipeline -- the pure decoder that production code uses to refuse a generated
 * file it does not recognise.
 */

import { describe, expect, it } from "vitest";
import { formatDiagnostic } from "@floor-fifty/content/diagnostics";
import { parseSources } from "@floor-fifty/content/parse";
import { readSources } from "@floor-fifty/content/read-sources";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import {
  VALID_SOURCE_ROOT,
  artifactFrom,
  treeWithSong,
  validSong,
  validStage,
  validTree,
  validTreeWith, validFlow } from "./support";

describe("diagnostics", () => {
  it("formats source-aware diagnostics", () => {
    expect(
      formatDiagnostic({
        code: "outOfRange",
        file: "content/tuning.toml",
        keyPath: "GRAVITY",
        message: "expected -1200..-100, received -2000",
      }),
    ).toBe("content/tuning.toml: GRAVITY: outOfRange: expected -1200..-100, received -2000");
  });
});

describe("parseGameContentArtifact", () => {
  it("rejects unknown artifact envelope fields", () => {
    expect(() =>
      parseGameContentArtifact({
        schemaVersion: 1,
        contentRevision: "0".repeat(64),
        rulesetRevision: "1".repeat(64),
        content: {},
        extra: true,
      }),
    ).toThrow();
  });
});

describe("readSources", () => {
  it("reads required files and sorted item files, ignoring non-sources", async () => {
    const tree = await readSources(VALID_SOURCE_ROOT);

    expect(tree.tuning.file).toBe("content/tuning.toml");
    expect(tree.characters.map((source) => source.file)).toEqual([
      "content/characters/cyan.toml",
      "content/characters/draft-ghost.toml",
      "content/characters/gold.toml",
      "content/characters/ninja.toml",
      "content/characters/scarlet.toml",
      "content/characters/violet.toml",
    ]);
    // `.gitkeep` and `*.toml.example` are deliberately outside the glob.
    expect(tree.songs.map((source) => source.file)).toEqual([
      "content/songs/dawn-tutorial.toml",
      "content/songs/dusk-run.toml",
    ]);
    expect(tree.modes).toEqual([]);
    expect(tree).toEqual(validTree());
  });
});

describe("parseSources", () => {
  it("maps unknown keys and invalid loop relationships to source diagnostics", () => {
    const result = parseSources(treeWithSong(`${validSong}\ntempoDrift = 3`));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "unknownField",
          file: "content/songs/dusk-run.toml",
          keyPath: "tempoDrift",
        }),
      );

    const loop = parseSources(treeWithSong(validSong.replace("loopEndMs = 96000", "loopEndMs = 0")));
    expect(loop.ok).toBe(false);
    if (!loop.ok)
      expect(loop.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalidBeatMetadata", keyPath: "loopEndMs" }),
      );
  });

  it("accepts a results section authored as an ordered pair, and nothing else", () => {
    const withSection = (lines: string) => parseSources(treeWithSong(`${validSong}\n${lines}\n`));

    const ok = withSection("resultsStartMs = 80000\nresultsEndMs = 96000");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.parsed.songs[0]?.value).toMatchObject({ resultsStartMs: 80000, resultsEndMs: 96000 });

    // Half a section is a mistake, not a default.
    const half = withSection("resultsStartMs = 80000");
    expect(half.ok).toBe(false);
    if (!half.ok)
      expect(half.diagnostics).toContainEqual(expect.objectContaining({ keyPath: "resultsEndMs" }));

    const backwards = withSection("resultsStartMs = 96000\nresultsEndMs = 80000");
    expect(backwards.ok).toBe(false);
    if (!backwards.ok)
      expect(backwards.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalidBeatMetadata", keyPath: "resultsEndMs" }),
      );
  });

  it("accepts a preview window authored as an ordered pair, apart from the results section", () => {
    const withWindow = (lines: string) => parseSources(treeWithSong(`${validSong}\n${lines}\n`));

    const ok = withWindow("previewStartMs = 20000\npreviewEndMs = 36000\nresultsStartMs = 80000\nresultsEndMs = 96000");
    expect(ok.ok).toBe(true);
    if (ok.ok)
      expect(ok.parsed.songs[0]?.value).toMatchObject({ previewStartMs: 20000, previewEndMs: 36000, resultsStartMs: 80000, resultsEndMs: 96000 });

    const half = withWindow("previewEndMs = 36000");
    expect(half.ok).toBe(false);
    if (!half.ok)
      expect(half.diagnostics).toContainEqual(expect.objectContaining({ keyPath: "previewStartMs" }));

    const backwards = withWindow("previewStartMs = 36000\npreviewEndMs = 20000");
    expect(backwards.ok).toBe(false);
    if (!backwards.ok)
      expect(backwards.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalidBeatMetadata", keyPath: "previewEndMs" }),
      );
  });

  it("parses all nine source shapes", () => {
    const result = parseSources(validTree());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.flow.value.entry).toBe("Splash");
      expect(result.parsed.eventRouting.value.routes[0]?.source).toBe("app.splash-ready");
      expect(result.parsed.catalog.value.stages).toEqual(["rooftops"]);
      expect(result.parsed.tuning.value["GRAVITY"]).toBe(-275);
      expect(result.parsed.characters.map((located) => located.value.id)).toEqual([
        "cyan",
        "draft-ghost",
        "gold",
        "ninja",
        "scarlet",
        "violet",
      ]);
      expect(result.parsed.stages.map((located) => located.value.id)).toEqual(["dawn", "rooftops"]);
      expect(result.parsed.stages[1]?.value.courseTuning).toEqual({ COURSE_FLOOR_COUNT: 24 });
      expect(result.parsed.songs.map((located) => located.value.id)).toEqual(["dawn-tutorial", "dusk-run"]);
      expect(result.parsed.story.value.chapters[0]!.songId).toBe("dawn-tutorial");
      expect(result.parsed.modes).toEqual([]);
    }
  });

  it.each([
    ["content/flow.toml", 'entry = "Unknown"', "invalidFlow"],
    // A transition style the client does not draw (race-flow spec §7.1).
    ["content/flow.toml", validFlow.replace('to = "MainMenu"', 'to = "MainMenu"\ntransition = "wipe"'), "invalidFlow"],
    [
      "content/events.toml",
      '[[routes]]\nsource = "room.racing"\norder = -1\naction = "flow.room-racing"',
      "invalidEventRoute",
    ],
  ] as const)("rejects malformed presentation source %s", (file, text, code) => {
    const result = parseSources(validTreeWith(file, text));
    expect(result).toEqual(expect.objectContaining({ ok: false }));
    if (!result.ok)
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ file, code }));
  });

  it("reports a TOML syntax error against the file that carries it", () => {
    const result = parseSources(validTreeWith("content/tuning.toml", "GRAVITY = ="));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalidType", file: "content/tuning.toml" }),
      );
  });
});

/**
 * The stage's cosmetic fields.
 *
 * Strict, bounded and finite, and each of those is load-bearing. Strict because
 * a misspelled field would otherwise be silently ignored -- the author would see
 * their setting accepted and their scenery unchanged. Bounded because these
 * reach a shader. Finite because the decoder is the last thing between a
 * hand-edited artifact and the renderer.
 */
describe("the stage's cosmetic fields", () => {
  const stageFile = "content/stages/rooftops.toml";
  /**
   * Adds keys to the fixture's `[theme]` table, and whatever follows as a
   * sub-table beside it. Anchored rather than appended: a bare key written at
   * the end of a TOML file attaches to whichever table was opened last, and the
   * fixture's lesson is that this is exactly the mistake an author makes.
   */
  const withTheme = (extra: string) => {
    const anchor = 'previewAlias = "still.rooftopsPreview"';
    const text = validStage.replace(anchor, `${anchor}\n${extra.trim()}`);
    return parseSources(validTreeWith(stageFile, text));
  };

  /** Parses, requires a refusal, and returns the readable diagnostics. */
  const rejection = (extra: string): string => {
    const result = withTheme(extra);
    expect(result.ok).toBe(false);
    return result.ok ? "" : result.diagnostics.map(formatDiagnostic).join("\n");
  };

  const AQUARIAN = `
[theme.presentation]
profile = "aquarian"
refractionIntensity = 0.65
horizonLift = 24
`;

  it("accepts the layer list and the presentation table", () => {
    const result = withTheme(AQUARIAN);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const theme = result.parsed.stages.find((stage) => stage.value.id === "rooftops")!.value.theme;
    expect(theme.layers.map((layer) => layer.alias)).toContain("world.cityMid");
    expect(theme.presentation).toMatchObject({
      profile: "aquarian",
      refractionIntensity: 0.65,
      horizonLift: 24,
    });
  });

  it("refuses a theme with no layer list", () => {
    // The list is the only description of the scenery; a theme without one
    // would draw nothing behind the climb.
    const text = validStage.replace(/\n\[\[theme\.layers\]\]\n(?:[^\n[].*\n)*/g, "\n");
    expect(text).not.toContain("theme.layers");
    const result = parseSources(validTreeWith(stageFile, text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(formatDiagnostic).join("\n")).toContain("layers");
  });

  it("refuses the retired slot fields", () => {
    for (const [key, extra] of [
      ["farCityAlias", 'farCityAlias = "world.cityFar"'],
      ["skyAlias", 'skyAlias = "world.dawnSky"'],
      ["propAliases", `[theme.propAliases]\nwindows = "world.lanterns"`],
      ["cloudDrift", `[theme.presentation]\nprofile = "aquarian"\nrefractionIntensity = 0.5\nhorizonLift = 12\ncloudDrift = 1`],
      [
        "haze",
        `[theme.presentation]\nprofile = "aquarian"\nrefractionIntensity = 0.5\nhorizonLift = 12\n[theme.presentation.haze]\nfar = 0.3\nmid = 0\nnear = 0`,
      ],
    ] as const) {
      expect(rejection(extra), key).toContain(key);
    }
  });

  it("still accepts a theme that omits the table", () => {
    // An omitted table keeps the legacy presentation profile, not an invalid
    // theme.
    const result = withTheme("");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.stages.find((stage) => stage.value.id === "rooftops")!.value.theme.presentation).toBeUndefined();
  });

  it("refuses a profile it does not know", () => {
    const diagnostics = rejection(`
[theme.presentation]
profile = "cyberpunk"
refractionIntensity = 0.5
horizonLift = 12
`);
    expect(diagnostics).toContain("profile");
  });

  it("refuses a field it does not know", () => {
    // The one that matters most: an unknown field that parsed would leave the
    // author believing a setting took effect.
    const diagnostics = rejection(`
[theme.presentation]
profile = "aquarian"
refractionIntensity = 0.5
horizonLift = 12
glowStrength = 4
`);
    expect(diagnostics).toContain("glowStrength");
  });

  it("refuses each setting above its bound", () => {
    for (const [field, value] of [
      ["refractionIntensity", "0.9"],
      ["horizonLift", "49"],
    ] as const) {
      const diagnostics = rejection(`
[theme.presentation]
profile = "aquarian"
refractionIntensity = 0.5
horizonLift = 12
${field} = ${value}
`);
      expect(diagnostics, field).toContain(field);
    }
  });

  it("refuses a non-finite setting", () => {
    // TOML can spell infinity, so a hand-edited file can reach the decoder with
    // a value JSON could not have carried.
    const diagnostics = rejection(`
[theme.presentation]
profile = "aquarian"
refractionIntensity = inf
horizonLift = 12
`);
    expect(diagnostics).toContain("refractionIntensity");
  });
});

/**
 * The decoder boundary.
 *
 * The authored path and the artifact path use the same predicate, but they are
 * different files reaching different code, and only one of them was just
 * tested. JSON cannot carry an infinity, which is exactly why this case has to
 * be written by hand: the artifact is the last thing before the renderer, and a
 * value that arrived by another route must not get through it.
 */
describe("the artifact decoder on the cosmetic settings", () => {
  const withPresentation = async (patch: Record<string, unknown>) => {
    const artifact = await artifactFrom("valid");
    // Written through a mutable view: the artifact type is readonly because
    // production code must not edit one, which is exactly what makes this a
    // test that has to construct an impossible file on purpose.
    (artifact.content.stages[0]!.theme as { presentation?: unknown }).presentation = {
      profile: "aquarian",
      refractionIntensity: 0.65,
      horizonLift: 24,
      ...patch,
    };
    return artifact;
  };

  it("accepts a bounded presentation", async () => {
    const artifact = await withPresentation({});
    expect(() => parseGameContentArtifact(artifact)).not.toThrow();
  });

  it("refuses a non-finite setting", async () => {
    for (const field of ["refractionIntensity", "horizonLift"]) {
      const artifact = await withPresentation({ [field]: Number.POSITIVE_INFINITY });
      expect(() => parseGameContentArtifact(artifact), field).toThrow();
    }
  });

  it("refuses a setting above its bound and an unknown profile", async () => {
    for (const patch of [
      { refractionIntensity: 0.9 },
      { horizonLift: 49 },
      { profile: "cyberpunk" },
    ]) {
      const artifact = await withPresentation(patch);
      expect(() => parseGameContentArtifact(artifact), JSON.stringify(patch)).toThrow();
    }
  });
});
