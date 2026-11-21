/**
 * `content/story.toml`'s shape (story mode v2, criterion 1): each refusal has
 * its own fixture and its own diagnostic. Unknown stages, songs, characters and
 * pictures are refused by the reference and alias passes, tested beside them.
 */

import { describe, expect, it } from "vitest";
import { parseSources } from "@floor-fifty/content/parse";
import { validStory, validTreeWith } from "./support";

const FILE = "content/story.toml";

const refusal = (text: string) => {
  expect(text).not.toBe(validStory);
  const result = parseSources(validTreeWith(FILE, text));
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.diagnostics;
};

describe("the valid story", () => {
  it("parses, with its actor, cutscene, phases and moments", () => {
    const result = parseSources(validTreeWith(FILE, validStory));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const story = result.parsed.story.value;
    expect(Object.keys(story.actors)).toEqual(["pal"]);
    expect(story.chapters[0]!.phases.map((phase) => phase.goal.kind)).toEqual(["reach", "rescue"]);
    expect(story.chapters[0]!.moments[1]!.when).toEqual({ kind: "phase", phase: "dive" });
  });
});

describe("a story the schema refuses", () => {
  it.each([
    ["a line over 80 characters", validStory.replace("Up we go.", "x".repeat(81)), "cutscenes.0.panels.0.lines.0.text"],
    ["a speaker who is no actor", validStory.replace('{ speaker = "pal", text = "Up!" }', '{ speaker = "nobody", text = "Up!" }'), "chapters.0.moments.0.lines.0.speaker"],
    ["a cutscene speaker who is no actor", validStory.replace('speaker = "pal", mood = "win"', 'speaker = "nobody", mood = "win"'), "cutscenes.0.panels.0.lines.1.speaker"],
    ["an unknown mood", validStory.replace('mood = "win"', 'mood = "angry"'), "cutscenes.0.panels.0.lines.1.mood"],
    ["a chapter actor not in [actors]", validStory.replace('id = "pal"\nceiling', 'id = "ghost"\nceiling'), "chapters.0.actors.0.id"],
    ["a goal outside the course", validStory.replace('floor = 6, lamps = 1', 'floor = 20, lamps = 1'), "chapters.0.phases.0.goal.floor"],
    ["a safe spot outside the course", validStory.replace("safeSpots = [6]", "safeSpots = [20]"), "chapters.0.phases.1.safeSpots.0"],
    ["a lamp outside the course", validStory.replace("lamps = [3]", "lamps = [25]"), "chapters.0.lamps.0"],
    ["a lamp at or above the goal", validStory.replace("lamps = [3]", "lamps = [6]"), "chapters.0.lamps.0"],
    ["a glim outside the course", validStory.replace("floor = 2\noffset", "floor = 21\noffset"), "chapters.0.glims.0.floor"],
    ["a glim above the goal", validStory.replace("floor = 2\noffset", "floor = 9\noffset"), "chapters.0.glims.0.floor"],
    ["a glim too far to the side", validStory.replace("offset = -90", "offset = -200"), "chapters.0.glims.0.offset"],
    ["a ceiling outside the course", validStory.replace("ceiling = 6", "ceiling = 20"), "chapters.0.actors.0.ceiling"],
    ["a ceiling above floor 16", validStory.replace("ceiling = 6", "ceiling = 17"), "chapters.0.actors.0.ceiling"],
    ["a rescue of someone never put below", validStory.replace('do = [{ do = "place", actor = "pal", floor = 2, parked = true }]\n', ""), "chapters.0.phases.1.goal"],
    ["a rescue of someone not in the chapter", validStory.replace('goal = { kind = "rescue", actor = "pal" }', 'goal = { kind = "rescue", actor = "ghost" }'), "chapters.0.phases.1.goal.actor"],
    ["lava with no safe spot", validStory.replace("safeSpots = [6]\n", ""), "chapters.0.phases.1.safeSpots"],
    ["lava rising too fast", validStory.replace("rise = 8.0", "rise = 61.0"), "chapters.0.phases.1.lava.rise"],
    ["a goal asking for more lamps than there are", validStory.replace("lamps = 1 }", "lamps = 2 }"), "chapters.0.phases.0.goal.lamps"],
    ["a moment for a phase that is not there", validStory.replace('phase = "dive"', 'phase = "swim"'), "chapters.0.moments.1.when.phase"],
    ["a moment that neither says nor does", `${validStory}\n[[chapters.moments]]\nwhen = { kind = "goal" }\n`, "chapters.0.moments.3"],
    ["a chapter before an unknown cutscene", validStory.replace('before = "first"', 'before = "second"'), "chapters.0.before"],
    ["an ending in an unknown cutscene", validStory.replace('cutscene = "first"', 'cutscene = "second"'), "ending.cutscene"],
    ["a picture that is not a story picture", validStory.replace('art = "story.lowtown"', 'art = "world.dawnSky"'), "cutscenes.0.panels.0.art"],
    ["a {glyph} outside a gamepad prompt", validStory.replace('keyboard = "A D to steer"', 'keyboard = "{glyph} to steer"'), "prompts.move.keyboard"],
    ["a chip for a move with no control", validStory.replace('teaches = ["move", "fastFall"]', 'teaches = ["survive"]'), "chapters.0.teaches.0"],
  ])("refuses %s", (_, text, keyPath) => {
    expect(refusal(text)).toContainEqual(expect.objectContaining({ file: FILE, keyPath }));
  });

  it("refuses an unknown field", () => {
    expect(refusal(validStory.replace('title = "The Only One"', 'title = "The Only One"\nnote = "x"'))).toContainEqual(
      expect.objectContaining({ code: "unknownField", file: FILE, keyPath: "chapters.0.note" }),
    );
  });
});
