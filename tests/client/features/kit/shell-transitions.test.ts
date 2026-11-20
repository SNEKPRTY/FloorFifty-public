/**
 * Shell transitions and the input rule (polish spec §5.3).
 *
 * The incoming surface's controls take input within 120 ms of the request
 * that opened it, no exit blocks the surface arriving, and a leaving element
 * is `inert` from its first exit frame.
 */

import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fadeIn, fadeOut, pageIn, pageOut, surfaceOut } from "../../../../apps/client/src/features/kit/motion";
import { installUiSounds } from "../../../../apps/client/src/features/kit/ui-sounds";
import ModalHarness from "../../support/ModalHarness.svelte";
import StayingModal from "../../support/StayingModal.svelte";
import { FakeAudio } from "../../support/fakes/audio";
import { setReducedMotion } from "../../support/motion";
import { readClient } from "../../support/client-source";

const source = (name: string): string => readClient(name);

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("exits", () => {
  it.each([
    ["surfaceOut", surfaceOut],
    ["fadeOut", fadeOut],
  ] as const)("%s makes the leaving element inert on its first frame", (_name, exit) => {
    const node = document.createElement("div");
    exit(node);
    expect(node.inert).toBe(true);
  });

  it("pageOut makes the leaving step inert too", () => {
    const node = document.createElement("div");
    pageOut(node, { direction: 1 });
    expect(node.inert).toBe(true);
  });

  it("takes half a beat, and a surface falls 4 px on whole pixels as it fades", () => {
    const config = surfaceOut(document.createElement("div"));
    expect(config.duration).toBeCloseTo(120);
    expect(config.css!(1, 0)).toContain("translateY(0px)");
    expect(config.css!(0, 1)).toContain("translateY(4px)");
    expect(config.css!(0.5, 0.5)).toMatch(/translateY\(\d+px\)/);
    expect(config.css!(0.5, 0.5)).toContain("opacity: 0.5");
  });

  it("changes a step by cross-fading it over 200 ms, from either side", () => {
    for (const direction of [1, -1] as const) {
      const config = pageIn(document.createElement("div"), { direction });
      expect(config.duration).toBe(200);
      expect(config.css!(0, 1)).toBe("opacity: 0");
      expect(config.css!(1, 0)).toBe("opacity: 1");
    }
  });

  it("cut in and out under reduced motion, still inert on the way out", () => {
    setReducedMotion(true);
    const leaving = document.createElement("div");
    expect(surfaceOut(leaving).duration).toBe(0);
    expect(leaving.inert).toBe(true);
    expect(fadeOut(document.createElement("div")).duration).toBe(0);
    expect(fadeIn(document.createElement("div")).duration).toBe(0);
    expect(pageIn(document.createElement("div"), { direction: 1 }).duration).toBe(0);
    expect(pageOut(document.createElement("div"), { direction: -1 }).duration).toBe(0);
  });
});

