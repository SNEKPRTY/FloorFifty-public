import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushSync } from "svelte";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { lobbyWithFakeNetwork } from "../../support/fakes/screens";
import { fakeSettings } from "../../support/fakes/settings";
import { STORY_FLAG_KEY } from "../../../../apps/client/src/features/story/enabled";

beforeAll(async () => {
  await import("../../../../apps/client/src/features/lobby/lobby");
}, 30_000);

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

const typeInto = (field: HTMLInputElement, value: string): void => {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
};
const settleAfter = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};

/** The three ways into a match, each as a player presses it. */
const WAYS = {
  "find-race": { press: "find-race", call: "quickMatch:Kite" },
  "create-room": { press: "create-room", call: "createRoom:Kite" },
  "join-room": { press: "join-room", call: "joinRoom:ABC123:Kite" },
} as const;

async function unseenLobby() {
  const lobby = await lobbyWithFakeNetwork({ settings: fakeSettings() });
  typeInto(lobby.query<HTMLInputElement>("name-input")!, "Kite");
  return lobby;
}

async function press(lobby: Awaited<ReturnType<typeof unseenLobby>>, way: keyof typeof WAYS): Promise<void> {
  // The join button needs a code in the field; the others do not mind one there.
  if (way === "join-room") typeInto(lobby.query<HTMLInputElement>("code-input")!, "ABC123");
  lobby.click(WAYS[way].press);
  await settleAfter();
}

describe("the match gate (story-mode spec, criterion 21)", () => {
  for (const way of Object.keys(WAYS) as (keyof typeof WAYS)[]) {
    it(`opens on ${way} for a player never shown how, and sends nothing`, async () => {
      const lobby = await unseenLobby();
      await press(lobby, way);
      expect(lobby.query("match-gate")).not.toBeNull();
      expect(lobby.network.calls).toEqual([]);
      lobby.screen.exit();
    });

    it(`Skip on ${way} sets the flag and makes the one call that was pressed, with the typed name and code`, async () => {
      const lobby = await unseenLobby();
      await press(lobby, way);
      lobby.click("match-gate-skip");
      await settleAfter();
      expect(lobby.network.calls).toEqual([WAYS[way].call]);
      expect(lobby.settings.value.seen.tutorial).toBe(true);
      expect(lobby.query("match-gate")).toBeNull();
      lobby.screen.exit();
    });
  }

  it("treats Escape as Skip", async () => {
    const lobby = await unseenLobby();
    await press(lobby, "find-race");
    lobby.query("match-gate")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settleAfter();
    expect(lobby.network.calls).toEqual([WAYS["find-race"].call]);
    expect(lobby.settings.value.seen.tutorial).toBe(true);
    lobby.screen.exit();
  });

  it("Show me how opens Instructions and makes no call; the next press goes straight in", async () => {
    const lobby = await unseenLobby();
    await press(lobby, "find-race");
    lobby.click("match-gate-show");
    await settleAfter();
    expect(lobby.query("match-gate")).toBeNull();
    expect(lobby.query("instructions")).not.toBeNull();
    expect(lobby.network.calls).toEqual([]);
    expect(lobby.settings.value.seen.tutorial).toBe(true);
    // Closing returns to the connect panel; the held press was dropped.
    lobby.click("instructions-next");
    for (let slide = 0; slide < 5; slide += 1) lobby.click("instructions-next");
    await settleAfter();
    expect(lobby.query("instructions")).toBeNull();
    expect(lobby.network.calls).toEqual([]);
    lobby.click("find-race");
    await settleAfter();
    expect(lobby.network.calls).toEqual([WAYS["find-race"].call]);
    lobby.screen.exit();
  });

  it("offers Play story to every player, with no flag (Owner, 2026-11-20: on for every player)", async () => {
    localStorage.removeItem(STORY_FLAG_KEY);
    const lobby = await unseenLobby();
    await press(lobby, "create-room");
    expect(lobby.query("match-gate")).not.toBeNull();
    expect(lobby.query("match-gate-story")).not.toBeNull();
    expect(lobby.query("match-gate-show")).not.toBeNull();
    lobby.screen.exit();
  });

  it("Play story publishes the story's event and makes no call", async () => {
    localStorage.removeItem(STORY_FLAG_KEY);
    const lobby = await unseenLobby();
    await press(lobby, "create-room");
    lobby.click("match-gate-story");
    await settleAfter();
    expect(lobby.published()).toContain("ui.story-requested");
    expect(lobby.network.calls).toEqual([]);
    lobby.screen.exit();
  });

  it("never opens for a player already shown how, or one who finished a chapter", async () => {
    for (const seed of [{ seen: { tutorial: true } }, { story: { chaptersDone: 1 } }] as const) {
      for (const way of Object.keys(WAYS) as (keyof typeof WAYS)[]) {
        // A fresh lobby each time: a press that goes in seats the player and the panel gives way to the room.
        const lobby = await lobbyWithFakeNetwork({ settings: fakeSettings(seed) });
        typeInto(lobby.query<HTMLInputElement>("name-input")!, "Kite");
        await press(lobby, way);
        expect(lobby.query("match-gate")).toBeNull();
        expect(lobby.network.calls).toEqual([WAYS[way].call]);
        lobby.screen.exit();
      }
    }
  });

  it("is gone from the lobby: the first-Play offer ids are in no client source", async () => {
    const { clientSourceFiles, CLIENT_SRC } = await import("../../support/client-source");
    const text = clientSourceFiles()
      .map((file) => readFileSync(resolve(CLIENT_SRC, "../../..", file), "utf8"))
      .join("\n");
    expect(text).not.toContain("tutorial-offer");
    expect(text).not.toContain("story-offer");
  });
});
