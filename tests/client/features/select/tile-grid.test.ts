import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import TileGrid from "../../../../apps/client/src/features/select/TileGrid.svelte";
import type { PackGroup } from "../../../../apps/client/src/features/select/tile-pages";

// The grid as the Character page uses it (select spec §6.1, §6.3): bust
// chips, the arrows at the row's sides, no dots, no "1 of 2", your seat's
// flag only on your own chip, and every tap the page's to decide.

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-form-factor");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const GROUPS: PackGroup[] = [
  {
    packId: "base",
    title: "Base",
    items: [
      { id: "ninja", label: "Ninja", state: "open" },
      { id: "frog", label: "Frog", state: "locked", hint: "Finish 5 games", progress: "2/5" },
      { id: "diver", label: "Diver", state: "locked", hint: "Finish 20 games" },
    ],
  },
  { packId: "friends", title: "Friends", items: [{ id: "robo", label: "Robo", state: "dlc" }, { id: "kitsune", label: "Kitsune", state: "dlc" }] },
];
const MOST = { "phone-portrait": { columns: 3, rows: 1 }, "phone-landscape": { columns: 3, rows: 1 }, "tablet-portrait": { columns: 4, rows: 1 }, desktop: { columns: 4, rows: 1 } } as const;

function render(props: Partial<Record<string, unknown>> = {}) {
  document.documentElement.dataset["formFactor"] = "tablet-portrait";
  const onPress = vi.fn();
  const announce = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const focusedId = (props["focusedId"] as string | undefined) ?? "ninja";
  component = mount(TileGrid, {
    target: host,
    props: {
      label: "Character",
      groups: GROUPS,
      most: MOST["tablet-portrait"],
      focusedId,
      cursors: [{ itemId: focusedId, seat: 0, colour: "violet" }],
      random: { label: "Random character" },
      onPress,
      announce,
      ...props,
    },
  });
  flushSync();
  const q = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector);
  const all = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
  const tile = (id: string) => all("[data-testid=tile]").find((element) => element.dataset["id"] === id)!;
  /** The page in view: the one page that is not inert. */
  const shown = () => all("[data-testid=tile-page]").findIndex((page) => !page.inert);
  return { host, q, all, tile, shown, onPress, announce };
}

function sized(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(height);
}

describe("TileGrid chips", () => {
  it("fills its box only when asked, so a content-sized panel never measures its own tiles", () => {
    expect(render().q("[data-testid=tile-grid]")!.hasAttribute("data-fill")).toBe(false);
    unmount(component!);
    component = undefined;
    document.body.innerHTML = "";
    expect(render({ fitHeight: true }).q("[data-testid=tile-grid]")!.hasAttribute("data-fill")).toBe(true);
  });

  it("puts one pack on a page, named only for assistive technology", () => {
    const { all, q } = render();
    const pages = all("[data-testid=tile-page]");
    expect(pages.map((page) => page.dataset["title"])).toEqual(["Base", "Friends"]);
    expect(pages[0]!.getAttribute("aria-label")).toBe("Base, page 1 of 2");
    expect(q("[data-testid=tile-grid]")!.textContent).not.toContain("Base");
  });

  it("draws a chip as its face alone, named in full with its lock", () => {
    const { tile } = render();
    expect(tile("frog").dataset["state"]).toBe("locked");
    expect(tile("frog").textContent).not.toContain("Frog");
    expect(tile("frog").textContent).not.toContain("Finish");
    expect(tile("frog").querySelector("[data-testid=tile-lock]")).not.toBeNull();
    expect(tile("frog").getAttribute("aria-label")).toBe("Frog, locked: Finish 5 games, 2/5");
  });

  it("pills a DLC chip and names it so", () => {
    const { tile } = render();
    expect(tile("robo").dataset["state"]).toBe("dlc");
    expect(tile("robo").querySelector("[data-testid=tile-dlc]")!.textContent).toBe("DLC");
    expect(tile("robo").getAttribute("aria-label")).toBe("Robo, DLC");
  });

  it("sets ? on a line of its own above the pages, with its word on it", () => {
    const { q } = render();
    const random = q("[data-testid=tile-random]")!;
    expect(random.closest("[data-testid=tile-page]")).toBeNull();
    expect(random.closest(".ff-tiles__row")).toBeNull();
    expect(random.getAttribute("aria-label")).toBe("Random character");
    expect(random.textContent).toContain("Random character");
  });

  it("outlines the viewed chip apart from the chosen one", () => {
    const { tile } = render({ previewId: "frog" });
    expect(tile("frog").dataset["previewed"]).toBe("true");
    expect(tile("frog").dataset["focused"]).toBe("false");
    expect(tile("ninja").dataset["focused"]).toBe("true");
  });
});

