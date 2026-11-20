// @vitest-environment node
/**
 * The client's content cache.
 *
 * The cache is the client's only copy of the catalog, and from Task 9 of its
 * screen graph too, so the rule that matters is that nothing replaces it
 * except a response that decoded. A server answering with something this
 * build cannot read must leave the client on the last artifact it understood.
 */

import { describe, expect, it, vi } from "vitest";
import { HttpContentManager } from "../../../../apps/client/src/features/net/content";
import { LoadMeter, LoadStalled, STALL_MS } from "../../../../apps/client/src/lib/load-meter";
import { ManualTimers } from "../../support/manual-timers";
import type { GameContent } from "@floor-fifty/shared/content/game-content";
import { GENERATED_CONTENT } from "../../../../apps/server/src/content/generated-content";

const fixtureContent: GameContent = GENERATED_CONTENT;

const okJson = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

const failing = (status: number): Response =>
  ({ ok: false, status, json: async () => ({}) }) as Response;

/** Answers each call with the next response, then repeats the last. */
const sequenceFetch = (...responses: Response[]) => {
  let index = 0;
  return vi.fn(async () => responses[Math.min(index++, responses.length - 1)]!);
};

describe("HttpContentManager", () => {
  it("requests /content under the configured server origin", async () => {
    const request = sequenceFetch(okJson(fixtureContent));
    await new HttpContentManager("http://server/", request).refresh();
    // With the signal the stall rule can abort it by.
    expect(request).toHaveBeenCalledWith("http://server/content", expect.any(AbortSignal));
  });

  it("keeps the last valid cache after an invalid refresh", async () => {
    const manager = new HttpContentManager(
      "http://server",
      sequenceFetch(okJson(fixtureContent), okJson({ schemaVersion: 99 })),
    );
    expect(await manager.refresh()).toEqual(fixtureContent);
    await expect(manager.refresh()).rejects.toThrow();
    expect(manager.current()).toEqual(fixtureContent);
  });

  it("keeps the last valid cache after a failed request", async () => {
    const manager = new HttpContentManager(
      "http://server",
      sequenceFetch(okJson(fixtureContent), failing(503)),
    );
    await manager.refresh();
    await expect(manager.refresh()).rejects.toThrow();
    expect(manager.current()).toEqual(fixtureContent);
  });

  it("notifies subscribers only after a valid decoded replacement", async () => {
    const seen: GameContent[] = [];
    const manager = new HttpContentManager(
      "http://server",
      sequenceFetch(okJson(fixtureContent), okJson({ schemaVersion: 99 })),
    );
    const dispose = manager.subscribe((content) => seen.push(content));

    await manager.refresh();
    await expect(manager.refresh()).rejects.toThrow();
    dispose();
    dispose();

    expect(seen).toEqual([fixtureContent]);
  });

  it("has nothing cached before the first refresh", () => {
    expect(new HttpContentManager("http://server", sequenceFetch()).current()).toBeUndefined();
  });
  it("is covered by the stall rule: 30 s of nothing fails the refresh and keeps the cache, any byte restarts the clock", async () => {
    const timers = new ManualTimers();
    const loads = new LoadMeter({ timers });
    let signal: AbortSignal | undefined;
    const manager = new HttpContentManager(
      "http://server",
      (_url, given) => {
        signal = given;
        return new Promise<Response>(() => undefined);
      },
      { loads },
    );
    const outcome = manager.refresh().then(
      () => "refreshed",
      (error: unknown) => error,
    );

    await timers.advance(STALL_MS - 1);
    expect(signal?.aborted).toBe(false);
    loads.progress();
    await timers.advance(STALL_MS - 1);
    expect(signal?.aborted).toBe(false);
    await timers.advance(1);
    expect(await outcome).toBeInstanceOf(LoadStalled);
    expect(signal?.aborted).toBe(true);
    expect(manager.current()).toBeUndefined();
  });

  it("reports how much of the artifact has been read", async () => {
    const text = new TextEncoder().encode(JSON.stringify(fixtureContent));
    const half = Math.floor(text.byteLength / 2);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(text.slice(0, half));
        controller.enqueue(text.slice(half));
        controller.close();
      },
    });
    const response = new Response(body, { headers: { "content-length": String(text.byteLength) } });
    const fractions: number[] = [];
    await new HttpContentManager("http://server", async () => response).refresh((fraction) => fractions.push(fraction));
    expect(fractions[0]).toBeCloseTo(half / text.byteLength);
    expect(fractions.at(-1)).toBe(1);
  });
});
