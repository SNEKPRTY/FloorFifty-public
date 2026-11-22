import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import PauseOverlay from "../../../../apps/client/src/features/race/PauseOverlay.svelte";
import { fakeSettings } from "../../support/fakes/settings";

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const escape = () =>
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

const open = async () => {
  const onResume = vi.fn();
  component = mount(PauseOverlay, {
    target: document.body,
    props: { settings: fakeSettings(), onResume, onLeave: vi.fn() },
  });
  await tick();
  return { onResume };
};

describe("the pause overlay with a controller", () => {
  it("B in Settings returns to the menu, on Settings; B in the menu resumes", async () => {
    const { onResume } = await open();
    byTestId("pause-settings")!.click();
    // `show` focuses after its own `tick`, so wait for focus rather than
    // counting ticks.
    await vi.waitFor(() => expect(document.activeElement).toBe(byTestId("settings-tab-settings")));
    expect(document.activeElement?.closest('[data-testid="pause-overlay"]')).not.toBeNull();

    escape();
    await vi.waitFor(() => expect(document.activeElement).toBe(byTestId("pause-settings")));
    expect(onResume).not.toHaveBeenCalled();

    escape();
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("B on the leave question cancels it, back on Leave race", async () => {
    const { onResume } = await open();
    byTestId("pause-leave")!.click();
    // The question opens on Cancel: the safe answer is the one a stray A press gives.
    await vi.waitFor(() => expect(document.activeElement).toBe(byTestId("pause-leave-cancel")));
    escape();
    await vi.waitFor(() => expect(document.activeElement).toBe(byTestId("pause-leave")));
    expect(onResume).not.toHaveBeenCalled();
  });
});

describe("the pause overlay's leave confirm", () => {
  it("makes Leave race red and Cancel blue in the leave confirm", async () => {
    await open();
    byTestId("pause-leave")!.click();
    await vi.waitFor(() => expect(byTestId("pause-leave-confirm")).not.toBeNull());
    expect(byTestId("pause-leave-confirm")!.classList.contains("ff-aq-control--stop")).toBe(true);
    expect(byTestId("pause-leave-cancel")!.className).not.toMatch(/ff-aq-control--(go|stop)/);
  });
});

describe("the pause overlay's buttons", () => {
  it("sit two across only where a whole word fits in each, one column below that", () => {
    // Two across from a 340 px dialog split "Confi- / guración" and "Salir / de carrera" on upright
    // phones and both iPads. The longest pause label (16 characters at the button size, about 13 px
    // a character, plus padding) needs about 230 px a column, so two need about 460.
    const source = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/race/PauseOverlay.svelte"), "utf8");
    const widths = [...source.matchAll(/@container ff-dialog \(min-width:\s*(\d+)px\)/g)].map((match) => Number(match[1]));
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect(width).toBeGreaterThanOrEqual(460);
  });
});

describe("the pause overlay's view switches keep the dialog's layout", () => {
  const source = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/race/PauseOverlay.svelte"), "utf8");
  it("carries the sheet fill through the body's switch, so the settings list scrolls with its hint", () => {
    expect(source).toContain('class="ff-pause__views"');
    expect(source).toMatch(/\.ff-pause__views \[data-dialog-body\]\)\s*\{[^}]*flex: 1 1 auto/);
  });
  it("lays the action row's view out as a grid, so Back fills the width as every action does", () => {
    expect(source).toMatch(/\.ff-pause__actions > \.ff-view\)\s*\{[^}]*display: grid/);
  });
});

describe("the modal makes a column of a dialog whose list sits in a view switch", () => {
  it("matches the switch's path to the settings list", () => {
    const modal = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/kit/Modal.svelte"), "utf8");
    expect(modal).toContain(".contents > .ff-view-switch > .ff-view > [data-dialog-body]");
  });
});
