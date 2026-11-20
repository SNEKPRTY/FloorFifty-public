import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@colyseus/sdk";
import { serverUpdatingMessage } from "@floor-fifty/shared/common/refusals";
import { ColyseusNetworkManager } from "../../../../apps/client/src/features/net/colyseus-network";

/**
 * The refusal a draining server sends (`matchmake-gate`): HTTP 503, JSON, the
 * words in `error`. Run through the real SDK client, so what the library does
 * with the response is part of the test.
 */
function refuseWith(response: Response): void {
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

const updating = (): Response =>
  new Response(JSON.stringify({ code: 503, error: serverUpdatingMessage() }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("a draining server's refusal", () => {
  it("ends in SERVER_UPDATING for a quick match, a created room and a joined one", async () => {
    for (const join of [
      (manager: ColyseusNetworkManager) => manager.quickMatch("Kite"),
      (manager: ColyseusNetworkManager) => manager.createRoom("Kite"),
      (manager: ColyseusNetworkManager) => manager.joinRoom("ABC123", "Kite"),
    ]) {
      refuseWith(updating());
      const manager = new ColyseusNetworkManager("http://127.0.0.1:9", (url) => new Client(url));
      const seen: string[] = [];
      manager.subscribe({ onError: (error) => seen.push(error.code) });
      await expect(join(manager)).rejects.toMatchObject({ code: "SERVER_UPDATING" });
      expect(seen).toEqual(["SERVER_UPDATING"]);
    }
  });
});
