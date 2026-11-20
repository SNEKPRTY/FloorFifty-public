import { flushSync } from "svelte";
import { describe, expect, it, vi } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { GameEndScreen } from "../../../../apps/client/src/features/results/game-end";
import { ProgressStore } from "../../../../apps/client/src/features/profile/store/progress.svelte";
import { gameEndWithSnapshot } from "../../support/fakes/screens";
import { installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import { fakeSettings } from "../../support/fakes/settings";
import { FakeAudio } from "../../support/fakes/audio";
import { fakeContentPort, shippedContentPort } from "../../support/fakes/content";
import { FakeNetwork } from "../../support/fakes/network";
import { fakeContext } from "../../support/fakes/screens";
import { fakeStage } from "../../support/fakes/stage";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { deflateReplaySync } from "../../../../apps/server/src/rooms/replay-compression";
import { runRoomLike } from "../../../server/support/room-like";
import { contentFor } from "../replay/replay-content";
import { tiedResults } from "../../../../apps/client/src/features/race/results";
import * as m from "../../../../apps/client/src/paraglide/messages.js";

const finishedSnapshot = (overrides: Parameters<typeof snapshotAt>[1] = {}) =>
  snapshotAt(TICK_HZ * 40, {
    phase: "finished",
    players: [
      playerSnapshot({ id: LOCAL_ID, name: "Kite", finishedAtTick: TICK_HZ * 39 }),
      playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", finishedAtTick: TICK_HZ * 30 }),
    ],
    standings: [REMOTE_ID, LOCAL_ID],
    winnerId: REMOTE_ID,
    ...overrides,
  });

describe("the results music", () => {
  const shipped = () =>
    parseGameContentArtifact(
      JSON.parse(readFileSync(resolve(process.cwd(), "content/generated/content.json"), "utf8")),
    );

  it("plays the room's song's results section once, and stops it on leaving", async () => {
    const audio = new FakeAudio();
    const network = new FakeNetwork();
    network.emitSnapshot(finishedSnapshot({ songId: "chrome-in-the-rain" }));
    const screen = new GameEndScreen();
    await screen.enter(fakeContext({ audio, network, content: fakeContentPort(shipped()) }));
    expect(audio.calls).toContain("load:song-chrome-in-the-rain");
    expect(audio.calls).toContain("section:music.chromeInTheRain:79000:96000");

    screen.exit();
    expect(audio.calls.at(-1)).toBe("stop:");
  });

  it("stays quiet for a song with no results section", async () => {
    const audio = new FakeAudio();
    const network = new FakeNetwork();
    network.emitSnapshot(finishedSnapshot({ songId: "chrome-in-the-rain" }));
    const content = shipped();
    const songs = content.content.songs.map(({ resultsStartMs: _s, resultsEndMs: _e, ...song }) => song);
    const screen = new GameEndScreen();
    await screen.enter(
      fakeContext({ audio, network, content: fakeContentPort({ ...content, content: { ...content.content, songs } }) }),
    );
    expect(audio.calls.some((call) => call.startsWith("section:"))).toBe(false);
    screen.exit();
  });

  it("plays the song the room raced, read from the snapshot", async () => {
    const audio = new FakeAudio();
    const network = new FakeNetwork();
    network.emitSnapshot(finishedSnapshot({ songId: "moving-on" }));
    const content = shipped();
    const movingOn = content.content.songs.find((song) => song.id === "moving-on")!;
    const screen = new GameEndScreen();
    await screen.enter(fakeContext({ audio, network, content: fakeContentPort(content) }));
    expect(audio.calls).toContain(`section:${movingOn.audioAlias}:${movingOn.resultsStartMs}:${movingOn.resultsEndMs}`);
    screen.exit();
  });
});

describe("race results", () => {
  it("owns one refracted backdrop for exactly the results lifetime", async () => {
    const stage = fakeStage();
    const network = new FakeNetwork();
    network.emitSnapshot(finishedSnapshot());
    const screen = new GameEndScreen();
    await screen.enter(fakeContext({ stage, network }));

    expect(
      stage.ui.children.filter((child) => child.label === "non-gameplay-backdrop"),
    ).toHaveLength(1);
    screen.exit();
    expect(
      stage.ui.children.filter((child) => child.label === "non-gameplay-backdrop"),
    ).toHaveLength(0);
  });

  it("shows server standings and does not recompute a client winner", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot());
    expect(gameEnd.screen.winnerName()).toBe("Ninja Two");
    expect(gameEnd.query("winner")?.textContent).toBe("Ninja Two wins");
  });

  it("orders rows by the server's standings, not by time", async () => {
    // The standings deliberately disagree with the finish times: the client
    // must follow the server's order rather than sorting for itself.
    const gameEnd = await gameEndWithSnapshot(
      finishedSnapshot({ standings: [LOCAL_ID, REMOTE_ID], winnerId: LOCAL_ID }),
    );
    expect(gameEnd.screen.results().map((player) => player.name)).toEqual(["Kite", "Ninja Two"]);
  });

  it("says nothing about a winner the server did not name", async () => {
    const gameEnd = await gameEndWithSnapshot(
      snapshotAt(10, { phase: "finished", standings: [], players: [playerSnapshot()] }),
    );
    expect(gameEnd.screen.winnerName()).toBeUndefined();
    expect(gameEnd.query("winner")?.textContent).toBe("Race over");
  });

  it("shows each finisher's completion time", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot());
    const times = gameEnd.queryAll("result-row").map((row) => row.lastElementChild?.textContent);
    expect(times).toEqual(["0:30.00", "0:39.00"]);
  });

  it("marks racers who finished on the same tick as tied, keeping the server's order and winner", async () => {
    const gameEnd = await gameEndWithSnapshot(
      finishedSnapshot({
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite", finishedAtTick: TICK_HZ * 30 }),
          playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", finishedAtTick: TICK_HZ * 30 }),
        ],
      }),
    );
    const rows = gameEnd.queryAll("result-row");
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual(["1", "2"]);
    expect(rows.map((row) => row.querySelector('[data-testid="result-tie"]')?.textContent)).toEqual(["Tie", "Tie"]);
    expect(gameEnd.query("winner")?.textContent).toBe("Ninja Two wins");
  });

  it("marks no tie between different times, nor for a racer who did not start", async () => {
    const apart = await gameEndWithSnapshot(finishedSnapshot());
    expect(apart.queryAll("result-tie")).toHaveLength(0);
    const dns = await gameEndWithSnapshot(
      finishedSnapshot({
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite", finishedAtTick: TICK_HZ * 39 }),
          playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", status: "dns" }),
        ],
        standings: [LOCAL_ID],
        winnerId: LOCAL_ID,
      }),
    );
    expect(dns.queryAll("result-tie")).toHaveLength(0);
  });

  it("marks Infinite racers tied when they reached the same best floor on the same tick", async () => {
    const tuning = { ...finishedSnapshot().tuning, RACE_TIME_LIMIT_TICKS: 10_800 };
    const infinite = (remoteAt: number) =>
      gameEndWithSnapshot(
        finishedSnapshot({
          modeId: "infinite",
          tuning,
          players: [
            playerSnapshot({ id: LOCAL_ID, name: "Kite", finishedAtTick: 10_800, bestFloor: 12, bestFloorAtTick: TICK_HZ * 90 }),
            playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", finishedAtTick: 10_800, bestFloor: 12, bestFloorAtTick: remoteAt }),
          ],
          standings: [LOCAL_ID, REMOTE_ID],
          winnerId: LOCAL_ID,
        }),
      );
    expect((await infinite(TICK_HZ * 90)).queryAll("result-tie")).toHaveLength(2);
    // Same finish tick (the clock), but one reached floor 12 first: not a tie.
    expect((await infinite(TICK_HZ * 95)).queryAll("result-tie")).toHaveLength(0);
  });

  it("labels a player who did not start rather than placing them", async () => {
    const gameEnd = await gameEndWithSnapshot(
      finishedSnapshot({
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite", finishedAtTick: TICK_HZ * 39 }),
          playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", status: "dns" }),
        ],
        standings: [LOCAL_ID],
        winnerId: LOCAL_ID,
      }),
    );

    const rows = gameEnd.queryAll("result-row");
    expect(rows[1]?.getAttribute("data-status")).toBe("dns");
    expect(rows[1]?.lastElementChild?.textContent).toBe("Did not start");
    expect(rows[1]?.firstElementChild?.textContent).toBe("—");
  });

  // Audit S12: a racer who finished and then left the results stays in the room
  // as a DNS row. A player reads "DNS" as "did not start", so the row must read as
  // the finished row it is, with its place and its time.
  it("shows a racer who finished and then left as a finished row, not as DNS", async () => {
    const gameEnd = await gameEndWithSnapshot(
      finishedSnapshot({
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite", finishedAtTick: TICK_HZ * 39 }),
          playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", status: "dns", finishedAtTick: TICK_HZ * 30 }),
        ],
        standings: [REMOTE_ID, LOCAL_ID],
        winnerId: REMOTE_ID,
      }),
    );

    const rows = gameEnd.queryAll("result-row");
    expect(rows[0]?.firstElementChild?.textContent).toBe("1");
    expect(rows[0]?.lastElementChild?.textContent).toBe("0:30.00");
    expect(rows[0]?.textContent).not.toContain("DNS");
    expect(rows[1]?.firstElementChild?.textContent).toBe("2");
  });

  it("shows a Survival racer who stood to the clock and then left by their best floor, not as DNS", async () => {
    const gameEnd = await gameEndWithSnapshot(
      finishedSnapshot({
        tuning: { ...finishedSnapshot().tuning, RACE_TIME_LIMIT_TICKS: TICK_HZ * 60 },
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite", finishedAtTick: TICK_HZ * 60, bestFloor: 12, bestFloorAtTick: TICK_HZ * 40 }),
          playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", status: "dns", finishedAtTick: TICK_HZ * 60, bestFloor: 15, bestFloorAtTick: TICK_HZ * 50 }),
        ],
        standings: [REMOTE_ID, LOCAL_ID],
        winnerId: REMOTE_ID,
      }),
    );

    const rows = gameEnd.queryAll("result-row");
    expect(rows[0]?.querySelector("[data-testid='result-best']")).not.toBeNull();
    expect(rows[0]?.textContent).not.toContain("DNS");
  });

  it("names the mode in the header (race-options spec §5.5)", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot({ modeId: "floors-50" }), { content: shippedContentPort() });
    expect(gameEnd.query("results-mode")?.textContent).toBe("50 floors");
  });

  it.each(["w", "s", "a"])("says the whole winner line when the winner is named %j", async (name) => {
    const gameEnd = await gameEndWithSnapshot(
      finishedSnapshot({
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite", finishedAtTick: TICK_HZ * 39 }),
          playerSnapshot({ id: REMOTE_ID, name, finishedAtTick: TICK_HZ * 30 }),
        ],
      }),
    );
    expect(gameEnd.query("winner")?.textContent?.trim()).toBe(m.results_winner({ name }));
    gameEnd.screen.exit();
  });

  it("shows no seed on results (Task 26)", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot({ seed: 48213 }), { content: shippedContentPort() });
    expect(gameEnd.query("results-seed")).toBeNull();
  });

  it("uses the same three labels on every size", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot(), { content: shippedContentPort() });
    const buttons = [...(gameEnd.query("results-actions")?.querySelectorAll<HTMLButtonElement>("[data-row='visible'] button") ?? [])];
    expect(buttons.map((b) => b.textContent)).toEqual(["Race again", "Watch replay", "Return to menu"]);
    expect(buttons.every((b) => !b.hasAttribute("data-short-label"))).toBe(true);
  });

  it("shows a floors racer who did not finish their best floor, not a dash", async () => {
    const gameEnd = await gameEndWithSnapshot(
      finishedSnapshot({
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite", bestFloor: 12 }),
          playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", finishedAtTick: TICK_HZ * 30 }),
        ],
      }),
      { content: shippedContentPort() },
    );
    const rows = gameEnd.queryAll("result-row");
    expect(rows[1]?.textContent).toContain("Floor 12");
  });

  it("shows each Infinite racer's best floor and when, and never places a DNS, though the clock lists it", async () => {
    const tuning = { ...finishedSnapshot().tuning, COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 };
    const gameEnd = await gameEndWithSnapshot(
      finishedSnapshot({
        modeId: "infinite",
        tuning,
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite", finishedAtTick: 10_800, bestFloor: 31, bestFloorAtTick: TICK_HZ * 100 }),
          playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", status: "dns" }),
        ],
        standings: [LOCAL_ID, REMOTE_ID],
        winnerId: LOCAL_ID,
      }),
      { content: shippedContentPort() },
    );
    expect(gameEnd.query("results-mode")?.textContent).toBe("Survival");
    const rows = gameEnd.queryAll("result-row");
    expect(rows[0]?.querySelector('[data-testid="result-best"]')?.textContent).toBe("Floor 31 · 1:40.00");
    expect(rows[1]?.lastElementChild?.textContent).toBe("Did not start");
    expect(rows[1]?.firstElementChild?.textContent).toBe("—");
  });

  it("shows when a Survival racer went out, after the one left standing (survival spec §7)", async () => {
    const tuning = { ...finishedSnapshot().tuning, COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 };
    const gameEnd = await gameEndWithSnapshot(
      finishedSnapshot({
        modeId: "infinite",
        tuning,
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite", finishedAtTick: TICK_HZ * 40, bestFloor: 22, bestFloorAtTick: TICK_HZ * 30 }),
          playerSnapshot({ id: REMOTE_ID, name: "Wren", finishedAtTick: TICK_HZ * 25, outAtTick: TICK_HZ * 25, bestFloor: 14, bestFloorAtTick: TICK_HZ * 10 }),
        ],
        standings: [LOCAL_ID, REMOTE_ID],
        winnerId: LOCAL_ID,
      }),
      { content: shippedContentPort() },
    );
    const rows = gameEnd.queryAll("result-row");
    expect(rows[0]?.querySelector('[data-testid="result-best"]')?.textContent).toBe("Floor 22 · 0:30.00");
    expect(rows[1]?.querySelector('[data-testid="result-best"]')?.textContent).toBe("Floor 14 · out 0:25.00");
  });

  it("keeps a Survival racer's place and fall when they left after going out (survival spec §4)", async () => {
    const tuning = { ...finishedSnapshot().tuning, COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 };
    const gameEnd = await gameEndWithSnapshot(
      finishedSnapshot({
        modeId: "infinite",
        tuning,
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite", finishedAtTick: TICK_HZ * 40, bestFloor: 22 }),
          playerSnapshot({ id: REMOTE_ID, name: "Wren", status: "dns", finishedAtTick: TICK_HZ * 25, outAtTick: TICK_HZ * 25, bestFloor: 14, bestFloorAtTick: TICK_HZ * 10 }),
        ],
        standings: [LOCAL_ID, REMOTE_ID],
        winnerId: LOCAL_ID,
      }),
      { content: shippedContentPort() },
    );
    const rows = gameEnd.queryAll("result-row");
    expect(rows[1]?.querySelector('[data-testid="result-best"]')?.textContent).toBe("Floor 14 · out 0:25.00");
    expect(rows[1]?.firstElementChild?.textContent).toBe("2");
  });

  it("does not call two out racers tied on a floor when they went out apart", () => {
    const tuning = { ...finishedSnapshot().tuning, RACE_TIME_LIMIT_TICKS: 10_800 };
    const snapshot = finishedSnapshot({
      modeId: "infinite",
      tuning,
      players: [
        playerSnapshot({ id: LOCAL_ID, finishedAtTick: 900, outAtTick: 900, bestFloor: 9, bestFloorAtTick: 300 }),
        playerSnapshot({ id: REMOTE_ID, finishedAtTick: 1200, outAtTick: 1200, bestFloor: 9, bestFloorAtTick: 300 }),
      ],
      standings: [REMOTE_ID, LOCAL_ID],
      winnerId: REMOTE_ID,
    });
    expect(tiedResults(snapshot).size).toBe(0);
  });

  it("shows Floor 0 for an Infinite racer who never climbed", async () => {
    const tuning = { ...finishedSnapshot().tuning, RACE_TIME_LIMIT_TICKS: 10_800 };
    const gameEnd = await gameEndWithSnapshot(
      finishedSnapshot({
        modeId: "infinite",
        tuning,
        players: [playerSnapshot({ id: LOCAL_ID, name: "Kite", finishedAtTick: 10_800 })],
        standings: [LOCAL_ID],
        winnerId: LOCAL_ID,
      }),
    );
    expect(gameEnd.query("result-best")?.textContent).toBe("Floor 0");
  });
});

