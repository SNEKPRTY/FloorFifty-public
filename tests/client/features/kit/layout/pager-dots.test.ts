import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PagerDots from "../../../../../apps/client/src/features/kit/layout/PagerDots.svelte";
import { installFakeResizeObserver } from "../../../support/resize-observer";

let component: ReturnType<typeof mount> | undefined;
let fake: ReturnType<typeof installFakeResizeObserver>;
beforeEach(() => {
  fake = installFakeResizeObserver();
});
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
  fake.restore();
});

function open(count: number, index: number, onSelect = vi.fn()) {
  const target = document.createElement("div");
  document.body.append(target);
  component = mount(PagerDots, { target, props: { count, index, onSelect, label: "Songs" } });
  flushSync();
  return target;
}

describe("PagerDots (UI layout system §5, audit m4)", () => {
  it("shows one dot per page, the current one marked, and jumps on a tap", () => {
    const onSelect = vi.fn();
    const target = open(5, 2, onSelect);
    const dots = target.querySelectorAll<HTMLButtonElement>("[data-pager-dot]");
    expect(dots).toHaveLength(5);
    expect(dots[2]!.getAttribute("aria-current")).toBe("true");
    dots[4]!.click();
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it("carries a test id, an id and a label per dot when given them", () => {
    const target = document.createElement("div");
    document.body.append(target);
    component = mount(PagerDots, {
      target,
      props: { count: 2, index: 0, label: "Stages", testId: "picker-dot", ids: ["rooftops", "snow-shrine"], labels: ["Rooftops", "Snow Shrine"] },
    });
    flushSync();
    const dots = [...target.querySelectorAll<HTMLElement>("[data-testid=picker-dot]")];
    expect(dots.map((dot) => dot.dataset["id"])).toEqual(["rooftops", "snow-shrine"]);
    expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual(["Rooftops", "Snow Shrine"]);
  });

  it("becomes a counter past nine pages, rather than a second row", () => {
    const target = open(11, 2);
    expect(target.querySelectorAll("[data-pager-dot]")).toHaveLength(0);
    expect(target.querySelector('[data-testid="pager-counter"]')!.textContent).toBe("3 / 11");
  });

  it("becomes a counter when its card is too narrow for the dots", () => {
    const target = open(6, 0);
    fake.resize(200); // six 44 px dots need 264
    flushSync();
    expect(target.querySelector('[data-testid="pager-counter"]')!.textContent).toBe("1 / 6");
  });
});
