import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import CharacterPage from "../../../../apps/client/src/features/select/CharacterPage.svelte";
import { fakeSettings } from "../../support/fakes/settings";
import { formFactor } from "../../../../apps/client/src/features/platform/viewport-tracking.svelte";
import { screenLayout } from "../../../../apps/client/src/features/kit/screen-arrangement";

const { content } = parseGameContentArtifact(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../content/generated/content.json"), "utf8")),
);

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-form-factor");
  formFactor.current = "desktop";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function render(props: Partial<Record<string, unknown>> = {}) {
  document.documentElement.dataset["formFactor"] = "tablet-portrait";
  const onPick = vi.fn();
  const onClose = vi.fn();
  const onPickColour = vi.fn();
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const host = document.createElement("div");
  document.body.append(host);
  component = mount(CharacterPage, {
    target: host,
    props: {
      content: () => content,
      artSrc: (alias: string) => `/assets/${alias}`,
      colour: "cyan",
      current: "ninja",
      access: { unlockAll: false },
      seat: 1,
      random: true,
      settings: fakeSettings(),
      layout: "tablet",
      onPick,
      onClose,
      onPickColour,
      ...props,
    },
  });
  flushSync();
  const q = <T extends HTMLElement>(testId: string) => host.querySelector<T>(`[data-testid="${testId}"]`);
  const tile = (id: string) => [...host.querySelectorAll<HTMLElement>("[data-testid=tile]")].find((element) => element.dataset["id"] === id);
  const tap = (element: HTMLElement) => {
    element.click();
    flushSync();
  };
  const swatch = (colour: string) => host.querySelector<HTMLButtonElement>(`[data-testid=colour-swatch][data-colour="${colour}"]`)!;
  return { host, q, tile, tap, swatch, onPick, onClose, onPickColour, opener };
}