/**
 * Both exits publish a `settled` event, after their network call has resolved
 * or entered its documented recovery path. The screen names no destination:
 * the authored graph sends both to the menu.
 */

describe("the results layout (ui layout spec §6.8)", () => {
  it("is a screen frame whose Mute sits in the corner, not in the action bar", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot());
    const root = gameEnd.query("game-end")!;
    expect(root.hasAttribute("data-screen-frame")).toBe(true);
    expect(root.querySelector("[data-corner-controls]")).not.toBeNull();
    const bar = gameEnd.query("results-actions")!;
    expect(bar.hasAttribute("data-action-bar")).toBe(true);
    expect(bar.querySelector('[data-testid="corner-mute"]')).toBeNull();
    expect(root.querySelectorAll('[data-testid="corner-mute"]')).toHaveLength(1);
    gameEnd.screen.exit();
  });

  it("keeps four standings rows before the actions take any height", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot());
    const list = gameEnd.query("results-list")!;
    expect(list.getAttribute("data-min-rows")).toBe("4");
    expect(list.hasAttribute("data-scroll-region")).toBe(true);
    expect(list.querySelectorAll('[data-testid="result-row"][data-row]')).toHaveLength(2);
    gameEnd.screen.exit();
  });

  it("orders the actions Race again, Watch replay, Return to menu, one label each on every size", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot());
    const ids = [...gameEnd.query("results-actions")!.querySelectorAll("button")].map((button) => button.dataset["testid"]);
    expect(ids).toEqual(["race-again", "watch-replay", "return-to-menu"]);
    expect(gameEnd.query("race-again")?.getAttribute("data-kind")).toBe("primary");
    expect(gameEnd.query("watch-replay")?.hasAttribute("data-short-label")).toBe(false);
    expect(gameEnd.query("return-to-menu")?.hasAttribute("data-short-label")).toBe(false);
    gameEnd.screen.exit();
  });

  it("sets the mode as a plain line, in the catalog's own words", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot({ modeId: "floors-50" }), { content: shippedContentPort() });
    const mode = gameEnd.query("results-mode")!;
    expect(mode.classList.contains("ff-mode-chip")).toBe(false);
    expect(mode.textContent).toBe("50 floors");
    gameEnd.screen.exit();
  });

  it("names each racer with the one name pill, and marks this player's row (a 2 px edge) when they are the winner", async () => {
    // This device is the winner's: the store's local player is LOCAL_ID.
    const network = new FakeNetwork();
    network.localPlayerId = LOCAL_ID;
    const gameEnd = await gameEndWithSnapshot(
      finishedSnapshot({ standings: [LOCAL_ID, REMOTE_ID], winnerId: LOCAL_ID }),
      { network },
    );
    const pills = gameEnd.queryAll("result-name") as HTMLElement[];
    // The root's text is the name alone: the colour dot is an empty aria-hidden span.
    expect(pills.map((pill) => pill.textContent?.trim())).toEqual(["Kite", "Ninja Two"]);
    expect(pills[0]?.querySelector("[data-truncatable]")).not.toBeNull();
    // This player won: their row carries the 2 px edge (no box around the pill); the other racer's does not.
    const rows = gameEnd.queryAll("result-row") as HTMLElement[];
    expect(rows[0]?.dataset["self"]).toBe("true");
    expect(rows[1]?.dataset["self"]).toBeUndefined();
    expect(pills[0]?.dataset["self"]).toBeUndefined();
    gameEnd.screen.exit();
  });
});