describe("TileGrid seat flag", () => {
  it("flags your own chip with your seat, in your colour", () => {
    const { all, tile } = render();
    const flags = all("[data-testid=cursor-flag]");
    expect(flags.map((flag) => flag.textContent)).toEqual(["P1"]);
    expect(flags[0]!.closest("[data-testid=tile]")).toBe(tile("ninja"));
    expect(flags[0]!.classList.contains("ff-colour-violet")).toBe(true);
    expect(tile("ninja").classList.contains("ff-colour-violet")).toBe(true);
  });

  it("flags nothing else when your chip is on another page: no arrow, no dot, no '1 of 2'", () => {
    const { q, all, shown } = render({ focusedId: "robo" });
    q<HTMLButtonElement>("[data-testid=page-next]")!.click();
    flushSync();
    expect(shown()).toBe(0);
    expect(all("[data-testid=cursor-flag]")).toHaveLength(1);
    for (const arrow of ["page-next", "page-previous"]) {
      expect(q(`[data-testid=${arrow}]`)!.textContent!.trim()).toBe("");
      expect(q(`[data-testid=${arrow}] svg`)).not.toBeNull();
    }
    expect(q("[data-testid=page-dot]")).toBeNull();
    expect(q("[data-testid=tile-grid]")!.textContent).not.toMatch(/\d of \d/);
  });
});

