import { readFileSync } from "node:fs";
import { resolve } from "node:path";
/**
 * The modal shell (launch polish §3.1.1, "Modals").
 *
 * jsdom does not move focus on Tab, so the trap is exercised by dispatching
 * the key: the dialog must handle Tab itself, which is also what makes it work
 * the same for a controller's focus navigation.
 */

import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ModalHarness from "../../support/ModalHarness.svelte";
import { installFakeResizeObserver } from "../../support/resize-observer";

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

const open = (onClose = vi.fn(), props: { fit?: "auto" | "sheet"; withActions?: boolean } = {}) => {
  const host = document.createElement("div");
  document.body.append(host);
  component = mount(ModalHarness, { target: host, props: { onClose, ...props } });
  flushSync();
  const opener = host.querySelector<HTMLButtonElement>('[data-testid="opener"]')!;
  opener.focus();
  opener.click();
  flushSync();
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
  const key = (key: string, shiftKey = false) =>
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
  return { host, opener, dialog, key, onClose };
};

describe("the modal", () => {
  it("is a labelled modal dialog", () => {
    const { dialog } = open();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog.getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelledBy)?.textContent).toBe("Harness");
    expect(dialog.dataset["testid"]).toBe("harness-modal");
  });

  it("moves focus inside on open", () => {
    const { dialog } = open();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("opens on its first control, not on Close, so A straight away does not shut it", () => {
    open();
    expect(document.activeElement?.getAttribute("data-testid")).toBe("first");
  });

  it("keeps a handled Tab to itself, so a modal opened inside another is not also tabbed out of by the one under it", () => {
    const { dialog } = open();
    // Svelte delegates keydown to the root, so a listener placed above the dialog would run first
    // whatever the handler does; what the handler decides is whether it stops the event.
    for (const shiftKey of [false, true]) {
      const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
      const stop = vi.spyOn(event, "stopPropagation");
      dialog.dispatchEvent(event);
      expect(stop, shiftKey ? "Shift+Tab stops here" : "Tab stops here").toHaveBeenCalled();
    }
  });

  it("wraps Tab and Shift+Tab inside the dialog", () => {
    const { host, key } = open();
    host.querySelector<HTMLButtonElement>('[data-testid="last"]')!.focus();
    key("Tab");
    expect(document.activeElement?.getAttribute("data-testid")).toBe("modal-close");
    key("Tab", true);
    expect(document.activeElement?.getAttribute("data-testid")).toBe("last");
  });

  it("closes on Escape and hands focus back to the opener", async () => {
    const { opener, key, onClose } = open();
    key("Escape");
    flushSync();
    expect(onClose).toHaveBeenCalledOnce();
    // As its outro starts (polish spec §5.3), which Svelte runs a moment later.
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("closes from its labelled close button", () => {
    const { host, onClose } = open();
    const close = host.querySelector<HTMLButtonElement>('[data-testid="modal-close"]')!;
    expect(close.getAttribute("aria-label")).toBe("Close");
    close.click();
    flushSync();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("moves focus into and out of the dialog without scrolling the page", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    open();
    const dialogCalls = focus.mock.contexts
      .map((element, index) => [element as HTMLElement, focus.mock.calls[index]![0]] as const)
      .filter(([element]) => element.closest('[role="dialog"]') !== null);
    expect(dialogCalls.length).toBeGreaterThan(0);
    for (const [, options] of dialogCalls) expect(options).toMatchObject({ preventScroll: true });
    focus.mockRestore();
  });

  it("heads the dialog with its title in display type, not a small label (ui layout spec §6.10)", () => {
    const { dialog } = open();
    const heading = document.getElementById(dialog.getAttribute("aria-labelledby")!)!;
    expect(heading.tagName).toBe("H2");
    expect(heading.textContent).toBe("Harness");
    expect(heading.classList.contains("ff-aq-label")).toBe(false);
    expect(heading.classList.contains("ff-dialog-heading__title")).toBe(true);
  });

  it("keeps inside the visible band, and branches on no form factor", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/kit/Modal.svelte"), "utf8");
    // Divided by the zoom of the screen it is drawn inside, which scales px lengths.
    expect(source).toMatch(/top:\s*calc\(var\(--ff-band-top\)\s*\/\s*var\(--ff-ancestor-zoom, 1\)\)/);
    expect(source).toMatch(/height:\s*calc\(var\(--ff-band-height\)\s*\/\s*var\(--ff-ancestor-zoom, 1\)\)/);
    expect(source).not.toMatch(/phone-l:|desktop:|tablet-p:|wide:|data-form-factor/);
  });
});

describe("a dialog that does not fit (ui spec, \"Phone sideways\")", () => {
  // jsdom has no layout: the dialog's content height and the room the band
  // gives it are what a test says they are, as `scrollHeight` and `clientHeight`.
  const room = { content: 200, band: 568 };
  let fake: ReturnType<typeof installFakeResizeObserver> | undefined;

  const stubLayout = (): void => {
    const sized = (value: () => number) => ({ configurable: true, get(this: HTMLElement) { return this.getAttribute("role") === "dialog" ? value() : 0; } });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", sized(() => room.content));
    Object.defineProperty(HTMLElement.prototype, "clientHeight", sized(() => room.band));
  };

  afterEach(() => {
    fake?.restore();
    fake = undefined;
    // @ts-expect-error -- back to jsdom's own
    delete HTMLElement.prototype.scrollHeight;
    // @ts-expect-error -- back to jsdom's own
    delete HTMLElement.prototype.clientHeight;
    room.content = 200;
    room.band = 568;
  });

  const fitOf = (dialog: HTMLElement): string | undefined => dialog.dataset["fit"];

  it("stays a dialog when it fits the band", () => {
    stubLayout();
    fake = installFakeResizeObserver();
    expect(fitOf(open().dialog)).toBe("dialog");
  });

  it("becomes a sheet when its content is taller than the band", () => {
    stubLayout();
    fake = installFakeResizeObserver();
    room.content = 700;
    expect(fitOf(open().dialog)).toBe("sheet");
  });

  it("re-fits a dialog when the window turns", () => {
    stubLayout();
    fake = installFakeResizeObserver();
    room.content = 400;
    const { dialog } = open();
    expect(fitOf(dialog)).toBe("dialog");
    // Held sideways: the band is 320 px tall.
    room.band = 320;
    fake.resize(0, 320);
    expect(fitOf(dialog)).toBe("sheet");
    // And upright again.
    room.band = 568;
    fake.resize(0, 568);
    expect(fitOf(dialog)).toBe("dialog");
  });

  it("re-fits when its content changes, not only when the window does", async () => {
    stubLayout();
    fake = installFakeResizeObserver();
    const { dialog } = open();
    expect(fitOf(dialog)).toBe("dialog");
    room.content = 900;
    dialog.append(document.createElement("p"));
    await vi.waitFor(() => expect(fitOf(dialog)).toBe("sheet"));
  });

  it("is a sheet whenever fit is sheet, with room to spare", () => {
    stubLayout();
    fake = installFakeResizeObserver();
    expect(fitOf(open(vi.fn(), { fit: "sheet" }).dialog)).toBe("sheet");
  });

  it("keeps the action row after the body, where a sheet pins it", () => {
    stubLayout();
    fake = installFakeResizeObserver();
    room.content = 700;
    const { dialog } = open(vi.fn(), { withActions: true });
    const parts = [...dialog.children].map((child) => child.getAttribute("data-modal-part"));
    expect(parts).toEqual(["header", "body", "actions"]);
    const actions = dialog.querySelector('[data-modal-part="actions"]')!;
    expect(actions.querySelector('[data-testid="harness-action"]')).not.toBeNull();
    expect(dialog.querySelector('[data-modal-part="body"]')!.querySelector('[data-testid="harness-action"]')).toBeNull();
    expect(fitOf(dialog)).toBe("sheet");
  });

  it("draws no action row when there are no actions", () => {
    const { dialog } = open();
    expect(dialog.querySelector('[data-modal-part="actions"]')).toBeNull();
  });
});
