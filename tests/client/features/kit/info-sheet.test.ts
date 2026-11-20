import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import InfoSheet from "../../../../apps/client/src/features/kit/layout/InfoSheet.svelte";

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

const body = createRawSnippet(() => ({ render: () => `<p data-testid="sheet-body">The long rules.</p>` }));

function open() {
  const host = document.createElement("div");
  document.body.append(host);
  component = mount(InfoSheet, { target: host, props: { title: "Rules", testId: "rules-button", children: body } });
  flushSync();
  return host;
}

describe("InfoSheet inside a dialog", () => {
  it("opens beside the dialog's backdrop, not inside the dialog, so it covers the window", () => {
    const stage = document.createElement("div");
    const backdrop = document.createElement("div");
    backdrop.className = "ff-modal";
    const target = document.createElement("div");
    backdrop.append(target);
    stage.append(backdrop);
    document.body.append(stage);
    component = mount(InfoSheet, { target, props: { title: "Rules", testId: "rules-button", children: body } });
    flushSync();
    target.querySelector<HTMLButtonElement>('[data-testid="rules-button"]')!.click();
    flushSync();
    const sheet = document.querySelector<HTMLElement>('[data-testid="rules-button-sheet"]')!;
    expect(sheet).not.toBeNull();
    expect(backdrop.contains(sheet), "not inside the dialog that holds the button").toBe(false);
    expect(stage.contains(sheet)).toBe(true);
    // Closing removes it from where it moved to.
    document.querySelector<HTMLButtonElement>('[data-testid="info-sheet-close"]')!.click();
    flushSync();
  });
});

describe("InfoSheet (the \"?\" sheet)", () => {
  it("labels its button with a word, not only ?", () => {
    const button = open().querySelector<HTMLButtonElement>('[data-testid="rules-button"]')!;
    expect(button.textContent).toContain("Rules");
    expect(button.textContent).toContain("?");
    expect(button.classList.contains("ff-aq-control")).toBe(true);
    expect(button.classList.contains("ff-aq-control--go")).toBe(false);
  });

  it("opens a sheet with its title and body, and closes it", async () => {
    const host = open();
    expect(document.querySelector('[data-testid="sheet-body"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('[data-testid="rules-button"]')!.click();
    flushSync();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    // Short text is a small popup, not a full-screen sheet; Modal turns it into a sheet only when it overflows.
    expect(dialog.dataset["fit"]).toBe("dialog");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Rules");
    expect(dialog.querySelector('[data-testid="sheet-body"]')?.textContent).toBe("The long rules.");
    // The Close button is in the pinned action row.
    const close = dialog.querySelector<HTMLButtonElement>('[data-modal-part="actions"] [data-testid="info-sheet-close"]')!;
    expect(close.textContent?.trim()).toBe("Close");
    close.click();
    flushSync();
    // Gone once its outro has run.
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });

  it("closes when the dimmed page around the popup is tapped", async () => {
    const host = open();
    host.querySelector<HTMLButtonElement>('[data-testid="rules-button"]')!.click();
    flushSync();
    document.querySelector<HTMLElement>(".ff-modal")!.click();
    flushSync();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });
});