describe("the modal", () => {
  function open(onClose = vi.fn(), backdrop = false) {
    const host = document.body.appendChild(document.createElement("div"));
    const audio = new FakeAudio();
    const release = installUiSounds(host, audio);
    const component = mount(ModalHarness, { target: host, props: { onClose, backdrop } });
    flushSync();
    host.querySelector<HTMLButtonElement>("[data-testid='opener']")!.click();
    flushSync();
    return { host, audio, component, release, onClose };
  }

  it("cues ui.open as it opens and ui.close as it closes, and nothing else", () => {
    const { host, audio, component, release } = open();
    host.querySelector<HTMLButtonElement>("[data-testid='modal-close']")!.click();
    flushSync();
    expect(audio.calls.filter((call) => call.startsWith("cue:"))).toEqual(["cue:ui.open:ui:", "cue:ui.close:ui:"]);
    release();
    unmount(component);
  });

  it("stays live when its owner keeps it open after a Close, as the pause overlay's sub-views do", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const component = mount(StayingModal, { target: host });
    flushSync();
    host.querySelector<HTMLButtonElement>("[data-testid='modal-close']")!.click();
    flushSync();
    expect(host.querySelector(".ff-modal")!.closest("[inert]")).toBeNull();
    expect(host.querySelector("[data-testid='closes']")!.textContent).toBe("1");
    unmount(component);
  });

  it("cues ui.close when Escape closes it", () => {
    const { host, audio, component, release } = open();
    host.querySelector("[role='dialog']")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    flushSync();
    expect(audio.calls).toContain("cue:ui.close:ui:");
    release();
    unmount(component);
  });

  it("the close button takes a click within 120 ms of the opener", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const onClose = vi.fn();
    const component = mount(ModalHarness, { target: host, props: { onClose } });
    flushSync();
    const started = performance.now();
    host.querySelector<HTMLButtonElement>("[data-testid='opener']")!.click();
    flushSync();
    const close = host.querySelector<HTMLButtonElement>("[data-testid='modal-close']")!;
    expect(close.closest("[inert]")).toBeNull();
    close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(performance.now() - started).toBeLessThan(120);
    unmount(component);
  });

  it("a press on a leaving modal reaches nothing: a second Escape or Close closes nothing twice", () => {
    const { host, audio, component, release, onClose } = open();
    const dialog = host.querySelector<HTMLElement>("[role='dialog']")!;
    const close = host.querySelector<HTMLButtonElement>("[data-testid='modal-close']")!;
    close.click();
    flushSync();
    // The outro runs on: the dialog is still in the page as it leaves.
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    close.click();
    flushSync();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(audio.calls.filter((call) => call.startsWith("cue:ui.close"))).toHaveLength(1);
    release();
    unmount(component);
  });

  it("cues ui.close when a tap on the backdrop dismisses it", () => {
    const { host, audio, component, release, onClose } = open(vi.fn(), true);
    const backdrop = host.querySelector<HTMLElement>(".ff-modal")!;
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flushSync();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(audio.calls).toContain("cue:ui.close:ui:");
    release();
    unmount(component);
  });

  it.each([
    ["TitleRoot.svelte", "title-settings"],
    ["RaceHud.svelte", "pause-open"],
    // The title's flag opens the Language modal (phase 5).
    ["../layout/CornerControls.svelte", "title-language"],
  ])("%s's %s is quiet, so it does not sound a confirm on top of the open", (file, testId) => {
    const text = source(file);
    const at = text.indexOf(`data-testid="${testId}"`);
    expect(at, testId).toBeGreaterThan(-1);
    const start = Math.max(text.lastIndexOf("<button", at), text.lastIndexOf("<Button", at), text.lastIndexOf("<IconButton", at));
    const tag = text.slice(start, text.indexOf(">", at));
    expect(tag).toContain('data-sfx="none"');
  });

  // Phase 4b's Coming soon sheet is a Modal: its own ui.open is the sound, so
  // each control that opens it goes quiet for that press, and only that press.
  it("the character page's Coming soon opens the sheet quietly", () => {
    const text = source("CharacterPage.svelte");
    const at = text.indexOf('data-testid="character-coming-soon"');
    expect(text.slice(text.lastIndexOf("<button", at), text.indexOf(">", at))).toContain('data-sfx="none"');
  });

  it("Lock in is quiet only while it opens the Coming soon sheet", () => {
    const text = source("FullscreenPicker.svelte");
    const at = text.indexOf('data-testid="lock-in"');
    expect(text.slice(text.lastIndexOf("<Button", at), text.indexOf(">", at))).toContain('data-sfx={teaser ? "none" : "ready"}');
  });

  it("the chip whose tap opens the Coming soon sheet is quiet, and no other", () => {
    const tiles = source("TileGrid.svelte");
    const at = tiles.indexOf('data-testid="tile"');
    expect(tiles.slice(tiles.lastIndexOf("<button", at), tiles.indexOf(">", at))).toContain('data-sfx={item.id === opensSheet ? "none" : undefined}');
    expect(source("CharacterPage.svelte")).toMatch(/opensSheet=\{action\.kind === "dlc" \? viewedId : undefined\}/);
  });

  // The quick actions are an ActionBar's actions, whose `sfx` is the button's `data-sfx`.
  it.each(["quick-contact", "quick-home-screen"])("the quick action %s is quiet, for the same reason", (id) => {
    const text = source("QuickActions.svelte");
    const at = text.indexOf(`id: "${id}"`);
    expect(at, id).toBeGreaterThan(-1);
    expect(text.slice(at, text.indexOf("}", at))).toContain('sfx: "none"');
  });
});

describe("the surfaces that use them", () => {
  it("the modal rises in and falls out", () => {
    const modal = source("Modal.svelte");
    expect(modal).toMatch(/out:exit/);
    expect(modal).toMatch(/fade \? fadeOut : surfaceOut/);
    // The rise is a stepped keyframe on the dialog, off under reduced motion.
    expect(modal).toMatch(/class="ff-panel-arrive ff-modal__dialog/);
    const css = source("aquarian.css");
    expect(css).toMatch(/\.ff-panel-arrive\s*{\s*animation:\s*ff-panel-rise 150ms steps\(8\) calc\([^)]*\) \* 60ms\) both/);
    expect(css).toMatch(/@keyframes ff-panel-rise\s*{\s*from\s*{\s*opacity: 0;\s*transform: translateY\(8px\);/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*{\s*\.ff-panel-arrive\s*{\s*animation: none/);
  });

  it("the pause overlay fades in and out, its panel still rising", () => {
    expect(source("PauseOverlay.svelte")).toMatch(/<Modal[^>]*\bfade\b/);
    const modal = source("Modal.svelte");
    expect(modal).toMatch(/fade \? fadeIn/);
    expect(modal).toMatch(/fade \? fadeOut : surfaceOut/);
  });

  it("the select steps cross-fade through one switch, and the frame pages nothing itself", () => {
    const screen = source("SelectScreen.svelte");
    // A step change is the switch's cross-fade; the lobby's own switch fades the first step in with the screen.
    expect(screen).toMatch(/<ViewSwitch view=\{viewOf\(step\)\}/);
    const frame = source("SelectFrame.svelte");
    expect(frame).not.toMatch(/pageIn|pageOut|\b(?:in|out):[a-z]/);
    expect(source("FullscreenPicker.svelte")).not.toMatch(/\spage=/);
    expect(source("StageStep.svelte")).not.toMatch(/\spage=/);
    expect(source("SongStep.svelte")).not.toMatch(/\spage=/);
  });

  it("a resume plays the pause overlay's outro; a screen leaving simply removes it", () => {
    const screens = (name: string) => readClient(name);
    expect(screens("gameplay.ts")).toMatch(/} else if \(this\.pause !== undefined\) {\s*(\/\/.*\s*)?void unmount\(this\.pause, { outro: true }\);/);
    expect(screens("tutorial.ts")).toMatch(/} else if \(pauseOverlay !== undefined\) {\s*(\/\/.*\s*)?void unmount\(pauseOverlay, { outro: true }\);/);
  });
});
