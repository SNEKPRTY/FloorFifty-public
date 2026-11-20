// @vitest-environment node
/**
 * The flow controller hands each edge's transition style to the screen
 * manager (race-flow spec §7.1): a liquid edge is wiped, any other is a cut.
 */

import { describe, expect, it } from "vitest";
import type { PresentationFlow, ScreenId, TransitionStyle } from "@floor-fifty/shared/content/presentation";
import { PresentationFlowController } from "../../../../../apps/client/src/features/screen/presentation/presentation-flow";
import type { ScreenManager } from "../../../../../apps/client/src/features/screen/screen-manager";

const flow: PresentationFlow = {
  entry: "Lobby",
  transitions: [
    { from: "Lobby", event: "roomRacing", to: "Gameplay", transition: "liquid" },
    { from: "Lobby", event: "back", to: "MainMenu" },
  ],
};

function screensAt(current: ScreenId) {
  const calls: [ScreenId, TransitionStyle | undefined][] = [];
  const screens = {
    currentName: current,
    transition: async (next: ScreenId, style?: TransitionStyle) => {
      calls.push([next, style]);
    },
  } as unknown as ScreenManager;
  return { screens, calls };
}

describe("the flow controller", () => {
  it("passes a liquid edge's style to the screen manager", () => {
    const { screens, calls } = screensAt("Lobby");
    new PresentationFlowController(flow, screens, () => {}).dispatch("roomRacing");
    expect(calls).toEqual([["Gameplay", "liquid"]]);
  });

  it("passes an edge with no style as a cut", () => {
    const { screens, calls } = screensAt("Lobby");
    new PresentationFlowController(flow, screens, () => {}).dispatch("back");
    expect(calls).toEqual([["MainMenu", "cut"]]);
  });
});
