import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Notice from "../../../../apps/client/src/features/kit/Notice.svelte";
import ConnectionIndicator from "../../../../apps/client/src/features/net/ConnectionIndicator.svelte";
import ReplayVideoButtons from "../../../../apps/client/src/features/replay/ReplayVideoButtons.svelte";
import { ErrorView } from "../../../../apps/client/src/features/screen/error-panel.svelte";
import { recoverableError } from "../../../../apps/client/src/features/net/error-view";
import { ReplayShare } from "../../../../apps/client/src/features/replay/replay-share.svelte";
import { fakeSettings } from "../../support/fakes/settings";
import { readClient } from "../../support/client-source";

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

function open(props: Record<string, unknown>) {
  const host = document.createElement("div");
  document.body.append(host);
  component = mount(Notice, { target: host, props: { message: "No room has that code.", tone: "problem", testId: "notice-test", ...props } });
  flushSync();
  return host.querySelector<HTMLElement>('[data-testid="notice-test"]')!;
}

describe("Notice (spec, \"Notices and errors\")", () => {
  it("sits at the top centre under the corner buttons, never pinned to a corner", () => {
    const css = readClient("Notice.svelte");
    expect(css).toMatch(/top:\s*calc\(var\(--ff-band-top\)[^;]*var\(--ff-corner-h\)/);
    expect(css).toMatch(/margin-inline:\s*auto/);
    expect(css).not.toMatch(/(?<![-\w])(left|right):\s*\d/);
    // The row it clears is published by the corner controls, one height for both.
    expect(readClient("layout/CornerControls.svelte")).toContain("var(--ff-corner-h)");
    expect(readClient("aquarian-tokens.css")).toMatch(/--ff-corner-h:/);
  });

  it("hangs under the HUD's top block in a race, so it covers no chip and no coach", () => {
    const css = readClient("Notice.svelte");
    expect(css).toMatch(/\[data-band-mode="field"\] \.ff-notice\[data-centre-in-race\]\)\s*\{[^}]*top:\s*calc\(var\(--ff-hud-under-y,\s*var\(--ff-band-top\)\)\s*\+\s*8px\)/);
    // Only the connection notice asks for it: the corner row exists in menus.
    const host = document.createElement("div");
    document.body.append(host);
    component = mount(ConnectionIndicator, { target: host, props: { state: "reconnecting" } });
    flushSync();
    expect(host.querySelector('[data-testid="connection-state"]')!.hasAttribute("data-centre-in-race")).toBe(true);
  });

  it("carries a word on what to do and a close button", () => {
    const onClose = vi.fn();
    const actions = createRawSnippet(() => ({ render: () => `<button type="button" data-testid="do-it">Try again</button>` }));
    const notice = open({ onClose, actions });
    expect(notice.textContent).toContain("No room has that code.");
    expect(notice.querySelector('[data-testid="do-it"]')?.textContent).toBe("Try again");
    const close = notice.querySelector<HTMLButtonElement>('[data-testid="notice-test-close"]')!;
    expect(close.getAttribute("aria-label")).toBe("Close");
    close.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("draws no close button without an onClose", () => {
    expect(open({}).querySelector("button")).toBeNull();
  });

  it("is an alert for a problem and a polite status for information, with a red edge only for a problem", () => {
    const problem = open({ tone: "problem" });
    expect(problem.getAttribute("role")).toBe("alert");
    expect(problem.dataset["tone"]).toBe("problem");
    document.body.innerHTML = "";
    const info = open({ tone: "info" });
    expect(info.getAttribute("role")).toBe("status");
    expect(info.getAttribute("aria-live")).toBe("polite");
    const css = readClient("Notice.svelte");
    expect(css).toMatch(/\[data-tone="problem"\][^{]*\{[^}]*border-left[^}]*var\(--ff-danger\)/);
  });

  it("can be hidden while keeping its place in the document, for a live region", () => {
    expect(open({ hidden: true }).hidden).toBe(true);
  });
});

describe("one place for an error, a connection problem and a share message", () => {
  it("shows an error through a notice", () => {
    const host = document.createElement("div");
    document.body.append(host);
    new ErrorView(host).show(recoverableError("INVALID_ROOM"), { onDismiss: () => {} });
    const notice = host.querySelector<HTMLElement>("[data-notice]")!;
    expect(notice.dataset["testid"]).toBe("error-view");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.dataset["code"]).toBe("INVALID_ROOM");
    expect(notice.querySelector('[data-testid="error-dismiss"]')?.getAttribute("aria-label")).toBe("Close");
  });

  it("shows a connection problem through a notice", () => {
    const host = document.createElement("div");
    document.body.append(host);
    component = mount(ConnectionIndicator, { target: host, props: { state: "reconnecting" } });
    flushSync();
    const notice = host.querySelector<HTMLElement>('[data-testid="connection-state"]')!;
    expect(notice.hasAttribute("data-notice")).toBe(true);
    expect(notice.textContent).toContain("Reconnecting");
    expect(notice.hidden).toBe(false);
  });

  it("shows a share message through a notice, which can be closed", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const share = new ReplayShare({
      video: () => ({ blob: new Blob([new Uint8Array([1])], { type: "video/mp4" }), type: "video/mp4", extension: "mp4", stageId: "rooftops", finishedAt: new Date(2026, 9, 3) }),
      winner: undefined,
      stageName: () => "Rooftops",
      round: undefined,
      progress: undefined,
      settings: fakeSettings(),
      content: () => undefined,
      colour: "scarlet",
      nav: { share: () => Promise.reject(new Error("refused")), canShare: () => true },
      activation: () => true,
    });
    component = mount(ReplayVideoButtons, { target: host, props: { share, available: true, top: 10 } });
    flushSync();
    const notice = host.querySelector<HTMLElement>('[data-testid="replay-share-status"]')!;
    expect(notice.hidden).toBe(true);
    await share.share();
    flushSync();
    expect(notice.hasAttribute("data-notice")).toBe(true);
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain("Could not share");
    notice.querySelector<HTMLButtonElement>('[data-testid="replay-share-status-close"]')!.click();
    flushSync();
    expect(notice.hidden).toBe(true);
  });
});