describe("watching the replay (race-options spec §7.1)", () => {
  const race = runRoomLike({ tuning: resolveTuning(), seats: 2 });
  const bytes = deflateReplaySync(race.replay);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("disables Watch replay with a reason until a replay arrives", async () => {
    const network = new FakeNetwork();
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot(), { network, content: fakeContentPort(contentFor(race.replay)) });
    expect(gameEnd.query<HTMLButtonElement>("watch-replay")?.disabled).toBe(true);
    expect(gameEnd.query("replay-unavailable")?.textContent).toBe("The replay is not ready yet.");
    network.deliverReplay(bytes);
    expect(gameEnd.query<HTMLButtonElement>("watch-replay")?.disabled).toBe(false);
    expect(gameEnd.query("replay-unavailable")).toBeNull();
    gameEnd.screen.exit();
  });

  it("asks for the replay once on a reload into results", async () => {
    const network = new FakeNetwork();
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot(), { network });
    network.emitSnapshot(finishedSnapshot({ tick: TICK_HZ * 41 }));
    expect(network.calls.filter((call) => call === "getReplay")).toHaveLength(1);
    gameEnd.screen.exit();
  });

  it("asks again after a refused ask, at most once a second and three times in all (audit remediation B5)", async () => {
    const network = new FakeNetwork();
    network.refuseReplayAsks = 10;
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot(), { network });
    const asks = () => network.calls.filter((call) => call === "getReplay").length;
    await settle();
    expect(asks()).toBe(1);
    network.emitSnapshot(finishedSnapshot({ tick: TICK_HZ * 40 + 10 }));
    await settle();
    expect(asks()).toBe(1);
    for (let second = 1; second <= 5; second += 1) {
      network.emitSnapshot(finishedSnapshot({ tick: TICK_HZ * (40 + second) }));
      await settle();
    }
    expect(asks()).toBe(3);
    expect(gameEnd.query("replay-unavailable")).not.toBeNull();
    gameEnd.screen.exit();
  });

  it("stops asking once an ask is accepted", async () => {
    const network = new FakeNetwork();
    network.refuseReplayAsks = 1;
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot(), { network });
    await settle();
    network.emitSnapshot(finishedSnapshot({ tick: TICK_HZ * 41 }));
    await settle();
    network.emitSnapshot(finishedSnapshot({ tick: TICK_HZ * 42 }));
    await settle();
    expect(network.calls.filter((call) => call === "getReplay")).toHaveLength(2);
    gameEnd.screen.exit();
  });

  it("does not ask when the replay is already here", async () => {
    const network = new FakeNetwork();
    network.replay = bytes;
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot(), { network });
    expect(network.calls).not.toContain("getReplay");
    gameEnd.screen.exit();
  });

  it("opens the replay when it can play it", async () => {
    const network = new FakeNetwork();
    network.replay = bytes;
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot(), { network, content: fakeContentPort(contentFor(race.replay)) });
    gameEnd.query<HTMLButtonElement>("watch-replay")!.click();
    for (let i = 0; i < 20 && gameEnd.lastPublished() !== "ui.watch-replay"; i += 1) await settle();
    expect(gameEnd.lastPublished()).toBe("ui.watch-replay");
    gameEnd.screen.exit();
  });

  it("opens the replay once for a double tap", async () => {
    const network = new FakeNetwork();
    network.replay = bytes;
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot(), { network, content: fakeContentPort(contentFor(race.replay)) });
    const watch = gameEnd.query<HTMLButtonElement>("watch-replay")!;
    watch.click();
    watch.click();
    for (let i = 0; i < 40; i += 1) await settle();
    expect(gameEnd.publishedEvents().filter((event) => event.name === "ui.watch-replay")).toHaveLength(1);
    gameEnd.screen.exit();
  });

  it("refuses a replay from another version on Results, and stays", async () => {
    const network = new FakeNetwork();
    network.replay = bytes;
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot(), { network, content: shippedContentPort() });
    gameEnd.query<HTMLButtonElement>("watch-replay")!.click();
    for (let i = 0; i < 20 && gameEnd.query("replay-refused") === null; i += 1) await settle();
    expect(gameEnd.query("replay-refused")?.textContent).toBe("This replay was made with a different version of the game");
    expect(gameEnd.publishedEvents().map((event) => event.name)).not.toContain("ui.watch-replay");
    gameEnd.screen.exit();
  });

  it("re-words the refusal when the language changes", async () => {
    const settings = fakeSettings();
    const undo = installLocaleStrategy(settings, () => ["en-US"]);
    const network = new FakeNetwork();
    network.replay = bytes;
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot(), { network, settings, content: shippedContentPort() });
    try {
      gameEnd.query<HTMLButtonElement>("watch-replay")!.click();
      for (let i = 0; i < 20 && gameEnd.query("replay-refused") === null; i += 1) await settle();
      expect(gameEnd.query("replay-refused")?.textContent).toBe("This replay was made with a different version of the game");
      settings.update({ locale: "ja" });
      flushSync();
      expect(gameEnd.query("replay-refused")?.textContent).toBe(m.replay_version_mismatch({}, { locale: "ja" }));
    } finally {
      settings.update({ locale: null });
      undo();
      gameEnd.screen.exit();
    }
  });
});

