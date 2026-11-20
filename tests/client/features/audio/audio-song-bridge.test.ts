import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioManager, type AudioContextLike } from "../../../../apps/client/src/features/audio";

/**
 * A race song decodes in about 20 s on an iPad (WebKit). Until the decode
 * lands, the song is heard from the network through a media element (the
 * "bridge"); when it lands, the decoded copy takes over where the bridge is.
 */

const MENU = "music.mainMenu";
const RACE = "music.race";
const RACE_URL = "assets/production/race.m4a";

/** Blob URLs the test has seen made and let go of, since jsdom has neither. */
let madeUrls: string[] = [];
let revokedUrls: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  madeUrls = [];
  revokedUrls = [];
  const urls = URL as unknown as { createObjectURL: (blob: Blob) => string; revokeObjectURL: (url: string) => void };
  urls.createObjectURL = () => {
    const url = `blob:silent-${madeUrls.length}`;
    madeUrls.push(url);
    return url;
  };
  urls.revokeObjectURL = (url) => void revokedUrls.push(url);
});
afterEach(() => {
  const urls = URL as unknown as Record<string, unknown>;
  delete urls["createObjectURL"];
  delete urls["revokeObjectURL"];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const param = () => ({ value: 1, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  const connections = new Map<object, object[]>();
  function node(extra = {}) {
    const value = { connect(to: object) { connections.set(value, [...(connections.get(value) ?? []), to]); }, disconnect() { connections.delete(value); }, ...extra };
    return value;
  }
  const mediaSources: ReturnType<typeof node>[] = [];
  const bufferSources: Array<ReturnType<typeof node> & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const context = {
    state: "running", currentTime: 10, destination: node(),
    resume: vi.fn(async () => { context.state = "running"; }),
    suspend: vi.fn(async () => { context.state = "suspended"; }),
    createGain: () => node({ gain: param() }),
    createMediaElementSource: vi.fn(() => { const source = node(); mediaSources.push(source); return source; }),
    createBufferSource: () => {
      const source = node({ playbackRate: param(), start: vi.fn(), stop: vi.fn() }) as (typeof bufferSources)[number];
      bufferSources.push(source);
      return source;
    },
  };

  const elements: FakeAudio[] = [];
  class FakeAudio extends EventTarget {
    src = ""; preload = ""; loop = false; currentTime = 0; duration = 200; paused = true; playbackRate = 1;
    play = vi.fn(async () => { this.paused = false; });
    pause = vi.fn(() => { this.paused = true; });
    load = vi.fn();
    removeAttribute(name: string) { if (name === "src") this.src = ""; }
    constructor() { super(); elements.push(this); }
  }
  vi.stubGlobal("Audio", FakeAudio);

  // The race song's decode waits until the test lets it land (or fail).
  let landDecode!: () => void;
  let failDecode!: () => void;
  const decode = vi.fn((bytes: ArrayBuffer) => {
    void bytes;
    return new Promise<object>((resolve, reject) => {
      landDecode = () => resolve({ duration: 200 });
      failDecode = () => reject(new Error("decode failed"));
    });
  });
  vi.stubGlobal("OfflineAudioContext", class { decodeAudioData = decode; });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("manifest.json")
    ? { ok: true, json: async () => ({ bundles: [{ name: "audio", assets: [
        { alias: [MENU], src: "assets/production/main-menu.m4a" },
        { alias: [RACE], src: RACE_URL, data: { loopStartMs: 20_000, loopEndMs: 90_000 } },
        { alias: ["music.plain"], src: "assets/production/plain.m4a" },
        { alias: ["ui.title"], src: "assets/production/title.wav" },
      ] }] }) }
    : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));

  const audio = new AudioManager({ createContext: () => context as unknown as AudioContextLike });
  /** The element playing the race song's file, if one has been given it. */
  const songElement = () => elements.find((element) => element.src === RACE_URL);
  return { audio, context, elements, bufferSources, mediaSources, decode, songElement, land: () => landDecode(), fail: () => failDecode() };
}

async function started() {
  const fixture = setup();
  await fixture.audio.load();
  await fixture.audio.unlock();
  return fixture;
}

/** Lets the promises a call set going run to their next wait. */
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };

