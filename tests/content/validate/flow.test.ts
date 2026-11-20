/**
 * Flow graph validation.
 *
 * The graph is the client's only navigation policy once this initiative
 * lands, so every one of these rejections is a screen the player would
 * otherwise have been stranded on.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PresentationFlow } from "@floor-fifty/shared/content/presentation";
import { validateFlow } from "@floor-fifty/content/validate/flow";
import {
  flowWith,
  flowWithIncomingEntry,
  flowWithTransition,
  flowWithUnreachable,
  flowWithout,
  located,
  shippedFlow,
} from "../support";

describe("validateFlow", () => {
  it("accepts the shipped graph, cycles and all", () => {
    expect(validateFlow(located("content/flow.toml", shippedFlow()))).toEqual([]);
  });

  it.each([
    [flowWith({ entry: "MainMenu" }), "entry"],
    [flowWithout("Gameplay", "raceFinished"), "transitions.Gameplay.raceFinished"],
    [flowWithTransition("Gameplay", "raceFinished", "Splash"), "transitions.Gameplay.raceFinished"],
    [flowWithIncomingEntry(), "transitions"],
    [flowWithUnreachable("GameEnd"), "GameEnd"],
  ] as const)("rejects an invalid flow graph", (flow, keyPath) => {
    expect(validateFlow(located("content/flow.toml", flow))).toContainEqual(
      expect.objectContaining({ code: "invalidFlow", file: "content/flow.toml", keyPath }),
    );
  });

  it("rejects a self-transition and a duplicated pair", () => {
    const self = flowWithTransition("GameEnd", "raceAgain", "GameEnd");
    expect(validateFlow(located("content/flow.toml", self))).toContainEqual(
      expect.objectContaining({ code: "invalidFlow", message: expect.stringContaining("itself") }),
    );

    const shipped = shippedFlow();
    const duplicate = {
      ...shipped,
      transitions: [...shipped.transitions, { from: "Splash", event: "splashComplete", to: "MainMenu" } as const],
    };
    expect(validateFlow(located("content/flow.toml", duplicate))).toContainEqual(
      expect.objectContaining({ code: "invalidFlow", message: expect.stringContaining("declared") }),
    );
  });
});

describe("the shipped flow's transitions", () => {
  const liquid = [
    "Lobby.roomRacing",
    "Gameplay.raceFinished",
    "GameEnd.raceAgain",
    "GameEnd.returnToMenu",
    "GameEnd.roomRacing",
    "Gameplay.leaveRace",
    "MainMenu.tutorial",
    "Lobby.tutorial",
    "Tutorial.tutorialToTitle",
    "Tutorial.tutorialToLobby",
    // The replay's edges (race-options spec §7.1).
    "GameEnd.watchReplay",
    "Replay.replayExit",
    "Replay.replayExitToRoom",
  ];

  it("runs the race's edges liquid and everything else as a fade (race-flow spec §7.1)", () => {
    const artifact = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../content/generated/content.json"), "utf8")) as {
      content: { presentation: { flow: PresentationFlow } };
    };
    for (const transition of artifact.content.presentation.flow.transitions) {
      const key = `${transition.from}.${transition.event}`;
      expect(transition.transition, key).toBe(liquid.includes(key) ? "liquid" : "fade");
    }
  });
});

