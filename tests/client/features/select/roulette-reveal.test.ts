import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import RouletteReveal from "../../../../apps/client/src/features/select/RouletteReveal.svelte";
import type { PlayerRow } from "../../../../apps/client/src/features/select/select-model";

let component: ReturnType<typeof mount> | undefined;
const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const ROWS: PlayerRow[] = [
  { seat: 0, name: "Kite", colour: "scarlet", itemId: "snow-shrine", itemLabel: "Snow Shrine", locked: true, local: true },
  { seat: 1, name: "Sable", colour: "cyan", itemId: "sunken-dome", itemLabel: "Sunken Dome", locked: true, local: false },
  { seat: 2, name: "Wren", colour: "gold", itemId: "?", itemLabel: "Random stage", locked: true, local: false },
];
const scene = createRawSnippet((id: () => string) => ({ render: () => `<p data-testid="scene-of">${id()}</p>` }));

function render(props: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  component = mount(RouletteReveal, {
    target: host,
    props: { heading: "Stage", rows: ROWS, winnerSeat: 1, resultLabel: "Sunken Dome", resultByline: "Sable's pick", solo: false, scene, ...props },
  });
  flushSync();
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { host, q };
}

describe("RouletteReveal", () => {
  it("draws one row per player, and steps the highlight down them, the scene following", () => {
    vi.useFakeTimers();
    const { host, q } = render();
    expect(host.querySelectorAll("[data-testid=player-row]")).toHaveLength(3);
    const lit = () => host.querySelector<HTMLElement>("[data-highlight=true]")?.dataset["seat"];
    const first = lit();
    vi.advanceTimersByTime(150);
    flushSync();
    expect(q("scene-of")!.textContent).toBe(ROWS.find((row) => String(row.seat) === lit())!.itemId);
    expect(first).toBeDefined();
  });

  it("lands on the winner, then names the result and whose pick it was", () => {
    vi.useFakeTimers();
    const { host, q } = render();
    expect(q("roulette-byline")).toBeNull();
    vi.advanceTimersByTime(2500);
    flushSync();
    expect(host.querySelector("[data-winner=true]")!.getAttribute("data-seat")).toBe("1");
    expect(q("select-headline")!.textContent).toBe("Sunken Dome");
    expect(q("roulette-byline")!.textContent).toBe("Sable's pick");
    expect(q("scene-of")!.textContent).toBe("sunken-dome");
  });

  it("shows no number under the stage name, even when the room names a seed", () => {
    vi.useFakeTimers();
    const { host, q } = render({ resultDetail: "#048213" });
    vi.advanceTimersByTime(2500);
    flushSync();
    expect(q("roulette-seed")).toBeNull();
    expect(host.textContent).not.toContain("#048213");
  });

  it("names whose pick won inside the winner's row, once it lands", () => {
    vi.useFakeTimers();
    const { host } = render();
    vi.advanceTimersByTime(2500);
    flushSync();
    const winner = host.querySelector<HTMLElement>("[data-winner=true]")!;
    expect(winner.querySelector("[data-testid=roulette-byline]")!.textContent).toBe("Sable's pick");
    expect(host.querySelectorAll("[data-testid=roulette-byline]")).toHaveLength(1);
  });

  it("shows the Random slide for a Random row", () => {
    vi.useFakeTimers();
    const { host, q } = render();
    for (let step = 0; step < 40; step += 1) {
      if (host.querySelector<HTMLElement>("[data-highlight=true]")?.dataset["seat"] === "2") break;
      vi.advanceTimersByTime(50);
      flushSync();
    }
    expect(q("scene-of")!.textContent).toBe("?");
  });

  it("shows the result at once alone, as Your pick", () => {
    const { q } = render({ solo: true, rows: [ROWS[0]], winnerSeat: 0, resultLabel: "Snow Shrine", resultByline: "Your pick" });
    expect(q("roulette")!.hasAttribute("data-filled"), "no art, so the frame stays").toBe(false);
    expect(q("select-headline")!.textContent).toBe("Snow Shrine");
    expect(q("roulette-byline")!.textContent).toBe("Your pick");
  });

  it("shows the result at once under reduced motion", () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    const { q } = render();
    expect(q("roulette-byline")!.textContent).toBe("Sable's pick");
  });

  it("settles on the stage a Random pick resolved to, not the Random slide", () => {
    const { q } = render({ solo: true, rows: [ROWS[2]], winnerSeat: 2, resultId: "rooftops", resultLabel: "Rooftops", resultByline: "Wren's pick" });
    expect(q("scene-of")!.textContent).toBe("rooftops");
  });

  it("announces its result through the headline", () => {
    const { q } = render({ solo: true, rows: [ROWS[0]], winnerSeat: 0, resultLabel: "Snow Shrine", resultByline: "Your pick" });
    expect(q("select-headline")!.getAttribute("aria-live")).toBe("polite");
  });

  it("says once that it has landed, after the spin", () => {
    vi.useFakeTimers();
    const onSettled = vi.fn();
    render({ onSettled });
    expect(onSettled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    flushSync();
    expect(onSettled).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    flushSync();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("says it has landed at once when alone", () => {
    const onSettled = vi.fn();
    render({ solo: true, onSettled });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("grows the result's art out of the scene even alone, when it fills the frame at once", () => {
    // jsdom lays nothing out: the scene stands 100 x 50 inside a 400 x 200 reveal.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const box = this.classList.contains("ff-roulette__fill") ? { left: 0, top: 0, width: 400, height: 200 } : { left: 10, top: 20, width: 100, height: 50 };
      return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box } as DOMRect;
    });
    try {
      const { q } = render({ solo: true, rows: [ROWS[0]], winnerSeat: 0, resultLabel: "Snow Shrine", resultByline: "Your pick", art: () => "snow.png" });
      const fill = q("roulette-fill")!;
      expect(fill.style.width, "the fill starts as large as the scene, not the frame").toBe("100px");
      expect(fill.style.left).toBe("10px");
      expect(q("roulette")!.hasAttribute("data-filled"), "the frame under the art fades out").toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("draws the smaller copy of the result's art under it until the large one loads", () => {
    const { q } = render({
      solo: true, rows: [ROWS[0]], winnerSeat: 0, resultLabel: "Snow Shrine", resultByline: "Your pick",
      art: () => "snow-1200.webp", artBehind: () => "snow-640.webp",
    });
    const img = q("roulette-fill")!.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("snow-1200.webp");
    expect(img.style.backgroundImage).toContain("snow-640.webp");
  });
});
