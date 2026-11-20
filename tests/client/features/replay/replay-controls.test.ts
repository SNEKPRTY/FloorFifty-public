/**
 * The replay's bar (race-options spec §7.3): play, speed, restart, follow and
 * exit by touch, keys and controller, a position bar that drags to seek, and
 * Watch again at the end.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextSpeed, ReplayControlsView, type ReplayControlsActions } from "../../../../apps/client/src/features/replay/replay-controls.svelte";
import { fakeSettings } from "../../support/fakes/settings";
import { fakeStage } from "../../support/fakes/stage";
import ReplayVideoButtons from "../../../../apps/client/src/features/replay/ReplayVideoButtons.svelte";
import { ReplayShare } from "../../../../apps/client/src/features/replay/replay-share.svelte";
import { REPLAY_HINT_MS, REPLAY_IDLE_MS, replayHintText } from "../../../../apps/client/src/features/replay/replay-idle";
import { inputMethod } from "../../../../apps/client/src/features/platform/input-method.svelte";

const STATE = { positionS: 0, lengthS: 40, paused: false, speed: 1, following: "Kite", followingColour: "scarlet", held: false, standings: [] as readonly string[] } as const;

/** Each test starts a fresh visit, so the once-a-visit hint has not been said. */
function mountControls(hint: { shown: boolean } = { shown: false }) {
  const stage = fakeStage();
  const actions = {
    onPlayPause: vi.fn(),
    onSpeed: vi.fn(),
    onRestart: vi.fn(),
    onFollow: vi.fn(),
    onExit: vi.fn(),
    onWatchAgain: vi.fn(),
    onBack: vi.fn(),
    onSeek: vi.fn(),
    onScrub: vi.fn(),
  } satisfies ReplayControlsActions;
  const view = new ReplayControlsView(stage, actions, hint);
  view.update({ ...STATE });
  flushSync();
  const query = <T extends Element>(id: string) => stage.overlay.querySelector<T>(`[data-testid="${id}"]`);
  return { stage, view, actions, query };
}

afterEach(() => {
  vi.useRealTimers();
  inputMethod.note("keyboard");
  document.body.innerHTML = "";
});

/** The hint falls out over half a beat, inert from its first frame (the kit's Toast), so "gone" is gone or leaving. */
const hintGone = (node: Element | null): boolean => node === null || (node as HTMLElement).inert;

