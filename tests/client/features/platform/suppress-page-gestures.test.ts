import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { suppressPageGestures } from "../../../../apps/client/src/features/platform/suppress-page-gestures";

let release: (() => void) | undefined;
afterEach(() => {
  release?.();
  release = undefined;
  document.body.innerHTML = "";
});

/** Dispatches a cancelable `type` at `target` and reports whether it was cancelled. */
function cancelled(target: Element, type: string): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("suppressPageGestures", () => {
  it("cancels the context menu and image drags over the game", () => {
    document.body.innerHTML = `<canvas></canvas><img alt="" /><button>Ready</button>`;
    release = suppressPageGestures(document);
    expect(cancelled(document.querySelector("canvas")!, "contextmenu")).toBe(true);
    expect(cancelled(document.querySelector("button")!, "contextmenu")).toBe(true);
    expect(cancelled(document.querySelector("img")!, "dragstart")).toBe(true);
  });

  it("leaves text fields their menu, so a room code can be pasted", () => {
    document.body.innerHTML = `<input data-testid="code-input" />`;
    release = suppressPageGestures(document);
    expect(cancelled(document.querySelector("input")!, "contextmenu")).toBe(false);
  });

  it("stops cancelling once released", () => {
    document.body.innerHTML = `<canvas></canvas>`;
    suppressPageGestures(document)();
    expect(cancelled(document.querySelector("canvas")!, "contextmenu")).toBe(false);
  });
});

describe("the page's selection rules", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/kit/styles.css"), "utf8");

  it("turns text selection and the long-press callout off for the page", () => {
    expect(css).toMatch(/html\s*\{[^}]*user-select:\s*none[^}]*-webkit-touch-callout:\s*none/);
  });

  it("gives selection back to text fields", () => {
    expect(css).toMatch(/input,\s*textarea\s*\{[^}]*user-select:\s*text/);
  });
});
