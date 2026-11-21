import { readFile } from "node:fs/promises";
import { compile, repoPaths } from "@floor-fifty/content/compiler";
import { build } from "@floor-fifty/content/build";
import { renderContentMessages, verifyContentMessages } from "@floor-fifty/content/messages";
import { beforeAll, describe, expect, it } from "vitest";
import { temporaryContentPaths } from "./support";

const snake = (id: string) => id.replaceAll("-", "_");

// One compile of the shipped content for the whole file: a compile is several
// seconds now that courses are validated, too slow to repeat per test.
let compiled: Extract<Awaited<ReturnType<typeof compile>>, { ok: true }>;
beforeAll(async () => {
  const result = await compile(repoPaths(process.cwd()));
  if (!result.ok) throw new Error("content does not compile");
  compiled = result;
}, 60_000);
const shipped = async () => compiled;

describe("content messages (languages spec §4.2)", () => {
  it("keys every named item except songs, every pack title, every hint, and every story prompt and line", async () => {
    const payload = (await shipped()).artifact.content;
    const messages = JSON.parse(renderContentMessages(payload).json) as Record<string, string>;

    for (const stage of [...payload.stages, ...payload.story.chapters.map((chapter) => chapter.stage)]) {
      expect(messages[`content_stage_${snake(stage.id)}_name`]).toBe(stage.displayName);
    }
    for (const character of payload.characters) expect(messages[`content_character_${snake(character.id)}_name`]).toBe(character.displayName);
    for (const pack of payload.packs) expect(messages[`content_pack_${snake(pack.id)}_title`]).toBe(pack.title);
    for (const unlock of payload.unlocks) expect(messages[`content_unlock_${snake(unlock.id)}_hint`]).toBe(unlock.hint);
    // The floor-count options a room races (phase 4): shown in the ready room and on results.
    expect(payload.modes.length).toBeGreaterThan(0);
    for (const mode of payload.modes) expect(messages[`content_mode_${snake(mode.id)}_name`]).toBe(mode.displayName);
    expect(messages["content_story_prompt_fast_fall_gamepad"]).toContain("{glyph}");
    expect(messages["content_story_prompt_move_buttons"]).toBeDefined();
    expect(messages["content_story_lowtown_title"]).toBe("Lowtown");
    expect(messages["content_story_lowtown_bark_0_0"]).toBe("Up we go! Follow me!");
    expect(messages["content_story_cut_lowtown_title"]).toBe("Lowtown");
    expect(messages["content_story_cut_lowtown_1_0"]).toBe("Wake up! The lava is coming up!");
    expect(messages["content_story_thesis_0"]).toBe("The best climbers look down.");
    expect(messages["content_story_last"]).toBe("Now let's race! First one up waits for the others.");
    expect(Object.keys(messages).some((key) => key.startsWith("content_tutorial_"))).toBe(false);
    expect(Object.keys(messages).some((key) => key.startsWith("content_song_"))).toBe(false);
    expect(Object.keys(messages).filter((key) => key !== "$schema").every((key) => /^content_[a-z0-9_]+$/.test(key))).toBe(true);
  });

  it("the committed file equals what the build would write", async () => {
    const paths = repoPaths(process.cwd());
    expect(await verifyContentMessages(paths, (await shipped()).artifact.content)).toEqual([]);
  });

  it("a build writes it, and a stale one is refused", async () => {
    const paths = await temporaryContentPaths();
    const result = await build(paths);
    if (!result.ok) throw new Error("content does not build");
    expect(await readFile(paths.messagesPath, "utf8")).toBe(renderContentMessages(result.artifact.content).json);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(paths.messagesPath, "{}\n");
    expect((await verifyContentMessages(paths, result.artifact.content)).map((d) => d.code)).toEqual(["staleArtifact"]);
  }, 60_000);

  it("stays out of the payload, so neither revision sees it", async () => {
    expect(JSON.stringify((await shipped()).artifact.content)).not.toContain("content_stage_");
  });
});
