import { flushSync } from "svelte";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SelectStep } from "@floor-fifty/shared/room/select";
import { PREVIEW_DEBOUNCE_MS } from "../../../../apps/client/src/features/audio/preview-deck";
import { shippedContentPort } from "../../support/fakes/content";
import { lobbyWithFakeNetwork } from "../../support/fakes/screens";
import { lobbySnapshot, LOCAL_ID, playerSnapshot, REMOTE_ID } from "../../support/snapshots";

/**
 * Turns the picker with Next until `id` is shown: past nine songs the
 * position is a counter (UI layout spec §6.4), so there is no dot to press.
 */
function turnTo(root: HTMLElement, id: string): void {
  for (let step = 0; step < 40 && root.querySelector<HTMLElement>("[data-testid=picker]")!.dataset["id"] !== id; step += 1) {
    root.querySelector<HTMLElement>("[data-testid=picker-next]")!.click();
    flushSync();
  }
  expect(root.querySelector<HTMLElement>("[data-testid=picker]")!.dataset["id"]).toBe(id);
}

const select = (step: SelectStep, overrides = {}) => ({
  ...lobbySnapshot(2, { players: [playerSnapshot(), playerSnapshot({ id: REMOTE_ID, name: "Sable", colour: "cyan" })] }),
  phase: "select" as const,
  select: {
    step,
    endsAtTick: 900,
    picks: { [LOCAL_ID]: { focus: "rooftops", locked: false, seed: "random" as const }, [REMOTE_ID]: { focus: "rooftops", locked: false, seed: "random" as const } },
    loaded: [],
    ...overrides,
  },
});

/**
 * Every screen a test opens is exited after it, so a roulette still spinning
 * at the end of a test stops with it rather than firing its timers into a
 * torn-down environment ("document is not defined").
 */
const live: { screen: { exit(): void } }[] = [];
async function lobby(...args: Parameters<typeof lobbyWithFakeNetwork>): ReturnType<typeof lobbyWithFakeNetwork> {
  const opened = await lobbyWithFakeNetwork(...args);
  live.push(opened);
  return opened;
}
afterEach(() => {
  for (const opened of live.splice(0)) {
    try {
      opened.screen.exit();
    } catch {
      // Already exited by the test itself.
    }
  }
});

// The lobby's first import (its screens, the select screen and the unlock
// code) runs to seconds on a busy machine; paid here, under its own timeout,
// rather than inside whichever test happens to run first.
beforeAll(async () => {
  await import("../../../../apps/client/src/features/lobby/lobby");
}, 30_000);