describe("CharacterPage", () => {
  it("is a labelled modal page of bust chips, drawn in the seat colour", () => {
    const { q, tile } = render();
    const page = q("character-page")!;
    expect(page.getAttribute("role")).toBe("dialog");
    expect(page.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(page.getAttribute("aria-labelledby")!)!.textContent).toBe("Character");
    // A chip is its bust alone, its name kept for assistive technology: the only text is your seat's flag.
    expect(tile("ninja")!.textContent!.trim()).toBe("P2");
    expect(tile("ninja")!.getAttribute("aria-label")).toBe("Ninja");
    expect(tile("frog")!.dataset["state"]).toBe("locked");
    expect(tile("robo")!.dataset["state"]).toBe("locked");
    expect(tile("penguin")!.dataset["state"]).toBe("dlc");
    expect(tile("ninja")!.querySelector("img")!.getAttribute("src")).toBe("/assets/portrait.cyan");
  });

  it("opens on your character, on the stage, Picked", () => {
    const { q } = render();
    expect(q("character-preview-name")!.textContent).toBe("Ninja");
    // Picked is a status, not a pale primary button (audit m5).
    const pick = q("character-pick")!;
    expect(pick.tagName).toBe("P");
    expect(pick.getAttribute("role")).toBe("status");
    expect(pick.textContent!.replace(/\s+/g, " ").trim()).toBe("✓ Picked");
    expect(q("stage-sprite")!.style.backgroundImage).toContain("/assets/ninja.cyan");
  });

  it("shows no pack titles, and pages with its arrows at the row's sides", () => {
    for (const factor of ["phone-landscape", "phone-portrait", "tablet-portrait", "desktop"] as const) {
      formFactor.current = factor;
      const { host } = render({ layout: screenLayout(factor) });
      const grid = host.querySelector<HTMLElement>("[data-testid=tile-grid]")!;
      for (const pack of content.packs) expect(grid.textContent, factor).not.toContain(pack.title);
      // jsdom measures nothing, so the grid pages: its arrows sit beside the row.
      expect(host.querySelector(".ff-tiles__row [data-testid=page-next]"), factor).not.toBeNull();
      unmount(component!);
      component = undefined;
      document.body.innerHTML = "";
    }
  });

  it("stands its Back and Mute in a screen frame's corners, as every shell screen does", () => {
    const { host } = render();
    const frame = host.querySelector("[data-screen-frame]")!;
    expect(frame.firstElementChild?.hasAttribute("data-corner-controls")).toBe(true);
    expect(frame.querySelector('[data-testid="character-back"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="corner-mute"]')).toHaveLength(1);
    expect(host.querySelector("[data-testid=character-page]")!.getAttribute("data-layout")).toBe("tablet");
  });

  it("offers the four colours as a group, yours checked", () => {
    const { q, host, swatch } = render();
    expect(q("colour-row")!.getAttribute("role")).toBe("radiogroup");
    expect(host.querySelectorAll("[data-testid=colour-swatch]")).toHaveLength(4);
    expect(swatch("cyan").getAttribute("aria-checked")).toBe("true");
    expect(swatch("scarlet").getAttribute("aria-checked")).toBe("false");
    expect(swatch("scarlet").getAttribute("aria-label")).toBe("Red");
  });

  it("disables and flags a colour another player holds", () => {
    const { swatch } = render({ taken: [{ colour: "gold", seat: 2 }] });
    expect(swatch("gold").disabled).toBe(true);
    expect(swatch("gold").textContent).toContain("P3");
    expect(swatch("gold").getAttribute("aria-label")).toBe("Orange, taken by P3");
  });

  it("flags a colour another player holds with their seat in a hint-size label, not struck through", () => {
    // Yours is cyan; seat 3 holds gold.
    const { swatch } = render({ taken: [{ colour: "gold", seat: 2 }] });
    expect(swatch("gold").disabled).toBe(true);
    expect(swatch("gold").querySelector(".ff-character-page__taken")).toBeNull();
    expect(swatch("gold").querySelector(".ff-character-page__holder")!.textContent).toBe("P3");
    const source = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/select/CharacterPage.svelte"), "utf8");
    expect(source).not.toMatch(/\.ff-character-page__taken/);
    expect(source).toMatch(/\.ff-character-page__holder\s*\{[^}]*font:\s*600 var\(--ff-type-hint\)/);
    expect(source).toMatch(/\.ff-character-page__colour:disabled\s*\{[^}]*opacity:\s*1/);
  });

  it("takes a free colour at once, and the page stays open", () => {
    const { tap, swatch, onPickColour, onPick, onClose } = render();
    tap(swatch("violet"));
    expect(onPickColour).toHaveBeenCalledWith("violet");
    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not ask again for the colour you wear", () => {
    const { tap, swatch, onPickColour } = render();
    tap(swatch("cyan"));
    expect(onPickColour).not.toHaveBeenCalled();
  });

  it("frames your chip in your colour", () => {
    const { tile } = render({ colour: "gold" });
    expect(tile("ninja")!.classList.contains("ff-colour-gold")).toBe(true);
  });

  it("focus starts on your character's chip", () => {
    const { tile } = render();
    expect(document.activeElement).toBe(tile("ninja"));
  });

  it("a tap views without picking, and drops the character in", () => {
    const { q, tile, tap, onPick, onClose } = render({ access: { unlockAll: true } });
    tap(tile("frog")!);
    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(q("character-preview-name")!.textContent).toBe("Frog");
    expect(q("character-pick")!.textContent!.trim()).toBe("Pick Frog");
    expect(q("stage-sprite")!.dataset["frame"]).toBe("3:0");
    expect(tile("frog")!.dataset["previewed"]).toBe("true");
    expect(tile("ninja")!.dataset["focused"]).toBe("true");
  });

  it("Pick picks, the character hops, and the page closes 500 ms later", () => {
    vi.useFakeTimers();
    const { q, tile, tap, onPick, onClose } = render({ access: { unlockAll: true } });
    tap(tile("frog")!);
    tap(q("character-pick")!);
    expect(onPick).toHaveBeenCalledWith("frog");
    expect(q("stage-sprite")!.dataset["frame"]).toBe("2:0");
    vi.advanceTimersByTime(499);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a second tap on the viewed chip picks it", () => {
    const { tile, tap, onPick } = render({ access: { unlockAll: true } });
    tap(tile("diver")!);
    tap(tile("diver")!);
    expect(onPick).toHaveBeenCalledWith("diver");
  });

  it("a tap on your own chip picks it again", () => {
    const { tile, tap, onPick } = render();
    tap(tile("ninja")!);
    expect(onPick).toHaveBeenCalledWith("ninja");
  });

  it("a locked character is viewed, dimmed and held, with its hint and no Pick", () => {
    const { q, tile, tap, onPick } = render();
    tap(tile("frog")!);
    tap(tile("frog")!);
    expect(onPick).not.toHaveBeenCalled();
    expect(q("character-pick")).toBeNull();
    expect(q("character-preview-access")!.textContent).toContain("Finish 5 races");
    expect(q("character-preview-lock")).not.toBeNull();
    expect(q("character-preview-bar")).toBeNull();
    expect(q("character-stage")!.dataset["tone"]).toBe("dimmed");
  });

  it("a DLC character is viewed grey, and names its pack", () => {
    const { q, tile, tap, onPick } = render();
    tap(tile("penguin")!);
    expect(onPick).not.toHaveBeenCalled();
    expect(q("character-pick")).toBeNull();
    expect(q("character-preview-access")!.textContent!.trim()).toBe("DLC · After Hours pack");
    expect(q("character-stage")!.dataset["tone"]).toBe("grey");
  });

  it("a DLC character offers Coming soon, which opens its pack's sheet and picks nothing (unlockables spec §7.3)", () => {
    const { q, tile, tap, onPick, onClose } = render();
    tap(tile("penguin")!);
    q("character-coming-soon")!.click();
    flushSync();
    const sheet = document.querySelector<HTMLElement>("[data-testid=coming-soon]")!;
    expect(sheet.textContent).toContain("Knight");
    expect(onPick).not.toHaveBeenCalled();
    sheet.querySelector<HTMLButtonElement>("[data-testid=modal-close]")!.click();
    flushSync();
    expect(document.querySelector("[data-testid=coming-soon]")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("an earned character wears NEW, and focusing it reveals it under its own key (unlockables spec §7.2)", () => {
    const reveal = vi.fn();
    const progress = { unlocked: (id: string) => id === "games-5", count: () => undefined, isNew: (key: string) => key === "character:frog", reveal };
    const { tile } = render({ access: { unlockAll: false, progress } });
    const frog = tile("frog")!;
    expect(frog.getAttribute("aria-label")).toBe("Frog, new");
    expect(frog.querySelector("[data-testid=tile-new]")).not.toBeNull();
    frog.focus();
    expect(reveal).toHaveBeenCalledWith("character:frog");
  });

  it("a second tap on a viewed DLC chip opens the sheet too", () => {
    const { tile, tap, onPick } = render();
    tap(tile("penguin")!);
    tap(tile("penguin")!);
    flushSync();
    expect(document.querySelector("[data-testid=coming-soon]")).not.toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("keyboard or pad focus views without picking; Enter then picks", () => {
    const { q, tile, onPick } = render({ access: { unlockAll: true } });
    tile("diver")!.focus();
    flushSync();
    expect(q("character-preview-name")!.textContent).toBe("Diver");
    expect(onPick).not.toHaveBeenCalled();
    tile("diver")!.click(); // Enter or the pad's A on a focused button is its click
    flushSync();
    expect(onPick).toHaveBeenCalledWith("diver");
  });

  it("a pointer's focus does not view, so a first tap never picks", () => {
    const { q, tile, onPick } = render({ access: { unlockAll: true } });
    const frog = tile("frog")!;
    frog.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    frog.focus(); // Chrome focuses on pointer-down, before the click
    frog.click();
    flushSync();
    expect(onPick).not.toHaveBeenCalled();
    expect(q("character-preview-name")!.textContent).toBe("Frog");
  });

  it("a touch tap that focuses after the finger lifts still only views (Android Chrome's order)", () => {
    vi.useFakeTimers();
    const { q, tile, onPick } = render({ access: { unlockAll: true } });
    const frog = tile("frog")!;
    frog.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    frog.dispatchEvent(new Event("pointerup", { bubbles: true }));
    vi.advanceTimersByTime(20); // the gesture's focus arrives after pointerup, in its own task
    frog.focus();
    frog.click();
    flushSync();
    expect(onPick).not.toHaveBeenCalled();
    expect(q("character-preview-name")!.textContent).toBe("Frog");
  });

  it("a press released off the chips leaves the pad's next focus viewing", () => {
    const { q, tile } = render({ access: { unlockAll: true } });
    tile("frog")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    tile("frog")!.focus(); // Chrome's mouse focus on the press; no click follows
    tile("diver")!.focus(); // the pad moves on, sending no key
    flushSync();
    expect(q("character-preview-name")!.textContent).toBe("Diver");
  });

  it("one pick, one close: a double Pick, a tap during the hop, or Escape during it", () => {
    vi.useFakeTimers();
    const { q, tile, tap, onPick, onClose } = render({ access: { unlockAll: true } });
    tap(tile("frog")!);
    tap(q("character-pick")!);
    tap(q("character-pick")!);
    tap(tile("diver")!);
    q("character-page")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    vi.advanceTimersByTime(1000);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes after 250 ms with reduced motion, with no hop", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { q, tile, tap, onClose } = render({ access: { unlockAll: true } });
    tap(tile("frog")!);
    tap(q("character-pick")!);
    expect(q("stage-sprite")!.dataset["frame"]).toBe("0:0");
    vi.advanceTimersByTime(250);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers ? only when asked, and views it as Random", () => {
    const { q, tap } = render({ random: true });
    tap(q("tile-random")!);
    expect(q("character-preview-name")!.textContent).toBe("Random");
    expect(q("character-pick")!.textContent!.trim()).toBe("Pick Random");
    expect(q("stage-random")).not.toBeNull();
    unmount(component!);
    component = undefined;
    document.body.innerHTML = "";
    expect(render({ random: false }).q("tile-random")).toBeNull();
  });

  it("Random worn shows Picked", () => {
    const { q } = render({ current: "?" });
    expect(q("character-preview-name")!.textContent).toBe("Random");
    // Picked: a status, not a button to press again.
    expect(q("character-pick")!.getAttribute("role")).toBe("status");
    expect(q("stage-random")).not.toBeNull();
  });

  it("shows the grid on a phone held sideways, as on every other screen", () => {
    for (const factor of ["tablet-portrait", "phone-portrait", "phone-landscape", "desktop"] as const) {
      formFactor.current = factor;
      const { host } = render({ layout: screenLayout(factor) });
      expect(host.querySelector("[data-testid=tile-grid]")!.hasAttribute("data-stackable"), factor).toBe(true);
      unmount(component!);
      component = undefined;
      document.body.innerHTML = "";
    }
  });

  it("draws Chosen as a label, not a control", () => {
    const { q } = render();
    const label = q("character-pick")!;
    expect(label.tagName).toBe("P");
    expect(label.className).not.toMatch(/ff-aq-control/);
    const source = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/select/CharacterPage.svelte"), "utf8");
    const rule = source.match(/^\s*\.ff-character-page__picked\s*\{([^}]*)\}/m)![1]!;
    expect(rule).not.toMatch(/border:|background:|border-radius:/);
  });

  it("Back and Escape close without a pick, and focus returns to the opener", () => {
    const first = render();
    first.q("character-back")!.click();
    expect(first.onClose).toHaveBeenCalledTimes(1);
    expect(first.onPick).not.toHaveBeenCalled();
    unmount(component!);
    component = undefined;
    expect(document.activeElement).toBe(first.opener);

    document.body.innerHTML = "";
    const second = render();
    second.q("character-page")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect(second.onPick).not.toHaveBeenCalled();
  });

  it("renders before content arrives", () => {
    const { q, host } = render({ content: () => undefined });
    expect(q("character-page")).not.toBeNull();
    expect(host.querySelectorAll("[data-testid=tile]").length).toBe(0);
    expect(q<HTMLButtonElement>("character-pick")?.disabled ?? true).toBe(true);
  });

  it("still renders with storage blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(render().q("character-page")).not.toBeNull();
  });

  it("tones a tile's art until it loads", () => {
    const { tile } = render();
    const frame = tile("ninja")!.querySelector<HTMLElement>(".ff-async")!;
    expect(frame.classList.contains("ff-tile__art")).toBe(true);
    expect(frame.dataset["load"]).toBe("pending");
  });
});
