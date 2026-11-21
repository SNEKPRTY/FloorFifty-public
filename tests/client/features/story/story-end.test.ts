import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as m from "../../../../apps/client/src/paraglide/messages.js";

const read = (file: string): string => readFileSync(join(__dirname, "../../../..", file), "utf8");

// Audit S18, the Owner's "A works" (2026-11-14): "Finite" is a word the game uses nowhere else. The story carries
// the same rule, and the way on after its last chapter is named as the title and the lobby name it.
describe("the story's words", () => {
  const ui = JSON.parse(read("apps/client/messages/ui/en.json")) as Record<string, string>;

  it("never says finite to a player", () => {
    for (const [key, text] of Object.entries(ui)) {
      if (key === "ready_mode_finite_tagline") continue; // the key is a name in the code; its words say no such thing
      expect(JSON.stringify(text), key).not.toMatch(/finite/i);
    }
    for (const line of read("content/story.toml").split("\n")) expect(line).not.toMatch(/finite/i);
  });

  it("names the way on after the last chapter, and the pause's ways out", () => {
    expect(m.story_race_now()).toBe("Race now");
    expect(m.story_play_now()).toBe("Play now");
    expect(m.story_exit()).toBe("Leave story");
    expect(m.story_restart()).toBe("Start chapter again");
  });
});
