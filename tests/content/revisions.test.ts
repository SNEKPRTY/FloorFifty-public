/**
 * The hash partition.
 *
 * `contentRevision` names one schema-and-payload combination; `rulesetRevision`
 * names only what can change a race. Keeping the second still while the first
 * moves is what lets a future client trust a cached ruleset across a purely
 * cosmetic content reload.
 *
 * A song's beat and loop metadata sit on the presentation side of that line:
 * music amplifies the climb rather than judging it, so retiming a track must
 * not read as a rules change.
 */

import { describe, expect, it } from "vitest";
import { buildArtifact, RULESET_SCHEMA_VERSION, rulesetRevisionAt } from "@floor-fifty/content/revisions";
import { payload } from "./support";

describe("buildArtifact", () => {
  it("emits two distinct lowercase-hex digests and no self-reference", () => {
    const artifact = buildArtifact(payload());
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.contentRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.rulesetRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.contentRevision).not.toBe(artifact.rulesetRevision);
    expect(buildArtifact(payload()).contentRevision).toBe(artifact.contentRevision);
  });

  it("keeps catalog order cosmetic to rulesetRevision", () => {
    const a = buildArtifact(payload({ characterOrder: ["scarlet", "cyan"] }));
    const b = buildArtifact(payload({ characterOrder: ["cyan", "scarlet"] }));
    expect(b.contentRevision).not.toBe(a.contentRevision);
    expect(b.rulesetRevision).toBe(a.rulesetRevision);
  });

  it.each(["base", "mode"] as const)("changes both for %s", (change) => {
    const a = buildArtifact(payload());
    const b = buildArtifact(payload({ change }));
    expect(b.contentRevision).not.toBe(a.contentRevision);
    expect(b.rulesetRevision).not.toBe(a.rulesetRevision);
  });

  it.each(["course", "courseSeed"] as const)("moves only that stage's course revision for %s", (change) => {
    const a = buildArtifact(payload());
    const b = buildArtifact(payload({ change }));
    expect(b.rulesetRevision).toBe(a.rulesetRevision);
    expect(b.contentRevision).not.toBe(a.contentRevision);
    expect(b.courseRevisions["rooftops"]).not.toBe(a.courseRevisions["rooftops"]);
  });

  it("moves every course revision when base tuning moves", () => {
    const a = buildArtifact(payload());
    const b = buildArtifact(payload({ change: "base" }));
    expect(b.courseRevisions["rooftops"]).not.toBe(a.courseRevisions["rooftops"]);
  });

  it.each([
    ["LAP_HOLD_TICKS", 30],
    ["MOVING_FLOOR_CARRY", 0.5],
    ["RACE_TIME_LIMIT_TICKS", 600],
    ["DEMAND_RAMP_FROM_FLOOR", 60],
    ["DEMAND_RAMP_BAND_FLOORS", 5],
    ["MOVING_SHARE_STEP", 0.1],
    ["MOVING_SHARE_MAX", 0.9],
    ["MOVING_SPEED_STEP", 20],
    ["MOVING_FLOOR_SPEED_CAP", 250],
  ] as const)(
    "moves rulesetRevision when %s changes (race-flow spec §4, race-options spec §3.3)",
    (key, value) => {
      const base = payload();
      const a = buildArtifact(base);
      const b = buildArtifact({ ...base, baseTuning: { ...base.baseTuning, [key]: value } });
      expect(b.rulesetRevision).not.toBe(a.rulesetRevision);
    },
  );

  it("is on ruleset schema version 4 (survival spec §3)", () => {
    expect(RULESET_SCHEMA_VERSION).toBe(4);
  });

  it("moves rulesetRevision with the schema version", () => {
    const content = payload();
    expect(rulesetRevisionAt(content, 2)).not.toBe(rulesetRevisionAt(content, 3));
    expect(rulesetRevisionAt(content, RULESET_SCHEMA_VERSION)).toBe(buildArtifact(content).rulesetRevision);
  });

  it.each([
    ["course", { course: "endless" as const, tuning: { RACE_TIME_LIMIT_TICKS: 600 } }],
    ["laps", { laps: [1] as const }],
  ])("moves rulesetRevision when a mode's %s changes", (_field, change) => {
    const base = payload({ change: "mode" });
    const a = buildArtifact(base);
    const modes = base.modes.map((mode) => ({
      ...mode,
      ...change,
      tuning: { ...mode.tuning, ...("tuning" in change ? change.tuning : {}) },
    }));
    const b = buildArtifact({ ...base, modes });
    expect(b.rulesetRevision).not.toBe(a.rulesetRevision);
  });

  it("keeps course revisions out of a phrase edit", () => {
    const a = buildArtifact(payload());
    const b = buildArtifact(payload({ change: "coursePhrase" }));
    expect(b.courseRevisions).toEqual(a.courseRevisions);
    expect(b.rulesetRevision).toBe(a.rulesetRevision);
  });

  it("excludes theme changes from ruleset", () => {
    const a = buildArtifact(payload());
    const b = buildArtifact(payload({ theme: "world.cityFar" }));
    expect(b.contentRevision).not.toBe(a.contentRevision);
    expect(b.rulesetRevision).toBe(a.rulesetRevision);
  });

  it.each(["flow", "eventRoute", "beat", "juice"] as const)("keeps %s presentation-only", (change) => {
    const a = buildArtifact(payload());
    const b = buildArtifact(payload({ change }));
    expect(b.contentRevision).not.toBe(a.contentRevision);
    expect(b.rulesetRevision).toBe(a.rulesetRevision);
  });

  // Every field of a song, one at a time. `beat` above moves `bpm` alone, and
  // a partition that holds for the tempo but leaks through the loop points or
  // the alias would be no partition at all.
  it.each([
    "songBpm",
    "songBeatOffset",
    "songLoopStart",
    "songLoopEnd",
    "songAlias",
  ] as const)("keeps %s out of the ruleset", (change) => {
    const a = buildArtifact(payload());
    const b = buildArtifact(payload({ change }));
    expect(b.contentRevision).not.toBe(a.contentRevision);
    expect(b.rulesetRevision).toBe(a.rulesetRevision);
  });

  it("moves the content revision and not the ruleset revision for a tutorial edit", () => {
    const a = buildArtifact(payload());
    const b = buildArtifact(payload({ change: "tutorial" }));
    expect(b.contentRevision).not.toBe(a.contentRevision);
    expect(b.rulesetRevision).toBe(a.rulesetRevision);
  });

  it("keeps the tutorial's stage out of the race", () => {
    const built = payload();
    expect(built.stages.map((stage) => stage.id)).not.toContain("dawn");
    expect(built.songs.map((song) => song.id)).not.toContain("dawn-tutorial");
    expect(built.tutorial.stage.id).toBe("dawn");
    expect(built.tutorial.song.audioAlias).toBe("music.tutorial");
  });

  it("moves the content revision and not the ruleset revision for a tutorial stage edit", () => {
    const a = buildArtifact(payload());
    const b = buildArtifact(payload({ change: "tutorialStage" }));
    expect(b.contentRevision).not.toBe(a.contentRevision);
    expect(b.rulesetRevision).toBe(a.rulesetRevision);
  });

  it("keeps authored course phrases presentation-only", () => {
    const a = buildArtifact(payload());
    const b = buildArtifact(payload({ change: "coursePhrase" }));
    expect(b.contentRevision).not.toBe(a.contentRevision);
    expect(b.rulesetRevision).toBe(a.rulesetRevision);
  });
});

