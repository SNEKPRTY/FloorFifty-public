import { flushSync } from "svelte";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { lobbyWithFakeNetwork } from "../../support/fakes/screens";
import { fakeSettings } from "../../support/fakes/settings";
import { FakeNetwork } from "../../support/fakes/network";
import type { NetworkListeners } from "../../../../apps/client/src/features/net/network";
import { JOIN_STEPS } from "../../../../apps/client/src/features/net/colyseus-network";

beforeAll(async () => {
  await import("../../../../apps/client/src/features/lobby/lobby");
}, 30_000);

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

/** A join that is still on its way: it says "connecting", and finishes only when told. */
class SlowNetwork extends FakeNetwork {
  private heard: Partial<NetworkListeners>[] = [];
  finish: () => void = () => undefined;

  override subscribe(listeners: Partial<NetworkListeners>): () => void {
    this.heard.push(listeners);
    return super.subscribe(listeners);
  }

  step(fraction: number): void {
    for (const listener of this.heard) listener.onJoinProgress?.(fraction);
  }

  private slow(call: string): Promise<void> {
    this.calls.push(call);
    this.emitConnectionState("connecting");
    this.step(JOIN_STEPS.asked);
    return new Promise((resolve) => {
      this.finish = () => {
        this.step(JOIN_STEPS.seated);
        this.roomCode = "ABC123";
        this.localPlayerId = "room-p1";
        this.emitConnectionState("connected");
        resolve();
      };
    });
  }

  override quickMatch(name: string): Promise<void> {
    return this.slow(`quickMatch:${name}`);
  }
  override createRoom(name: string): Promise<void> {
    return this.slow(`createRoom:${name}`);
  }
  override joinRoom(code: string, name: string): Promise<void> {
    return this.slow(`joinRoom:${code}:${name}`);
  }
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};

async function seenLobby(network: SlowNetwork) {
  const lobby = await lobbyWithFakeNetwork({ network, settings: fakeSettings({ seen: { tutorial: true } }) });
  const field = lobby.query<HTMLInputElement>("name-input")!;
  field.value = "Kite";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
  return lobby;
}

const loader = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="loader-overlay"]');
const bar = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="loader-progress"]');

describe("the loading bar while a race is found", () => {
  it("shows on the press, with plain words and the join's real steps, and goes once seated", async () => {
    const network = new SlowNetwork();
    const lobby = await seenLobby(network);
    expect(loader()).toBeNull();

    lobby.click("find-race");
    await settle();
    expect(loader()).not.toBeNull();
    expect(loader()!.textContent).toContain("Finding a race…");
    expect(bar()!.getAttribute("aria-valuenow")).toBe(String(Math.round(JOIN_STEPS.asked * 100)));

    network.step(JOIN_STEPS.reserved);
    await settle();
    expect(bar()!.getAttribute("aria-valuenow")).toBe(String(Math.round(JOIN_STEPS.reserved * 100)));

    network.finish();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 400));
    flushSync();
    expect(loader()).toBeNull();
    lobby.screen.exit();
  });

  it("names Create room's and Join room's waits in their own words", async () => {
    const network = new SlowNetwork();
    const lobby = await seenLobby(network);
    lobby.click("create-room");
    await settle();
    expect(loader()!.textContent).toContain("Making your room…");
    lobby.screen.exit();
  });

  it("never starts a join over: a second press while one is on its way sends nothing", async () => {
    const network = new SlowNetwork();
    const lobby = await seenLobby(network);
    lobby.click("find-race");
    await settle();
    lobby.click("find-race");
    lobby.click("create-room");
    const field = lobby.query<HTMLInputElement>("name-input")!;
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(network.calls).toEqual(["quickMatch:Kite"]);
    lobby.screen.exit();
  });
});
