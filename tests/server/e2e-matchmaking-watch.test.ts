import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { watchMatchmaking } from "../e2e/support/matchmaking-watch";

/**
 * What a join did on the wire, as the browser suite reads it
 * (`e2e/support/matchmaking-watch`): the page's own matchmaking calls, so a join
 * that came back refused is told apart from one that never got an answer, and
 * both from the room the server knows.
 */

function fakePage() {
  const events = new EventEmitter();
  return {
    on: ((name: string, listener: (...args: unknown[]) => void) => events.on(name, listener)) as never,
    off: ((name: string, listener: (...args: unknown[]) => void) => events.off(name, listener)) as never,
    emit: (name: string, payload: unknown) => events.emit(name, payload),
    listeners: () => events.listenerCount("response") + events.listenerCount("requestfailed"),
  };
}

const response = (url: string, status: number, body: string) => ({ url: () => url, status: () => status, text: async () => body });
const failed = (url: string, errorText: string) => ({ url: () => url, failure: () => ({ errorText }) });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("watching a page's matchmaking calls", () => {
  it("has heard nothing before a call, and ignores what is not matchmaking", async () => {
    const page = fakePage();
    const watch = watchMatchmaking(page as never);
    page.emit("response", response("http://127.0.0.1:4173/assets/menu.json", 200, "{}"));
    page.emit("requestfailed", failed("http://127.0.0.1:4173/telemetry", "net::ERR_ABORTED"));
    await settle();
    expect(watch.refusal()).toBeUndefined();
    expect(watch.lines).toEqual([]);
  });

  it("calls a 200 an answer that seats, and says nothing against the join", async () => {
    const page = fakePage();
    const watch = watchMatchmaking(page as never);
    page.emit("response", response("http://127.0.0.1:4100/matchmake/joinById/ABC234", 200, '{"sessionId":"s"}'));
    await settle();
    expect(watch.refusal()).toBeUndefined();
    expect(watch.lines).toEqual(["200 joinById/ABC234"]);
  });

  it("reads a refusal's status and the words the server gave", async () => {
    const page = fakePage();
    const watch = watchMatchmaking(page as never);
    page.emit("response", response("http://127.0.0.1:4100/matchmake/joinById/ABC234", 400, '{"error":"room \\"ABC234\\" not found"}'));
    await settle();
    expect(watch.refusal()).toBe('400 joinById/ABC234 {"error":"room \\"ABC234\\" not found"}');
  });

  it("reads a request that failed on the wire as a refusal with no answer in it", async () => {
    const page = fakePage();
    const watch = watchMatchmaking(page as never);
    page.emit("requestfailed", failed("http://127.0.0.1:4100/matchmake/joinById/ABC234", "net::ERR_CONNECTION_RESET"));
    await settle();
    expect(watch.refusal()).toBe("FAILED joinById/ABC234 net::ERR_CONNECTION_RESET");
  });

  it("stops listening when told to, so a spec does not collect a page's whole history", async () => {
    const page = fakePage();
    const watch = watchMatchmaking(page as never);
    expect(page.listeners()).toBe(2);
    watch.stop();
    expect(page.listeners()).toBe(0);
    page.emit("response", response("http://127.0.0.1:4100/matchmake/joinById/ABC234", 400, "late"));
    await settle();
    expect(watch.lines).toEqual([]);
  });
});
