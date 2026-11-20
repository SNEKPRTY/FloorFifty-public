import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import ScrollList from "../../../../../apps/client/src/features/kit/layout/ScrollList.svelte";
import { FocusNavigator, tabbables } from "../../../../../apps/client/src/features/platform/focus-nav";
import * as m from "../../../../../apps/client/src/paraglide/messages.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

const rows = (count: number) =>
  createRawSnippet(() => ({
    render: () =>
      `<ol>${Array.from({ length: count }, (_, i) => `<li data-row>Row ${i + 1}</li>`).join("")}</ol>`,
  }));

/** The line of its own under a list, where "more" is said. */
const more = (list: HTMLElement): Element | null => list.parentElement!.querySelector('[data-testid="scroll-more"]');

function open(minRows: number, rowCount: number) {
  const host = document.createElement("div");
  document.body.append(host);
  component = mount(ScrollList, {
    target: host,
    props: { minRows, rowCount, label: "Standings", testId: "standings", children: rows(rowCount) },
  });
  flushSync();
  return host.querySelector<HTMLElement>('[data-testid="standings"]')!;
}

describe("ScrollList (UI layout system §5)", () => {
  function overflow(list: HTMLElement, height = 80): void {
    Object.defineProperty(list, "clientHeight", { configurable: true, value: height });
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 240 });
    for (const row of list.querySelectorAll<HTMLElement>("[data-row]"))
      Object.defineProperty(row, "offsetHeight", { configurable: true, value: 40 });
    list.dispatchEvent(new Event("scroll"));
    flushSync();
  }

  it("lets the focus navigator read overflowing rows, then leave at an edge", () => {
    const list = open(1, 6);
    overflow(list);
    expect(tabbables(document)).toContain(list);
    const next = document.createElement("button");
    list.after(next);
    const navigation = new FocusNavigator(() => document);
    list.focus();
    expect(navigation.steer("down")).toBe(true);
    expect(list.scrollTop).toBe(40);
    expect(navigation.page("next")).toBe(true);
    expect(list.scrollTop).toBe(120);
    expect(navigation.steer("down")).toBe(true);
    expect(list.scrollTop).toBe(160);
    flushSync();
    expect(tabbables(document), "a bottom-scrolled list stays in the focus order").toContain(list);
    expect(navigation.steer("down")).toBe(false);
    navigation.move("next");
    expect(document.activeElement).toBe(next);
    list.focus();
    expect(navigation.steer("up")).toBe(true);
    expect(list.scrollTop).toBe(120);
  });

  it("leaves its child controls' directional navigation alone", () => {
    const list = open(1, 6);
    overflow(list);
    const option = document.createElement("button");
    list.append(option);
    option.focus();
    expect(new FocusNavigator(() => document).steer("down")).toBe(false);
    expect(list.scrollTop).toBe(0);
  });

  it("lets a down step enter its own enabled controls rather than scroll past them", () => {
    // A pad player in Settings reached the first slider only after a dozen
    // presses scrolled the whole list (2026-11-18, gamepad.spec).
    const list = open(1, 6);
    overflow(list);
    const option = document.createElement("button");
    list.querySelector("li")!.append(option);
    const navigation = new FocusNavigator(() => document);
    list.focus();
    expect(navigation.steer("down"), "the region kept the step for a scroll").toBe(false);
    expect(list.scrollTop).toBe(0);
    navigation.move("next");
    expect(document.activeElement).toBe(option);
  });

  it("scrolls a row at a time until its first control is in view, so no row above it is skipped", () => {
    // In the Controls tab the first control is the touch guide at the foot;
    // jumping to it skipped the keyboard rows (review of #179, R1).
    const list = open(1, 6);
    overflow(list);
    const option = document.createElement("button");
    list.querySelectorAll("li")[5]!.append(option);
    const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) });
    list.getBoundingClientRect = () => rect(0, 80);
    option.getBoundingClientRect = () => rect(200 - list.scrollTop, 40);
    const navigation = new FocusNavigator(() => document);
    list.focus();
    const seen: number[] = [];
    while (navigation.steer("down")) seen.push(list.scrollTop);
    expect(seen, "each step scrolls one row until the control is in view").toEqual([40, 80, 120, 160]);
    navigation.move("next");
    expect(document.activeElement).toBe(option);
  });

  it("lets focus leave at the foot when the browser rounds the scroll position", () => {
    // A browser keeps scrollTop on whole device pixels: with a foot at 657.6 it
    // reads back 657, and every down step re-scrolled the same 0.6 px and kept
    // focus forever (pause menu, gamepad.spec with the stick, 2026-11-18).
    const list = open(1, 6);
    overflow(list);
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 237.6 });
    let top = 0;
    Object.defineProperty(list, "scrollTop", { configurable: true, get: () => top, set: (value: number) => {
        top = Math.floor(value);
      } });
    const navigation = new FocusNavigator(() => document);
    list.focus();
    let steps = 0;
    while (navigation.steer("down") && steps < 20) steps += 1;
    expect(steps, "down steps before focus may leave").toBeLessThan(6);
    expect(list.scrollTop).toBe(157);
  });

  it("does not add a focus stop when every row fits", () => {
    const list = open(1, 6);
    overflow(list, 240);
    expect(tabbables(document)).not.toContain(list);
  });

  it("declares itself a scroll region with its minimum, for the screen contract", () => {
    const list = open(4, 6);
    expect(list.hasAttribute("data-scroll-region")).toBe(true);
    expect(list.dataset["minRows"]).toBe("4");
    expect(list.getAttribute("aria-label")).toBe("Standings");
  });

  it("reserves its rows in the row-height token, or every row when there are fewer", () => {
    expect(open(4, 6).style.minHeight).toBe("calc(4 * var(--ff-row-h))");
    document.body.innerHTML = "";
    expect(open(4, 2).style.minHeight).toBe("calc(2 * var(--ff-row-h))");
  });

  it("reserves the gaps between its rows too, when told them", () => {
    const host = document.createElement("div");
    document.body.append(host);
    component = mount(ScrollList, {
      target: host,
      props: { minRows: 4, rowCount: 6, rowGap: "8px", label: "Standings", testId: "standings", children: rows(6) },
    });
    flushSync();
    expect(host.querySelector<HTMLElement>('[data-testid="standings"]')!.style.minHeight).toBe("calc(4 * var(--ff-row-h) + 3 * 8px)");
  });

  it("reserves at least where its last reserved row actually ends, once rows have a height", () => {
    // A taller first row (the local racer's badges) must not cost the last one.
    const list = open(2, 4);
    const heights = [70, 40, 40, 40];
    list.querySelectorAll<HTMLElement>("[data-row]").forEach((row, index) =>
      Object.defineProperty(row, "offsetHeight", { configurable: true, value: heights[index] }),
    );
    list.dispatchEvent(new Event("scroll"));
    flushSync();
    expect(list.style.minHeight).toBe("max(calc(2 * var(--ff-row-h)), 110px)");
  });

  it("says how many rows are out of view, and nothing when none are", () => {
    const list = open(2, 5);
    expect(more(list)).toBeNull();

    // jsdom has no layout: give the list a 120 px view and its rows 40 px each.
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 120 });
    for (const row of list.querySelectorAll<HTMLElement>("[data-row]"))
      Object.defineProperty(row, "offsetHeight", { configurable: true, value: 40 });
    list.dispatchEvent(new Event("scroll"));
    flushSync();

    expect(more(list)?.textContent).toBe(m.shell_more({ count: 2 }));
    expect(more(list)?.textContent).toBe("2 more ↓");
    expect(list.dataset["more"]).toBe("true");

    Object.defineProperty(list, "scrollTop", { configurable: true, value: 80 });
    list.dispatchEvent(new Event("scroll"));
    flushSync();
    expect(more(list)).toBeNull();
  });

  it("puts the more line under the list, in flow, never over a row", () => {
    const list = open(2, 5);
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 120 });
    for (const row of list.querySelectorAll<HTMLElement>("[data-row]"))
      Object.defineProperty(row, "offsetHeight", { configurable: true, value: 40 });
    list.dispatchEvent(new Event("scroll"));
    flushSync();
    const line = more(list)!;
    // A sibling after the scroller, not a child of it: it cannot sit on a row.
    expect(list.contains(line)).toBe(false);
    expect(list.nextElementSibling).toBe(line.parentElement);
    const source = readFileSync(resolve(import.meta.dirname, "../../../../../apps/client/src/features/kit/layout/ScrollList.svelte"), "utf8");
    expect(source).not.toMatch(/position:\s*(absolute|sticky)/);
  });

  it("reserves the more line in its minimum height while rows may be hidden, and not when every row is reserved", () => {
    const frame = open(2, 5).parentElement!;
    expect(frame.style.minHeight).toBe("calc(calc(2 * var(--ff-row-h)) + var(--ff-more-line))");
    document.body.innerHTML = "";
    expect(open(5, 5).parentElement!.style.minHeight).toBe("");
  });
  it("counts rows set side by side by where they end, not as if stacked (the tablet's podium)", () => {
    // Three podium cards share the first line, 100 px tall, and the fourth
    // row runs under them: everything ends by 160 px, inside a 200 px view.
    const list = open(4, 4);
    const boxes = [
      { top: 0, height: 100 },
      { top: 0, height: 100 },
      { top: 0, height: 100 },
      { top: 112, height: 48 },
    ];
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 200 });
    list.getBoundingClientRect = () => new DOMRect(0, 50, 600, 200);
    list.querySelectorAll<HTMLElement>("[data-row]").forEach((row, index) => {
      const box = boxes[index]!;
      Object.defineProperty(row, "offsetTop", { configurable: true, value: box.top });
      Object.defineProperty(row, "offsetHeight", { configurable: true, value: box.height });
      row.getBoundingClientRect = () => new DOMRect(index * 200, 50 + box.top, 190, box.height);
    });
    list.dispatchEvent(new Event("scroll"));
    flushSync();
    expect(list.querySelector('[data-testid="scroll-more"]')).toBeNull();
    // Rows that share lines reserve where they end, not four rows of the
    // token: four stacked rows' height left the podium (and two-across seats)
    // with empty space under them.
    expect(list.style.minHeight).toBe("160px");
  });
});
