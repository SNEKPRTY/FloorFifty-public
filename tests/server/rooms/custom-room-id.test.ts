import { afterEach, describe, expect, it } from "vitest";
import { Room } from "@colyseus/core";
import { Schema } from "@colyseus/schema";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";

class ProbeState extends Schema {}
class ProbeRoom extends Room<{ state: ProbeState }> {
  override async onCreate(): Promise<void> {
    this.roomId = "ABC123";
    this.setState(new ProbeState());
  }
}

let server: ColyseusTestServer | undefined;

afterEach(async () => {
  await server?.shutdown();
});

describe("a custom roomId assigned in onCreate", () => {
  it("is the id the matchmaker registers and joinById finds", async () => {
    server = await boot(config({
      initializeGameServer(gameServer) {
        gameServer.define("probe", ProbeRoom);
      },
    }));
    const created = await server.sdk.create("probe", {});
    const joined = await server.sdk.joinById("ABC123", {});
    expect(created.roomId).toBe("ABC123");
    expect(joined.roomId).toBe("ABC123");
  });
});
