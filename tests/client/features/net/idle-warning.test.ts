import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { IdleWarningStore, wireIdleWarning } from "../../../../apps/client/src/features/net/idle-warning.svelte";
import IdleWarning from "../../../../apps/client/src/features/lobby/IdleWarning.svelte";
import { FakeNetwork } from "../../support/fakes/network";
import { installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import { fakeSettings } from "../../support/fakes/settings";

/**
 * Audit B1, the warning: a room nobody has used for ten minutes closes, and a
 * minute before it does the room tells its players, who may press Keep it open.
 */

let teardown: Array<() => void> = [];
afterEach(() => {
  for (const undo of teardown.splice(0)) undo();
  document.body.innerHTML = "";
});

const setup = () => {
  teardown.push(installLocaleStrategy(fakeSettings(), () => ["en-US"]));
  const network = new FakeNetwork();
  const store = new IdleWarningStore();
  teardown.push(wireIdleWarning(network, store));
  const component = mount(IdleWarning, { target: document.body, props: { network, store } });
  teardown.push(() => void unmount(component));
  return { network, store };
};
const banner = () => document.querySelector<HTMLElement>("[data-testid='idle-warning']")!;
const keep = () => document.querySelector<HTMLButtonElement>("[data-testid='idle-warning-keep']")!;

describe("the idle warning on screen", () => {
  it("is hidden until the room warns", () => {
    setup();
    expect(banner().hidden).toBe(true);
  });

  it("says the room closes in a minute and offers Keep it open", () => {
    const { network } = setup();
    network.emitIdleWarning(60);
    flushSync();
    expect(banner().hidden).toBe(false);
    expect(banner().textContent).toContain("Nobody's playing. This room closes in 1 minute.");
    expect(keep().textContent?.trim()).toBe("Keep it open");
  });

  it("is a polite live region, so a screen reader hears it without being cut off", () => {
    setup();
    expect(banner().getAttribute("role")).toBe("status");
    expect(banner().getAttribute("aria-live")).toBe("polite");
  });

  it("asks the room to stay open when pressed, and hides at once", async () => {
    const { network } = setup();
    network.emitIdleWarning(60);
    flushSync();
    keep().click();
    flushSync();
    await Promise.resolve();
    expect(network.calls).toContain("keepRoomOpen");
    expect(banner().hidden).toBe(true);
  });

  it("hides when another seat kept the room open", () => {
    const { network } = setup();
    network.emitIdleWarning(60);
    flushSync();
    network.emitIdleWarning(null);
    flushSync();
    expect(banner().hidden).toBe(true);
  });

  it("hides when the connection is lost, which is a different failure with its own indicator", () => {
    const { network, store } = setup();
    network.emitIdleWarning(60);
    flushSync();
    expect(store.visible).toBe(true);
    for (const listener of (network as unknown as { listeners: Array<{ onConnectionState?: (s: string) => void }> }).listeners) {
      listener.onConnectionState?.("reconnecting");
    }
    flushSync();
    expect(store.visible).toBe(false);
  });
});