describe("the select screen", () => {
  it("replaces the ready room in select, and picks a stage through the server", async () => {
    const screen = await lobby({ unlockAll: true, content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("stage"));
    // The ready room's roster is gone; the select screen stands in its place.
    await vi.waitFor(() => expect(screen.query("seats")).toBeNull());
    expect(screen.query<HTMLElement>("select-screen")!.dataset["step"]).toBe("stage");
    screen.query("select-screen")!.querySelector<HTMLElement>("[data-testid=picker-dot][data-id=snow-shrine]")!.click();
    expect(screen.network.calls).toContain("pickStage:snow-shrine");
  });

  it("locks in, then says so and stops taking picks", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("stage"));
    screen.query<HTMLButtonElement>("lock-in")!.click();
    expect(screen.network.calls).toContain("lockIn");
    screen.receiveSnapshot(select("stage", { picks: { [LOCAL_ID]: { focus: "rooftops", locked: true, seed: "random" as const }, [REMOTE_ID]: { focus: "rooftops", locked: false, seed: "random" as const } } }));
    expect(screen.query("lock-in")!.textContent).toContain("Locked in");
    expect(screen.query<HTMLButtonElement>("lock-in")!.disabled).toBe(true);
  });

  it("a DLC stage's button opens its pack's Coming soon sheet and never locks in (unlockables spec §7.3)", async () => {
    const content = shippedContentPort();
    const current = content.current()!;
    // Snow Shrine moved into a DLC pack this device does not own.
    content.set({
      ...current,
      content: {
        ...current.content,
        packs: [
          ...current.content.packs.map((pack) => ({ ...pack, stages: pack.stages.filter((id) => id !== "snow-shrine") })),
          { ...current.content.packs[0]!, id: "far" as never, title: "Far", dlc: true, stages: ["snow-shrine" as never], songs: [], characters: [] },
        ],
      },
    });
    const screen = await lobby({ content });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("stage", { picks: { [LOCAL_ID]: { focus: "snow-shrine", locked: false, seed: "random" as const }, [REMOTE_ID]: { focus: "rooftops", locked: false, seed: "random" as const } } }));
    const lock = screen.query<HTMLButtonElement>("lock-in")!;
    expect(lock.textContent).toContain("Coming soon");
    lock.click();
    await Promise.resolve();
    expect(screen.query("coming-soon")!.textContent).toContain("Snow Shrine");
    expect(screen.network.calls).not.toContain("lockIn");
    // The seat locks in elsewhere (or the step moves on): the sheet goes with it.
    screen.receiveSnapshot(select("stage", { picks: { [LOCAL_ID]: { focus: "snow-shrine", locked: true, seed: "random" as const }, [REMOTE_ID]: { focus: "rooftops", locked: false, seed: "random" as const } } }));
    // The sheet falls out over half a beat (polish spec §5.3) before it leaves.
    await vi.waitFor(() => expect(screen.query("coming-soon")).toBeNull());
  });

  it("names each player, the stage they are on, and whether they locked, in words", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("stage", { picks: { [LOCAL_ID]: { focus: "rooftops", locked: true, seed: "random" as const }, [REMOTE_ID]: { focus: "rooftops", locked: false, seed: "random" as const } } }));
    const rows = screen.queryAll("player-row");
    expect(rows.map((row) => row.textContent?.replace(/\s+/g, " ").trim())).toEqual(["Kite Rooftops Locked", "Sable"]);
  });

  it("sends loaded once per round in the loading step", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("loading", { stage: { id: "rooftops", pickedBy: LOCAL_ID }, song: { id: "moving-on", pickedBy: LOCAL_ID } }));
    screen.receiveSnapshot({ ...select("loading", { stage: { id: "rooftops", pickedBy: LOCAL_ID }, song: { id: "moving-on", pickedBy: LOCAL_ID } }), tick: 3 });
    await screen.settle();
    expect(screen.network.calls.filter((call) => call === "loaded")).toHaveLength(1);
    expect(screen.assets.loadedBundles).toContain("stage-rooftops");
    const movingOn = shippedContentPort().current()!.content.songs.find((song) => song.id === "moving-on")!;
    expect(screen.audio.calls).toContain("load:song-moving-on");
    expect(screen.audio.calls).toContain(`preload:${movingOn.audioAlias}`);
  });

  it("says what is being chosen, on the stage step", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("stage"));
    expect(screen.query("select-heading")!.textContent).toBe("Pick a stage");
  });

  it("says it on the song step too", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("song", { picks: songPicks("moving-on", "whats-next") }));
    expect(screen.query("select-heading")!.textContent).toBe("Pick a song");
  });

  it("heads the stage step, and shows the seconds beside Lock in", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot({ ...select("stage"), tick: 900 - 12 * 60 });
    expect(screen.query("select-seconds")!.textContent).toBe("12 s");
    expect(screen.query("select-banner")).toBeNull();
    expect(screen.query("select-headline")!.textContent).toBe("Rooftops");
  });

  it("still renders, and still picks, with storage blocked", async () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    try {
      const screen = await lobby({ unlockAll: true, content: shippedContentPort() });
      await screen.createRoom("Kite");
      screen.receiveSnapshot(select("stage"));
      expect(screen.query<HTMLElement>("select-screen")!.dataset["step"]).toBe("stage");
      screen.query("select-screen")!.querySelector<HTMLElement>("[data-testid=picker-dot][data-id=snow-shrine]")!.click();
      expect(screen.network.calls).toContain("pickStage:snow-shrine");

      screen.receiveSnapshot(select("song", { stage: { id: "rooftops", pickedBy: LOCAL_ID }, picks: { [LOCAL_ID]: { focus: "moving-on", locked: false, seed: "random" as const }, [REMOTE_ID]: { focus: "moving-on", locked: false, seed: "random" as const } } }));
      expect(screen.query<HTMLElement>("select-screen")!.dataset["step"]).toBe("song");
      expect(screen.query("picker")).not.toBeNull();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  describe("under reduced motion", () => {
    const realMatchMedia = window.matchMedia;
    afterEach(() => {
      window.matchMedia = realMatchMedia;
    });

    it("keeps the rows and the winner it began with when a player leaves mid-reveal (review 1)", async () => {
      window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
      const screen = await lobby({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      const WREN = "room-p3" as typeof REMOTE_ID;
      const three = select("stageReveal", {
        picks: {
          [LOCAL_ID]: { focus: "rooftops", locked: true, seed: "random" as const },
          [REMOTE_ID]: { focus: "snow-shrine", locked: true, seed: "random" as const },
          [WREN]: { focus: "sunken-dome", locked: true, seed: "random" as const },
        },
        stage: { id: "sunken-dome", pickedBy: WREN },
      });
      const players = [...three.players, playerSnapshot({ id: WREN, name: "Wren", colour: "gold" })];
      screen.receiveSnapshot({ ...three, players });
      expect(screen.query("roulette-byline")!.textContent).toBe("Picked by Wren");
      // Sable leaves: the room drops them from players and picks, and the seats after them move up.
      const { [REMOTE_ID]: _gone, ...picks } = three.select.picks;
      screen.receiveSnapshot({ ...three, tick: 5, players: [players[0]!, players[2]!], select: { ...three.select, picks } });
      expect(screen.queryAll("player-row")).toHaveLength(3);
      expect(screen.query("roulette-byline")!.textContent).toBe("Picked by Wren");
      expect(screen.queryAll("player-row").find((row) => row.dataset["winner"] === "true")!.textContent).toContain("Wren");
    });

    it("says nothing of whose pick it was when the winner is no longer in the room (review 1)", async () => {
      window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
      const screen = await lobby({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      // A reload into a reveal whose winner has already left.
      screen.receiveSnapshot(select("stageReveal", { stage: { id: "snow-shrine", pickedBy: "room-p9" } }));
      expect(screen.query("roulette-byline")!.textContent).toBe("");
    });

    it("draws the room's stage open, whatever this player may pick (review 2)", async () => {
      window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
      const content = shippedContentPort();
      const current = content.current()!;
      // Snow Shrine behind an unlock this device has not earned.
      content.set({
        ...current,
        content: {
          ...current.content,
          stages: current.content.stages.map((stage) => (stage.id === "snow-shrine" ? { ...stage, unlock: current.content.unlocks[0]!.id } : stage)),
        },
      });
      const screen = await lobby({ content });
      await screen.createRoom("Kite");
      screen.receiveSnapshot(select("stageReveal", { stage: { id: "snow-shrine", pickedBy: REMOTE_ID } }));
      expect(screen.query<HTMLElement>("stage-slide")!.dataset["state"]).toBe("open");
    });

    it("names the winner by name, or Your pick", async () => {
      const screen = await lobby({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
      screen.receiveSnapshot(select("stageReveal", { stage: { id: "snow-shrine", pickedBy: REMOTE_ID } }));
      expect(screen.query("roulette-byline")!.textContent).toBe("Picked by Sable");
    });

    it("names the song the roulette landed on, and whose pick it was", async () => {
      window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
      const screen = await lobby({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      screen.receiveSnapshot(select("songReveal", { picks: songPicks("moving-on", "whats-next", true), song: { id: "moving-on", pickedBy: LOCAL_ID } }));
      expect(screen.query("roulette-result")!.textContent).toBe("Moving On");
      expect(screen.query("roulette-byline")!.textContent).toBe("Your pick");
      expect(screen.query<HTMLElement>("song-slide")!.dataset["state"]).toBe("open");
    });

    it("draws the room's song open, whatever this player may pick", async () => {
      window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
      const screen = await lobby({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      // Unseen is locked on this device; the room races it anyway.
      screen.receiveSnapshot(select("songReveal", { picks: songPicks("moving-on", "unseen", true), song: { id: "unseen", pickedBy: REMOTE_ID } }));
      expect(screen.query<HTMLElement>("song-slide")!.dataset["state"]).toBe("open");
    });

    it("holds the preview still", async () => {
      window.matchMedia = ((query: string) => ({
        matches: query.includes("reduce"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      })) as unknown as typeof window.matchMedia;
      const screen = await lobby({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      screen.receiveSnapshot(select("stage"));
      expect(screen.query<HTMLElement>("stage-slide")!.dataset["pan"]).toBe("still");
    });
  });

  it("spins over people only: a lone racer with a CPU gets the result, not a spin (CPU players spec D-C6)", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    const reveal = {
      ...select("stageReveal", { picks: { [LOCAL_ID]: { focus: "snow-shrine", locked: true, seed: "random" as const } }, stage: { id: "snow-shrine", pickedBy: LOCAL_ID } }),
      players: [playerSnapshot(), playerSnapshot({ id: REMOTE_ID, name: "Koi", colour: "cyan", cpu: true, ready: true })],
    };
    screen.receiveSnapshot(reveal);
    expect(screen.queryAll("player-row")).toHaveLength(1);
    expect(screen.query<HTMLElement>("roulette")!.dataset["settled"]).toBe("true");
  });

  it("reveals the roulette's stage and whose pick it was", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    const reveal = select("stageReveal", { stage: { id: "snow-shrine", pickedBy: REMOTE_ID } });
    screen.receiveSnapshot(reveal);
    expect(screen.query("roulette")).not.toBeNull();
    expect(screen.queryAll("player-row")).toHaveLength(2);
  });

  it("keeps the reveal's rows for a Lobby resumed mid-countdown, before it hands over", async () => {
    // Review finding 3: the room drops `select` at the countdown, and the reveal
    // lost every card and its byline for the three seconds before GO.
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    const song = { id: "whats-next", pickedBy: REMOTE_ID };
    const picks = songPicks("moving-on", "whats-next", true);
    screen.receiveSnapshot(select("loading", { stage: { id: "snow-shrine", pickedBy: REMOTE_ID }, picks, song }));
    const { select: _dropped, ...countdown } = select("loading", { stage: { id: "snow-shrine", pickedBy: REMOTE_ID }, picks, song });
    screen.receiveSnapshot({ ...countdown, phase: "countdown", stageId: "snow-shrine", songId: "whats-next", countdownEndsAtTick: 180, tick: 10 });
    expect(screen.query<HTMLElement>("select-screen")!.dataset["step"]).toBe("countdown");
    expect(screen.queryAll("player-row")).toHaveLength(2);
    // The count is the stage's (race-flow spec §3): the reveal says no "Starting in N".
    expect(screen.query<HTMLElement>("select-screen")!.textContent).not.toMatch(/starting/i);
  });

  it("leaves a failed load in the loading step to the race's own loader, with no panel left behind", async () => {
    // Review finding 5: the lobby's load mounted a Retry panel that outlived
    // the lobby and sat over the race once the room timed out. The race's own
    // loader retries (select spec §5.1: its loader stays up until it has loaded).
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.assets.failing.add("stage-rooftops");
    screen.receiveSnapshot(select("loading", { stage: { id: "rooftops", pickedBy: LOCAL_ID } }));
    await screen.settle();
    await screen.settle();
    expect(screen.query("error-view")).toBeNull();
    expect(screen.network.calls).not.toContain("loaded");
  });

  it("shows one stage at a time, opening on the seat's focus", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("stage"));
    expect(screen.query<HTMLElement>("picker")!.dataset["id"]).toBe("rooftops");
    expect(screen.queryAll("stage-slide")).toHaveLength(1);
    expect(screen.query("tile-grid")).toBeNull();
  });
});

const songPicks = (mine: string, theirs: string, locked = false) => ({
  [LOCAL_ID]: { focus: mine, locked },
  [REMOTE_ID]: { focus: theirs, locked },
});
const previewOf = (id: string) => `${shippedContentPort().current()!.content.songs.find((song) => song.id === id)!.audioAlias}Preview`;
const debounce = () => new Promise((resolve) => setTimeout(resolve, PREVIEW_DEBOUNCE_MS + 50));

describe("the song step", () => {
  it("shows one song at a time, opening on the seat's focus, and picks through the server", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("song", { picks: songPicks("moving-on", "whats-next") }));
    expect(screen.query<HTMLElement>("select-screen")!.dataset["step"]).toBe("song");
    expect(screen.query<HTMLElement>("picker")!.dataset["id"]).toBe("moving-on");
    expect(screen.query("select-headline")!.textContent).toBe("Moving On");
    // The tempo is not shown: nobody picks a song by its BPM (Owner, 2026-11-15, question 5).
    expect(screen.query("song-slide-bpm")).toBeNull();
    expect(screen.query("tile-grid")).toBeNull();
    turnTo(screen.query<HTMLElement>("select-screen")!, "whats-next");
    expect(screen.network.calls).toContain("pickSong:whats-next");
  });

  it("fetches the large cover of each song a player is on, so the reveal lands on it loaded (Owner, 2026-10-10)", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "Image",
      class {
        set src(url: string) {
          requested.push(url);
        }
      },
    );
    try {
      const screen = await lobby({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      screen.receiveSnapshot(select("song", { picks: songPicks("moving-on", "whats-next") }));
      await vi.waitFor(() => {
        expect(requested.filter((url) => url.endsWith("cover.movingOnFull"))).toHaveLength(1);
        expect(requested.filter((url) => url.endsWith("cover.whatsNextFull"))).toHaveLength(1);
      });
      // The same picks again ask for nothing new.
      screen.receiveSnapshot(select("song", { picks: songPicks("whats-next", "moving-on") }));
      await Promise.resolve();
      expect(requested.filter((url) => url.endsWith("Full"))).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("names each player's song in their row", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("song", { picks: songPicks("moving-on", "?") }));
    const rows = screen.queryAll("player-row").map((row) => row.textContent?.replace(/\s+/g, " ").trim());
    expect(rows).toEqual(["Kite Moving On", "Sable Random song"]);
  });

  it("previews the song on screen after the debounce, from the shell's clips", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("song", { picks: songPicks("moving-on", "moving-on") }));
    await debounce();
    expect(screen.audio.calls).toContain("load:shell");
    expect(screen.audio.calls.filter((call) => call.startsWith("preview:"))).toEqual([`preview:${previewOf("moving-on")}`]);
    turnTo(screen.query<HTMLElement>("select-screen")!, "whats-next");
    await debounce();
    expect(screen.audio.calls).toContain(`preview:${previewOf("whats-next")}`);
    expect(screen.audio.calls).toContain(`release:${previewOf("moving-on")}`);
  });

  it("previews a locked song, says why it cannot be picked, and leaves the pick where it was", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("song", { picks: songPicks("moving-on", "moving-on") }));
    await debounce();
    turnTo(screen.query<HTMLElement>("select-screen")!, "unseen");
    await debounce();
    expect(screen.query<HTMLElement>("song-slide")!.dataset["state"]).toBe("locked");
    expect(screen.query("song-slide-hint")!.textContent).not.toBe("");
    expect(screen.query<HTMLButtonElement>("lock-in")!.disabled).toBe(true);
    expect(screen.network.calls).not.toContain("pickSong:unseen");
    expect(screen.audio.calls.slice(-2)).toEqual([`preview:${previewOf("unseen")}`, `release:${previewOf("moving-on")}`]);
  });

  it("previews a DLC song too, and never picks it", async () => {
    const content = shippedContentPort();
    const current = content.current()!;
    // We Outside moved into a DLC pack this device does not own.
    content.set({
      ...current,
      content: {
        ...current.content,
        packs: [
          ...current.content.packs.map((pack) => ({ ...pack, songs: pack.songs.filter((id) => id !== "we-outside") })),
          { ...current.content.packs[0]!, id: "far" as never, title: "Far", dlc: true, stages: [], songs: ["we-outside" as never], characters: [] },
        ],
      },
    });
    const screen = await lobby({ content });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("song", { picks: songPicks("moving-on", "moving-on") }));
    await debounce();
    turnTo(screen.query<HTMLElement>("select-screen")!, "we-outside");
    await debounce();
    expect(screen.query<HTMLElement>("song-slide")!.dataset["state"]).toBe("dlc");
    expect(screen.network.calls).not.toContain("pickSong:we-outside");
    expect(screen.audio.calls.slice(-2)).toEqual([`preview:${previewOf("we-outside")}`, `release:${previewOf("moving-on")}`]);
  });

  it("ends the menu theme from the song step on, even when no preview starts (final review 2)", async () => {
    // A reload claims the theme in the Splash, before the room's snapshot is
    // in; with the focus on Random no preview ever ends it.
    for (const step of ["song", "songReveal", "loading"] as const) {
      const screen = await lobby({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      screen.receiveSnapshot(select(step, { picks: songPicks("?", "?"), song: { id: "moving-on", pickedBy: REMOTE_ID } }));
      await screen.settle();
      expect(screen.audio.calls, step).toContain("stop:music.mainMenu");
    }
  });

  it("leaves the menu theme alone in the stage step", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("stage"));
    await screen.settle();
    expect(screen.audio.calls).not.toContain("stop:music.mainMenu");
  });

  it("ends the preview when the song reveal begins", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("song", { picks: songPicks("moving-on", "moving-on") }));
    await debounce();
    screen.receiveSnapshot(select("songReveal", { picks: songPicks("moving-on", "moving-on", true), song: { id: "moving-on", pickedBy: REMOTE_ID } }));
    expect(screen.audio.calls).toContain("preview-stop");
  });

  it("reveals the roulette's song and whose pick it was, and keeps it through loading", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    const picks = songPicks("moving-on", "whats-next", true);
    const song = { id: "whats-next", pickedBy: REMOTE_ID };
    screen.receiveSnapshot(select("songReveal", { picks, song }));
    const roulette = screen.query("roulette");
    expect(roulette).not.toBeNull();
    expect(screen.query("roulette-frame")!.querySelector("h2")!.textContent).toBe("Song");
    screen.receiveSnapshot({ ...select("loading", { picks, song }), tick: 200 });
    // One branch across the song reveal, loading and the countdown: never remounted, so the spin never replays.
    expect(screen.query("roulette")).toBe(roulette);
  });

  describe("the opening", () => {
    const realMatchMedia = window.matchMedia;
    afterEach(() => {
      window.matchMedia = realMatchMedia;
    });
    const reduce = () => {
      window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    };
    const movingOn = () => shippedContentPort().current()!.content.songs.find((song) => song.id === "moving-on")!;

    it("starts the chosen song once the reveal lands, once a round, to run on into the race", async () => {
      reduce();
      const screen = await lobby({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      screen.receiveSnapshot(select("song", { picks: songPicks("moving-on", "moving-on") }));
      const reveal = select("songReveal", { picks: songPicks("moving-on", "moving-on", true), song: { id: "moving-on", pickedBy: REMOTE_ID } });
      screen.receiveSnapshot(reveal);
      screen.receiveSnapshot({ ...reveal, tick: 5 });
      await screen.settle();
      const opening = `play:${movingOn().audioAlias}`;
      expect(screen.audio.calls.filter((call) => call === opening)).toHaveLength(1);
      expect(screen.audio.calls.indexOf("load:song-moving-on")).toBeLessThan(screen.audio.calls.indexOf(opening));
    });

    it("leaves the song playing as the room hands over to the race", async () => {
      reduce();
      const screen = await lobby({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      const reveal = select("songReveal", { picks: songPicks("moving-on", "moving-on", true), song: { id: "moving-on", pickedBy: REMOTE_ID } });
      screen.receiveSnapshot(reveal);
      await screen.settle();
      const { select: _select, ...counting } = reveal;
      screen.receiveSnapshot({ ...counting, phase: "countdown", songId: "moving-on" });
      screen.screen.exit();
      expect(screen.audio.calls).not.toContain(`stop:${movingOn().audioAlias}`);
    });

    it("stops the song if the room goes back to the ready room instead of racing", async () => {
      reduce();
      const screen = await lobby({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      const reveal = select("songReveal", { picks: songPicks("moving-on", "moving-on", true), song: { id: "moving-on", pickedBy: REMOTE_ID } });
      screen.receiveSnapshot(reveal);
      await screen.settle();
      screen.receiveSnapshot(lobbySnapshot(2));
      flushSync();
      expect(screen.audio.calls).toContain(`stop:${movingOn().audioAlias}`);
    });

    it("waits for the spin to land", async () => {
      const screen = await lobby({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      screen.receiveSnapshot(select("songReveal", { picks: songPicks("moving-on", "whats-next", true), song: { id: "moving-on", pickedBy: REMOTE_ID } }));
      await screen.settle();
      expect(screen.audio.calls.some((call) => call === `play:${movingOn().audioAlias}`)).toBe(false);
    });

    it("plays no opening for a reload that lands after the reveal", async () => {
      reduce();
      const screen = await lobby({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      screen.receiveSnapshot(select("loading", { picks: songPicks("moving-on", "moving-on", true), song: { id: "moving-on", pickedBy: REMOTE_ID } }));
      await screen.settle();
      expect(screen.audio.calls.some((call) => call === `play:${movingOn().audioAlias}`)).toBe(false);
    });
  });
});

describe("the stage step's seed (stage seeds spec §4)", () => {
  const withSeed = (seed: "random" | "classic" | number, locked = false) =>
    select("stage", { picks: { [LOCAL_ID]: { focus: "rooftops", locked, seed }, [REMOTE_ID]: { focus: "rooftops", locked: false, seed: "random" as const } } });
  const steer = (direction: string) => {
    document.activeElement!.dispatchEvent(new CustomEvent("ff-steer", { detail: { direction }, bubbles: true, cancelable: true }));
    flushSync();
  };
  async function open(seed: "random" | "classic" | number = "classic") {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(withSeed(seed));
    screen.query<HTMLButtonElement>("seed-chip")!.click();
    flushSync();
    return screen;
  }

  it("shows Random on the chip, and a press moves it to Classic through the server", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(withSeed("random"));
    const chip = screen.query<HTMLButtonElement>("seed-chip")!;
    expect(chip.dataset["choice"]).toBe("random");
    expect(chip.textContent).toContain("Random");
    chip.click();
    expect(screen.network.calls).toContain("pickSeed:classic");
    expect(screen.query("seed-editor")).toBeNull();
  });

  it("opens the editor from Classic, sending nothing yet", async () => {
    const screen = await open("classic");
    expect(screen.query("seed-editor")).not.toBeNull();
    expect(screen.queryAll("seed-digit")).toHaveLength(6);
    expect(screen.network.calls.filter((call) => call.startsWith("pickSeed"))).toEqual([]);
  });

  it("enters a seed digit by digit with a pad's directions, and sends it", async () => {
    const screen = await open("classic");
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.queryAll("seed-digit")[0]));
    steer("up");
    steer("right");
    steer("up");
    steer("up");
    expect(screen.queryAll("seed-digit").map((cell) => cell.textContent?.trim())).toEqual(["1", "2", "0", "0", "0", "0"]);
    screen.query<HTMLButtonElement>("seed-confirm")!.click();
    expect(screen.network.calls).toContain("pickSeed:120000");
    flushSync();
    await vi.waitFor(() => expect(screen.query("seed-editor")).toBeNull());
  });

  it("commits with a pad's A on a digit, as FocusNavigator's confirm clicks it (final review I1)", async () => {
    const screen = await open("classic");
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.queryAll("seed-digit")[0]));
    steer("up");
    // FocusNavigator.confirm() is a plain click on the focused element: detail 0.
    (document.activeElement as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(screen.network.calls).toContain("pickSeed:100000");
  });

  it("lets a pad walk off either end of the cells, toward the buttons (final review I1)", async () => {
    const screen = await open("classic");
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.queryAll("seed-digit")[0]));
    const offered = (direction: string) => {
      const event = new CustomEvent("ff-steer", { detail: { direction }, bubbles: true, cancelable: true });
      document.activeElement!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(offered("left"), "left on the first cell walks focus").toBe(false);
    for (let at = 0; at < 5; at += 1) expect(offered("right")).toBe(true);
    expect(offered("right"), "right on the last cell walks focus").toBe(false);
  });

  it("opens on the seed last raced, so the same climb is one press away (final review I2)", async () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("stageReveal", { stage: { id: "rooftops", pickedBy: LOCAL_ID, seed: 48213, classic: false } }));
    screen.receiveSnapshot({ ...withSeed("classic"), round: 2, tick: 10 });
    screen.query<HTMLButtonElement>("seed-chip")!.click();
    flushSync();
    expect(screen.queryAll("seed-digit").map((cell) => cell.textContent?.trim()).join("")).toBe("048213");
  });

  it("opens on the seat's own entered seed", async () => {
    const screen = await open(48213);
    expect(screen.queryAll("seed-digit").map((cell) => cell.textContent?.trim()).join("")).toBe("048213");
  });

  it("closes on Escape without sending", async () => {
    const screen = await open("classic");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    flushSync();
    await vi.waitFor(() => expect(screen.query("seed-editor")).toBeNull());
    expect(screen.network.calls.filter((call) => call.startsWith("pickSeed"))).toEqual([]);
  });

  it("takes typed text only when it is a seed", async () => {
    const screen = await open("classic");
    const text = screen.query<HTMLInputElement>("seed-text")!;
    const confirm = screen.query<HTMLButtonElement>("seed-confirm")!;
    text.value = "12a45";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(confirm.disabled).toBe(true);
    text.value = "12345";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(confirm.disabled).toBe(false);
    confirm.click();
    expect(screen.network.calls).toContain("pickSeed:12345");
  });

  it("goes back to Random from the editor", async () => {
    const screen = await open(48213);
    screen.query<HTMLButtonElement>("seed-random")!.click();
    expect(screen.network.calls).toContain("pickSeed:random");
  });

  it("shows an entered seed as its code, as a reload finds it, and is still once locked", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(withSeed(48213, true));
    const chip = screen.query<HTMLButtonElement>("seed-chip")!;
    expect(chip.textContent).toContain("#048213");
    expect(chip.disabled).toBe(true);
  });

  it("shows another player's seed in their row when it is not Random", async () => {
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("stage", { picks: { [LOCAL_ID]: { focus: "rooftops", locked: false, seed: "random" as const }, [REMOTE_ID]: { focus: "snow-shrine", locked: false, seed: 7 } } }));
    expect(screen.queryAll("player-row")[1]!.textContent).toContain("Snow Shrine · #000007");
  });

  it("shows no seed number under the reveal's stage name once it lands", async () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    const screen = await lobby({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(select("stageReveal", { stage: { id: "rooftops", pickedBy: LOCAL_ID, seed: 48213, classic: false } }));
    expect(screen.query("roulette-seed")).toBeNull();
    expect(screen.query("roulette-fill-seed")).toBeNull();
  });
});
