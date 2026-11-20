/**
 * The loader for a request to the server: every room command a player waits
 * on is counted, a command asked for twice in flight is sent once, and the
 * loader catches taps at once but shows its spinner only for a slow answer.
 */

import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import NetworkLoader from "../../../../apps/client/src/features/net/NetworkLoader.svelte";
import { NetworkActivity, trackNetworkActivity } from "../../../../apps/client/src/features/net/store/network-activity.svelte";
import { FakeNetwork } from "../../support/fakes/network";

/** A network whose `createRoom` waits until the test lets it answer. */
function slowNetwork(): { network: FakeNetwork; answer: () => void } {
  const network = new FakeNetwork();
  let answer!: () => void;
  const create = network.createRoom.bind(network);
  network.createRoom = (name) =>
    new Promise<void>((resolve) => (answer = resolve)).then(() => create(name));
  return { network, answer: () => answer() };
}

describe("network activity", () => {
  it("counts a room command until it settles, answered or refused", async () => {
    const activity = new NetworkActivity();
    const { network, answer } = slowNetwork();
    const tracked = trackNetworkActivity(network, activity);

    const creating = tracked.createRoom("Ada");
    expect(activity.busy).toBe(true);
    answer();
    await creating;
    expect(activity.busy).toBe(false);

    network.nextFailure = { code: "ROOM_FULL", message: "That room is full." } as never;
    await expect(tracked.setReady(true)).rejects.toThrow("That room is full.");
    expect(activity.busy).toBe(false);
  });

  it("sends a command asked for again while it is in flight once", async () => {
    const activity = new NetworkActivity();
    const { network, answer } = slowNetwork();
    const tracked = trackNetworkActivity(network, activity);

    const first = tracked.createRoom("Ada");
    const second = tracked.createRoom("Ada");
    answer();
    await Promise.all([first, second]);
    expect(network.calls.filter((call) => call.startsWith("createRoom"))).toHaveLength(1);

    // Settled, the next ask is a new command.
    const third = tracked.createRoom("Ada");
    answer();
    await third;
    expect(network.calls.filter((call) => call.startsWith("createRoom"))).toHaveLength(2);
  });

  it("leaves the race's own traffic uncounted and everything else as it was", () => {
    const activity = new NetworkActivity();
    const network = new FakeNetwork();
    const tracked = trackNetworkActivity(network, activity);
    tracked.sendPing(4);
    expect(network.sentPings).toEqual([4]);
    expect(activity.busy).toBe(false);
    expect(tracked.connectionState).toBe(network.connectionState);
  });
});

describe("the network loader", () => {
  let component: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("catches taps at once and shows its spinner only for a slow answer", async () => {
    vi.useFakeTimers();
    const activity = new NetworkActivity();
    component = mount(NetworkLoader, { target: document.body, props: { activity } });
    flushSync();
    const loader = document.querySelector<HTMLElement>('[data-testid="network-loader"]')!;
    const badge = loader.querySelector<HTMLElement>('[role="status"]')!;
    expect(loader.hidden).toBe(true);

    let finish!: () => void;
    const work = activity.track(() => new Promise<void>((resolve) => (finish = resolve)));
    flushSync();
    expect(loader.hidden).toBe(false);
    expect(badge.hidden).toBe(true);

    vi.advanceTimersByTime(200);
    flushSync();
    expect(badge.hidden).toBe(false);

    finish();
    await work;
    flushSync();
    expect(loader.hidden).toBe(true);
    expect(badge.hidden).toBe(true);
  });
});
