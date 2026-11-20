/**
 * A stage's set pieces, as data (Wonder spec §6.4): each kind's own fields,
 * floors on the fifty-floor arc, and layers the stage's theme really draws.
 */
import { describe, expect, it } from "vitest";
import { buildPayload } from "@floor-fifty/content/canonicalize";
import { parseSources } from "@floor-fifty/content/parse";
import { setPieceSchema } from "../../../packages/content/src/schema/stage";
import { validateSetPieces } from "../../../packages/content/src/validate/set-pieces";
import { validStage, validTreeWith } from "../support";

const issues = (value: unknown): string[] => {
  const result = setPieceSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

/** The fixture Rooftops with `toml` appended to its theme. */
const parsedWith = (toml: string) => parseSources(validTreeWith("content/stages/rooftops.toml", `${validStage}\n${toml}\n`));

describe("set pieces (Wonder spec §6.4)", () => {
  it("parses each kind", () => {
    expect(issues({ floor: 22, kind: "lightsOut", holdMs: 6000 })).toEqual([]);
    expect(issues({ floor: 50, kind: "lightsOut", holdMs: 4000, invert: true })).toEqual([]);
    expect(issues({ floor: 34, kind: "paletteShift", holdMs: 12000, mood: "sunset" })).toEqual([]);
    expect(issues({ floor: 45, kind: "weatherBurst", holdMs: 6000, particle: "rain", density: 0.7 })).toEqual([]);
    expect(issues({ floor: 45, kind: "skyFlash", holdMs: 6000, flashes: 2, tone: "lightning", kick: 3 })).toEqual([]);
    expect(issues({ floor: 10, kind: "swarm", holdMs: 5000, layers: ["world.clouds"], speed: 8 })).toEqual([]);
  });

  it("refuses an unknown kind", () => {
    expect(issues({ floor: 10, kind: "earthquake", holdMs: 5000 })).not.toEqual([]);
  });

  it("refuses a floor outside 1 to 50", () => {
    expect(issues({ floor: 0, kind: "lightsOut", holdMs: 6000 })).not.toEqual([]);
    expect(issues({ floor: 51, kind: "lightsOut", holdMs: 6000 })).not.toEqual([]);
  });

  it("refuses a field that does not fit the kind", () => {
    expect(issues({ floor: 10, kind: "paletteShift", holdMs: 5000, mood: "storm", layers: ["world.clouds"] })).not.toEqual([]);
  });

  it("refuses an unknown mood", () => {
    expect(issues({ floor: 10, kind: "paletteShift", holdMs: 5000, mood: "lava" })).not.toEqual([]);
  });

  it("refuses more than three flashes, the photosensitivity ceiling", () => {
    expect(issues({ floor: 45, kind: "skyFlash", holdMs: 6000, flashes: 4, tone: "lightning" })).not.toEqual([]);
  });

  it("refuses a layer the stage's theme does not draw", () => {
    const result = parsedWith('[[theme.setPieces]]\nfloor = 10\nkind = "swarm"\nholdMs = 5000\nlayers = ["world.nope"]\nspeed = 8');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateSetPieces(result.parsed)).toEqual([
      expect.objectContaining({ code: "unknownReference", file: "content/stages/rooftops.toml" }),
    ]);
  });

  it("accepts a layer the theme draws, and carries the set pieces into the payload", () => {
    const result = parsedWith('[[theme.setPieces]]\nfloor = 10\nkind = "swarm"\nholdMs = 5000\nlayers = ["world.clouds"]\nspeed = 8');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateSetPieces(result.parsed)).toEqual([]);
    const rooftops = buildPayload(result.parsed).stages.find((stage) => stage.id === "rooftops")!;
    expect(rooftops.theme.setPieces).toEqual([{ floor: 10, kind: "swarm", holdMs: 5000, layers: ["world.clouds"], speed: 8 }]);
  });

  it("defaults to none", () => {
    const result = parseSources(validTreeWith("content/stages/rooftops.toml", validStage));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildPayload(result.parsed).stages.find((stage) => stage.id === "rooftops")!.theme.setPieces).toEqual([]);
  });
});
