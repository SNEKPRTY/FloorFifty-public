import { describe, expect, it } from "vitest";
import { ErrorChannel } from "../../../../apps/client/src/features/net/error-view";
import { FakeNetwork } from "../../support/fakes/network";
import { gameplayWithFakeNetwork, lobbyWithFakeNetwork, mainMenuWithFakeNetwork } from "../../support/fakes/screens";
import { snapshotAt } from "../../support/snapshots";

describe("a disconnect during a race", () => {
  it("keeps the race canvas while attempting reconnect for 30 seconds", async () => {
    const gameplay = await gameplayWithFakeNetwork();
    gameplay.network.emitSnapshot(snapshotAt(30));

    gameplay.network.emitConnectionState("reconnecting");

    expect(gameplay.screen.isMounted()).toBe(true);
    expect(gameplay.screen.connectionState()?.text()).toBe("Reconnecting…");
  });

  it("retains the last snapshot so the world stays on screen", async () => {
    const gameplay = await gameplayWithFakeNetwork({
      latestSnapshot: snapshotAt(30, { player: { x: 120, y: 400 } }),
    });
    gameplay.network.emitConnectionState("reconnecting");

    expect(gameplay.screen.sample()?.players[0]).toMatchObject({ x: 120, y: 400 });
  });

  it("hides the indicator again once the seat is reclaimed", async () => {
    const gameplay = await gameplayWithFakeNetwork();
    gameplay.network.emitConnectionState("reconnecting");
    gameplay.network.emitConnectionState("connected");

    expect(gameplay.screen.connectionState()?.isVisible).toBe(false);
    expect(gameplay.screen.isMounted()).toBe(true);
  });

  it("does not leave the race for a failure it can continue through", async () => {
    const gameplay = await gameplayWithFakeNetwork();
    gameplay.network.emitError({ code: "RATE_LIMITED", message: "slow down" });
    expect(gameplay.publishedEvents()).toEqual([]);
    expect(gameplay.screen.isMounted()).toBe(true);
  });
});

describe("a race that cannot continue", () => {
  it("leaves Gameplay with a reason when the room closes", async () => {
    const gameplay = await gameplayWithFakeNetwork();
    gameplay.network.emitError({ code: "ROOM_CLOSED", message: "the room closed" });

    expect(gameplay.lastPublished()).toBe("room.recovery-required");
    expect(gameplay.errors.take()).toMatchObject({ code: "ROOM_CLOSED", retry: false });
  });

  it("leaves the room and the race when the server's simulation fails", async () => {
    const gameplay = await gameplayWithFakeNetwork();
    gameplay.network.emitError({
      code: "SIMULATION_FAILURE",
      message: "This race could not continue. Nothing about it was recorded.",
    });

    expect(gameplay.lastPublished()).toBe("room.recovery-required");
    expect(gameplay.errors.take()).toMatchObject({ code: "SIMULATION_FAILURE", retry: false });
    expect(gameplay.network.calls).toContain("leaveRoom");
  });

  it("never fabricates a result screen from a transport failure", async () => {
    const gameplay = await gameplayWithFakeNetwork();
    gameplay.network.emitError({ code: "ROOM_CLOSED", message: "the room closed" });
    expect(gameplay.lastPublished()).not.toBe("room.finished");
  });

  it("reaches GameEnd only from a finished snapshot", async () => {
    const gameplay = await gameplayWithFakeNetwork();
    gameplay.network.emitSnapshot(snapshotAt(90, { phase: "finished" }));
    expect(gameplay.lastPublished()).toBe("room.finished");
  });

  it("tears the connection indicator down with the screen", async () => {
    const gameplay = await gameplayWithFakeNetwork();
    gameplay.screen.exit();
    expect(gameplay.overlay.querySelector('[data-testid="connection-state"]')).toBeNull();
  });
});

describe("returning to the menu with a reason", () => {
  it("shows the failure that ejected the player", async () => {
    const errors = new ErrorChannel();
    errors.report({ code: "ROOM_CLOSED", retry: false });

    const menu = await mainMenuWithFakeNetwork({ errors });
    expect(menu.query("error-view")?.getAttribute("data-code")).toBe("ROOM_CLOSED");
    expect(menu.query("error-message")?.textContent).toBe("The room was closed.");
  });

  it("shows a failure exactly once", async () => {
    const errors = new ErrorChannel();
    errors.report({ code: "ROOM_FULL", retry: false });

    await mainMenuWithFakeNetwork({ errors });
    const second = await mainMenuWithFakeNetwork({ errors });
    expect(second.query("error-view")).toBeNull();
  });

  it("opens on the ready room when the room survived, and on create otherwise", async () => {
    const held = new FakeNetwork();
    await held.createRoom("Kite");
    const rejoined = await lobbyWithFakeNetwork({ network: held });
    expect(rejoined.query("seats")).not.toBeNull();

    const released = await lobbyWithFakeNetwork();
    expect(released.query("create-room")).not.toBeNull();
  });
});