describe("leaving the results", () => {
  it("keeps the room open on Race Again and reports it settled", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot());
    gameEnd.query<HTMLButtonElement>("race-again")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(gameEnd.network.calls).toContain("raceAgain");
    expect(gameEnd.network.calls).not.toContain("leaveRoom");
    expect(gameEnd.lastPublished()).toBe("ui.race-again-settled");
  });

  it("releases the room on Return to Menu", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot());
    gameEnd.query<HTMLButtonElement>("return-to-menu")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(gameEnd.network.calls).toContain("leaveRoom");
    expect(gameEnd.lastPublished()).toBe("ui.return-to-menu-settled");
  });

  it("still reports settled if the room refuses another race", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot());
    gameEnd.network.nextFailure = { code: "ROOM_CLOSED", message: "the room closed" };
    gameEnd.query<HTMLButtonElement>("race-again")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(gameEnd.lastPublished()).toBe("ui.race-again-settled");
  });

  it("re-renders when a later snapshot arrives", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot());
    gameEnd.network.emitSnapshot(
      finishedSnapshot({ winnerId: asPlayerId(LOCAL_ID), standings: [LOCAL_ID, REMOTE_ID] }),
    );
    expect(gameEnd.query("winner")?.textContent).toBe("Kite wins");
  });

  it("removes its DOM on exit", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot());
    gameEnd.screen.exit();
    expect(gameEnd.query("game-end")).toBeNull();
  });
});

