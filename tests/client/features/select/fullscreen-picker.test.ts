import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import PickerHost from "../../support/PickerHost.svelte";
import type { PickerItem } from "../../../../apps/client/src/features/select/picker-model";

let component: ReturnType<typeof mount> | undefined;
let control: { set?: (next: Record<string, unknown>) => void } = {};
const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

const ITEMS: PickerItem[] = [
  { id: "?", label: "Random stage", state: "open" },
  { id: "rooftops", label: "Rooftops", state: "open" },
  { id: "snow-shrine", label: "Snow Shrine", state: "open" },
  { id: "far", label: "Far Shrine", state: "dlc", reason: "DLC · Far pack" },
];
const slide = createRawSnippet((item: () => PickerItem) => ({ render: () => `<p data-testid="slide-label">${item().label}</p>` }));

function render(props: Record<string, unknown> = {}) {
  const onPick = vi.fn();
  const onLockIn = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  control = {};
  component = mount(PickerHost, {
    target: host,
    props: { control, initial: {
      labels: { kind: "Stage", previous: "Previous stage", next: "Next stage", group: "Stages" },
      heading: "Pick a stage",
      seconds: 12,
      items: ITEMS,
      focusedId: "rooftops",
      rows: [
        { seat: 0, name: "Kite", colour: "scarlet", itemId: "rooftops", itemLabel: "Rooftops", locked: false, local: true },
        { seat: 1, name: "Sable", colour: "cyan", itemId: "snow-shrine", itemLabel: "Snow Shrine", locked: false, local: false },
      ],
      locked: false,
      onPick,
      onLockIn,
      slide,
      ...props,
    } },
  });
  flushSync();
  const q = <T extends HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`);
  const all = (id: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
  return { host, q, all, onPick, onLockIn };
}

describe("the fullscreen picker", () => {
  it("opens on the seat's focus, and is not moved by a later snapshot", () => {
    const { q } = render();
    expect(q("picker")!.dataset["id"]).toBe("rooftops");
    q("picker-next")!.click();
    flushSync();
    expect(q("picker")!.dataset["id"]).toBe("snow-shrine");
    // A snapshot still naming the old focus arrives before the server hears the move.
    control.set!({ focusedId: "rooftops" });
    flushSync();
    expect(q("picker")!.dataset["id"]).toBe("snow-shrine");
  });

  it("a tap on next turns one slide, not two, and picks it", () => {
    const { q, onPick } = render();
    const next = q("picker-next")!;
    next.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 10, pointerId: 1 }));
    next.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 102, clientY: 10, pointerId: 1 }));
    next.click();
    flushSync();
    expect(q("picker")!.dataset["id"]).toBe("snow-shrine");
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("snow-shrine");
  });

  it("wraps, and turns with the page keys and a pad's shoulders", () => {
    const { q } = render({ focusedId: "?" });
    q("picker")!.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
    flushSync();
    expect(q("picker")!.dataset["id"]).toBe("far");
    q("picker")!.dispatchEvent(new CustomEvent("ff-page", { detail: { direction: "next" }, bubbles: true, cancelable: true }));
    flushSync();
    expect(q("picker")!.dataset["id"]).toBe("?");
  });

  it("sends nothing for a locked slide, and says why Lock in is unavailable", () => {
    const { q, onPick } = render({ focusedId: "snow-shrine" });
    q("picker-next")!.click();
    flushSync();
    expect(q("picker")!.dataset["id"]).toBe("far");
    expect(onPick).not.toHaveBeenCalled();
    const lock = q<HTMLButtonElement>("lock-in")!;
    expect(lock.disabled).toBe(true);
    expect(lock.textContent).toContain("DLC · Far pack");
  });

  it("offers a DLC slide's pack as Coming soon, which never locks in (unlockables spec §7.3)", () => {
    const onTeaser = vi.fn();
    const { q, onPick, onLockIn } = render({ focusedId: "snow-shrine", onTeaser });
    q("picker-next")!.click();
    flushSync();
    const lock = q<HTMLButtonElement>("lock-in")!;
    expect(lock.disabled).toBe(false);
    expect(lock.textContent).toContain("Coming soon");
    expect(lock.getAttribute("aria-label")).toBe("DLC · Far pack: coming soon");
    lock.click();
    expect(onTeaser).toHaveBeenCalledWith("far");
    expect(onLockIn).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("offers no Coming soon once the step is locked", () => {
    const onTeaser = vi.fn();
    const { q } = render({ items: [ITEMS[3]!], focusedId: "far", locked: true, onTeaser });
    expect(q<HTMLButtonElement>("lock-in")!.disabled).toBe(true);
  });

  it("stops paging once locked", () => {
    const { q, onPick } = render({ locked: true });
    expect(q<HTMLButtonElement>("picker-next")!.disabled).toBe(true);
    q("picker")!.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    flushSync();
    expect(q("picker")!.dataset["id"]).toBe("rooftops");
    expect(onPick).not.toHaveBeenCalled();
    expect(q("lock-in")!.textContent).toContain("Locked in");
  });

  it("names the stage on screen as the headline, lists the players, and pages by the dots", () => {
    const { q, all } = render();
    expect(q("select-headline")!.textContent).toBe("Rooftops");
    expect(q("picker")!.getAttribute("aria-label")).toBe("Stage, 2 of 4: Rooftops");
    expect(all("player-row")).toHaveLength(2);
    expect(q("picker")!.querySelector("[data-testid=cursor-flag]")).toBeNull();
    const dots = all("picker-dot");
    expect(dots.map((dot) => dot.dataset["id"])).toEqual(["?", "rooftops", "snow-shrine", "far"]);
    dots[3]!.click();
    flushSync();
    expect(q("select-headline")!.textContent).toBe("Far Shrine");
  });


  it("shows the seconds beside Lock in, and the step's heading on screen", () => {
    const { q, onLockIn } = render();
    expect(q("select-seconds")!.textContent).toBe("12 s");
    const heading = q("select-heading")!;
    expect(heading.tagName).toBe("H2");
    expect(heading.classList.contains("sr-only")).toBe(false);
    expect(heading.textContent).toBe("Pick a stage");
    expect(q("select-banner")).toBeNull();
    q("lock-in")!.click();
    expect(onLockIn).toHaveBeenCalled();
  });



  it("tells the step which slide is on screen, open or not, once per turn", () => {
    const onView = vi.fn();
    const { q } = render({ onView });
    expect(onView.mock.calls.map(([item]) => item.id)).toEqual(["rooftops"]);
    q("picker-next")!.click();
    flushSync();
    q("picker-next")!.click();
    flushSync();
    // The DLC slide is on screen too, though it picks nothing.
    expect(onView.mock.calls.map(([item]) => item.id)).toEqual(["rooftops", "snow-shrine", "far"]);
    // A snapshot that changes nothing on screen says nothing.
    control.set!({ seconds: 11 });
    flushSync();
    expect(onView).toHaveBeenCalledTimes(3);
  });
});

describe("the fullscreen picker under review", () => {
  it("turns one slide per arrow key, as the app's window listener offers it (review 1)", () => {
    // The app routes arrow keys through FocusNavigator, which offers `ff-steer`
    // to the focused element; the panel must not also turn on the raw key.
    const offer = (event: KeyboardEvent) => {
      const direction = event.key === "ArrowRight" ? "right" : event.key === "ArrowLeft" ? "left" : undefined;
      if (direction === undefined) return;
      document.activeElement?.dispatchEvent(new CustomEvent("ff-steer", { detail: { direction }, bubbles: true, cancelable: true }));
    };
    window.addEventListener("keydown", offer);
    try {
      const { q } = render({ focusedId: "?" });
      q("picker")!.focus();
      q("picker")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      flushSync();
      expect(q("picker")!.dataset["id"]).toBe("rooftops");
    } finally {
      window.removeEventListener("keydown", offer);
    }
  });

  it("sends a return to the stage the server still names, since it already heard the move (review 2)", () => {
    const { q, onPick } = render();
    q("picker-next")!.click();
    q("picker-previous")!.click();
    flushSync();
    expect(onPick.mock.calls.map(([id]) => id)).toEqual(["snow-shrine", "rooftops"]);
  });

  it("takes a dot tap after a swipe (review 3)", async () => {
    const { q, all, onPick } = render();
    const panel = q("picker")!;
    panel.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 300, clientY: 50, pointerId: 2, button: 0, buttons: 1 }));
    panel.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 50, pointerId: 2, buttons: 1 }));
    panel.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 100, clientY: 50, pointerId: 2 }));
    // A touch swipe sends no click; the next thing the player does is tap a dot.
    await new Promise((resolve) => setTimeout(resolve, 0));
    all("picker-dot")[0]!.click();
    flushSync();
    expect(q("picker")!.dataset["id"]).toBe("?");
    expect(onPick).toHaveBeenLastCalledWith("?");
  });

  it("drops a mouse drag that ended outside the panel (review 4)", () => {
    const { q } = render();
    const panel = q("picker")!;
    panel.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 300, clientY: 50, pointerId: 1, button: 0, buttons: 1, pointerType: "mouse" }));
    panel.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 50, pointerId: 1, buttons: 1, pointerType: "mouse" }));
    // Released off the panel: the next move arrives with no button held.
    panel.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 180, clientY: 50, pointerId: 1, buttons: 0, pointerType: "mouse" }));
    flushSync();
    expect(panel.querySelector<HTMLElement>(".ff-picker__slide")!.style.transform).toBe("");
  });

  it("brings the view to the locked stage, and stops paging the moment Lock in is pressed (review 5)", () => {
    const { q, onPick } = render({ focusedId: "snow-shrine" });
    q("picker-next")!.click();
    flushSync();
    expect(q("picker")!.dataset["id"]).toBe("far");
    control.set!({ locked: true });
    flushSync();
    expect(q("picker")!.dataset["id"]).toBe("snow-shrine");

    unmount(component!);
    component = undefined;
    document.body.innerHTML = "";
    const again = render();
    again.q("lock-in")!.click();
    again.q("picker-next")!.click();
    flushSync();
    expect(again.q("picker")!.dataset["id"]).toBe("rooftops");
    expect(again.onPick).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });



  it("turns one slide per sideways wheel gesture, and leaves an up-and-down wheel alone", async () => {
    const { q, onPick } = render();
    const panel = q("picker")!;
    const wheel = (deltaX: number, deltaY = 0) => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX, deltaY });
      panel.dispatchEvent(event);
      flushSync();
      return event;
    };

    expect(wheel(0, 120).defaultPrevented).toBe(false);
    expect(panel.dataset["id"]).toBe("rooftops");

    // One trackpad swipe arrives as many small deltas: it turns once.
    expect(wheel(25).defaultPrevented).toBe(true);
    wheel(25);
    wheel(25);
    wheel(25);
    expect(panel.dataset["id"]).toBe("snow-shrine");
    expect(onPick).toHaveBeenCalledTimes(1);

    // The next gesture, after the wheel goes quiet, turns again; leftwards turns back.
    await new Promise((resolve) => setTimeout(resolve, 200));
    wheel(-50);
    expect(panel.dataset["id"]).toBe("rooftops");
  });

  it("cuts to the next slide under reduced motion: a drag never slides it, and the still does not pan", () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query })) as never;
    const moving: boolean[] = [];
    const watched = createRawSnippet((item: () => PickerItem, motion: () => boolean) => {
      moving.push(motion());
      return { render: () => `<p data-testid="slide-label">${item().label}</p>` };
    });
    const { q } = render({ slide: watched });
    const panel = q("picker")!;
    const slideBox = panel.querySelector<HTMLElement>(".ff-picker__slide")!;

    panel.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 300, clientY: 50, pointerId: 1, button: 0, buttons: 1 }));
    panel.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 50, pointerId: 1, buttons: 1 }));
    flushSync();
    expect(slideBox.style.transform).toBe("");
    panel.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 100, clientY: 50, pointerId: 1 }));
    flushSync();

    expect(panel.dataset["id"]).toBe("snow-shrine");
    expect(q("slide-label")!.textContent).toBe("Snow Shrine");
    expect(moving.length).toBeGreaterThanOrEqual(2);
    expect(moving.every((motion) => !motion)).toBe(true);
  });

  it("slides with the drag when motion is allowed", () => {
    window.matchMedia = ((query: string) => ({ matches: false, media: query })) as never;
    const { q } = render();
    const panel = q("picker")!;
    panel.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 300, clientY: 50, pointerId: 1, button: 0, buttons: 1 }));
    panel.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 50, pointerId: 1, buttons: 1 }));
    flushSync();
    expect(panel.querySelector<HTMLElement>(".ff-picker__slide")!.style.transform).toBe("translateX(-100px)");
  });

  it("announces a page turn once: the headline is not also a live region", () => {
    const { q } = render();
    expect(q("select-headline")!.hasAttribute("aria-live")).toBe(false);
  });
});

describe("the stage slide", () => {
  it("carries no name of its own: the panel's headline names the stage", async () => {
    const { default: StageSlide } = await import("../../../../apps/client/src/features/select/StageSlide.svelte");
    const host = document.createElement("div");
    document.body.append(host);
    component = mount(StageSlide, { target: host, props: { item: { id: "rooftops", label: "Rooftops", state: "open", art: "/x.png" }, pan: false } });
    flushSync();
    expect(host.textContent!.trim()).toBe("");
  });

  it("reveals a new slide when the player moves off it, not while it is on screen (unlockables spec §7.2)", () => {
    const onReveal = vi.fn();
    const items: PickerItem[] = [
      { id: "?", label: "Random stage", state: "open" },
      { id: "rooftops", label: "Rooftops", state: "open", isNew: true },
      { id: "snow-shrine", label: "Snow Shrine", state: "open" },
    ];
    const { q } = render({ items, onReveal });
    expect(q("picker")!.getAttribute("aria-label")).toBe("Stage, 2 of 3: Rooftops, new");
    expect(onReveal).not.toHaveBeenCalled();
    q("picker-next")!.click();
    flushSync();
    expect(onReveal).toHaveBeenCalledWith("rooftops");
    expect(onReveal).toHaveBeenCalledTimes(1);
  });
});

describe("the picker's position and arrows (spec §6.4)", () => {
  const openItem = (id: string): PickerItem => ({ id, label: id, state: "open" });
  /** The file's `render`, with the items under test and the first one in focus. */
  const renderPicker = (props: { items: PickerItem[] }) => render({ ...props, focusedId: props.items[0]!.id });

  it("draws its dots inside the glass card, beside the headline", () => {
    const { host } = renderPicker({ items: Array.from({ length: 5 }, (_, i) => openItem(`s${i}`)) });
    const panel = host.querySelector(".ff-frame__panel")!;
    expect(panel.querySelectorAll("[data-testid=picker-dot]")).toHaveLength(5);
  });

  it("switches to a counter past nine items, so the dots never wrap", () => {
    const { host } = renderPicker({ items: Array.from({ length: 11 }, (_, i) => openItem(`s${i}`)) });
    expect(host.querySelectorAll("[data-testid=picker-dot]")).toHaveLength(0);
    expect(host.querySelector("[data-testid=pager-counter]")!.textContent).toBe("1 / 11");
  });

  it("keeps the arrows inside the slide's edges, not in gutters and not over its middle", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/select/FullscreenPicker.svelte"), "utf8");
    expect(source).not.toMatch(/\.ff-picker__panel\s*\{[^}]*grid-template-columns/);
    expect(source).toMatch(/\.ff-picker__arrow--previous\)?\s*\{\s*left:/);
    expect(source).toMatch(/\.ff-picker__arrow--next\)?\s*\{\s*right:/);
  });
});
