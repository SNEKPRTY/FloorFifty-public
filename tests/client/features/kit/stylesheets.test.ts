/**
 * The boot turns on the page's deferred stylesheets and waits for them before
 * any screen mounts, so nothing is ever drawn without its styles (Ruken
 * loading, the Owner's rule). The build marks them (`defer-stylesheets.ts`).
 */

import { afterEach, describe, expect, it } from "vitest";
import { applyDeferredStylesheets } from "../../../../apps/client/src/features/kit/stylesheets";

const deferred = (href: string, loaded = false): HTMLLinkElement => {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.media = "print";
  link.dataset["ffStyle"] = "";
  link.href = href;
  if (loaded) Object.defineProperty(link, "sheet", { value: {} as CSSStyleSheet });
  document.head.append(link);
  return link;
};

afterEach(() => {
  document.head.querySelectorAll("link").forEach((link) => link.remove());
});

describe("the page's deferred stylesheets", () => {
  it("turns each one on and resolves only when every one has loaded", async () => {
    const first = deferred("/a.css");
    const second = deferred("/b.css");
    let done = false;
    const waiting = applyDeferredStylesheets(document).then(() => (done = true));
    expect(first.media).toBe("all");
    expect(second.media).toBe("all");
    first.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(done).toBe(false);
    second.dispatchEvent(new Event("load"));
    await waiting;
    expect(done).toBe(true);
  });

  it("does not wait for a sheet that had already loaded before the boot asked", async () => {
    const link = deferred("/a.css", true);
    await applyDeferredStylesheets(document);
    expect(link.media).toBe("all");
  });

  it("rejects when a stylesheet fails, so the boot shows its failure with Try again", async () => {
    const link = deferred("/a.css");
    const waiting = applyDeferredStylesheets(document);
    link.dispatchEvent(new Event("error"));
    await expect(waiting).rejects.toThrow("/a.css");
  });

  it("stops waiting when the stall rule aborts it", async () => {
    deferred("/a.css");
    const controller = new AbortController();
    const waiting = applyDeferredStylesheets(document, controller.signal);
    controller.abort(new Error("stalled"));
    await expect(waiting).rejects.toThrow("stalled");
  });

  it("has nothing to wait for in development, where Vite injects styles itself", async () => {
    await expect(applyDeferredStylesheets(document)).resolves.toBeUndefined();
  });
});
