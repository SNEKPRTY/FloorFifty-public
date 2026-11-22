/**
 * The runtime, end to end.
 *
 * Real screens, the real router, and the shipped graph. What these pin is the
 * behaviour a player would notice: following the room's authoritative phase
 * exactly once per edge, reaching the results screen on a reconnect into a
 * finished room, and never navigating anywhere the authored graph does not
 * describe.
 */

import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { asRevision } from "@floor-fifty/shared/content/game-content";
import { GENERATED_CONTENT } from "../../../../../apps/server/src/content/generated-content";
import { FakeNetwork } from "../../../support/fakes/network";
import { snapshotAt } from "../../../support/snapshots";
import { hotReloadHarness, presentationHarness } from "../../../support/presentation";

const shipped = GENERATED_CONTENT.content.presentation;

/** Every `.ts` file under a directory, recursively. */
async function readAllFiles(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  const parts = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return readAllFiles(path);
      return entry.name.endsWith(".ts") ? readFile(path, "utf8") : "";
    }),
  );
  return parts.join("\n");
}

describe("starting a session", () => {
  it("enters the authored entry screen and follows it to the menu", async () => {
    const app = await presentationHarness({ config: shipped });

    await app.runtime.start();
    await app.settleTransitions();

    expect(app.screenHistory).toEqual(["Splash", "MainMenu"]);
    expect(app.failures).toEqual([]);
    app.dispose();
  });
});

describe("the title, lobby and race flow", () => {
  it("walks title -> lobby -> race -> title through the authored graph", async () => {
    const app = await presentationHarness({ config: shipped });
    await app.runtime.start();
    await app.settleTransitions();
    expect(app.screens.currentName).toBe("MainMenu");

    app.runtime.publish("ui.play-requested", {});
    await app.settleTransitions();
    expect(app.screens.currentName).toBe("Lobby");

    app.emitSnapshot(snapshotAt(10, { phase: "racing" }));
    await app.settleTransitions();
    expect(app.screens.currentName).toBe("Gameplay");

    app.runtime.publish("ui.leave-race-settled", {});
    await app.settleTransitions();
    expect(app.screens.currentName).toBe("MainMenu");
    expect(app.failures).toEqual([]);
    app.dispose();
  });

  it("goes back from the lobby to the title", async () => {
    const app = await presentationHarness({ config: shipped, currentScreen: "Lobby" });
    app.runtime.publish("ui.back-requested", {});
    await app.settleTransitions();
    expect(app.screenHistory).toEqual(["Lobby", "MainMenu"]);
    app.dispose();
  });

  it("sends a resumed seat from the splash to the lobby", async () => {
    const network = new FakeNetwork();
    network.resumeOutcome = "resumed";
    const app = await presentationHarness({ config: shipped, network });
    await app.runtime.start();
    await app.settleTransitions();
    expect(app.screenHistory).toEqual(["Splash", "Lobby"]);
    expect(app.failures).toEqual([]);
    app.dispose();
  });
});

describe("following authority", () => {
  it("follows one repeated authoritative phase and supports finished reconnect", async () => {
    const app = await presentationHarness({ config: shipped, currentScreen: "Lobby" });

    const finished = snapshotAt(10, { phase: "finished", winnerId: asPlayerId("p1") });
    app.emitSnapshot(finished);
    app.emitSnapshot(snapshotAt(11, { phase: "finished", winnerId: asPlayerId("p1") }));
    await app.settleTransitions();

    expect(app.screenHistory).toEqual(["Lobby", "GameEnd"]);
    expect(app.publishedNames.filter((name) => name === "room.finished")).toHaveLength(1);
    expect(app.failures).toEqual([]);
    app.dispose();
  });

  it("enters gameplay when the room starts racing, once", async () => {
    const app = await presentationHarness({ config: shipped, currentScreen: "Lobby" });

    app.emitSnapshot(snapshotAt(10, { phase: "racing" }));
    app.emitSnapshot(snapshotAt(11, { phase: "racing" }));
    await app.settleTransitions();

    expect(app.screenHistory).toEqual(["Lobby", "Gameplay"]);
    expect(app.publishedNames.filter((name) => name === "room.racing")).toHaveLength(1);
    app.dispose();
  });

  it("does not republish the phase it was entered for", async () => {
    const app = await presentationHarness({ config: shipped, currentScreen: "Lobby" });

    app.emitSnapshot(snapshotAt(10, { phase: "racing" }));
    await app.settleTransitions();
    const afterEntry = app.publishedNames.length;

    // Gameplay was entered because of this very edge; saying so again would
    // be a `roomRacing` event the graph has no Gameplay transition for.
    app.emitSnapshot(snapshotAt(11, { phase: "racing" }));
    await app.settleTransitions();

    expect(app.publishedNames.length).toBe(afterEntry);
    expect(app.failures).toEqual([]);
    app.dispose();
  });

  it("recovers to the menu from a fatal room failure", async () => {
    const app = await presentationHarness({ config: shipped, currentScreen: "Lobby" });
    app.emitSnapshot(snapshotAt(10, { phase: "racing" }));
    await app.settleTransitions();

    app.network.emitError({ code: "ROOM_CLOSED", message: "the room closed" });
    await app.settleTransitions();

    expect(app.screenHistory).toEqual(["Lobby", "Gameplay", "MainMenu"]);
    expect(app.publishedNames).toContain("room.recovery-required");
    app.dispose();
  });

  it("reports a flow event the current screen has no transition for", async () => {
    const app = await presentationHarness({ config: shipped, currentScreen: "GameEnd" });

    // `GameEnd` has no `recoverToMenu` transition in the shipped graph.
    app.runtime.publish("room.recovery-required", { code: "ROOM_CLOSED" });
    await app.settleTransitions();

    expect(app.failures).toEqual([
      expect.objectContaining({ kind: "flow" }),
    ]);
    app.dispose();
  });
});

