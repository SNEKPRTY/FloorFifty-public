import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioManager } from "../../../../apps/client/src/features/audio";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decoding before the first tap (release readiness §9.2)", () => {
  it("decodes a preload without creating the page's AudioContext, so the browser has nothing to warn about", async () => {
    const realContexts = vi.fn();
    const decoded = vi.fn(async () => ({ duration: 1, sampleRate: 48_000, numberOfChannels: 2, length: 48_000 }));
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          realContexts();
        }
      },
    );
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        decodeAudioData = decoded;
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("manifest.json")
          ? ({
              ok: true,
              json: async () => ({
                bundles: [{ name: "audio", assets: [{ alias: ["music.menu"], src: "assets/production/menu.m4a" }] }],
              }),
            } as unknown as Response)
          : ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Response),
      ),
    );

    const audio = new AudioManager();
    await audio.load("audio");
    await audio.preload("music.menu");

    expect(decoded).toHaveBeenCalledTimes(1);
    expect(realContexts).not.toHaveBeenCalled();
  });
});

it("a cue finishes while a song remains queued in its own decoder", async () => {
  let finishSong!: () => void;
  const song = new Promise<void>((resolve) => { finishSong = resolve; });
  const calls: { context: object; kind: number }[] = [];
  vi.stubGlobal("OfflineAudioContext", class {
    private queue: Promise<unknown> = Promise.resolve();
    decodeAudioData(bytes: ArrayBuffer) {
      const kind = new Uint8Array(bytes)[0]!;
      calls.push({ context: this, kind });
      const decoded = this.queue.then(async () => {
        if (kind === 1) await song;
        return { duration: 1 };
      });
      this.queue = decoded;
      return decoded;
    }
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("manifest.json")
    ? { ok: true, json: async () => ({ bundles: [{ name: "audio", assets: [
        { alias: ["music.race"], src: "song.m4a" }, { alias: ["ui.title"], src: "cue.m4a" },
      ] }] }) }
    : { ok: true, arrayBuffer: async () => Uint8Array.of(url === "song.m4a" ? 1 : 2).buffer }));
  const audio = new AudioManager();
  await audio.load();
  let songDone = false;
  const loadingSong = audio.preload("music.race").then(() => { songDone = true; });
  let cueDone = false;
  const loadingCue = audio.preload("ui.title").then(() => { cueDone = true; });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  try {
    expect(cueDone).toBe(true);
    expect(songDone).toBe(false);
    expect(calls[0]!.context).not.toBe(calls[1]!.context);
  } finally {
    finishSong();
    await Promise.all([loadingSong, loadingCue]);
  }
});