describe("the replay controls (race-options spec §7.3)", () => {
  it("cycles the speed 1 → 2 → 0.5 → 1", () => {
    expect([nextSpeed(1), nextSpeed(2), nextSpeed(0.5)]).toEqual([2, 0.5, 1]);
  });

  it.each([
    [" ", "onPlayPause"],
    ["ArrowLeft", "onFollow"],
    ["ArrowRight", "onFollow"],
    ["s", "onSpeed"],
    ["r", "onRestart"],
    ["Escape", "onExit"],
  ] as const)("maps %j to %s", (key, action) => {
    const { view, actions } = mountControls();
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
    expect(actions[action]).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it("passes ← as -1 and → as 1", () => {
    const { view, actions } = mountControls();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(actions.onFollow.mock.calls).toEqual([[-1], [1]]);
    view.destroy();
  });

  it("plays and pauses on Space with a button focused, and keeps the button from pressing (D-R3)", () => {
    const { view, actions, query } = mountControls();
    const restart = query<HTMLButtonElement>("replay-restart")!;
    restart.focus();
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    restart.dispatchEvent(event);
    expect(actions.onPlayPause).toHaveBeenCalledTimes(1);
    expect(actions.onRestart).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    view.destroy();
  });

  it.each([
    ["Escape", "onExit"],
    ["s", "onSpeed"],
    ["r", "onRestart"],
  ] as const)("answers %j on a focused button, which a click, a tap or the controller leaves there", (key, action) => {
    // The controller's Back reaches the focused button as Escape.
    const { view, actions, query } = mountControls();
    const play = query<HTMLButtonElement>("replay-play")!;
    play.focus();
    play.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(actions[action]).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it("changes the racer on ← and → with a button focused (D-R3)", () => {
    const { view, actions, query } = mountControls();
    const play = query<HTMLButtonElement>("replay-play")!;
    play.focus();
    play.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(actions.onFollow).toHaveBeenCalledWith(1);
    view.destroy();
  });

  it("leaves Enter to the focused button", () => {
    const { view, actions, query } = mountControls();
    const restart = query<HTMLButtonElement>("replay-restart")!;
    restart.focus();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    restart.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(actions.onPlayPause).not.toHaveBeenCalled();
    view.destroy();
  });

  it("takes its keys before the page's own arrow walk can (B8)", () => {
    // main.ts walks focus on the arrows from a bubbling window listener added
    // at boot, before any replay; it must never see a key the replay took.
    const walked: string[] = [];
    const walk = (event: KeyboardEvent): void => void walked.push(event.key);
    window.addEventListener("keydown", walk);
    const { view, actions } = mountControls();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(actions.onFollow).toHaveBeenCalledWith(-1);
    expect(walked).toEqual([]);
    window.removeEventListener("keydown", walk);
    view.destroy();
  });

  it.each(["ctrlKey", "metaKey", "altKey"] as const)("leaves %s chords to the browser", (modifier) => {
    const { view, actions } = mountControls();
    const event = new KeyboardEvent("keydown", { key: "r", [modifier]: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(actions.onRestart).not.toHaveBeenCalled();
    view.destroy();
  });

  it("stops listening for keys once destroyed", () => {
    const { view, actions } = mountControls();
    view.destroy();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
    expect(actions.onRestart).not.toHaveBeenCalled();
  });

  it("calls each action from its button", () => {
    const { view, actions, query } = mountControls();
    query<HTMLButtonElement>("replay-play")!.click();
    query<HTMLButtonElement>("replay-speed")!.click();
    query<HTMLButtonElement>("replay-restart")!.click();
    query<HTMLButtonElement>("replay-follow-prev")!.click();
    query<HTMLButtonElement>("replay-follow-next")!.click();
    query<HTMLButtonElement>("replay-exit")!.click();
    expect(actions.onPlayPause).toHaveBeenCalledTimes(1);
    expect(actions.onSpeed).toHaveBeenCalledTimes(1);
    expect(actions.onRestart).toHaveBeenCalledTimes(1);
    expect(actions.onFollow.mock.calls).toEqual([[-1], [1]]);
    expect(actions.onExit).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it("shows the position on a bar that seeks when dragged, in whole seconds", () => {
    const { view, actions, query } = mountControls();
    view.update({ ...STATE, positionS: 12.4 });
    flushSync();
    const bar = query<HTMLInputElement>("replay-progress")!;
    expect(bar.type).toBe("range");
    expect(bar.max).toBe("40");
    expect(bar.step).toBe("1");
    expect(bar.value).toBe("12");
    expect(bar.getAttribute("aria-valuetext")).toBe("0:12 of 0:40");
    bar.value = "30";
    bar.dispatchEvent(new Event("input", { bubbles: true }));
    expect(actions.onSeek).toHaveBeenCalledWith(30);
    view.destroy();
  });

  it("holds the replay while a finger or the mouse is on the bar", () => {
    const { view, actions, query } = mountControls();
    const bar = query<HTMLInputElement>("replay-progress")!;
    bar.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    bar.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(actions.onScrub.mock.calls).toEqual([[true], [false]]);
    view.destroy();
  });

  it("leaves the arrows, Home and End to a focused bar, and still answers Escape, Space, S and R there", () => {
    const { view, actions, query } = mountControls();
    const bar = query<HTMLInputElement>("replay-progress")!;
    bar.focus();
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) bar.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(actions.onFollow).not.toHaveBeenCalled();
    for (const key of ["Escape", " ", "s", "r"]) bar.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(actions.onExit).toHaveBeenCalledTimes(1);
    expect(actions.onPlayPause).toHaveBeenCalledTimes(1);
    expect(actions.onSpeed).toHaveBeenCalledTimes(1);
    expect(actions.onRestart).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it("keeps the bar on the end card, so the race can be dragged back into", () => {
    const { view, query } = mountControls();
    view.update({ ...STATE, positionS: 40, held: true });
    flushSync();
    expect(query("replay-progress")).not.toBeNull();
    view.destroy();
  });

  it("says the speed, play or pause, and who it follows, with no badge of its own", () => {
    const { view, query } = mountControls();
    view.update({ ...STATE, paused: true, speed: 2, following: "Wren", followingColour: "gold" });
    flushSync();
    expect(query("replay-badge")).toBeNull();
    expect(query("replay-speed")?.textContent?.trim()).toBe("2×");
    expect(query("replay-play")?.getAttribute("aria-label")).toBe("Play");
    expect(query("replay-follow-name")?.textContent?.trim()).toBe("Wren");
    expect(query("replay-follow-name")?.querySelector("[data-truncatable]")).not.toBeNull();
    view.destroy();
  });

  it("names the way out Back to results", () => {
    const { view, query } = mountControls();
    expect(query("replay-exit")?.textContent?.trim()).toBe("Back to results");
    view.destroy();
  });

  it("hides after 2.5 s without input and comes back on a pointer move", () => {
    vi.useFakeTimers();
    const { view, query } = mountControls();
    const root = query("replay-controls")!;
    expect(root.getAttribute("data-idle")).toBe("false");
    vi.advanceTimersByTime(2500);
    flushSync();
    expect(root.getAttribute("data-idle")).toBe("true");
    window.dispatchEvent(new Event("pointermove"));
    flushSync();
    expect(root.getAttribute("data-idle")).toBe("false");
    view.destroy();
  });

  it("stays in view while paused and on the end card", () => {
    vi.useFakeTimers();
    const { view, query } = mountControls();
    view.update({ ...STATE, paused: true });
    flushSync();
    vi.advanceTimersByTime(10_000);
    flushSync();
    expect(query("replay-controls")?.getAttribute("data-idle")).toBe("false");
    view.update({ ...STATE, paused: false, held: true });
    flushSync();
    vi.advanceTimersByTime(10_000);
    flushSync();
    expect(query("replay-controls")?.getAttribute("data-idle")).toBe("false");
    view.destroy();
  });

  it("stays in view while keyboard or controller focus is inside it", () => {
    vi.useFakeTimers();
    const { view, query } = mountControls();
    query<HTMLButtonElement>("replay-speed")!.focus();
    vi.advanceTimersByTime(10_000);
    flushSync();
    expect(query("replay-controls")?.getAttribute("data-idle")).toBe("false");
    query<HTMLButtonElement>("replay-speed")!.blur();
    vi.advanceTimersByTime(REPLAY_IDLE_MS);
    flushSync();
    expect(query("replay-controls")?.getAttribute("data-idle")).toBe("true");
    view.destroy();
  });

  it("keeps the one position bar across the end card, so a press that leaves it lets go on the same element", () => {
    const { view, query } = mountControls();
    const bar = query("replay-progress");
    view.update({ ...STATE, held: true });
    flushSync();
    expect(query("replay-progress")).toBe(bar);
    view.update({ ...STATE, held: false });
    flushSync();
    expect(query("replay-progress")).toBe(bar);
    view.destroy();
  });

  it("still steps aside after a tap or click focuses one of its buttons", () => {
    // A pointer press focuses a button without a focus ring (`:focus-visible`
    // does not match); that is not a player walking the bar, so it must not
    // hold the bar over the race (B5).
    vi.useFakeTimers();
    const { view, query } = mountControls();
    const speed = query<HTMLButtonElement>("replay-speed")!;
    const matches = speed.matches.bind(speed);
    speed.matches = ((selector: string) => (selector === ":focus-visible" ? false : matches(selector))) as typeof speed.matches;
    speed.focus();
    vi.advanceTimersByTime(REPLAY_IDLE_MS);
    flushSync();
    expect(query("replay-controls")?.getAttribute("data-idle")).toBe("true");
    view.destroy();
  });

  it("stays in view while the bar is held by a finger", () => {
    vi.useFakeTimers();
    const { view, query } = mountControls();
    query<HTMLInputElement>("replay-progress")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    vi.advanceTimersByTime(10_000);
    flushSync();
    expect(query("replay-controls")?.getAttribute("data-idle")).toBe("false");
    view.destroy();
  });

  it("replaces the bar with Watch again and Back to results when held", () => {
    const { view, actions, query } = mountControls();
    view.update({ ...STATE, positionS: 40, held: true });
    flushSync();
    expect(query("replay-play")).toBeNull();
    query<HTMLButtonElement>("replay-watch-again")!.click();
    query<HTMLButtonElement>("replay-back")!.click();
    expect(actions.onWatchAgain).toHaveBeenCalledTimes(1);
    expect(actions.onBack).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it("shows the drift notice once, and the room-moved line", () => {
    const { stage, view, query } = mountControls();
    view.notice("This replay drifted from the race");
    view.notice("This replay drifted from the race");
    view.setRoomMoved(true);
    flushSync();
    expect(stage.overlay.querySelectorAll('[data-testid="replay-drift"]')).toHaveLength(1);
    expect(query("replay-drift")?.getAttribute("role")).toBe("status");
    expect(query("replay-room-moved")?.textContent).toBe("Your room is back in the ready room");
    view.destroy();
  });

  it("builds every target from the Aquarian control, which holds 44 px", () => {
    const { view, query } = mountControls();
    for (const id of ["replay-play", "replay-speed", "replay-restart", "replay-follow-prev", "replay-follow-next", "replay-exit"]) {
      expect(query(id)?.className, id).toMatch(/ff-aq-control/);
    }
    view.destroy();
  });

  it("carries the end standings on the end card, and none before it", () => {
    const { view, query } = mountControls();
    expect(query("replay-controls")!.hasAttribute("data-standings")).toBe(false);
    view.update({ ...STATE, held: true, standings: ["Wren", "Kite"] });
    flushSync();
    expect(query("replay-controls")!.getAttribute("data-standings")).toBe("Wren|Kite");
    view.destroy();
  });
  it("says how to bring the bar back the first time it steps aside, then lets the hint go", () => {
    vi.useFakeTimers();
    inputMethod.note("touch");
    const { view, query, stage } = mountControls();
    expect(hintGone(query("replay-hint"))).toBe(true);
    vi.advanceTimersByTime(REPLAY_IDLE_MS);
    flushSync();
    const hint = query("replay-hint");
    expect(hint?.textContent?.trim()).toBe("Tap for controls");
    // Outside the bar, which is invisible while it is aside.
    expect(query("replay-controls")!.contains(hint)).toBe(false);
    expect(stage.overlay.contains(hint)).toBe(true);
    vi.advanceTimersByTime(REPLAY_HINT_MS);
    flushSync();
    expect(hintGone(query("replay-hint"))).toBe(true);
    view.destroy();
  });

  it("drops the hint the moment the bar comes back", () => {
    vi.useFakeTimers();
    const { view, query } = mountControls();
    vi.advanceTimersByTime(REPLAY_IDLE_MS);
    flushSync();
    expect(query("replay-hint")).not.toBeNull();
    window.dispatchEvent(new Event("pointermove"));
    flushSync();
    expect(hintGone(query("replay-hint"))).toBe(true);
    view.destroy();
  });

  it("gives the hint once a visit, not each time the bar steps aside or a replay opens", () => {
    vi.useFakeTimers();
    const visit = { shown: false };
    const first = mountControls(visit);
    vi.advanceTimersByTime(REPLAY_IDLE_MS);
    flushSync();
    expect(first.query("replay-hint")).not.toBeNull();
    window.dispatchEvent(new Event("pointermove"));
    vi.advanceTimersByTime(REPLAY_IDLE_MS);
    flushSync();
    expect(hintGone(first.query("replay-hint"))).toBe(true);
    first.view.destroy();

    const second = mountControls(visit);
    vi.advanceTimersByTime(REPLAY_IDLE_MS);
    flushSync();
    expect(hintGone(second.query("replay-hint"))).toBe(true);
    second.view.destroy();
  });

  it("names the input that wakes the bar, in the player's hand", () => {
    expect(replayHintText("touch")).toBe("Tap for controls");
    expect(replayHintText("gamepad")).toBe("Press any button for controls");
    expect(replayHintText("keyboard")).toBe("Move the mouse or press a key for controls");
  });
});

describe("replay buttons say what they do (Task 27)", () => {
  it("labels save and share with words", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const share = new ReplayShare({
      video: () => undefined, winner: undefined, stageName: () => "Rooftops", round: undefined, progress: undefined,
      settings: fakeSettings(), content: () => undefined, colour: "scarlet",
      nav: { share: () => Promise.resolve(), canShare: () => true }, activation: () => true,
    });
    const app = mount(ReplayVideoButtons, { target: host, props: { share, available: true, top: 10 } });
    flushSync();
    // Icons alone (Owner, 2026-11-19): the name is for a screen reader and a hover.
    for (const [id, name] of [["replay-save-video", "Save video"], ["replay-share-video", "Share video"]] as const) {
      const button = host.querySelector(`[data-testid="${id}"]`)!;
      expect(button.textContent?.trim()).toBe("");
      expect(button.getAttribute("aria-label")).toBe(name);
      expect(button.getAttribute("title")).toBe(name);
    }
    unmount(app);
  });

  it("shows Share alone inside Ruken's frame, which blocks downloads", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const share = new ReplayShare({
      video: () => undefined, winner: undefined, stageName: () => "Rooftops", round: undefined, progress: undefined,
      settings: fakeSettings(), content: () => undefined, colour: "scarlet",
      nav: { share: () => Promise.resolve(), canShare: () => true }, activation: () => true, canSave: false,
    });
    const app = mount(ReplayVideoButtons, { target: host, props: { share, available: true, top: 10 } });
    flushSync();
    expect(host.querySelector('[data-testid="replay-save-video"]')).toBeNull();
    expect(host.querySelector('[data-testid="replay-share-video"]')).not.toBeNull();
    unmount(app);
  });

  it("ticks Share only when the share went through, never on a cancel", async () => {
    const mountShare = (nav: { share: () => Promise<void>; canShare: () => boolean }) => {
      const host = document.createElement("div");
      document.body.append(host);
      const share = new ReplayShare({
        video: () => ({ blob: new Blob([new Uint8Array([1])]), type: "video/mp4", extension: "mp4", stageId: "rooftops", finishedAt: new Date() }),
        winner: undefined, stageName: () => "Rooftops", round: undefined, progress: undefined,
        settings: fakeSettings(), content: () => undefined, colour: "scarlet", nav, activation: () => true,
      });
      const app = mount(ReplayVideoButtons, { target: host, props: { share, available: true, top: 10 } });
      flushSync();
      const done = host.querySelector<HTMLElement>('[data-testid="replay-share-video"] [data-confirm-label="done"]')!;
      const press = async () => {
        host.querySelector<HTMLButtonElement>('[data-testid="replay-share-video"]')!.click();
        await vi.advanceTimersByTimeAsync(10);
        flushSync();
      };
      return { done, press, stop: () => unmount(app) };
    };
    vi.useFakeTimers();
    const cancelled = mountShare({ share: () => Promise.reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), canShare: () => true });
    await cancelled.press();
    expect(cancelled.done.style.visibility, "a cancel shows no tick").toBe("hidden");
    cancelled.stop();
    const sent = mountShare({ share: () => Promise.resolve(), canShare: () => true });
    await sent.press();
    expect(sent.done.style.visibility, "a share that went through ticks").toBe("visible");
    sent.stop();
  });

  it("makes Back to results the green way on at the end and Watch again blue", () => {
    const { view, query } = mountControls();
    view.update({ ...STATE, positionS: 40, held: true });
    flushSync();
    expect(query("replay-back")?.classList.contains("ff-aq-control--go")).toBe(true);
    expect(query("replay-watch-again")?.classList.contains("ff-aq-control--go")).toBe(false);
    expect(query("replay-back")?.textContent?.trim()).toBe("Back to results");
    view.destroy();
  });
});
