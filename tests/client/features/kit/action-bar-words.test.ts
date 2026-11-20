import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import ActionBar from "../../../../apps/client/src/features/kit/layout/ActionBar.svelte";

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

const icon = (() => {}) as never;
const actions = [
  { id: "a-one", label: "Full screen", icon, kind: "utility" as const, onSelect: () => {} },
  { id: "a-two", label: "Tutorial", icon, kind: "utility" as const, onSelect: () => {} },
];
// A bar far too narrow for its one row: the level any measuring would choose is the last.
const narrow = () => ({ available: 10, widths: [300, 200, 100] as [number, number, number] });

describe("an action bar that keeps its words", () => {
  it("never drops a utility to its icon, however narrow the bar is", () => {
    component = mount(ActionBar, { target: document.body, props: { actions, measure: narrow, keepWords: true } });
    flushSync();
    const bar = document.querySelector("[data-action-bar]")!;
    expect(bar.getAttribute("data-collapse")).toBe("3");
    for (const id of ["a-one", "a-two"]) {
      const button = bar.querySelector(`[data-row="visible"] [data-testid="${id}"]`)!;
      expect(button.textContent?.trim()).not.toBe("");
      expect(button.hasAttribute("aria-label")).toBe(false);
    }
  });

  it("still drops to icons where it is not asked to keep them", () => {
    component = mount(ActionBar, { target: document.body, props: { actions, measure: () => ({ available: 250, widths: [300, 200, 100] }) } });
    flushSync();
    expect(document.querySelector("[data-action-bar]")!.getAttribute("data-collapse")).toBe("1");
  });
});
