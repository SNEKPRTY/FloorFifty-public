// @vitest-environment node
/**
 * Reading a response while counting what arrives (Ruken loading plan, Task 3
 * and 5): the stall rule and the loader's bar need to hear each chunk, and a
 * response that has no stream (a test's stand-in) still reads whole.
 */

import { describe, expect, it } from "vitest";
import { readBlob, readJson } from "../../apps/client/src/lib/fetch-progress";

/** A response whose body arrives in the given pieces, as a slow link delivers it. */
function chunked(pieces: Uint8Array[], headers: Record<string, string> = {}): Response {
  let next = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const piece = pieces[next++];
      if (piece === undefined) controller.close();
      else controller.enqueue(piece);
    },
  });
  return new Response(body, { headers });
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("reading a body as it arrives", () => {
  it("reports every chunk with the running total and the size the server announced", async () => {
    const response = chunked([bytes('{"a"'), bytes(":1,"), bytes('"b":2}')], { "content-length": "14" });
    const seen: [number, number | undefined][] = [];
    const value = await readJson<{ a: number; b: number }>(response, (received, total) => seen.push([received, total]));
    expect(value).toEqual({ a: 1, b: 2 });
    expect(seen).toEqual([
      [4, 14],
      [7, 14],
      [13, 14],
    ]);
  });

  it("reads text that a chunk boundary cuts through a multi-byte character", async () => {
    const whole = bytes('{"word":"読み込み"}');
    const response = chunked([whole.slice(0, 11), whole.slice(11)]);
    expect(await readJson<{ word: string }>(response)).toEqual({ word: "読み込み" });
  });

  it("collects a blob of the right size and type, with no size announced", async () => {
    const response = chunked([new Uint8Array(1000), new Uint8Array(500)]);
    const seen: (number | undefined)[] = [];
    const blob = await readBlob(response, "audio/mp4", (received, total) => seen.push(total ?? received));
    expect(blob.size).toBe(1500);
    expect(blob.type).toBe("audio/mp4");
    expect(seen).toEqual([1000, 1500]);
  });

  it("reads a response that has no stream, reporting it once whole", async () => {
    const plain = { ok: true, json: async () => ({ ok: 1 }) } as unknown as Response;
    const seen: number[] = [];
    expect(await readJson(plain, (received) => seen.push(received))).toEqual({ ok: 1 });
    expect(seen).toEqual([0]);
  });

  it("passes a failed read on, as the stream raised it", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError("network error"));
      },
    });
    await expect(readBlob(new Response(body), "audio/mp4")).rejects.toThrow("network error");
  });
});