/**
 * The cosmetic stage settings.
 *
 * The reason they live on `theme` at all: they change what the scenery looks
 * like and nothing about how a race is decided, so a room frozen on one ruleset
 * plays identically whichever of these it was authored with. The last case here
 * is the guard on the rest -- the partition only means something while a real
 * rule change still moves both hashes.
 */
describe("the cosmetic stage settings", () => {
  const withTheme = (theme: Record<string, unknown>) => {
    const original = payload();
    return buildArtifact({
      ...original,
      stages: original.stages.map((stage) => ({
        ...stage,
        theme: { ...stage.theme, ...theme },
      })) as never,
    });
  };

  const AQUARIAN = {
    profile: "aquarian" as const,
    refractionIntensity: 0.65,
    horizonLift: 24,
  };

  const FAR = { alias: "world.cityFar", plate: "city", depth: 0.15, sink: 240, extend: "skirt" } as const;
  const NEAR = { alias: "world.cityNear", plate: "city", depth: 0.35, sink: 290, extend: "skirt" } as const;
  const MID = { alias: "world.cityMid", plate: "city", depth: 0.24, sink: 270, extend: "skirt" } as const;

  it("moves contentRevision alone for the presentation table", () => {
    const a = buildArtifact(payload());
    const b = withTheme({ presentation: { ...AQUARIAN } });

    expect(b.contentRevision).not.toBe(a.contentRevision);
    expect(b.rulesetRevision).toBe(a.rulesetRevision);
  });

  it("moves contentRevision alone for each layer change, individually", () => {
    const a = withTheme({ layers: [FAR, NEAR] });
    for (const [name, layers] of [
      ["a layer added", [FAR, MID, NEAR]],
      ["a layer's sink", [FAR, { ...NEAR, sink: 300 }]],
      ["a layer's arc", [FAR, { ...NEAR, arc: 0.5 }]],
    ] as const) {
      const b = withTheme({ layers });
      expect(b.contentRevision, name).not.toBe(a.contentRevision);
      expect(b.rulesetRevision, name).toBe(a.rulesetRevision);
      expect(b.courseRevisions, name).toEqual(a.courseRevisions);
    }
  });

  it("moves contentRevision alone for a set piece change (Wonder spec §6.4)", () => {
    const a = withTheme({ setPieces: [] });
    const b = withTheme({ setPieces: [{ floor: 22, kind: "lightsOut", holdMs: 6000 }] });
    expect(b.contentRevision).not.toBe(a.contentRevision);
    expect(b.rulesetRevision).toBe(a.rulesetRevision);
    expect(b.courseRevisions).toEqual(a.courseRevisions);
  });

  it("moves contentRevision alone for each setting, individually", () => {
    const a = buildArtifact(payload());
    for (const [key, value] of [
      ["refractionIntensity", 0.4],
      ["horizonLift", 12],
    ] as const) {
      const b = withTheme({ presentation: { ...AQUARIAN, [key]: value } });
      expect(b.contentRevision, key).not.toBe(a.contentRevision);
      expect(b.rulesetRevision, key).toBe(a.rulesetRevision);
    }
  });

  it("keeps the per-skyline haze out of the ruleset", () => {
    // Haze is how far away a skyline looks, and nothing about how a race is
    // decided; a room frozen on one ruleset must play the same with any haze.
    const hazed = withTheme({ layers: [{ ...FAR, haze: 0.3 }, NEAR] });
    const plain = withTheme({ layers: [FAR, NEAR] });
    const denser = withTheme({ layers: [{ ...FAR, haze: 0.5 }, NEAR] });

    expect(hazed.contentRevision).not.toBe(plain.contentRevision);
    expect(denser.contentRevision).not.toBe(hazed.contentRevision);
    expect(hazed.rulesetRevision).toBe(plain.rulesetRevision);
    expect(denser.rulesetRevision).toBe(hazed.rulesetRevision);
  });

  it("keeps the city's ascent arc out of the ruleset", () => {
    const plain = withTheme({ presentation: { ...AQUARIAN } });
    const arced = withTheme({
      presentation: { ...AQUARIAN, citySink: { teach: 10, combine: 40, recover: 90, finish: 160 } },
    });

    expect(arced.contentRevision).not.toBe(plain.contentRevision);
    expect(arced.rulesetRevision).toBe(plain.rulesetRevision);
  });

  it("accepts an arc deep enough to take the city out of frame, in content only", () => {
    // Spec §2.8 item 11: the arc now carries the city the camera used to, so
    // its finish can be several hundred units.
    const plain = withTheme({ presentation: { ...AQUARIAN } });
    const deep = withTheme({
      presentation: { ...AQUARIAN, citySink: { teach: 0, combine: 40, recover: 120, finish: 600 } },
    });

    expect(deep.contentRevision).not.toBe(plain.contentRevision);
    expect(deep.rulesetRevision).toBe(plain.rulesetRevision);
  });

  it("still moves both for a change that decides a race", () => {
    const a = buildArtifact(payload());
    const b = buildArtifact(payload({ change: "base" }));

    expect(b.contentRevision).not.toBe(a.contentRevision);
    expect(b.rulesetRevision).not.toBe(a.rulesetRevision);
  });
});