describe("replacing the configuration", () => {
  it("is legal before the first screen starts", async () => {
    const app = await presentationHarness({ config: shipped });
    const replacement = { ...shipped };

    app.runtime.replaceConfig(replacement, GENERATED_CONTENT.contentRevision);

    expect(app.runtime.currentConfig()).toBe(replacement);
    app.dispose();
  });

  it.each(["MainMenu", "Lobby"] as const)("is legal on %s", async (screen) => {
    const app = await presentationHarness({ config: shipped, currentScreen: screen });
    const replacement = { ...shipped };

    app.runtime.replaceConfig(replacement, GENERATED_CONTENT.contentRevision);

    expect(app.runtime.currentConfig()).toBe(replacement);
    app.dispose();
  });

  it.each(["Splash", "Gameplay", "GameEnd"] as const)(
    "throws on %s, leaving flow, routing, and revision identical",
    async (screen) => {
      const app = await presentationHarness({
        config: shipped,
        currentScreen: screen === "Gameplay" ? "Lobby" : screen,
        ...(screen === "Splash" ? { holdEntry: true } : {}),
      });
      if (screen === "Gameplay") {
        app.emitSnapshot(snapshotAt(10, { phase: "racing" }));
        await app.settleTransitions();
      }

      const before = app.runtime.currentConfig();
      const revisionBefore = app.runtime.currentRevision();

      expect(() => app.runtime.replaceConfig({ ...shipped }, "f".repeat(64) as never)).toThrow(
        new RegExp(screen),
      );
      expect(app.runtime.currentConfig()).toBe(before);
      expect(app.runtime.currentRevision()).toBe(revisionBefore);
      app.dispose();
    },
  );
});

describe("the presentation boundary", () => {
  it("never publishes input or outbound commands through presentation", async () => {
    const sources = await readAllFiles("apps/client/src");

    expect(
      sources.match(/publishPresentationEvent\([^)]*(sendInput|raceAgain|leaveRoom)/g),
    ).toBeNull();
  });
});

/**
 * Development reload.
 *
 * A rebuild reaches the client as a whole configuration or not at all, and
 * only at a moment where swapping it cannot strand a race between two graphs.
 */
describe("adopting a rebuilt artifact", () => {
  const withRevision = (revision: string): typeof GENERATED_CONTENT => ({
    ...GENERATED_CONTENT,
    contentRevision: asRevision(revision),
    content: {
      ...GENERATED_CONTENT.content,
      presentation: { ...GENERATED_CONTENT.content.presentation },
    },
  });

  it("adopts flow and routing together only after gameplay reaches the menu", async () => {
    const oldContent = withRevision("a".repeat(64));
    const newContent = withRevision("b".repeat(64));
    const app = await hotReloadHarness({ currentScreen: "Gameplay", content: oldContent });

    await app.serverBuilds(newContent);
    expect(app.runtimeConfig()).toBe(oldContent.content.presentation);
    expect(app.runtimeRevision()).toBe(oldContent.contentRevision);

    await app.finishIntoMenu();

    expect(app.runtimeConfig()).toBe(newContent.content.presentation);
    expect(app.runtimeRevision()).toBe(newContent.contentRevision);
    app.dispose();
  });

  it("keeps the last valid presentation config after an invalid edit", async () => {
    const oldContent = withRevision("a".repeat(64));
    const app = await hotReloadHarness({ currentScreen: "MainMenu", content: oldContent });

    await app.invalidServerBuild();

    expect(app.runtimeConfig()).toBe(oldContent.content.presentation);
    expect(app.contentCache()).toBe(oldContent);
    app.dispose();
  });

  it("adopts a rebuild immediately when the menu is already showing", async () => {
    const oldContent = withRevision("a".repeat(64));
    const newContent = withRevision("b".repeat(64));
    const app = await hotReloadHarness({ currentScreen: "MainMenu", content: oldContent });

    await app.serverBuilds(newContent);

    expect(app.runtimeConfig()).toBe(newContent.content.presentation);
    app.dispose();
  });
});