describe("a race song heard from the network while it decodes", () => {
  it("sounds at once through the music bus, without waiting for the decode", async () => {
    const { audio, songElement, mediaSources, bufferSources } = await started();
    audio.play(RACE);
    await flush();
    const element = songElement();
    expect(element).toBeDefined();
    expect(element!.play).toHaveBeenCalled();
    expect(element!.paused).toBe(false);
    expect(mediaSources).toHaveLength(1);
    expect(bufferSources).toHaveLength(0);
    expect(audio.isLooping(RACE)).toBe(true);
    expect(audio.playing).toBe(true);
  });

  it("starts part-way in when asked to, as a replay does", async () => {
    const { audio, songElement } = await started();
    audio.play(RACE, 12_500);
    await flush();
    expect(songElement()!.currentTime).toBe(12.5);
  });

  it("reports where it is while it sounds, for the beat and for a later restart", async () => {
    const { audio, songElement } = await started();
    audio.play(RACE);
    await flush();
    songElement()!.currentTime = 7.25;
    expect(audio.positionOf(RACE)).toBe(7250);
    expect(audio.nowPlaying()).toEqual({ alias: RACE, ms: 7250 });
  });

  it("does not start over when the race asks for the song again at GO", async () => {
    const { audio, songElement } = await started();
    audio.play(RACE);
    await flush();
    songElement()!.currentTime = 5;
    audio.play(RACE);
    await flush();
    expect(songElement()!.currentTime).toBe(5);
    expect(songElement()!.play).toHaveBeenCalledTimes(1);
  });

  it("hands over to the decoded copy where the song is by then, not from the top", async () => {
    const { audio, songElement, bufferSources, land } = await started();
    audio.play(RACE);
    await flush();
    songElement()!.currentTime = 30;
    land();
    await flush();
    expect(bufferSources).toHaveLength(1);
    const [, offsetSeconds] = bufferSources[0]!.start.mock.calls[0] as [number, number];
    // A little ahead of the stream's 30 s, for the moment the swap takes.
    expect(offsetSeconds).toBeGreaterThan(30);
    expect(offsetSeconds).toBeLessThan(30.5);
    expect(bufferSources[0]).toMatchObject({ loop: true, loopStart: 20, loopEnd: 90 });
    expect(audio.isLooping(RACE)).toBe(true);
  });

  it("lets the stream ring out for the crossfade, then pauses it", async () => {
    const { audio, songElement, land } = await started();
    audio.play(RACE);
    await flush();
    songElement()!.currentTime = 30;
    land();
    await flush();
    expect(songElement()!.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(songElement()!.paused).toBe(true);
    expect(audio.isLooping(RACE)).toBe(true);
    expect(audio.mixer.liveSources).toBe(1);
  });

  it("wraps into the loop region the way the decoded copy would, if the stream passes the region's end first", async () => {
    const { audio, songElement, land, bufferSources } = await started();
    audio.play(RACE);
    await flush();
    const element = songElement()!;
    element.currentTime = 91;
    element.dispatchEvent(new Event("timeupdate"));
    expect(element.currentTime).toBe(20);
    land();
    await flush();
    expect(bufferSources).toHaveLength(1);
  });

  it("plays a whole-file song with no authored region on a native loop", async () => {
    const { audio, elements } = await started();
    audio.play("music.plain");
    await flush();
    const element = elements.find((candidate) => candidate.src.endsWith("plain.m4a"))!;
    expect(element.loop).toBe(true);
  });

  it("starts from the decoded copy at once when it was already decoded, with no stream", async () => {
    const { audio, elements, bufferSources, land, songElement } = await started();
    void audio.preload(RACE);
    await flush();
    land();
    await flush();
    audio.play(RACE);
    await flush();
    expect(songElement()).toBeUndefined();
    expect(elements.filter((element) => element.src !== "")).toHaveLength(0);
    expect(bufferSources).toHaveLength(1);
  });

  it("is cut by stop, and a decode that lands afterwards starts nothing", async () => {
    const { audio, songElement, land, bufferSources } = await started();
    audio.play(RACE);
    await flush();
    audio.stop();
    expect(songElement()!.paused).toBe(true);
    expect(audio.isLooping(RACE)).toBe(false);
    land();
    await flush();
    expect(bufferSources).toHaveLength(0);
  });

  it("gives way to the next song, on the same element", async () => {
    const { audio, elements } = await started();
    audio.play(RACE);
    await flush();
    audio.play("music.plain");
    await flush();
    expect(elements).toHaveLength(1);
    expect(elements[0]!.src).toBe("assets/production/plain.m4a");
    expect(audio.isLooping(RACE)).toBe(false);
    expect(audio.isLooping("music.plain")).toBe(true);
    expect(audio.mixer.liveSources).toBe(1);
  });

  it("keeps sounding when the decode fails, rather than falling silent", async () => {
    const { audio, songElement, fail, bufferSources } = await started();
    audio.play(RACE);
    await flush();
    fail();
    await flush();
    expect(bufferSources).toHaveLength(0);
    expect(songElement()!.paused).toBe(false);
    expect(audio.isLooping(RACE)).toBe(true);
  });

  it("stays quiet, and throws nothing, where the browser refuses the stream; the decode still comes in", async () => {
    const { audio, elements, land, bufferSources } = await started();
    const refuse = vi.fn(async () => { throw new DOMException("gesture needed", "NotAllowedError"); });
    // The next element made is the song's: it refuses to play.
    const make = (globalThis as unknown as { Audio: new () => (typeof elements)[number] }).Audio;
    vi.stubGlobal("Audio", class extends make { constructor() { super(); this.play = refuse as unknown as typeof this.play; } });
    audio.play(RACE);
    await flush();
    expect(refuse).toHaveBeenCalled();
    land();
    await flush();
    expect(bufferSources).toHaveLength(1);
  });

  it("pauses while the page sleeps and plays on when it wakes", async () => {
    const { audio, songElement } = await started();
    audio.play(RACE);
    await flush();
    await audio.mixer.sleep();
    expect(songElement()!.paused).toBe(true);
    await audio.mixer.wake();
    expect(songElement()!.paused).toBe(false);
  });

  it("is released with the engine", async () => {
    const { audio, songElement } = await started();
    audio.play(RACE);
    await flush();
    audio.destroy();
    expect(songElement()).toBeUndefined();
  });
});

describe("the gesture that lets a later song play", () => {
  it("plays a silent clip in a gesture, and the song later reuses that element", async () => {
    const { audio, elements, songElement } = await started();
    await audio.mixer.resumeOnGesture();
    expect(elements).toHaveLength(1);
    expect(elements[0]!.play).toHaveBeenCalledTimes(1);
    // A blob: URL, never a data: one: Ruken's policy allows `media-src 'self' blob:` only.
    expect(elements[0]!.src).toBe(madeUrls[0]);
    expect(elements[0]!.src).toMatch(/^blob:/);
    await flush();
    expect(elements[0]!.paused).toBe(true);
    expect(revokedUrls).toEqual(madeUrls);
    audio.play(RACE);
    await flush();
    expect(elements).toHaveLength(1);
    expect(songElement()).toBe(elements[0]);
    expect(elements[0]!.paused).toBe(false);
  });

  it("lets the silent clip's URL go even where the browser refuses to play it", async () => {
    const { audio, elements } = await started();
    const make = (globalThis as unknown as { Audio: new () => (typeof elements)[number] }).Audio;
    vi.stubGlobal("Audio", class extends make { constructor() { super(); this.play = vi.fn(async () => { throw new DOMException("gesture needed", "NotAllowedError"); }) as unknown as typeof this.play; } });
    await audio.mixer.resumeOnGesture();
    await flush();
    expect(madeUrls).toHaveLength(1);
    expect(revokedUrls).toEqual(madeUrls);
  });

  it("is harmless where the browser has no blob URLs: the gesture goes on and nothing is made", async () => {
    const { audio, elements } = await started();
    // Unset rather than deleted: Node's own URL (Vitest 4's jsdom keeps it) has a native one underneath.
    (URL as unknown as Record<string, unknown>)["createObjectURL"] = undefined;
    await expect(audio.mixer.resumeOnGesture()).resolves.toBeUndefined();
    expect(elements).toHaveLength(0);
  });

  it("does the silent clip once, however many gestures follow", async () => {
    const { audio, elements } = await started();
    await audio.mixer.resumeOnGesture();
    await flush();
    await audio.mixer.resumeOnGesture();
    expect(elements[0]!.play).toHaveBeenCalledTimes(1);
  });

  it("does not play the silent clip over a song that is already sounding", async () => {
    const { audio, songElement, elements } = await started();
    audio.play(RACE);
    await flush();
    await audio.mixer.resumeOnGesture();
    expect(songElement()!.src).toBe(RACE_URL);
    expect(elements).toHaveLength(1);
  });
});

describe("what is not a race song", () => {
  it("makes no stream for a short cue or for a preview", async () => {
    const { audio, elements } = await started();
    audio.cue("ui.title", { bus: "ui" });
    await flush();
    expect(elements).toHaveLength(0);
  });
});
