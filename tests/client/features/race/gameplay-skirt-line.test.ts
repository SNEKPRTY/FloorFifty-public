/**
 * A race reports where its scenery starts stretching, so a phone held upright
 * can cover it (LetterboxFrame.setSkirtLine), and lets go of it on exit.
 */
import { describe, expect, it } from "vitest";
import { gameplayWithFakeNetwork } from "../../support/fakes/screens";
import { fakeStage } from "../../support/fakes/stage";

describe("the stretched scenery during a race", () => {
  it("is let go of when the race exits", async () => {
    const stage = fakeStage();
    const calls: (number | undefined)[] = [];
    stage.setSkirtLine = (line) => calls.push(line);
    const gameplay = await gameplayWithFakeNetwork({ stage });
    const beforeExit = calls.length;
    gameplay.screen.exit();
    expect(calls.length).toBe(beforeExit + 1);
    expect(calls.at(-1)).toBeUndefined();
  });
});
