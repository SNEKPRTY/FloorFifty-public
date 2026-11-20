import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScreenFrame from "../../../../../apps/client/src/features/kit/layout/ScreenFrame.svelte";
import CornerControls from "../../../../../apps/client/src/features/kit/layout/CornerControls.svelte";
import Split from "../../../../../apps/client/src/features/kit/layout/Split.svelte";
import { fakeSettings } from "../../../support/fakes/settings";
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

const text = (id: string) => createRawSnippet(() => ({ render: () => `<p data-testid="${id}">${id}</p>` }));

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

describe("CornerControls (UI layout system §5, audit m2)", () => {
  it("shows Mute by default and Back only when there is somewhere to go back to", () => {
    const target = host();
    component = mount(CornerControls, { target, props: { settings: fakeSettings() } });
    flushSync();
    expect(target.querySelector("[data-corner-controls]")).not.toBeNull();
    expect(target.querySelectorAll('[data-testid="corner-mute"]')).toHaveLength(1);
    expect(target.querySelector('[data-testid="corner-back"]')).toBeNull();
  });

  it("goes back under the test id its screen has always had, and mutes through its settings", () => {
    const back = vi.fn();
    const settings = fakeSettings();
    const target = host();
    component = mount(CornerControls, { target, props: { settings, back, backTestId: "lobby-back" } });
    flushSync();
    expect(target.querySelector('[data-testid="corner-back"]')).toBeNull();
    target.querySelector<HTMLButtonElement>('[data-testid="lobby-back"]')!.click();
    expect(back).toHaveBeenCalledTimes(1);
    target.querySelector<HTMLButtonElement>('[data-testid="corner-mute"]')!.click();
    expect(settings.value.audio.muted).toBe(true);
  });

  it("holds a header between the corners, in the same row (the ready room's code)", () => {
    const target = host();
    component = mount(CornerControls, { target, props: { settings: fakeSettings(), back: vi.fn(), header: text("room-code") } });
    flushSync();
    const middle = target.querySelector(".ff-corners__middle")!;
    expect(middle.querySelector('[data-testid="room-code"]')).not.toBeNull();
    const row = target.querySelector("[data-corner-controls]")!;
    // The first class: Svelte adds its scoping class after it.
    expect([...row.children].map((child) => child.classList[0])).toEqual([
      "ff-corners__start",
      "ff-corners__middle",
      "ff-corners__end",
    ]);
  });

  it("leaves Mute out where a screen has its own (the pause menu)", () => {
    const target = host();
    component = mount(CornerControls, { target, props: { settings: fakeSettings(), mute: false, back: vi.fn() } });
    flushSync();
    expect(target.querySelector('[data-testid="corner-mute"]')).toBeNull();
  });
});

describe("ScreenFrame (UI layout system §5)", () => {
  it.each(["stack", "split", "rail"] as const)("lays its %s arrangement out with the corners in it", (arrangement) => {
    const target = host();
    component = mount(ScreenFrame, {
      target,
      props: {
        arrangement,
        settings: fakeSettings(),
        hero: text("hero"),
        body: text("body"),
        actions: text("actions"),
        testId: "frame",
      },
    });
    flushSync();
    const frame = target.querySelector<HTMLElement>('[data-testid="frame"]')!;
    expect(frame.hasAttribute("data-screen-frame")).toBe(true);
    expect(frame.classList.contains("ff-screen-frame")).toBe(true);
    expect(frame.dataset["arrangement"]).toBe(arrangement);
    // The corners are the frame's first row, in flow.
    expect(frame.firstElementChild?.hasAttribute("data-corner-controls")).toBe(true);
    // The hero and the body sit in the content area; the body is the `ff-screen`
    // size container compositions query (its CSS sets `container: ff-screen / size`;
    // jsdom does not compute it, so the hook is the class).
    const content = frame.querySelector(".ff-screen-frame__content")!;
    expect(content.querySelector('[data-testid="hero"]')).not.toBeNull();
    expect(content.querySelector(".ff-screen-frame__body [data-testid='body']")).not.toBeNull();
    expect(frame.querySelector(".ff-screen-frame__body [data-testid='actions']")).not.toBeNull();
  });

  it("passes Back, its test id and a header through to the corners", () => {
    const back = vi.fn();
    const target = host();
    component = mount(ScreenFrame, {
      target,
      props: {
        arrangement: "split",
        settings: fakeSettings(),
        body: text("body"),
        back,
        backTestId: "lobby-back",
        header: text("room-code"),
      },
    });
    flushSync();
    target.querySelector<HTMLButtonElement>('[data-testid="lobby-back"]')!.click();
    expect(back).toHaveBeenCalledTimes(1);
    expect(target.querySelector("[data-corner-controls] [data-testid='room-code']")).not.toBeNull();
  });

  it("lays out without a hero or actions", () => {
    const target = host();
    component = mount(ScreenFrame, { target, props: { arrangement: "stack", settings: fakeSettings(), body: text("body") } });
    flushSync();
    expect(target.querySelector('[data-testid="body"]')).not.toBeNull();
    expect(target.querySelector(".ff-screen-frame__hero")).toBeNull();
    expect(target.querySelector(".ff-screen-frame__actions")).toBeNull();
  });
});

describe("Split (UI layout system §5)", () => {
  it("stacks until measured, then sits side by side only where both columns fit", () => {
    const target = host();
    component = mount(Split, { target, props: { min: 300, gap: 16, first: text("seats"), second: text("settings") } });
    flushSync();
    const split = target.querySelector<HTMLElement>("[data-split]")!;
    expect(split.dataset["split"]).toBe("stack");
    expect(split.querySelector('[data-testid="seats"]')).not.toBeNull();
    expect(split.querySelector('[data-testid="settings"]')).not.toBeNull();

    fake.resize(700);
    flushSync();
    expect(split.dataset["split"]).toBe("row");

    fake.resize(500);
    flushSync();
    expect(split.dataset["split"]).toBe("stack");
  });
});
