import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import UnlockBanner from "../../../../apps/client/src/features/select/UnlockBanner.svelte";
import { FocusNavigator } from "../../../../apps/client/src/features/platform/focus-nav";
import { UNLOCK_BANNER_MS, type UnlockGrant } from "../../../../apps/client/src/features/net/unlock-grant";

const songGrant: UnlockGrant = {
  kind: "song",
  conditionId: "any-match",
  id: "crash-mode",
  title: "Crash Mode",
  coverAlias: "cover.crashMode",
  song: { id: "crash-mode", audioAlias: "music.crashMode" } as never,
};
const frogGrant: UnlockGrant = {
  kind: "character",
  conditionId: "games-5",
  id: "frog",
  name: "Frog",
  portraitAlias: "portrait.frog.violetWin",
  colour: "violet",
};

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render(grant: UnlockGrant, onDone = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  const sounds: unknown[] = [];
  host.addEventListener("ff-sfx", (event) => sounds.push((event as CustomEvent).detail));
  component = mount(UnlockBanner, { target: host, props: { grant, artSrc: (alias: string) => `/assets/${alias}`, onDone } });
  flushSync();
  return { banner: () => document.querySelector<HTMLElement>("[data-testid='unlock-banner']"), onDone, sounds };
}

describe("the unlock banner (unlockables spec §7.1)", () => {
  it("stings NEW CHALLENGER, keyed by its grant so a remount is not heard again", () => {
    const { sounds } = render(frogGrant);
    expect(sounds).toEqual([{ sound: "unlock", key: "unlock:games-5" }]);
  });

  it("asks no sound of its own for NEW SONG, whose preview is the reward", () => {
    const { sounds } = render(songGrant);
    expect(sounds).toEqual([]);
  });

  it("a song shows NEW SONG, its cover and its title", () => {
    const { banner } = render(songGrant);
    expect(banner()!.dataset["kind"]).toBe("song");
    expect(banner()!.textContent).toContain("NEW SONG");
    expect(banner()!.textContent).toContain("Crash Mode");
    expect(banner()!.querySelector("img")!.getAttribute("src")).toBe("/assets/cover.crashModeLarge");
  });

  it("a character shows NEW CHALLENGER with the win portrait and the name", () => {
    const { banner } = render(frogGrant);
    expect(banner()!.dataset["kind"]).toBe("character");
    expect(banner()!.textContent).toContain("NEW CHALLENGER");
    expect(banner()!.textContent).toContain("Frog");
    expect(banner()!.querySelector("img")!.getAttribute("src")).toBe("/assets/portrait.frog.violetWin");
  });

  it("dismisses after 6 s, once", () => {
    vi.useFakeTimers();
    const { onDone } = render(songGrant);
    vi.advanceTimersByTime(UNLOCK_BANNER_MS - 1);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(UNLOCK_BANNER_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("dismisses on a tap", () => {
    const { banner, onDone } = render(songGrant);
    banner()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("dismisses on a key, without taking the key from the focused button", () => {
    const { onDone } = render(songGrant);
    const key = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    window.dispatchEvent(key);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(key.defaultPrevented).toBe(false);
  });

  it("dismisses on a controller's confirm, and still presses the focused button", () => {
    const { onDone } = render(songGrant);
    const raceAgain = document.createElement("button");
    const clicked = vi.fn();
    raceAgain.addEventListener("click", clicked);
    document.body.append(raceAgain);
    raceAgain.focus();
    new FocusNavigator().confirm();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("dismisses on the d-pad", () => {
    const { onDone } = render(songGrant);
    new FocusNavigator().steer("down");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("stays up for a key held through the finish: its auto-repeat is not a press", () => {
    const { onDone } = render(songGrant);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", repeat: true, bubbles: true }));
    expect(onDone).not.toHaveBeenCalled();
  });

  it("never blocks: it is no dialog and takes no focus", () => {
    const { banner } = render(songGrant);
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(banner()!.contains(document.activeElement)).toBe(false);
    expect(banner()!.querySelector("button, [tabindex]")).toBeNull();
  });

  it("slides with full motion, and cuts in under reduced motion", () => {
    expect(render(songGrant).banner()!.dataset["motion"]).toBe("full");
    unmount(component!);
    component = undefined;
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    expect(render(songGrant).banner()!.dataset["motion"]).toBe("reduced");
  });

  it("is the kit's glass plate, dropped in by a keyframe and not by a tween on the panel", () => {
    const { banner } = render(songGrant);
    const plate = banner()!.querySelector<HTMLElement>(".ff-unlock-banner__plate")!;
    expect(plate.classList.contains("ff-aquarian-panel")).toBe(true);
    // A GSAP tween on the panel would stop its fall-out from finishing (`Panel`): the drop is CSS.
    expect(plate.style.transform).toBe("");
    expect(readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/select/UnlockBanner.svelte"), "utf8")).toMatch(/@keyframes ff-unlock-drop/);
  });

  it("flashes as it slides in with full motion, and never under reduced motion (spec §7.1)", () => {
    const flash = () => document.querySelector("[data-testid='unlock-banner-flash']");
    render(songGrant);
    expect(flash()).not.toBeNull();
    expect(flash()!.getAttribute("aria-hidden")).toBe("true");
    unmount(component!);
    component = undefined;
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    render(songGrant);
    expect(flash()).toBeNull();
  });
});
