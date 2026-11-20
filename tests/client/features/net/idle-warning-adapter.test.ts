import { describe, expect, it, vi } from "vitest";
import { ColyseusNetworkManager } from "../../../../apps/client/src/features/net/colyseus-network";
import { fakeColyseusClient } from "../../support/fakes/server";

/** Audit B1, the warning: what the adapter does with the room's word that it is about to close. */

describe("the idle warning through the network adapter", () => {
  it("hands the room's warning to subscribers, and the word that it was kept open", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const onIdleWarning = vi.fn();
    manager.subscribe({ onIdleWarning });
    await manager.createRoom("Kite");

    room.emit("idleWarning", { closesInSeconds: 60 });
    room.emit("idleWarning", { closesInSeconds: null });

    expect(onIdleWarning).toHaveBeenNthCalledWith(1, { closesInSeconds: 60 });
    expect(onIdleWarning).toHaveBeenNthCalledWith(2, { closesInSeconds: null });
    manager.dispose();
  });

  it("sends stillHere as a command and resolves when the room answers", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");

    const pending = manager.keepRoomOpen();
    const sent = room.sent.at(-1)!;
    expect(sent.type).toBe("stillHere");
    room.emit("commandResult", { requestId: (sent.payload as { requestId: string }).requestId, ok: true });

    await expect(pending).resolves.toBeUndefined();
    manager.dispose();
  });

  it("hears nothing from a room it has left", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const onIdleWarning = vi.fn();
    manager.subscribe({ onIdleWarning });
    await manager.createRoom("Kite");
    await manager.leaveRoom();

    room.emit("idleWarning", { closesInSeconds: 60 });

    expect(onIdleWarning).not.toHaveBeenCalled();
    manager.dispose();
  });
});