describe("surviving the snapshot stream", () => {
  // The room clock runs in every phase, so a finished room keeps broadcasting
  // at 20 Hz while the results are on screen. Rebuilding the actions on each
  // one destroys the button under the player's finger, and the press is lost.
  it("keeps the race-again button across an ordinary snapshot", async () => {
    const snapshot = finishedSnapshot();
    const view = await gameEndWithSnapshot(snapshot);

    const before = view.query<HTMLButtonElement>("race-again");
    view.network.emitSnapshot({ ...snapshot, tick: snapshot.tick + 3 });

    expect(view.query<HTMLButtonElement>("race-again")).toBe(before);
  });

  it("keeps the return-to-menu button across an ordinary snapshot", async () => {
    const snapshot = finishedSnapshot();
    const view = await gameEndWithSnapshot(snapshot);

    const before = view.query<HTMLButtonElement>("return-to-menu");
    view.network.emitSnapshot({ ...snapshot, tick: snapshot.tick + 3 });

    expect(view.query<HTMLButtonElement>("return-to-menu")).toBe(before);
  });

  it("keeps the pressed button in the document so its click can fire", async () => {
    const snapshot = finishedSnapshot();
    const view = await gameEndWithSnapshot(snapshot);

    const pressed = view.query<HTMLButtonElement>("race-again")!;
    view.network.emitSnapshot({ ...snapshot, tick: snapshot.tick + 3 });

    expect(document.contains(pressed)).toBe(true);
  });

  it("still shows what the newest snapshot says", async () => {
    const snapshot = finishedSnapshot();
    const view = await gameEndWithSnapshot(snapshot);

    const later = {
      ...snapshot,
      tick: snapshot.tick + 3,
      players: snapshot.players.map((player) => ({ ...player, name: `${player.name}!` })),
    };
    view.network.emitSnapshot(later);

    expect(view.query<HTMLElement>("game-end")?.textContent).toContain("!");
  });
});

