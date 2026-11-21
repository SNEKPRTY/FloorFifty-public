import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColyseusNetworkManager, SILENT_SOCKET_MS } from "../../../../apps/client/src/features/net/colyseus-network";
import { fakeColyseusClient } from "../../support/fakes/server";

/**
 * Audit S16: nothing noticed a socket that was open but silent. Unanswered
 * pings were dropped, and only a close or the browser's `offline` event started
 * a reconnect, so on a stalled link the badge said connected and the race froze
 * until the system killed the socket, usually after the server's 30 second
 * grace, when the player had lost the seat. The Owner's number: 8 seconds.
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const seated = async () => {
  const { client, room } = fakeColyseusClient();
  const manager = new ColyseusNetworkManager("http://test", () => client);
  await manager.createRoom("Kite");
  return { manager, room };
};

describe("a socket that is open but silent (audit S16)", () => {
  it("waits eight seconds", () => {
    expect(SILENT_SOCKET_MS).toBe(8_000);
  });

  it("is closed, and a reconnect starts, once the server has said nothing for that long", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");
    // The server has not answered the reconnect yet.
    vi.mocked(client.reconnect).mockReturnValue(new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(SILENT_SOCKET_MS + 3_000);
    expect(manager.connectionState).toBe("reconnecting");
    expect(room.connection.close).toHaveBeenCalled();
    expect(client.reconnect).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  // A really stalled link: the browser waits for a closing handshake that never
  // comes (about 60 s in Chromium), so `close()` never reports a leave in time.
  // The reconnect must not wait for it: the server holds the seat for 30 s.
  it("starts the reconnect itself, without waiting for the old socket to report its close", async () => {
    const { client, room } = fakeColyseusClient();
    const leaveHandlers: ((code: number) => void)[] = [];
    const onLeave = room.onLeave.bind(room);
    room.onLeave = (handler) => {
      leaveHandlers.push(handler);
      onLeave(handler);
    };
    const fresh = fakeColyseusClient().room;
    vi.mocked(client.reconnect).mockResolvedValue(fresh as never);
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");
    expect(client.reconnect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SILENT_SOCKET_MS + 2_000);
    expect(room.connection.close).toHaveBeenCalled();
    expect(client.reconnect).toHaveBeenCalledTimes(1);
    expect(client.reconnect).toHaveBeenCalledWith("reconnection-token-1");
    expect(manager.connectionState).toBe("connected");

    // The old socket's close arrives late: it starts nothing.
    for (const handler of leaveHandlers) handler(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.reconnect).toHaveBeenCalledTimes(1);
    expect(manager.connectionState).toBe("connected");
    manager.dispose();
  });

  it("is left alone while the server keeps answering, even if it says little", async () => {
    const { manager, room } = await seated();
    for (let second = 0; second < 30; second += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      room.emit("pong", { id: second, slack: 0 });
    }
    expect(manager.connectionState).toBe("connected");
    expect(room.connection.close).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("counts a state patch as the server speaking", async () => {
    const { manager, room } = await seated();
    for (let second = 0; second < 20; second += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      room.pushState();
    }
    expect(manager.connectionState).toBe("connected");
    manager.dispose();
  });

  it("does not hold a hidden tab to account, whose timers and sockets the browser slows", async () => {
    const { manager, room } = await seated();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(SILENT_SOCKET_MS * 3);
    expect(room.connection.close).not.toHaveBeenCalled();
    // Back on screen: the silence the browser caused does not count either.
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(room.connection.close).not.toHaveBeenCalled();
    manager.dispose();
    hidden.mockRestore();
  });

  it("stops watching once the manager is disposed", async () => {
    const { manager, room } = await seated();
    manager.dispose();
    const closedByDispose = vi.mocked(room.connection.close).mock.calls.length;
    await vi.advanceTimersByTimeAsync(SILENT_SOCKET_MS * 3);
    expect(room.connection.close).toHaveBeenCalledTimes(closedByDispose);
  });
});