describe("TileGrid paging", () => {
  it("sets its arrows at the row's sides, around the pages", () => {
    const { q } = render();
    const row = q(".ff-tiles__row")!;
    const children = [...row.children].map((child) => child.getAttribute("data-testid") ?? child.className);
    expect(children[0]).toBe("page-previous");
    expect(children.at(-1)).toBe("page-next");
  });

  it("pages with the arrows, wrapping, and says where it is to assistive technology", () => {
    const { q, shown, announce } = render();
    expect(shown()).toBe(0);
    q<HTMLButtonElement>("[data-testid=page-next]")!.click();
    flushSync();
    expect(shown()).toBe(1);
    expect(announce).toHaveBeenLastCalledWith("Friends, page 2 of 2");
    q<HTMLButtonElement>("[data-testid=page-next]")!.click();
    flushSync();
    expect(shown()).toBe(0);
    q<HTMLButtonElement>("[data-testid=page-previous]")!.click();
    flushSync();
    expect(shown()).toBe(1);
  });

  it("draws no arrows when there is one page", () => {
    const { q } = render({ groups: [GROUPS[0]!] });
    expect(q("[data-testid=page-next]")).toBeNull();
    expect(q("[data-testid=page-previous]")).toBeNull();
  });

  it("brings the chosen chip's page into view", () => {
    expect(render({ focusedId: "robo" }).shown()).toBe(1);
  });

  it("pages on the pad's ff-page and on Page Down, Page Up, E and Q", () => {
    const { tile, shown } = render();
    const ninja = tile("ninja");
    ninja.focus();
    ninja.dispatchEvent(new CustomEvent("ff-page", { detail: { direction: "next" }, bubbles: true, cancelable: true }));
    flushSync();
    expect(shown()).toBe(1);
    for (const [key, page] of [["PageDown", 0], ["PageUp", 1], ["e", 0], ["q", 1]] as const) {
      ninja.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      flushSync();
      expect(shown(), key).toBe(page);
    }
  });

  it("turns the page when steered past the last column", () => {
    const { tile, shown } = render({ groups: [{ ...GROUPS[0]!, items: [...GROUPS[0]!.items, { id: "x", label: "X", state: "open" }, { id: "y", label: "Y", state: "open" }] }] });
    const last = tile("x");
    last.focus();
    const event = new CustomEvent("ff-steer", { detail: { direction: "right" }, bubbles: true, cancelable: true });
    last.dispatchEvent(event);
    flushSync();
    expect(event.defaultPrevented).toBe(true);
    expect(shown()).toBe(1);
  });

  it("a drag never presses", () => {
    const { q, tile, onPress } = render();
    const track = q("[data-testid=tile-track]")!;
    track.dispatchEvent(new PointerEvent("pointerdown", { clientX: 200, clientY: 10, pointerId: 1, bubbles: true }));
    track.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, clientY: 10, pointerId: 1, bubbles: true }));
    track.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 10, pointerId: 1, bubbles: true }));
    tile("ninja").click(); // the click a browser sends after the drag
    flushSync();
    expect(onPress).not.toHaveBeenCalled();
  });

  it("a touch swipe turns the page, though the chip under the finger loses its capture", () => {
    const { q, tile, shown } = render();
    const track = q("[data-testid=tile-track]")!;
    const ninja = tile("ninja");
    // A touch is captured to the chip it lands on; the track taking the
    // capture for the drag sends that chip a lostpointercapture, which bubbles.
    ninja.dispatchEvent(new PointerEvent("pointerdown", { clientX: 200, clientY: 10, pointerId: 1, pointerType: "touch", bubbles: true }));
    ninja.dispatchEvent(new PointerEvent("pointermove", { clientX: 150, clientY: 10, pointerId: 1, pointerType: "touch", bubbles: true }));
    ninja.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1, pointerType: "touch", bubbles: true }));
    track.dispatchEvent(new PointerEvent("pointermove", { clientX: 20, clientY: 10, pointerId: 1, pointerType: "touch", bubbles: true }));
    track.dispatchEvent(new PointerEvent("pointerup", { clientX: 20, clientY: 10, pointerId: 1, pointerType: "touch", bubbles: true }));
    flushSync();
    expect(shown()).toBe(1);
  });
});

describe("TileGrid presses", () => {
  it("reports every tap, whatever the chip's state, and ? as ?", () => {
    const { q, tile, onPress } = render();
    tile("frog").click();
    tile("ninja").click();
    q<HTMLElement>("[data-testid=tile-random]")!.click();
    expect(onPress.mock.calls.map(([id]) => id)).toEqual(["frog", "ninja", "?"]);
  });

  it("leaves a locked or DLC chip enabled, so the page can show what it costs", () => {
    const { tile, onPress } = render({ focusedId: "robo" });
    expect(tile("frog").hasAttribute("aria-disabled")).toBe(false);
    expect(tile("robo").hasAttribute("aria-disabled")).toBe(false);
    tile("robo").click();
    expect(onPress).toHaveBeenCalledWith("robo");
  });
});

describe("TileGrid stacked", () => {
  it("stacks every pack as an untitled section when they all fit, ? on its line above them", () => {
    sized(344, 400);
    const { all, q } = render({ stack: true, fitHeight: true });
    expect(q("[data-testid=tile-stack]")).not.toBeNull();
    const sections = all("[data-testid=tile-section]");
    expect(sections.map((section) => section.getAttribute("aria-label"))).toEqual(["Base", "Friends"]);
    expect(q("[data-testid=tile-stack]")!.textContent).not.toContain("Base");
    expect(q("[data-testid=tile-random]")!.closest("[data-testid=tile-stack]")).toBeNull();
    expect(q("[data-testid=page-next]")).toBeNull();
  });

  it("pages when the packs do not fit", () => {
    sized(344, 120);
    const { q } = render({ stack: true, fitHeight: true });
    expect(q("[data-testid=tile-stack]")).toBeNull();
    expect(q("[data-testid=page-next]")).not.toBeNull();
  });

  it("never stacks unless asked", () => {
    sized(344, 400);
    expect(render({ fitHeight: true }).q("[data-testid=tile-stack]")).toBeNull();
  });
});

