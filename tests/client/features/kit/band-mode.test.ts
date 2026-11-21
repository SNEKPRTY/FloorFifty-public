/**
 * The band is the whole window in the menus and the 16:9 field in a race, a
 * replay and the tutorial, which share one race scene (features/platform/band.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { deflateReplaySync } from "../../../../apps/server/src/rooms/replay-compression";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { runRoomLike } from "../../../server/support/room-like";
import { gameplayWithFakeNetwork, replayWithFakes, storyWithFakes } from "../../support/fakes/screens";
import { contentFor } from "../replay/replay-content";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the band mode of a race scene", () => {
  it("puts the band in field mode for a race, and back to menu on leave", async () => {
    const gameplay = await gameplayWithFakeNetwork({});
    expect(gameplay.stage.bandModes.at(-1)).toBe("field");
    gameplay.screen.exit();
    expect(gameplay.stage.bandModes.at(-1)).toBe("menu");
  });

  it("puts the band in field mode for a replay, and back to menu on leave", { timeout: 30_000 }, async () => {
    const race = runRoomLike({ tuning: resolveTuning(), seats: 2 });
    const viewer = await replayWithFakes({ bytes: deflateReplaySync(race.replay), content: contentFor(race.replay) });
    expect(viewer.stage.bandModes).toEqual(["field"]);
    viewer.screen.exit();
    expect(viewer.stage.bandModes).toEqual(["field", "menu"]);
  });

  it("puts the band in field mode for the story's climb, and back to menu on leave", async () => {
    const tutorial = await storyWithFakes();
    // The hub and the cutscene are menus over the window; the climb is the field.
    expect(tutorial.stage.bandModes).toEqual([]);
    tutorial.click("story-cutscene-skip");
    await vi.waitFor(() => expect(tutorial.screen.chapterIndex()).not.toBeUndefined());
    expect(tutorial.stage.bandModes).toEqual(["field"]);
    tutorial.screen.exit();
    expect(tutorial.stage.bandModes).toEqual(["field", "menu"]);
  });

  it("returns the band to the window after a race: menu is the last word", async () => {
    const gameplay = await gameplayWithFakeNetwork({});
    gameplay.screen.exit();
    expect(gameplay.stage.bandModes[0]).toBe("field");
    expect(gameplay.stage.bandModes.at(-1)).toBe("menu");
  });
});
