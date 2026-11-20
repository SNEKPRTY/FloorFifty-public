/**
 * The Replay screen (race-options spec §7): the race just finished, watched
 * again on this device, with its cues, its controls, and an eye on the room.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { deflateReplaySync } from "../../../../apps/server/src/rooms/replay-compression";
import { GO_TICK, runRoomLike } from "../../../server/support/room-like";
import { FakeAudio } from "../../support/fakes/audio";
import { replayWithFakes } from "../../support/fakes/screens";
import { lobbySnapshot, snapshotAt } from "../../support/snapshots";
import { contentFor } from "./replay-content";
import { RaceScene } from "../../../../apps/client/src/features/race/race-scene";
import { RaceVideo } from "../../../../apps/client/src/features/net/race-video.svelte";
import { hudBottomOnRight } from "../../../../apps/client/src/features/replay/replay-video.svelte";
import { flushSync } from "svelte";

const race = runRoomLike({ tuning: resolveTuning(), seats: 2 });
const bytes = deflateReplaySync(race.replay);
const content = contentFor(race.replay);

afterEach(() => {
  document.body.innerHTML = "";
});

/** Frames until the replay holds on its last frame, or the guard runs out. */
function playToTheEnd(viewer: Awaited<ReturnType<typeof replayWithFakes>>): void {
  for (let guard = 0; guard < 400 && viewer.query("replay-watch-again") === null; guard += 1) viewer.frames(30);
}