describe("TileGrid sizing", () => {
  // The pinned ? chip sits in the row beside the viewport and is a tile wide,
  // so a size read from the viewport shrinks the viewport it was read from:
  // the tiles flickered a pixel every frame and could not be clicked (select
  // flow, 2026-09-30). The size comes from the whole row.
  it("sizes chips from the row, whatever the viewport measures", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ff-tiles__viewport") ? 300 : 400;
    });
    const { q } = render({ groups: [GROUPS[0]!] });
    const tile = parseFloat(q("[data-testid=tile-grid]")!.style.getPropertyValue("--ff-tile"));
    // 400 less the outline room (2 x 4), shared by the three columns the
    // pack fills (fitColumns: no empty slots beside a short roster), with two
    // gaps between them: 125 px. The ? has a line of its own.
    expect(tile).toBe(Math.floor((400 - 2 * 4 - 2 * 8) / 3));
  });

  // Review finding 4: the shape counted the ? chip but not the side arrows, so
  // a narrow paged row took four columns its tiles could only fill at below
  // the smallest tile, and the viewport clipped the last one.
  it("takes only the columns that fit once the arrows have their room", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(330);
    const { q } = render();
    const style = q("[data-testid=tile-grid]")!.style;
    const columns = Number(style.getPropertyValue("--ff-tile-columns"));
    const tile = parseFloat(style.getPropertyValue("--ff-tile"));
    // Row: 2 x 4 outline room, two arrows with their gaps (2 x 52), then the
    // columns, each a tile and a gap.
    expect(8 + 104 + columns * (tile + 8)).toBeLessThanOrEqual(330 + 8);
  });

  it("a tile earned by play flips once, wears NEW until focused, and says so (unlockables spec §7.2)", () => {
    const onReveal = vi.fn();
    const groups: PackGroup[] = [{ packId: "base", title: "Base", items: [{ id: "ninja", label: "Ninja", state: "open" }, { id: "frog", label: "Frog", state: "open", isNew: true }] }];
    const { tile } = render({ groups, onReveal });
    const frog = tile("frog");
    expect(frog.getAttribute("aria-label")).toBe("Frog, new");
    expect(frog.dataset["reveal"]).toBe("flip");
    expect(frog.querySelector("[data-testid=tile-new]")!.textContent).toBe("NEW");
    frog.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(frog.dataset["reveal"]).toBe("done");
    expect(onReveal).not.toHaveBeenCalled();
    frog.focus();
    expect(onReveal).toHaveBeenCalledWith("frog");
  });

  it("a tap on a new tile reveals it too", () => {
    const onReveal = vi.fn();
    const groups: PackGroup[] = [{ packId: "base", title: "Base", items: [{ id: "frog", label: "Frog", state: "open", isNew: true }] }];
    const { tile } = render({ groups, onReveal, focusedId: undefined });
    tile("frog").click();
    expect(onReveal).toHaveBeenCalledWith("frog");
  });

  it("cross-fades rather than flips under reduced motion", () => {
    // jsdom has no matchMedia to spy on, so the test supplies one.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }) as MediaQueryList);
    const groups: PackGroup[] = [{ packId: "base", title: "Base", items: [{ id: "frog", label: "Frog", state: "open", isNew: true }] }];
    expect(render({ groups }).tile("frog").dataset["reveal"]).toBe("fade");
  });

  it("a tile that is not new has no reveal, no pill, and reveals nothing on focus", () => {
    const onReveal = vi.fn();
    const { tile } = render({ onReveal });
    const ninja = tile("ninja");
    expect(ninja.dataset["reveal"]).toBeUndefined();
    expect(ninja.querySelector("[data-testid=tile-new]")).toBeNull();
    ninja.focus();
    expect(onReveal).not.toHaveBeenCalled();
  });
});
