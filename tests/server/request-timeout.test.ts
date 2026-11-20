import { connect, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@colyseus/sdk";
import { ContentStore } from "../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../apps/server/src/content/generated-content";
import {
  HTTP_REQUEST_TIMEOUT_MS,
  createColyseusRaceServer,
  type ColyseusRaceServer,
} from "../../apps/server/src/colyseus-server";
import { PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";

let server: ColyseusRaceServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const start = async (requestTimeoutMs: number): Promise<number> => {
  server = await createColyseusRaceServer({ port: 0, contentStore: new ContentStore(GENERATED_CONTENT), requestTimeoutMs });
  return server.port;
};

/** Resolves with how long the server took to close a socket, or `undefined` if it stayed open for `waitMs`. */
const endedWithin = (socket: Socket, waitMs: number): Promise<number | undefined> => {
  const opened = Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), waitMs);
    // An ended or closed socket both mean the server let go of the request.
    const done = (): void => {
      clearTimeout(timer);
      resolve(Date.now() - opened);
    };
    socket.once("end", done);
    socket.once("close", done);
  });
};

describe("a request that never finishes sending (QC: read timeouts)", () => {
  it("keeps the production limit short", () => {
    // Matchmaking and telemetry bodies are a few hundred bytes; Node's default is five minutes.
    expect(HTTP_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });

  it("is closed by the server once the limit passes", async () => {
    const port = await start(400);
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => undefined);
    // Node's timeout sweep may answer 408 before closing; reading it lets "end" and "close" fire.
    socket.resume();
    await new Promise((resolve) => socket.once("connect", resolve));
    // Headers promise a body that never comes.
    socket.write("POST /matchmake/create/race HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 200\r\n\r\n{\"na");
    const after = await endedWithin(socket, 5_000);
    expect(after).toBeDefined();
    expect(after!).toBeGreaterThanOrEqual(300);
  });

  it("is closed by the server when the headers never finish", async () => {
    const port = await start(400);
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => undefined);
    // Node answers 408 before closing; reading it lets "end" and "close" fire.
    socket.resume();
    await new Promise((resolve) => socket.once("connect", resolve));
    socket.write("POST /matchmake/create/race HTTP/1.1\r\nHost: x\r\nContent-Ty");
    const after = await endedWithin(socket, 5_000);
    expect(after).toBeDefined();
    expect(after!).toBeGreaterThanOrEqual(300);
  });

  it("never closes a seated player's WebSocket", async () => {
    const port = await start(400);
    const client = new Client(`http://127.0.0.1:${port}`);
    const room = await client.create("race", { name: "Steady", protocolVersion: PROTOCOL_VERSION });
    room.onMessage("*", () => undefined);
    let left = false;
    room.onLeave(() => {
      left = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(left).toBe(false);
    expect(room.connection.isOpen).toBe(true);
    await room.leave(true);
  });
});