describe("the Replay screen (race-options spec §7)", () => {
  it("stops the climb hum when it closes", { timeout: 30_000 }, async () => {
    // The hum is Infinite's alone: a short endless race reaches its last 30 s soon.
    const endless = runRoomLike({ tuning: resolveTuning({ COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 2_400 }), seats: 2 });
    const viewer = await replayWithFakes({ bytes: deflateReplaySync(endless.replay), content: contentFor(endless.replay) });
    const drones = (): string[] => viewer.audio.calls.filter((call) => call.startsWith("drone"));
    // Into the last stretch, where the hum starts, and out before the hold on the last frame cuts it.
    for (let guard = 0; guard < 400 && !drones().some((call) => call.startsWith("drone:")); guard += 1) viewer.frames(5);
    expect(drones().some((call) => call.startsWith("drone:"))).toBe(true);
    expect(viewer.query("replay-watch-again")).toBeNull();
    viewer.screen.exit();
    expect(drones().at(-1)).toBe("drone-stop");
  });

  it("a replay's cues sound though the live race already played them, and once per playthrough", { timeout: 30_000 }, async () => {
    const viewer = await replayWithFakes({ bytes, content });
    playToTheEnd(viewer);
    expect(viewer.query("replay-watch-again")).not.toBeNull();
    const cued = viewer.audio.calls.filter((call) => call.startsWith("cue:")).map((call) => call.split(":").slice(3).join(":"));
    const keyed = cued.filter((id) => id !== "");
    expect(keyed.length).toBeGreaterThan(0);
    // Every event cue is this playthrough's, so none collides with an ID the
    // engine already heard live: a live ID never starts "replay:".
    const prefix = /^replay:\d+:/.exec(keyed[0]!)![0];
    expect(keyed.every((id) => id.startsWith(prefix))).toBe(true);

    viewer.query<HTMLButtonElement>("replay-watch-again")!.click();
    // The bar gives Watch again back to the controls on the next frame.
    viewer.frames(1);
    expect(viewer.query("replay-watch-again")).toBeNull();
    playToTheEnd(viewer);
    const again = viewer.audio.calls
      .filter((call) => call.startsWith("cue:"))
      .map((call) => call.split(":").slice(3).join(":"))
      .filter((id) => id !== "" && !id.startsWith(prefix));
    expect(again.length).toBeGreaterThan(0);
    viewer.screen.exit();
  });

  it("plays though the browser has not let sound start yet", { timeout: 30_000 }, async () => {
    // A refused resume never settles; waiting on it held the replay behind the loader.
    const audio = new FakeAudio();
    audio.running = false;
    const viewer = await replayWithFakes({ bytes, content, audio });
    expect(audio.calls).toContain("unlock");
    expect(audio.calls.some((call) => call.startsWith("play:"))).toBe(true);
    viewer.screen.exit();
  });

  it("a second Watch replay sounds its cues too: no event ID is cued twice on one engine", { timeout: 30_000 }, async () => {
    const audio = new FakeAudio();
    const eventIds = (): string[] =>
      audio.calls
        .filter((call) => call.startsWith("cue:"))
        .map((call) => call.split(":").slice(3).join(":"))
        .filter((id) => id !== "");
    const first = await replayWithFakes({ bytes, content, audio });
    playToTheEnd(first);
    first.screen.exit();
    const heard = eventIds().length;
    const second = await replayWithFakes({ bytes, content, audio });
    playToTheEnd(second);
    second.screen.exit();
    const ids = eventIds();
    expect(ids.length).toBeGreaterThan(heard);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("hands every frame's re-keyed events to the juice as the room's, so its pops and bursts play (polish spec §4.1)", { timeout: 30_000 }, async () => {
    const noted = vi.spyOn(RaceScene.prototype, "noteRoomEvents");
    const viewer = await replayWithFakes({ bytes, content });
    try {
      playToTheEnd(viewer);
      const events = noted.mock.calls.flatMap(([batch]) => batch);
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((event) => event.id.startsWith("replay:"))).toBe(true);
    } finally {
      viewer.screen.exit();
      noted.mockRestore();
    }
  });

  it("plays to the recorded finish without drifting", { timeout: 30_000 }, async () => {
    const viewer = await replayWithFakes({ bytes, content });
    playToTheEnd(viewer);
    expect(viewer.screen.tick()).toBe(race.replay.finalTick);
    expect(viewer.query("replay-drift")).toBeNull();
    viewer.screen.exit();
  });

  it("says the room is back in the ready room, and exits there", async () => {
    const viewer = await replayWithFakes({ bytes, content });
    viewer.network.emitSnapshot(lobbySnapshot(2));
    viewer.frames(1);
    expect(viewer.query("replay-room-moved")?.textContent).toBe("Your room is back in the ready room");
    viewer.query<HTMLButtonElement>("replay-exit")!.click();
    expect(viewer.published()).toContain("ui.replay-exit-to-room");
    viewer.screen.exit();
  });

  it("the viewer leaves for the room when the room enters select", async () => {
    const viewer = await replayWithFakes({ bytes, content });
    viewer.network.emitSnapshot(snapshotAt(GO_TICK, { phase: "select" }));
    expect(viewer.published()).toEqual(["ui.replay-exit-to-room"]);
    viewer.screen.exit();
  });

  it("exits to results when the room has not moved, by Exit or Escape, once", async () => {
    const viewer = await replayWithFakes({ bytes, content });
    viewer.key("Escape");
    viewer.query<HTMLButtonElement>("replay-exit")!.click();
    expect(viewer.published()).toEqual(["ui.replay-exit"]);
    viewer.screen.exit();
  });

  it("goes back to results when there is no replay to play", async () => {
    const viewer = await replayWithFakes({ bytes: undefined, content });
    expect(viewer.published()).toEqual(["ui.replay-exit"]);
    viewer.screen.exit();
  });

  it("follows the next racer on →, wrapping, and names them", async () => {
    const viewer = await replayWithFakes({ bytes, content });
    viewer.frames(1);
    expect(viewer.query("replay-follow-name")?.textContent).toBe("Racer 1");
    viewer.key("ArrowRight");
    viewer.frames(1);
    expect(viewer.query("replay-follow-name")?.textContent).toBe("Racer 2");
    viewer.key("ArrowRight");
    viewer.frames(1);
    expect(viewer.query("replay-follow-name")?.textContent).toBe("Racer 1");
    viewer.screen.exit();
  });

  it("a solo replay has no one else to follow: the arrows leave the camera be", async () => {
    const solo = runRoomLike({ tuning: resolveTuning(), seats: 1 });
    const focusOn = vi.spyOn(RaceScene.prototype, "focusOn");
    try {
      const viewer = await replayWithFakes({ bytes: deflateReplaySync(solo.replay), content: contentFor(solo.replay) });
      viewer.frames(1);
      focusOn.mockClear();
      viewer.key("ArrowRight");
      viewer.key("ArrowLeft");
      viewer.frames(1);
      expect(focusOn).not.toHaveBeenCalled();
      viewer.screen.exit();
    } finally {
      focusOn.mockRestore();
    }
  });

  it("pauses the race and the song together, and speeds them together", async () => {
    const viewer = await replayWithFakes({ bytes, content });
    viewer.frames(10);
    const before = viewer.screen.tick();
    const song = viewer.audio.calls.find((call) => call.startsWith("play:"))!.slice("play:".length).split("@")[0]!;
    viewer.key(" ");
    viewer.frames(10);
    expect(viewer.screen.tick()).toBe(before);
    expect(viewer.audio.calls).toContain(`stop:${song}`);
    viewer.key(" ");
    expect(viewer.audio.calls.some((call) => call.startsWith(`play:${song}@`) && !call.endsWith("@0"))).toBe(true);
    viewer.key("s");
    expect(viewer.audio.calls).toContain("musicRate:2.00");
    viewer.screen.exit();
  });

  /** Moves the position bar as a drag would, to `seconds` from GO. */
  function drag(viewer: Awaited<ReturnType<typeof replayWithFakes>>, seconds: number): void {
    const bar = viewer.query<HTMLInputElement>("replay-progress")!;
    bar.value = String(seconds);
    bar.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /** Frames until the bar's seek has landed. */
  function land(viewer: Awaited<ReturnType<typeof replayWithFakes>>): void {
    for (let guard = 0; guard < 2_000 && viewer.screen.seeking(); guard += 1) viewer.frames(1);
    viewer.frames(1);
  }

  const songOf = (viewer: Awaited<ReturnType<typeof replayWithFakes>>): string =>
    viewer.audio.calls.find((call) => call.startsWith("play:"))!.slice("play:".length).split("@")[0]!;

  it("shows where the replay is on the bar, in seconds", async () => {
    const viewer = await replayWithFakes({ bytes, content });
    viewer.frames(120);
    const bar = viewer.query<HTMLInputElement>("replay-progress")!;
    expect(Number(bar.value)).toBe(2);
    expect(Number(bar.max)).toBe(Math.ceil((race.replay.finalTick - GO_TICK + 1) / 60));
    viewer.screen.exit();
  });

  it("stops the song while it seeks, and starts it again where the race landed", async () => {
    const viewer = await replayWithFakes({ bytes, content });
    viewer.frames(10);
    const song = songOf(viewer);
    drag(viewer, 5);
    expect(viewer.audio.playing()).toBeUndefined();
    land(viewer);
    expect(viewer.screen.tick()).toBeGreaterThanOrEqual(GO_TICK + 300);
    expect(viewer.audio.playing()).toBe(song);
    const resumed = viewer.audio.calls.filter((call) => call.startsWith(`play:${song}@`)).at(-1)!;
    expect(Number(resumed.split("@")[1])).toBeCloseTo(5_000, -2);
    viewer.screen.exit();
  });

  it("holds the replay while the bar is held, and plays on when it is let go", async () => {
    const viewer = await replayWithFakes({ bytes, content });
    viewer.frames(10);
    const bar = viewer.query<HTMLInputElement>("replay-progress")!;
    bar.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const held = viewer.screen.tick();
    viewer.frames(10);
    expect(viewer.screen.tick()).toBe(held);
    bar.dispatchEvent(new Event("pointerup", { bubbles: true }));
    viewer.frames(10);
    expect(viewer.screen.tick()).toBeGreaterThan(held!);
    viewer.screen.exit();
  });

  it("drags back from the end card into the race, which plays on from there", { timeout: 30_000 }, async () => {
    const viewer = await replayWithFakes({ bytes, content });
    playToTheEnd(viewer);
    expect(viewer.query("replay-watch-again")).not.toBeNull();
    drag(viewer, 1);
    land(viewer);
    expect(viewer.query("replay-watch-again")).toBeNull();
    const landed = viewer.screen.tick()!;
    expect(landed).toBeLessThan(GO_TICK + 120);
    viewer.frames(10);
    expect(viewer.screen.tick()).toBeGreaterThan(landed);
    viewer.screen.exit();
  });

  it("lets go of the finish's slow motion on the end card, so the song does not drone on slowed", { timeout: 30_000 }, async () => {
    const viewer = await replayWithFakes({ bytes, content });
    playToTheEnd(viewer);
    const slowed = viewer.audio.calls.filter((call) => call.startsWith("slowMusic:"));
    expect(slowed.some((call) => Number(call.split(":")[1]) < 1)).toBe(true);
    viewer.frames(30);
    expect(viewer.audio.calls.filter((call) => call.startsWith("slowMusic:")).at(-1)).toBe("slowMusic:1.00");
    // The replay's own speed never carries the finish: that is slowMusic's.
    expect(viewer.audio.calls.filter((call) => call.startsWith("musicRate:")).every((call) => call === "musicRate:1.00")).toBe(true);
    viewer.screen.exit();
  });

  it("ignores Space on the end card, rather than starting the song over a still race", { timeout: 30_000 }, async () => {
    const viewer = await replayWithFakes({ bytes, content });
    playToTheEnd(viewer);
    const before = viewer.audio.calls.length;
    viewer.key(" ");
    viewer.key(" ");
    expect(viewer.audio.calls.slice(before).filter((call) => call.startsWith("play:") || call.startsWith("stop:"))).toEqual([]);
    viewer.screen.exit();
  });

  it("leaves no render pass and no song behind, five times over", async () => {
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const viewer = await replayWithFakes({ bytes, content });
      viewer.frames(5);
      const song = viewer.audio.calls.find((call) => call.startsWith("play:"))!.slice("play:".length).split("@")[0]!;
      const before = viewer.audio.calls.length;
      viewer.screen.exit();
      expect(viewer.ticker.size).toBe(0);
      const onExit = viewer.audio.calls.slice(before);
      expect(onExit).toContain(`stop:${song}`);
      expect(onExit).toContain("musicRate:1.00");
      expect(viewer.overlay.querySelector('[data-testid="replay-controls"]')).toBeNull();
    }
  });

  it("drops the followed racer's landing when the scene slammed on that frame (Wonder spec §3.2)", { timeout: 30_000 }, async () => {
    // The followed racer's landings carry no event ID (`landingSounds`); a rival's are keyed by `cuesForEvents`.
    const landings = (viewer: Awaited<ReturnType<typeof replayWithFakes>>) =>
      viewer.audio.calls.filter((call) => call.startsWith("cue:sfx.land") && call.split(":").slice(3).join(":") === "").length;
    const plain = await replayWithFakes({ bytes, content });
    playToTheEnd(plain);
    expect(landings(plain)).toBeGreaterThan(0);
    plain.screen.exit();
    const slamming = vi.spyOn(RaceScene.prototype, "localSlammed", "get").mockReturnValue(true);
    const slammed = await replayWithFakes({ bytes, content });
    playToTheEnd(slammed);
    expect(landings(slammed)).toBe(0);
    slammed.screen.exit();
    slamming.mockRestore();
  });
});

describe("the announcer in a replay", () => {
  type Viewer = Awaited<ReturnType<typeof replayWithFakes>>;

  /** Frames until the finish's first call has been asked for. */
  function toTheFinish(viewer: Viewer): void {
    for (let guard = 0; guard < 400 && !viewer.audio.calls.some((call) => call.startsWith("cue:vo.game:")); guard += 1) viewer.frames(30);
    expect(viewer.audio.calls.some((call) => call.startsWith("cue:vo.game:"))).toBe(true);
  }

  /** The event IDs of the finish's lines queued behind GAME: the winner is, and their colour. */
  const queuedCalls = (viewer: Viewer): string[] =>
    viewer.audio.calls
      .filter((call) => call.startsWith("cue:vo.") && call.split(":")[2] === "voice" && !call.startsWith("cue:vo.game:"))
      .map((call) => call.split(":").slice(3).join(":"))
      .filter((id) => id.includes("raceFinished"));

  /**
   * Whether a cue stop or cancel the screen asked for since `from` covers
   * `eventId`. The fake records the music's `stop()` as a bare "stop:", which
   * stops no cue, so a prefix must name something.
   */
  const silenced = (viewer: Viewer, from: number, eventId: string): boolean =>
    viewer.audio.calls
      .slice(from)
      .filter((call) => call.startsWith("stop:") || call.startsWith("cancel:"))
      .map((call) => call.slice(call.indexOf(":") + 1))
      .some((prefix) => prefix !== "" && eventId.startsWith(prefix));

  it("stops the winner's calls when the viewer leaves mid-finish, so they are not said over the menu", { timeout: 120_000 }, async () => {
    const viewer = await replayWithFakes({ bytes, content });
    toTheFinish(viewer);
    const queued = queuedCalls(viewer);
    expect(queued.length).toBeGreaterThan(0);
    const from = viewer.audio.calls.length;
    viewer.screen.exit();
    for (const eventId of queued) expect(silenced(viewer, from, eventId), eventId).toBe(true);
  });

  it("stops the winner's calls when the viewer drags back into the race", { timeout: 120_000 }, async () => {
    const viewer = await replayWithFakes({ bytes, content });
    toTheFinish(viewer);
    const queued = queuedCalls(viewer);
    expect(queued.length).toBeGreaterThan(0);
    const from = viewer.audio.calls.length;
    const bar = viewer.query<HTMLInputElement>("replay-progress")!;
    bar.value = "1";
    bar.dispatchEvent(new Event("input", { bubbles: true }));
    for (let guard = 0; guard < 2_000 && viewer.screen.seeking(); guard += 1) viewer.frames(1);
    for (const eventId of queued) expect(silenced(viewer, from, eventId), eventId).toBe(true);
    viewer.screen.exit();
  });
});

describe("Save video and Share video (unlockables spec §6.4, amended)", () => {
  const recorded = { blob: new Blob([new Uint8Array([1])]), type: "video/mp4", extension: "mp4" as const, stageId: "rooftops", finishedAt: new Date() };

  it("are in the window, disabled with the reason until the race's video is there", async () => {
    const raceVideo = new RaceVideo();
    const viewer = await replayWithFakes({ bytes, content, raceVideo });
    expect(viewer.query<HTMLButtonElement>("replay-save-video")?.disabled).toBe(true);
    expect(viewer.query<HTMLButtonElement>("replay-share-video")?.disabled).toBe(true);
    expect(viewer.query("replay-video-unavailable")?.textContent).toBe("Video unavailable");
    raceVideo.keep(recorded);
    flushSync();
    expect(viewer.query<HTMLButtonElement>("replay-save-video")?.disabled).toBe(false);
    expect(viewer.query<HTMLButtonElement>("replay-share-video")?.getAttribute("aria-label")).toBe("Share video");
    expect(viewer.query("replay-video-unavailable")).toBeNull();
    viewer.screen.exit();
    expect(viewer.query("replay-video")).toBeNull();
  });

  it("are not on the bar, and stay when the end card replaces it", async () => {
    const raceVideo = new RaceVideo();
    raceVideo.keep(recorded);
    const viewer = await replayWithFakes({ bytes, content, raceVideo });
    expect(viewer.query("replay-actions")?.querySelector('[data-testid="replay-save-video"]')).toBeNull();
    playToTheEnd(viewer);
    expect(viewer.query("replay-watch-again")).not.toBeNull();
    expect(viewer.query("replay-save-video")).not.toBeNull();
    viewer.screen.exit();
  });

  it("sit under the lowest HUD element on the right, not under one on the left or mid-screen", () => {
    const overlay = document.createElement("div");
    overlay.innerHTML = `<div data-testid="race-hud"><div id="left"></div><div id="roster"></div><div id="toast"></div></div>`;
    document.body.append(overlay);
    const rect = (top: number, left: number, width: number, height: number) =>
      ({ top, left, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
    overlay.getBoundingClientRect = () => rect(0, 0, 1280, 720);
    overlay.querySelector<HTMLElement>('[data-testid="race-hud"]')!.getBoundingClientRect = () => rect(0, 0, 0, 0);
    overlay.querySelector<HTMLElement>("#left")!.getBoundingClientRect = () => rect(12, 12, 116, 300);
    overlay.querySelector<HTMLElement>("#roster")!.getBoundingClientRect = () => rect(84, 1072, 196, 152);
    overlay.querySelector<HTMLElement>("#toast")!.getBoundingClientRect = () => rect(500, 1100, 170, 40);
    expect(hudBottomOnRight(overlay)).toBe(236);
  });

  it("are not pushed off the screen by Survival's full-field vignette (survival spec §7)", () => {
    const overlay = document.createElement("div");
    overlay.innerHTML = `<div data-testid="race-hud"><div data-testid="survival-vignette"></div><div id="roster"></div></div>`;
    document.body.append(overlay);
    const rect = (top: number, left: number, width: number, height: number) =>
      ({ top, left, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
    overlay.getBoundingClientRect = () => rect(0, 0, 1280, 720);
    overlay.querySelector<HTMLElement>('[data-testid="race-hud"]')!.getBoundingClientRect = () => rect(0, 0, 0, 0);
    overlay.querySelector<HTMLElement>('[data-testid="survival-vignette"]')!.getBoundingClientRect = () => rect(0, 0, 1280, 720);
    overlay.querySelector<HTMLElement>("#roster")!.getBoundingClientRect = () => rect(84, 1072, 196, 152);
    expect(hudBottomOnRight(overlay)).toBe(236);
  });
});