describe("result portraits", () => {
  it("shows the winner's win portrait and everyone else's lose portrait, a DNS racer included", async () => {
    const snapshot = snapshotAt(TICK_HZ * 40, {
      phase: "finished",
      players: [
        playerSnapshot({ id: LOCAL_ID, name: "Kite", finishedAtTick: TICK_HZ * 39 }),
        playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", status: "dns", colour: "cyan" }),
      ],
      standings: [LOCAL_ID],
      winnerId: LOCAL_ID,
    });
    const gameEnd = await gameEndWithSnapshot(snapshot);
    const portraits = gameEnd.queryAll("result-portrait") as HTMLImageElement[];

    expect(portraits).toHaveLength(2);
    // The player's colour decides the portrait's colour, standings the mood.
    expect(portraits[0]!.getAttribute("src")).toBe("/assets/portrait.scarletWin");
    expect(portraits[1]!.getAttribute("src")).toBe("/assets/portrait.cyanLose");
    // Decorative: the name beside it says who it is.
    for (const portrait of portraits) expect(portrait.getAttribute("alt")).toBe("");
  });
});

describe("unlocks at results (unlockables spec §5.2)", () => {
  const shipped = () =>
    parseGameContentArtifact(
      JSON.parse(readFileSync(resolve(process.cwd(), "content/generated/content.json"), "utf8")),
    );

  it("judges the results once on entry and holds the grant for the banner", async () => {
    const content = shipped();
    const progress = new ProgressStore(undefined, () => content.content);
    const network = new FakeNetwork();
    network.localPlayerId = LOCAL_ID;
    network.emitSnapshot(finishedSnapshot({ roomSeed: 5, round: 1 }));

    const screen = new GameEndScreen();
    await screen.enter(fakeContext({ network, progress, content: fakeContentPort(content) }));
    expect(progress.unlocked("any-match")).toBe(true);
    expect(screen.unlock()).toMatchObject({ kind: "song", id: "crash-mode" });
    screen.exit();

    // A reload that lands on the same results judges nothing again.
    const again = new GameEndScreen();
    await again.enter(fakeContext({ network, progress, content: fakeContentPort(content) }));
    expect(again.unlock()).toBeUndefined();
    expect(progress.value.stats.matchesFinished).toBe(1);
    again.exit();
  });

  it("judges the finished race even when another seat's Race again has already taken the room back to the lobby", async () => {
    const content = shipped();
    const progress = new ProgressStore(undefined, () => content.content);
    const network = new FakeNetwork();
    network.localPlayerId = LOCAL_ID;
    network.emitSnapshot(finishedSnapshot({ roomSeed: 5, round: 1 }));
    network.emitSnapshot(finishedSnapshot({ phase: "lobby", roomSeed: 5, round: 2 }));

    const screen = new GameEndScreen();
    await screen.enter(fakeContext({ network, progress, content: fakeContentPort(content) }));
    expect(progress.value.counted).toEqual(["5:1"]);
    expect(screen.unlock()).toMatchObject({ kind: "song", id: "crash-mode" });
    screen.exit();
  });

  it("leaves the race unjudged while this seat is unknown, so results that learn it later still count it", async () => {
    const content = shipped();
    const progress = new ProgressStore(undefined, () => content.content);
    const network = new FakeNetwork();
    network.localPlayerId = undefined;
    network.emitSnapshot(finishedSnapshot({ roomSeed: 5, round: 1 }));
    const unknown = new GameEndScreen();
    await unknown.enter(fakeContext({ network, progress, content: fakeContentPort(content) }));
    expect(progress.value.counted).toEqual([]);
    unknown.exit();

    network.localPlayerId = LOCAL_ID;
    const known = new GameEndScreen();
    await known.enter(fakeContext({ network, progress, content: fakeContentPort(content) }));
    expect(progress.value.counted).toEqual(["5:1"]);
    expect(progress.value.stats.matchesFinished).toBe(1);
    known.exit();
  });

  it("judges nothing for a room that is not finished", async () => {
    const content = shipped();
    const progress = new ProgressStore(undefined, () => content.content);
    const network = new FakeNetwork();
    network.localPlayerId = LOCAL_ID;
    network.emitSnapshot(finishedSnapshot({ phase: "racing" }));
    const screen = new GameEndScreen();
    await screen.enter(fakeContext({ network, progress, content: fakeContentPort(content) }));
    expect(screen.unlock()).toBeUndefined();
    expect(progress.value.counted).toEqual([]);
    screen.exit();
  });

  it("shows the banner over the results, Race again stays usable under it, and the region announces once", async () => {
    const content = shipped();
    const progress = new ProgressStore(undefined, () => content.content);
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot({ roomSeed: 5, round: 1 }), {
      content: fakeContentPort(content),
      progress,
      localPlayerId: LOCAL_ID,
    });
    expect(gameEnd.query("unlock-banner")).not.toBeNull();
    expect(gameEnd.query("unlock-announcer")!.textContent).toBe("New song unlocked: Crash Mode");

    gameEnd.network.emitSnapshot(finishedSnapshot({ roomSeed: 5, round: 1, tick: TICK_HZ * 41 }));
    expect(gameEnd.query("unlock-announcer")!.textContent).toBe("New song unlocked: Crash Mode");

    gameEnd.query<HTMLButtonElement>("race-again")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gameEnd.network.calls).toContain("raceAgain");
    gameEnd.screen.exit();
  });

  it("previews a granted song and hands the slot back when the banner goes", async () => {
    const content = shipped();
    const progress = new ProgressStore(undefined, () => content.content);
    const audio = new FakeAudio();
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot({ roomSeed: 5, round: 1, songId: "chrome-in-the-rain" }), {
      content: fakeContentPort(content),
      progress,
      localPlayerId: LOCAL_ID,
      audio,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const crash = content.content.songs.find((song) => song.id === "crash-mode")!;
    expect(audio.calls).toContain("load:song-crash-mode");
    expect(audio.calls).toContain(`section:${crash.audioAlias}:${crash.previewStartMs}:${crash.previewEndMs}`);

    gameEnd.query<HTMLElement>("unlock-banner")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    flushSync();
    // The banner falls out (`Panel leave="fall"`): it is `inert` from its first exit frame and gone once the fall ends.
    expect(gameEnd.query("unlock-banner")!.querySelector<HTMLElement>(".ff-unlock-banner__plate")!.inert).toBe(true);
    await vi.waitFor(() => expect(gameEnd.query("unlock-banner")).toBeNull());
    expect(audio.calls.at(-1)).toMatch(/^section:music\.chromeInTheRain:/);
    gameEnd.screen.exit();
  });

  it("shows no banner when the round granted nothing", async () => {
    const gameEnd = await gameEndWithSnapshot(finishedSnapshot());
    expect(gameEnd.query("unlock-banner")).toBeNull();
    expect(gameEnd.query("unlock-announcer")!.textContent).toBe("");
    gameEnd.screen.exit();
  });
});
