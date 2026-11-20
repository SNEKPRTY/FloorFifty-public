import { afterEach, describe, expect, it } from "vitest";
import { createAudioDebug, readAudioDebugMode } from "../../../../apps/client/src/features/audio/diagnostics";

afterEach(() => {
  document.querySelectorAll("[data-audio-debug]").forEach((panel) => panel.remove());
});

describe("audio diagnostics (?audiodebug)", () => {
  it("is off without the flag, watches with it, and asks for the playback session or the bench only when told", () => {
    expect(readAudioDebugMode("")).toBeUndefined();
    expect(readAudioDebugMode("?room=abc")).toBeUndefined();
    expect(readAudioDebugMode("?audiodebug")).toBe("watch");
    expect(readAudioDebugMode("?audiodebug=1")).toBe("watch");
    expect(readAudioDebugMode("?room=abc&audiodebug=playback")).toBe("playback");
    expect(readAudioDebugMode("?audiodebug=bench")).toBe("bench");
  });

  it("logs each resume with the event it came from, and calls the real resume at once so a gesture still counts", async () => {
    const lines: string[] = [];
    const debug = createAudioDebug("watch", window, (line) => lines.push(line));
    const resumed: string[] = [];
    const destination = {};
    const node = () => ({ connect: () => undefined, fftSize: 0, getFloatTimeDomainData: () => undefined });
    const context = {
      state: "suspended",
      sampleRate: 48_000,
      baseLatency: 0.01,
      currentTime: 0,
      destination,
      addEventListener: () => undefined,
      createGain: node,
      createAnalyser: node,
      resume() {
        resumed.push("real");
        this.state = "running";
        return Promise.resolve();
      },
      suspend: () => Promise.resolve(),
    };

    debug.watchContext(context as unknown as AudioContext);
    const asked = context.resume();
    // Called before the wrapper returned, not on a later tick.
    expect(resumed).toEqual(["real"]);
    await asked;
    await Promise.resolve();

    expect(lines.some((line) => line.includes("context made: state=suspended rate=48000"))).toBe(true);
    expect(lines.some((line) => line.includes("resume() from no event") && line.includes("state=suspended"))).toBe(true);
    expect(lines.some((line) => line.includes("resolved: state=running"))).toBe(true);
    // The graph's master now lands on the tap, which feeds the real destination.
    expect(context.destination).not.toBe(destination);
    expect(document.querySelector("[data-audio-debug]")?.textContent).toContain("resolved: state=running");
  });

  it("logs a decode that failed with the browser's reason", () => {
    const lines: string[] = [];
    const debug = createAudioDebug("watch", window, (line) => lines.push(line));
    debug.decoded("music.menu", { error: new DOMException("Decoding failed", "EncodingError"), ms: 12 });
    expect(lines.at(-1)).toContain("decode music.menu FAILED after 12ms: EncodingError: Decoding failed");
  });
});
