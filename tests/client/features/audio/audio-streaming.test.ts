import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioManager, type AudioContextLike } from "../../../../apps/client/src/features/audio";
import { LoadMeter, LoadStalled, STALL_MS } from "../../../../apps/client/src/lib/load-meter";
import { ManualTimers } from "../../support/manual-timers";

const MENU = "music.mainMenu";
const SONG_URL = "assets/production/main-menu.m4a";
const SONG_BLOB = "blob:menu-song";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
});

/** The song's body as a slow link delivers it: the given pieces, one after another. */
function songBody(pieces: number[], headers: Record<string, string> = { "content-length": String(pieces.reduce((a, b) => a + b, 0)), "content-type": "audio/mp4" }): Response {
  let next = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const size = pieces[next++];
        if (size === undefined) controller.close();
        else controller.enqueue(new Uint8Array(size));
      },
    }),
    { headers },
  );
}

function setup(loads?: LoadMeter) {
  const connections = new Map<object, object[]>();
  function node(extra = {}) {
    const value = { connect(to: object) { connections.set(value, [...(connections.get(value) ?? []), to]); }, disconnect() { connections.delete(value); }, ...extra };
    return value;
  }
  const param = () => ({ value: 1, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  const destination = node();
  const mediaSource = node();
  const bufferSources: object[] = [];
  const context = {
    state: "running", currentTime: 0, destination,
    resume: vi.fn(async () => { context.state = "running"; }),
    suspend: vi.fn(async () => { context.state = "suspended"; }),
    createGain: () => node({ gain: param() }),
    createMediaElementSource: vi.fn(() => mediaSource),
    createBufferSource: () => { const source = node({ playbackRate: param(), start: vi.fn(), stop: vi.fn() }); bufferSources.push(source); return source; },
  };
  const elements: FakeAudio[] = [];
  class FakeAudio extends EventTarget {
    src = ""; preload = ""; loop = false; currentTime = 0; duration = 330; paused = true; playbackRate = 1;
    play = vi.fn(async () => { this.paused = false; });
    pause = vi.fn(() => { this.paused = true; });
    load = vi.fn();
    removeAttribute(name: string) { if (name === "src") this.src = ""; }
    constructor() { super(); elements.push(this); }
  }
  vi.stubGlobal("Audio", FakeAudio);
  const decode = vi.fn(async () => ({ duration: 330 }));
  vi.stubGlobal("OfflineAudioContext", class { decodeAudioData = decode; });
  // The menu song is a download, not an element's `src`: its bytes are fetched
  // with progress and played from memory (a Blob URL), which is the one thing
  // that works on iOS before a gesture and lets "Tap to start" mean the song is in.
  const songFetch = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => songBody([600, 400]));
  const createObjectURL = vi.fn((_blob: Blob) => SONG_BLOB);
  const revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => url.endsWith("manifest.json")
    ? { ok: true, json: async () => ({ bundles: [{ name: "audio", assets: [
        { alias: [MENU], src: SONG_URL },
        { alias: ["music.race"], src: "assets/production/race.m4a", data: { loopStartMs: 1000, loopEndMs: 9000 } },
        { alias: ["preview.race"], src: "assets/production/preview.m4a" },
      ] }] }) }
    : url === SONG_URL
      ? songFetch(url, init)
      : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  const audio = new AudioManager({ createContext: () => context as unknown as AudioContextLike, ...(loads === undefined ? {} : { loads }) });
  return { audio, elements, decode, context, connections, mediaSource, destination, bufferSources, songFetch, createObjectURL, revokeObjectURL };
}

async function start() {
  const fixture = setup();
  await fixture.audio.load();
  await fixture.audio.preload(MENU);
  await fixture.audio.unlock();
  fixture.audio.play(MENU, 220_000);
  await Promise.resolve();
  return fixture;
}

describe("streamed menu music", () => {
  it("preloads by downloading the whole file, without decoding or creating a live context", async () => {
    const { audio, decode, elements, context, songFetch, createObjectURL } = setup();
    await audio.load();
    await audio.preload(MENU);
    expect(songFetch).toHaveBeenCalledTimes(1);
    expect(songFetch.mock.calls[0]![0]).toBe(SONG_URL);
    // One blob of everything that arrived, and the element plays that, not the network.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0]![0].size).toBe(1000);
    expect(createObjectURL.mock.calls[0]![0].type).toBe("audio/mp4");
    expect(elements[0]?.src).toBe(SONG_BLOB);
    expect(decode).not.toHaveBeenCalled();
    expect(context.createMediaElementSource).not.toHaveBeenCalled();
  });

  it("resolves its preload only when the last byte is in, reporting the bytes as they come", async () => {
    const { audio, elements, songFetch } = setup();
    let pass!: () => void;
    const gate = new Promise<void>((resolve) => (pass = resolve));
    songFetch.mockImplementation(async () => {
      let next = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (next === 1) await gate;
            if (next++ < 2) controller.enqueue(new Uint8Array(500));
            else controller.close();
          },
        }),
        { headers: { "content-length": "1000", "content-type": "audio/mp4" } },
      );
    });
    await audio.load();
    const fractions: number[] = [];
    let done = false;
    void audio.preload(MENU, (fraction) => fractions.push(fraction)).then(() => (done = true));
    await vi.waitFor(() => expect(fractions).toEqual([0.5]));
    expect(done).toBe(false);
    // Half the file is in, and still nothing plays from it.
    expect(elements).toHaveLength(0);
    pass();
    await vi.waitFor(() => expect(done).toBe(true));
    expect(fractions).toEqual([0.5, 1]);
    expect(elements[0]?.src).toBe(SONG_BLOB);
  });

  it("shares one download between callers, and fetches nothing again once the bytes are in", async () => {
    const { audio, songFetch } = setup();
    await audio.load();
    await Promise.all([audio.preload(MENU), audio.preload(MENU)]);
    await audio.preload(MENU);
    expect(songFetch).toHaveBeenCalledTimes(1);
  });

  it("fails its preload on an error or an unwanted answer, and tries the whole download again next time", async () => {
    const { audio, elements, songFetch } = setup();
    await audio.load();
    songFetch.mockResolvedValueOnce(new Response("gone", { status: 404 }));
    await expect(audio.preload(MENU)).rejects.toThrow(/404/);
    songFetch.mockRejectedValueOnce(new TypeError("network error"));
    await expect(audio.preload(MENU)).rejects.toThrow("network error");
    expect(elements).toHaveLength(0);
    await expect(audio.preload(MENU)).resolves.toBeUndefined();
    expect(elements[0]?.src).toBe(SONG_BLOB);
  });

  it("fails its preload when the song is not in the manifest, rather than waiting on a file nobody named", async () => {
    const { audio } = setup();
    // `load()` was not called, or its manifest never came: no alias, no source.
    await expect(audio.preload(MENU)).rejects.toThrow(/menu song/);
  });

  it("answers to the stall rule: 30 s without a byte fails the preload and lets go of the request", async () => {
    const timers = new ManualTimers();
    const loads = new LoadMeter({ timers });
    const { audio, songFetch, elements } = setup(loads);
    let signal: AbortSignal | undefined;
    songFetch.mockImplementation((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    await audio.load();
    const outcome = audio.preload(MENU).then(
      () => "loaded",
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(signal).toBeDefined());
    await timers.advance(STALL_MS - 1);
    expect(signal?.aborted).toBe(false);
    await timers.advance(1);
    expect(await outcome).toBeInstanceOf(LoadStalled);
    expect(signal?.aborted).toBe(true);
    expect(elements).toHaveLength(0);
  });

  it("starts a play asked for before the bytes are in as soon as they are, from the offset asked", async () => {
    const { audio, elements, songFetch } = setup();
    let pass!: () => void;
    const gate = new Promise<void>((resolve) => (pass = resolve));
    songFetch.mockImplementation(async () => {
      await gate;
      return songBody([1000]);
    });
    await audio.load();
    await audio.unlock();
    const loading = audio.preload(MENU);
    audio.play(MENU, 220_000);
    expect(elements).toHaveLength(0);
    expect(audio.isLooping(MENU)).toBe(false);
    // Not yet playing, but where it will start is known.
    expect(audio.positionOf(MENU)).toBe(220_000);
    pass();
    await loading;
    expect(elements[0]!.currentTime).toBe(220);
    expect(elements[0]!.play).toHaveBeenCalled();
    expect(audio.isLooping(MENU)).toBe(true);
  });

  it("does not start a song that was stopped while it was still downloading", async () => {
    const { audio, elements, songFetch } = setup();
    let pass!: () => void;
    const gate = new Promise<void>((resolve) => (pass = resolve));
    songFetch.mockImplementation(async () => {
      await gate;
      return songBody([1000]);
    });
    await audio.load();
    await audio.unlock();
    const loading = audio.preload(MENU);
    audio.play(MENU, 220_000);
    audio.stop(MENU);
    pass();
    await loading;
    expect(elements[0]!.play).not.toHaveBeenCalled();
    expect(audio.isLooping(MENU)).toBe(false);
  });

  it("gives the bytes back when the audio is destroyed", async () => {
    const { audio, revokeObjectURL } = setup();
    await audio.load();
    await audio.preload(MENU);
    audio.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith(SONG_BLOB);
  });

  it("starts at 220 seconds, loops, and reaches the existing music graph", async () => {
    const { audio, elements, decode, connections, mediaSource, destination } = await start();
    expect(decode).not.toHaveBeenCalled();
    expect(elements[0]?.currentTime).toBe(220);
    expect(elements[0]?.loop).toBe(true);
    expect(audio.isLooping(MENU)).toBe(true);
    expect(audio.playing).toBe(true);
    const reached = new Set<object>();
    function visit(node: object) { if (reached.has(node)) return; reached.add(node); for (const next of connections.get(node) ?? []) visit(next); }
    visit(mediaSource);
    expect(reached.has(destination)).toBe(true);
    expect(audio.mixer.liveSources).toBe(1);
  });

  it("remembers media time on stop and reuses the element/source on return", async () => {
    const { audio, elements, context } = await start();
    expect(elements).toHaveLength(1);
    elements[0]!.currentTime = 242.5;
    expect(audio.positionOf(MENU)).toBe(242_500);
    expect(audio.nowPlaying()).toEqual({ alias: MENU, ms: 242_500 });
    audio.stop("music.other");
    expect(audio.isLooping(MENU)).toBe(true);
    audio.stop(MENU);
    expect(elements[0]!.paused).toBe(true);
    expect(audio.isLooping(MENU)).toBe(false);
    expect(audio.positionOf(MENU)).toBe(242_500);
    audio.play(MENU, audio.positionOf(MENU));
    await Promise.resolve();
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(elements).toHaveLength(1);
    expect(elements[0]!.currentTime).toBe(242.5);
  });

  it("retries a rejected media play synchronously on a gesture even with a running context", async () => {
    const { audio, elements } = setup();
    await audio.load();
    await audio.preload(MENU);
    expect(elements).toHaveLength(1);
    elements[0]!.play.mockRejectedValueOnce(new DOMException("gesture needed", "NotAllowedError"));
    await audio.unlock();
    audio.play(MENU, 220_000);
    await Promise.resolve();
    const attempts = elements[0]!.play.mock.calls.length;
    const resumed = audio.mixer.resumeOnGesture();
    expect(elements[0]!.play.mock.calls.length).toBe(attempts + 1);
    await resumed;
    expect(audio.playing).toBe(true);
  });

  it("pauses while hidden, resumes at the same media time, and cannot revive after stop", async () => {
    const { audio, elements } = await start();
    expect(elements).toHaveLength(1);
    elements[0]!.currentTime = 225;
    await audio.mixer.sleep();
    expect(elements[0]!.paused).toBe(true);
    await audio.mixer.resumeOnGesture();
    expect(elements[0]!.paused).toBe(true);
    await audio.mixer.wake();
    expect(elements[0]!.paused).toBe(false);
    expect(audio.positionOf(MENU)).toBe(225_000);
    audio.stop();
    await audio.mixer.resumeOnGesture();
    expect(elements[0]!.paused).toBe(true);
  });

  it("keeps the requested offset when WebKit cannot seek before metadata and the menu is left", async () => {
    const { audio, elements } = setup();
    await audio.load();
    await audio.preload(MENU);
    const element = elements[0]!;
    let metadata = false;
    let time = 0;
    Object.defineProperty(element, "currentTime", {
      get: () => time,
      set: (value: number) => { if (!metadata) throw new DOMException("no metadata", "InvalidStateError"); time = value; },
    });
    await audio.unlock();
    audio.play(MENU, 220_000);
    expect(audio.positionOf(MENU)).toBe(220_000);
    audio.stop();
    expect(audio.positionOf(MENU)).toBe(220_000);
    metadata = true;
    element.dispatchEvent(new Event("loadedmetadata"));
    expect(time).toBe(0);
    audio.play(MENU, audio.positionOf(MENU));
    expect(time).toBe(220);
  });

  it.each(["stop", "sleep", "destroy", "handoff"] as const)("a pending play cannot revive after %s", async (action) => {
    const { audio, elements } = setup();
    await audio.load();
    await audio.preload(MENU);
    const element = elements[0]!;
    let rejectPlay!: (error: unknown) => void;
    element.play.mockImplementationOnce(() => {
      element.paused = false;
      return new Promise<void>((_resolve, reject) => { rejectPlay = reject; });
    });
    await audio.unlock();
    audio.play(MENU, 220_000);
    if (action === "stop") audio.stop();
    if (action === "sleep") await audio.mixer.sleep();
    if (action === "destroy") audio.destroy();
    if (action === "handoff") await audio.mixer.playMusic("music.race");
    rejectPlay(new DOMException("play interrupted by pause", "AbortError"));
    await Promise.resolve();
    await audio.mixer.resumeOnGesture();
    expect(element.paused).toBe(true);
    expect(audio.isLooping(MENU)).toBe(false);
  });

  it("starts media synchronously on the first eligible gesture while context resume is still pending", async () => {
    const { audio, elements, context } = setup();
    await audio.load();
    await audio.preload(MENU);
    context.state = "suspended";
    let finishResume!: () => void;
    context.resume.mockImplementation(() => new Promise<void>((resolve) => { finishResume = () => { context.state = "running"; resolve(); }; }));
    const initialUnlock = audio.unlock();
    elements[0]!.play.mockRejectedValueOnce(new DOMException("gesture needed", "NotAllowedError"));
    audio.play(MENU, 220_000);
    await Promise.resolve();
    const gesture = audio.mixer.resumeOnGesture();
    expect(elements[0]!.paused).toBe(false);
    expect(context.state).toBe("suspended");
    expect(elements[0]!.currentTime).toBe(220);
    finishResume();
    await gesture;
    // The initial blocked resume is intentionally still pending, as it can be in a browser.
    void initialUnlock;
  });

  it("hands off to a decoded region loop and destroys the media source", async () => {
    const { audio, elements, bufferSources, connections, mediaSource } = await start();
    expect(elements).toHaveLength(1);
    await audio.mixer.playMusic("music.race");
    expect(elements[0]!.paused).toBe(true);
    expect(bufferSources[0]).toMatchObject({ loop: true, loopStart: 1, loopEnd: 9 });
    audio.destroy();
    expect(connections.has(mediaSource)).toBe(false);
    expect(elements[0]!.src).toBe("");
  });
});
