/**
 * The mixer.
 *
 * Six properties, and every one of them is something a player notices the
 * absence of rather than the presence: that sound starts at all under a
 * browser's autoplay rules, that a mute is silent, that the stage loop does
 * not gap, that a cue confirmed twice is heard once, that a burst of landings
 * cannot exhaust the machine, and that muting changes nothing about the race.
 */

import { describe, expect, it, vi } from "vitest";
import {
  AudioEngine,
  AudioManager,
  DEFAULT_GAINS,
  DRONE_GAIN,
  PREVIEW_FADE_SECONDS,
  raceSong,
  softClipCurve,
  songById,
  type AudioContextLike,
  type AudioEngineOptions,
  type DecodedTrack, DANGER_MUSIC_HZ, MUSIC_TAIL_SECONDS, DANGER_RUMBLE_GAIN, FAR_CUE_HZ, MIXES, playerGain, SLOW_MUSIC_CUTOFF_HZ, VOICE_BUS_DUCK } from "../../../../apps/client/src/features/audio";
// Loaded here, not inside the test that uses it: race-cues pulls in the
// compiled message catalogues, a module graph that takes over a second to
// load cold, and a test's own five seconds are no place to spend that on a
// loaded runner. Collection has no such budget.
import { MISSED_FLOOR_CUE, WALL_SCUFF_CUE } from "../../../../apps/client/src/features/race/race-cues";

/** A recording stand-in for the Web Audio graph. */
type Started = {
  alias: string;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  when?: number;
  offset?: number;
  duration?: number;
  /** Playback rate, where it is not one. */
  rate?: number;
};

function fakeContext(): AudioContextLike & {
  started: Started[];
  /** Every stop asked for: the alias, and when on the graph's clock (now when omitted). */
  stopped: { alias: string; when: number }[];
  gains: Map<string, number>;
  resumed: number;
  advance(seconds: number): void;
} {
  const started: Started[] = [];
  const stopped: { alias: string; when: number }[] = [];
  const gains = new Map<string, number>();
  let resumed = 0;
  /** Sources told to stop at a time still ahead, which `advance` ends. */
  const stopping: { at: number; end: () => void }[] = [];

  const context = {
    state: "suspended" as AudioContextState,
    currentTime: 0,
    destination: {} as AudioNode,
    get resumed() {
      return resumed;
    },
    started,
    stopped,
    gains,
    async resume() {
      resumed += 1;
      context.state = "running";
    },
    async suspend() {
      context.state = "suspended";
    },
    /** Moves the graph's clock on, ending every source whose stop time it passes. */
    advance(seconds: number) {
      context.currentTime += seconds;
      for (const due of stopping.filter((entry) => entry.at <= context.currentTime)) {
        stopping.splice(stopping.indexOf(due), 1);
        due.end();
      }
    },
    createGain() {
      let value = 1;
      const targets: unknown[] = [];
      return {
        targets,
        gain: {
          get value() {
            return value;
          },
          set value(next: number) {
            value = next;
          },
          setTargetAtTime(next: number) {
            value = next;
          },
          // The fake has no audio rate: automation lands where it ends, at once.
          setValueAtTime(next: number) {
            value = next;
          },
          linearRampToValueAtTime(next: number) {
            value = next;
          },
          cancelScheduledValues() {},
        },
        connect: (target: unknown) => void targets.push(target),
        disconnect: () => undefined,
      } as unknown as GainNode;
    },
    createBufferSource() {
      const node = {
        buffer: null as AudioBuffer | null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: { value: 1 },
        onended: null as (() => void) | null,
        connect: () => undefined,
        disconnect: () => undefined,
        start(when?: number, offset?: number, duration?: number) {
          started.push({
            alias: (node.buffer as unknown as { alias: string })?.alias ?? "?",
            loop: node.loop,
            loopStart: node.loopStart,
            loopEnd: node.loopEnd,
            ...(when === undefined || when === 0 ? {} : { when }),
            ...(offset === undefined ? {} : { offset }),
            ...(duration === undefined ? {} : { duration }),
            ...(node.playbackRate.value === 1 ? {} : { rate: node.playbackRate.value }),
          });
        },
        // Now, or once the fake clock passes `when`: a fade's stop waits for `advance`.
        stop(when?: number) {
          stopped.push({ alias: (node.buffer as unknown as { alias: string })?.alias ?? "?", when: when ?? context.currentTime });
          if (when === undefined || when <= context.currentTime) node.onended?.();
          else stopping.push({ at: when, end: () => node.onended?.() });
        },
      };
      return node as unknown as AudioBufferSourceNode;
    },
  };
  return context as never;
}

const track = (alias: string, durationMs = 121_240): DecodedTrack => ({
  buffer: { alias, duration: durationMs / 1000 } as unknown as AudioBuffer,
  loopStartMs: 405,
  loopEndMs: 53_008,
});

function engineWith(decode: AudioEngineOptions["decode"] = async (alias) => track(alias)): {
  engine: AudioEngine;
  context: ReturnType<typeof fakeContext>;
} {
  const context = fakeContext();
  const engine = new AudioEngine({ createContext: () => context, decode });
  return { engine, context };
}

/** Every gain the graph builds, in order: the master first, then one per bus in `buses` order. */
function recordGains(context: ReturnType<typeof fakeContext>): GainNode[] {
  const nodes: GainNode[] = [];
  const createGain = context.createGain.bind(context);
  context.createGain = () => {
    const node = createGain();
    nodes.push(node);
    return node;
  };
  return nodes;
}
const targetsOf = (node: AudioNode): unknown[] => (node as unknown as { targets: unknown[] }).targets;

describe("previews", () => {
  it("crossfades: the old clip fades while the new one fades in, and never more than two sound", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playPreview("music.aPreview");
    await engine.playPreview("music.bPreview");
    await engine.playPreview("music.cPreview");
    expect(engine.previewSources).toBe(2);
    context.advance(PREVIEW_FADE_SECONDS + 0.01);
    expect(engine.previewSources).toBe(1);
  });

  it("starts only the last of several quick asks", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    void engine.playPreview("music.aPreview");
    void engine.playPreview("music.bPreview");
    await engine.playPreview("music.cPreview");
    await Promise.resolve();
    expect(context.started.map((entry) => entry.alias)).toEqual(["music.cPreview"]);
  });

  it("ends the music slot when the first preview starts", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.mainMenu");
    await engine.playPreview("music.aPreview");
    expect(engine.playingMusic).toBe(false);
  });

  it("counts fading previews as live sources", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playPreview("music.aPreview");
    await engine.playPreview("music.bPreview");
    expect(engine.liveSources).toBe(2);
    context.advance(PREVIEW_FADE_SECONDS + 0.01);
    expect(engine.liveSources).toBe(1);
    engine.stopPreview();
    context.advance(PREVIEW_FADE_SECONDS + 0.01);
    expect(engine.liveSources).toBe(0);
  });

  it("a preview obeys mute and the music volume", async () => {
    // Review Focus 2: the preview enters where the music does, so the music
    // bus and the master reach it, and unmuting resumes the same clip.
    const { engine, context } = engineWith();
    const nodes = recordGains(context);
    await engine.unlock();
    const master = nodes[0]!;
    const musicBus = nodes[1 + [...engine.buses].indexOf("music")]!;
    // The music enters a gain, passes the climb's low-pass, then the duck, then
    // the bus; the preview enters where the music does, before the filter.
    const musicDuck = nodes.find((node) => targetsOf(node).includes(musicBus))!;
    const musicInput = nodes.find(
      (node) =>
        node !== musicDuck &&
        (targetsOf(node).includes(musicDuck) ||
          targetsOf(node).some((target) => (targetsOf(target as AudioNode) ?? []).includes(musicDuck))),
    )!;
    await engine.playPreview("music.aPreview");
    expect(targetsOf(nodes.at(-1)!)).toContain(musicInput);

    engine.setPlayerVolume("music", 0);
    expect(musicBus.gain.value).toBe(0);
    engine.setPlayerVolume("music", 1);

    engine.setMuted(true);
    expect(master.gain.value).toBe(0);
    const startedBefore = context.started.length;
    engine.setMuted(false);
    expect(master.gain.value).toBe(1);
    expect(context.started.length).toBe(startedBefore);
    expect(engine.previewSources).toBe(1);
  });

  it("a missing preview clip plays nothing and throws nothing", async () => {
    const missing = engineWith(async () => undefined);
    await missing.engine.unlock();
    await expect(missing.engine.playPreview("music.gonePreview")).resolves.toBeUndefined();
    expect(missing.engine.previewSources).toBe(0);

    const failing = engineWith(async () => {
      throw new Error("404");
    });
    await failing.engine.unlock();
    await expect(failing.engine.playPreview("music.gonePreview")).resolves.toBeUndefined();
    expect(failing.engine.previewSources).toBe(0);
  });

  it("forgets a released clip unless it is sounding", async () => {
    const decodes = new Map<string, number>();
    const { engine } = engineWith(async (alias) => {
      decodes.set(alias, (decodes.get(alias) ?? 0) + 1);
      return track(alias);
    });
    await engine.unlock();
    await engine.playPreview("music.aPreview");
    await engine.playPreview("music.bPreview");
    engine.release("music.aPreview");
    engine.release("music.bPreview"); // sounding: kept
    await engine.playPreview("music.aPreview");
    expect(decodes.get("music.aPreview")).toBe(2);
    expect(decodes.get("music.bPreview")).toBe(1);
  });

  it("forgets the clip paged away from once its fade ends, even when released mid-crossfade", async () => {
    // Final review 1: the deck releases the old clip in the same tick it asks
    // for the new one, while the old clip still holds the slot.
    const decodes = new Map<string, number>();
    const { engine, context } = engineWith(async (alias) => {
      decodes.set(alias, (decodes.get(alias) ?? 0) + 1);
      return track(alias);
    });
    await engine.unlock();
    await engine.playPreview("music.aPreview");
    const next = engine.playPreview("music.bPreview");
    engine.release("music.aPreview");
    await next;
    context.advance(PREVIEW_FADE_SECONDS + 0.01);
    await engine.playPreview("music.aPreview");
    expect(decodes.get("music.aPreview")).toBe(2);
  });

  it("keeps a clip released mid-crossfade when the player pages back to it", async () => {
    const decodes = new Map<string, number>();
    const { engine, context } = engineWith(async (alias) => {
      decodes.set(alias, (decodes.get(alias) ?? 0) + 1);
      return track(alias);
    });
    await engine.unlock();
    await engine.playPreview("music.aPreview");
    const next = engine.playPreview("music.bPreview");
    engine.release("music.aPreview");
    // Back on it before the next clip has decoded: it never stopped sounding.
    await engine.playPreview("music.aPreview");
    await next;
    await engine.playPreview("music.bPreview");
    context.advance(PREVIEW_FADE_SECONDS + 0.01);
    await engine.playPreview("music.aPreview");
    expect(decodes.get("music.aPreview")).toBe(1);
  });

  it("stops every preview at once, fading ones too, when the engine goes", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    await engine.playPreview("music.aPreview");
    await engine.playPreview("music.bPreview");
    engine.destroy();
    expect(engine.previewSources).toBe(0);
    expect(engine.liveSources).toBe(0);
  });

  it("is silent before sound was unlocked", async () => {
    const { engine, context } = engineWith();
    await engine.playPreview("music.aPreview");
    expect(context.started).toHaveLength(0);
  });

  it("plays its clip once rather than looping it", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playPreview("music.aPreview");
    expect(context.started.at(-1)).toMatchObject({ alias: "music.aPreview", loop: false });
  });

  it("plays the same clip again once it has played out, when asked for it again", async () => {
    const { engine, context } = engineWith();
    const sources: { onended: (() => void) | null }[] = [];
    const make = context.createBufferSource.bind(context);
    context.createBufferSource = () => {
      const source = make();
      sources.push(source as unknown as { onended: (() => void) | null });
      return source;
    };
    await engine.unlock();
    await engine.playPreview("music.aPreview");
    await engine.playPreview("music.aPreview");
    expect(context.started.filter((entry) => entry.alias === "music.aPreview")).toHaveLength(1);
    sources.at(-1)!.onended?.();
    expect(engine.previewSources).toBe(0);
    await engine.playPreview("music.aPreview");
    expect(context.started.filter((entry) => entry.alias === "music.aPreview")).toHaveLength(2);
  });
});

describe("a song's results section", () => {
  it("plays once from its start for its length, without looping", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playSection("music.chromeInTheRain", 80_000, 96_000);
    const last = context.started.at(-1)!;
    expect(last.alias).toBe("music.chromeInTheRain");
    expect(last.loop).toBe(false);
    expect(last.offset).toBeCloseTo(80);
    expect(last.duration).toBeCloseTo(16);
  });

  it("takes over from the race music rather than playing over it", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.chromeInTheRain");
    await engine.playSection("music.chromeInTheRain", 80_000, 96_000);
    engine.stopMusic();
    expect(engine.playingMusic).toBe(false);
  });

  it("is silent before sound was unlocked", async () => {
    const { engine, context } = engineWith();
    await engine.playSection("music.chromeInTheRain", 80_000, 96_000);
    expect(context.started).toHaveLength(0);
  });
});

describe("sleeping", () => {
  it("suspends a running context when the page is hidden, and resumes it after", async () => {
    // A locked phone went on playing the stage music.
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.sleep();
    expect(context.state).toBe("suspended");
    await engine.wake();
    expect(context.state).toBe("running");
  });

  it("does nothing before sound was ever unlocked", async () => {
    const created = vi.fn(() => fakeContext());
    const engine = new AudioEngine({ createContext: created, decode: async (a) => track(a) });
    await engine.sleep();
    await engine.wake();
    expect(created).not.toHaveBeenCalled();
  });

  it("drops cues asked for while asleep, rather than sounding them all at once on waking", async () => {
    // A hidden tab still takes snapshots: every landing, lap and call since
    // then would start together the moment the graph resumed.
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.sleep();
    await engine.playCue("sfx.land", { bus: "effects", eventId: "e1" });
    await engine.playCue("ui.confirm", { bus: "ui" });
    await engine.wake();
    await engine.playCue("sfx.land", { bus: "effects", eventId: "e1" });
    expect(context.started).toHaveLength(0);
  });

  it("drops cues while the system has interrupted the graph", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    context.state = "interrupted" as AudioContextState;
    await engine.playCue("sfx.land", { bus: "effects", eventId: "e1" });
    expect(context.started).toHaveLength(0);
  });

  it("silences lines still queued when it sleeps, so a stale count is not called on return", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playCue("vo.two", { bus: "voice", eventId: "countdown:a/vo.two", delayMs: 1_000 });
    await engine.sleep();
    expect(engine.liveSources).toBe(0);
    expect(context.stopped.map((entry) => entry.alias)).toEqual(["vo.two"]);
  });

  it("wakes a graph the system interrupted -- a call, Siri -- when the page is seen again", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    context.state = "interrupted" as AudioContextState;
    await engine.wake();
    expect(context.state).toBe("running");
  });

  it("resumes a graph the system suspended on the next gesture", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    context.state = "suspended";
    await engine.resumeOnGesture();
    expect(context.state).toBe("running");
  });

  it("does not resume on a gesture a graph it put to sleep itself", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.sleep();
    await engine.resumeOnGesture();
    expect(context.state).toBe("suspended");
  });

  it("does not wake a context it did not put to sleep", async () => {
    // Waking must never start sound a player has not unlocked.
    const { engine, context } = engineWith();
    await engine.unlock();
    context.state = "suspended";
    const resumedBefore = context.resumed;
    await engine.wake();
    expect(context.resumed).toBe(resumedBefore);
  });
});

describe("unlocking", () => {
  it("does not build a context until something asks for sound", () => {
    const created = vi.fn(() => fakeContext());
    // eslint-disable-next-line no-new
    new AudioEngine({ createContext: created, decode: async (a) => track(a) });
    expect(created).not.toHaveBeenCalled();
  });

  it("resumes a suspended context, which is what a browser requires", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    expect(context.state).toBe("running");
    expect(context.resumed).toBe(1);
  });

  it("is idempotent, so every screen may ask without stacking resumes", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.unlock();
    await engine.unlock();
    expect(context.resumed).toBe(1);
  });
});

describe("the buses", () => {
  it("carries four, so music can duck without taking the cues or the announcer with it", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    expect([...engine.buses].sort()).toEqual(["effects", "music", "ui", "voice"]);
  });

  it("keeps every bus gain inside unity or its default, so no screen drives the master past the mix", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    for (const bus of engine.buses) {
      engine.setBusGain(bus, 4);
      expect(engine.busGain(bus)).toBeLessThanOrEqual(Math.max(1, DEFAULT_GAINS[bus]));
      engine.setBusGain(bus, -2);
      expect(engine.busGain(bus)).toBeGreaterThanOrEqual(0);
    }
  });

  it("scales a bus by the player's volume without losing the mix's own level", async () => {
    const { engine, context } = engineWith();
    // The graph builds the master first, then one gain per bus in `buses` order.
    const nodes: GainNode[] = [];
    const createGain = context.createGain.bind(context);
    context.createGain = () => {
      const node = createGain();
      nodes.push(node);
      return node;
    };
    await engine.unlock();
    const busGain = (bus: string): number => nodes[1 + [...engine.buses].indexOf(bus as never)]!.gain.value;

    engine.setBusGain("music", 0.5);
    engine.setPlayerVolume("music", 0.5);
    // The slider's half is a quarter of the gain: see `playerGain`.
    expect(busGain("music")).toBeCloseTo(0.125);

    engine.setBusGain("music", 0.8); // a screen sets the mix
    expect(busGain("music")).toBeCloseTo(0.2);

    engine.setPlayerVolume("music", 1);
    expect(busGain("music")).toBeCloseTo(0.8);
  });

  it("applies a volume set before unlocking once the graph exists", async () => {
    const { engine, context } = engineWith();
    const nodes: GainNode[] = [];
    const createGain = context.createGain.bind(context);
    context.createGain = () => {
      const node = createGain();
      nodes.push(node);
      return node;
    };
    engine.setPlayerVolume("effects", 0.3);
    await engine.unlock();
    expect(nodes[1 + [...engine.buses].indexOf("effects")]!.gain.value).toBeCloseTo(0.09 * engine.busGain("effects"));
  });

  it("tapers the player's volume to the ear: half the slider is a quarter of the gain, about -12 dB", () => {
    expect(playerGain(1)).toBe(1);
    expect(playerGain(0.5)).toBeCloseTo(0.25);
    expect(playerGain(0)).toBe(0);
    expect(playerGain(2)).toBe(1);
    expect(playerGain(-1)).toBe(0);
  });

  it("silences the master while unfocused, apart from the player's own mute", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    engine.setUnfocused(true);
    expect(engine.masterGain).toBe(0);
    engine.setMuted(true);
    engine.setUnfocused(false);
    expect(engine.masterGain).toBe(0);
    engine.setMuted(false);
    expect(engine.masterGain).toBe(1);
  });

  it("scales the master by the host's gain, under the player's own mute", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    engine.setHostGain(0.4);
    expect(engine.masterGain).toBeCloseTo(0.4);
    engine.setMuted(true);
    expect(engine.masterGain).toBe(0);
    engine.setMuted(false);
    engine.setHostGain(0);
    expect(engine.masterGain).toBe(0);
    engine.setHostGain(1);
    expect(engine.masterGain).toBe(1);
  });

  it("clamps a host gain outside 0..1", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    engine.setHostGain(3);
    expect(engine.masterGain).toBe(1);
    engine.setHostGain(-1);
    expect(engine.masterGain).toBe(0);
  });

  it("silences everything on mute and restores the same mix after", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    engine.setBusGain("music", 0.6);

    engine.setMuted(true);
    expect(engine.masterGain).toBe(0);
    engine.setMuted(false);
    expect(engine.masterGain).toBeGreaterThan(0);
    expect(engine.busGain("music")).toBeCloseTo(0.6);
  });
});

describe("the stage loop", () => {
  it("loops on the content's own points rather than on the whole file", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.chromeInTheRain");

    const [started] = context.started;
    expect(started?.loop).toBe(true);
    // Seconds, because that is the unit the graph works in.
    expect(started?.loopStart).toBeCloseTo(0.405);
    expect(started?.loopEnd).toBeCloseTo(53.008);
  });

  it("replaces the running track rather than layering a second one", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.chromeInTheRain");
    await engine.playMusic("music.chromeInTheRain");
    expect(engine.playingMusic).toBe(true);
    expect(context.started).toHaveLength(2);
  });

  it("says which track is looping in the slot, and only while it is", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    expect(engine.isLooping("music.chromeInTheRain")).toBe(false);
    await engine.playMusic("music.chromeInTheRain");
    expect(engine.isLooping("music.chromeInTheRain")).toBe(true);
    expect(engine.isLooping("music.mainMenu")).toBe(false);
    await engine.playSection("music.chromeInTheRain", 80_000, 96_000);
    expect(engine.isLooping("music.chromeInTheRain")).toBe(false);
    await engine.playMusic("music.chromeInTheRain");
    engine.stopMusic();
    expect(engine.isLooping("music.chromeInTheRain")).toBe(false);
  });
});

describe("a song whose decode lands late", () => {
  // A race asks for its song at GO; on an iPad its decode can still be running
  // then (about 20 s for a whole song), and the race no longer waits for it.
  // When it lands, the song comes in where it would have been, not from the top.
  it("starts at the time that has passed since it was asked for", async () => {
    let finishDecode: (() => void) | undefined;
    const { engine, context } = engineWith(
      (alias) => new Promise((resolve) => (finishDecode = () => resolve(track(alias)))),
    );
    await engine.unlock();
    const playing = engine.playMusic("music.chromeInTheRain");
    await Promise.resolve();
    (context as { currentTime: number }).currentTime = 12;
    finishDecode?.();
    await playing;
    const [started] = context.started;
    expect(started?.offset).toBeCloseTo(12);
  });

  it("wraps into the loop when more time has passed than the first pass lasts", async () => {
    let finishDecode: (() => void) | undefined;
    const { engine, context } = engineWith(
      (alias) => new Promise((resolve) => (finishDecode = () => resolve(track(alias)))),
    );
    await engine.unlock();
    const playing = engine.playMusic("music.chromeInTheRain");
    await Promise.resolve();
    (context as { currentTime: number }).currentTime = 60;
    finishDecode?.();
    await playing;
    const [started] = context.started;
    // 60 s is past the 53.008 s loop end: 0.405 + (60 - 53.008) = 7.397 s.
    expect(started?.offset).toBeCloseTo(7.397);
  });
});

describe("starting part-way and resuming", () => {
  it("starts the first pass at the offset and still loops the whole region", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.mainMenu", 20_000);
    const [started] = context.started;
    expect(started?.offset).toBeCloseTo(20);
    expect(started?.loop).toBe(true);
    expect(started?.loopStart).toBeCloseTo(0.405);
  });

  it("wraps to the loop's start once the first pass runs out", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.mainMenu", 50_000);
    (context as { currentTime: number }).currentTime = 5;
    // 50 s + 5 s is past the 53.008 s loop end, so 1.992 s into the region.
    expect(engine.positionOf("music.mainMenu")).toBeCloseTo(405 + 1_992);
  });

  it("remembers where a loop was when another track took the slot", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.mainMenu", 20_000);
    (context as { currentTime: number }).currentTime = 3;
    await engine.playMusic("music.chromeInTheRain");
    (context as { currentTime: number }).currentTime = 90;
    expect(engine.positionOf("music.mainMenu")).toBeCloseTo(23_000);
    expect(engine.positionOf("sfx.never")).toBeUndefined();
  });
});

describe("what is playing, for a pulse to keep time to", () => {
  it("is the looping track and where it is, while it holds the slot", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.mainMenu", 20_000);
    (context as { currentTime: number }).currentTime = 3;
    expect(engine.nowPlaying()).toEqual({ alias: "music.mainMenu", ms: expect.closeTo(23_000, 3) });
  });

  it("is the track that took the slot, not the one that left it, and nothing once a finish slows it", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.mainMenu", 20_000);
    await engine.playMusic("music.chromeInTheRain");
    (context as { currentTime: number }).currentTime = 3;
    expect(engine.nowPlaying()).toEqual({ alias: "music.chromeInTheRain", ms: expect.closeTo(3_000, 3) });
    // A slowed track runs behind the graph's clock its position is read from.
    engine.slowMusic(0.5);
    expect(engine.nowPlaying()).toBeUndefined();
  });

  it("is a section where it is in its track, and nothing once it has played out", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playSection("music.chromeInTheRain", 80_000, 96_000);
    (context as { currentTime: number }).currentTime = 2;
    expect(engine.nowPlaying()).toEqual({ alias: "music.chromeInTheRain", ms: expect.closeTo(82_000, 3) });
    (context as { currentTime: number }).currentTime = 17;
    expect(engine.nowPlaying()).toBeUndefined();
  });

  it("is a preview where it is in its clip, and nothing once it has played out", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playPreview("music.aPreview");
    (context as { currentTime: number }).currentTime = 1.5;
    expect(engine.nowPlaying()).toEqual({ alias: "music.aPreview", ms: expect.closeTo(1_500, 3) });
    // The clip plays once (121.24 s in this fake), and a silent clip has no beat.
    (context as { currentTime: number }).currentTime = 122;
    expect(engine.nowPlaying()).toBeUndefined();
    (context as { currentTime: number }).currentTime = 1.5;
    engine.stopPreview();
    expect(engine.nowPlaying()).toBeUndefined();
  });

  it("is nothing before any music starts", async () => {
    const { engine } = engineWith();
    expect(engine.nowPlaying()).toBeUndefined();
    await engine.unlock();
    expect(engine.nowPlaying()).toBeUndefined();
  });
});


describe("letting go of one track", () => {
  it("leaves another track that has since taken the slot playing", async () => {
    // The menu lets go of its song after the race has already started its own.
    const { engine } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.mainMenu");
    await engine.playMusic("music.chromeInTheRain");
    engine.stopMusic("music.mainMenu");
    expect(engine.playingMusic).toBe(true);
    engine.stopMusic("music.chromeInTheRain");
    expect(engine.playingMusic).toBe(false);
  });

  it("cuts the outgoing track before the incoming one has decoded", async () => {
    // The race asks for its song while the menu's is still sounding, and the
    // race's is a fetch and a decode away. The menu track must not play on
    // under it for that long, nor at all if the race's never arrives.
    const context = fakeContext();
    let finish: () => void = () => undefined;
    const engine = new AudioEngine({
      createContext: () => context,
      decode: (alias) =>
        alias === "music.mainMenu"
          ? Promise.resolve(track(alias))
          : new Promise((resolve) => (finish = () => resolve(track(alias)))),
    });
    await engine.unlock();
    await engine.playMusic("music.mainMenu");
    expect(engine.playingMusic).toBe(true);

    const incoming = engine.playMusic("music.chromeInTheRain");
    expect(engine.playingMusic).toBe(false);

    finish();
    await incoming;
    expect(engine.playingMusic).toBe(true);
  });

  it("starts nothing when stopped while the track was still decoding", async () => {
    const context = fakeContext();
    let finish: (value: DecodedTrack) => void = () => undefined;
    const engine = new AudioEngine({
      createContext: () => context,
      decode: (alias) => new Promise((resolve) => (finish = () => resolve(track(alias)))),
    });
    await engine.unlock();
    const playing = engine.playMusic("music.mainMenu");
    engine.stopMusic("music.mainMenu");
    finish(track("music.mainMenu"));
    await playing;
    expect(context.started).toHaveLength(0);
  });
});

describe("cues", () => {
  it("plays one sound per authoritative event, however often it arrives", async () => {
    // A snapshot replay, a reconnect, or two subscribers on one event all
    // deliver the same landing twice. The race is unharmed by that and the mix
    // is not: two identical transients a frame apart read as a flam.
    const { engine, context } = engineWith();
    await engine.unlock();

    await engine.playCue("sfx.land", { bus: "effects", eventId: "t42:floorLanded:p1:floor-3" });
    await engine.playCue("sfx.land", { bus: "effects", eventId: "t42:floorLanded:p1:floor-3" });
    await engine.playCue("sfx.land", { bus: "effects", eventId: "t43:floorLanded:p1:floor-4" });

    expect(context.started).toHaveLength(2);
  });

  it("still plays an unidentified cue every time it is asked", async () => {
    // A UI click has no authoritative identity and two clicks are two sounds.
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playCue("ui.focus", { bus: "ui" });
    await engine.playCue("ui.focus", { bus: "ui" });
    expect(context.started).toHaveLength(2);
  });

  it("caps how many cues sound at once", async () => {
    // Concurrency, not lifetime starts: sixty-four landings over a race is
    // sixty-four sounds, and the thing worth bounding is how many of them
    // overlap. A reconnect can deliver a burst of confirmations at once.
    const { engine } = engineWith();
    await engine.unlock();
    for (let index = 0; index < 64; index += 1) {
      await engine.playCue("sfx.land", { bus: "effects", eventId: `e${index}` });
      expect(engine.activeVoices).toBeLessThanOrEqual(engine.maxVoices);
    }
    expect(engine.activeVoices).toBe(engine.maxVoices);
  });

  it("does nothing at all before the context is unlocked", async () => {
    const { engine, context } = engineWith();
    await engine.playCue("sfx.land", { bus: "effects", eventId: "e1" });
    expect(context.started).toHaveLength(0);
  });
});

describe("shaping a cue", () => {
  it("plays a cue at the rate it is asked for, which is its pitch", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playCue("sfx.landLow", { bus: "effects", rate: 2 });
    expect(context.started.at(-1)!.rate).toBe(2);
  });

  it("varies a cue a little either way each time, and never far", async () => {
    let next = 0;
    const draws = [0, 0.999, 0.5, 0.5];
    const context = fakeContext();
    const engine = new AudioEngine({
      createContext: () => context,
      decode: async (alias) => track(alias),
      random: () => draws[next++ % draws.length]!,
    });
    await engine.unlock();
    await engine.playCue("sfx.landLow", { bus: "effects", vary: true });
    await engine.playCue("sfx.landLow", { bus: "effects", vary: true });
    const [low, middle] = context.started.map((entry) => entry.rate ?? 1);
    const cents = (rate: number): number => 1200 * Math.log2(rate);
    expect(cents(low!)).toBeCloseTo(-25, 0);
    // A draw at the centre leaves it exactly as asked.
    expect(middle).toBe(1);
    for (const rate of [low!, middle!]) expect(Math.abs(cents(rate))).toBeLessThanOrEqual(25);
  });

  it("places a cue between the speakers where the graph can, and centres it where it cannot", async () => {
    const { engine, context } = engineWith();
    const panned: number[] = [];
    (context as AudioContextLike).createStereoPanner = () =>
      ({
        pan: {
          set value(next: number) {
            panned.push(next);
          },
        },
        connect: () => undefined,
      }) as unknown as StereoPannerNode;
    await engine.unlock();
    await engine.playCue("sfx.landLow", { bus: "effects", pan: -0.4 });
    await engine.playCue("sfx.landLow", { bus: "effects" });
    expect(panned).toEqual([-0.4]);

    const plain = engineWith();
    await plain.engine.unlock();
    await plain.engine.playCue("sfx.landLow", { bus: "effects", pan: 0.5 });
    expect(plain.context.started).toHaveLength(1);
  });
});

describe("ducking the music", () => {
  const at = (context: AudioContextLike, seconds: number): void => {
    (context as { currentTime: number }).currentTime = seconds;
  };

  it("pulls the music down while a cue sounds, and lets it back after", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playCue("sfx.lap", { bus: "effects", duck: { level: 0.6, holdMs: 300 } });
    expect(engine.musicDuckLevel).toBe(0.6);
    at(context, 0.31);
    expect(engine.musicDuckLevel).toBe(1);
  });

  it("holds the deeper of two ducks while both are in force, then the one left", async () => {
    // The finish's silence under "GAME!": silent through the fanfare, then the
    // line's own dip, never full music in between.
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playCue("sfx.finish", { bus: "effects", duck: { level: 0, holdMs: 450 } });
    await engine.playCue("vo.game", { bus: "voice", delayMs: 350, duck: { level: 0.55, holdMs: 800 } });
    at(context, 0.2);
    expect(engine.musicDuckLevel).toBe(0);
    at(context, 0.4);
    expect(engine.musicDuckLevel).toBe(0);
    at(context, 0.6);
    expect(engine.musicDuckLevel).toBe(0.55);
    at(context, 1.2);
    expect(engine.musicDuckLevel).toBe(1);
  });

  it("starts a delayed cue's duck when the cue starts, not when it was asked for", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playCue("vo.winnerIs", { bus: "voice", delayMs: 1_000, duck: { level: 0.5, holdMs: 500 } });
    expect(engine.musicDuckLevel).toBe(1);
    at(context, 1.1);
    expect(engine.musicDuckLevel).toBe(0.5);
  });

  it("ducks the music under every voice cue by default, recovering over 300 ms (polish spec §8.3)", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    await engine.playCue("vo.title", { bus: "voice" });
    expect(engine.musicDuckLevel).toBe(VOICE_BUS_DUCK.level);
    expect(VOICE_BUS_DUCK).toEqual({ level: 0.55, releaseMs: 300 });
  });

  it("lets a voice cue bring its own duck", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    await engine.playCue("vo.game", { bus: "voice", duck: { level: 0 } });
    expect(engine.musicDuckLevel).toBe(0);
  });

  it("does not duck for a cue on any other bus", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    await engine.playCue("ui.confirm", { bus: "ui" });
    await engine.playCue("sfx.lap", { bus: "effects" });
    expect(engine.musicDuckLevel).toBe(1);
  });

  it("lets the music back up when a queued line that ducks it is called off", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playCue("vo.two", { bus: "voice", eventId: "countdown:a/vo.two", delayMs: 1_000 });
    engine.cancelPending("countdown:");
    at(context, 1.1);
    expect(engine.musicDuckLevel).toBe(1);
  });

  it("lets the music back up at once when a line speaking is stopped", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    await engine.playCue("vo.three", { bus: "voice", eventId: "countdown:a/vo.three" });
    expect(engine.musicDuckLevel).toBe(VOICE_BUS_DUCK.level);
    engine.stopCues("countdown:");
    expect(engine.musicDuckLevel).toBe(1);
  });

  it("keeps the ducks of the lines that were not called off", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playCue("vo.two", { bus: "voice", eventId: "countdown:a/vo.two", delayMs: 1_000 });
    await engine.playCue("vo.red", { bus: "voice", eventId: "join:x/name", delayMs: 1_000 });
    engine.cancelPending("countdown:");
    at(context, 1.1);
    expect(engine.musicDuckLevel).toBe(VOICE_BUS_DUCK.level);
  });

  it("forgets the muffle of a fall that was called off before it landed", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    engine.setMusicCutoff(20_000);
    await engine.playCue("sfx.fallOff", { bus: "effects", eventId: "fall:a/x", delayMs: 500, muffle: true });
    engine.cancelPending("fall:");
    at(context, 0.6);
    expect(engine.musicCutoff).toBe(20_000);
  });

  it("leaves the mix's level and the player's untouched", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    engine.setPlayerVolume("music", 0.5);
    await engine.playCue("sfx.lap", { bus: "effects", duck: { level: 0.2 } });
    expect(engine.busGain("music")).toBeCloseTo(1.1);
  });
});

describe("cutting a sound short", () => {
  // A source stopped mid-waveform clicks; every cut fades over a few
  // milliseconds first, and frees the slot at once.
  it("fades the track it ends rather than stopping it dead", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.menu");
    engine.stopMusic();
    expect(engine.playingMusic).toBe(false);
    expect(context.stopped.at(-1)!.when).toBeGreaterThan(context.currentTime);
  });

  it("fades the track a new one hands over from", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.menu");
    await engine.playMusic("music.chromeInTheRain");
    expect(context.stopped.find((entry) => entry.alias === "music.menu")!.when).toBeGreaterThan(context.currentTime);
  });

  it("fades the bed and the drone it ends", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playBed("ambience.rooftop");
    await engine.setDrone("ambience.climbDrone", 1);
    engine.stopBed();
    engine.stopDrone();
    expect(context.stopped.every((entry) => entry.when > context.currentTime)).toBe(true);
    expect(engine.liveSources).toBe(0);
  });

  it("fades the voice it steals, and a line it stops speaking", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    for (let index = 0; index <= engine.maxVoices; index += 1) {
      await engine.playCue("sfx.land", { bus: "effects", eventId: `e${index}` });
    }
    await engine.playCue("vo.three", { bus: "voice", eventId: "countdown:a/vo.three" });
    engine.stopCues("countdown:");
    expect(context.stopped).toHaveLength(3);
    expect(context.stopped.every((entry) => entry.when > context.currentTime)).toBe(true);
  });
});

describe("counting live sources", () => {
  it("counts the music slot and every sounding cue, and returns to zero once they end", async () => {
    // The phase 2 gate's leak check reads this: a race, a quality switch or the
    // tutorial that left a source playing would never bring it back down.
    const { engine, context } = engineWith();
    await engine.unlock();
    expect(engine.liveSources).toBe(0);

    await engine.playMusic("music.menu");
    await engine.playCue("sfx.land", { bus: "effects" });
    await engine.playCue("ui.focus", { bus: "ui" });
    expect(engine.liveSources).toBe(3);

    // The music rings out over its tail, and only then stops counting.
    engine.stopMusic();
    expect(engine.liveSources).toBe(3);
    context.advance(MUSIC_TAIL_SECONDS);
    expect(engine.liveSources).toBe(2);

    engine.destroy();
    expect(engine.liveSources).toBe(0);
  });
});

describe("the music's tail at a screen change", () => {
  it("fades a stopped track out over its tail instead of cutting it, the way a scene's sound runs under the next", async () => {
    const { engine, context } = engineWith();
    const gains = recordGains(context);
    await engine.unlock();
    await engine.playMusic("music.race");
    const trackLevel = gains.at(-1)!;
    expect(trackLevel.gain.value).toBe(1);
    engine.stopMusic();
    expect(engine.playingMusic).toBe(false);
    expect(trackLevel.gain.value).toBe(0);
    expect(engine.liveSources).toBe(1);
    context.advance(MUSIC_TAIL_SECONDS);
    expect(engine.liveSources).toBe(0);
  });

  it("tails the old track under the new one when the slot changes hands", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.mainMenu");
    await engine.playMusic("music.race");
    expect(engine.liveSources).toBe(2);
    context.advance(MUSIC_TAIL_SECONDS);
    expect(engine.liveSources).toBe(1);
  });

  it("cuts every tail when the engine goes away", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    await engine.playMusic("music.race");
    engine.stopMusic();
    engine.destroy();
    expect(engine.liveSources).toBe(0);
  });
});

describe("choosing the race's song", () => {
  // The bug this exists to prevent already happened once: the screen asked for
  // a literal `music.theme`, the authored track was called something else, and
  // the game went quiet without anything failing -- an alias the bundle does
  // not carry is a no-op by design, so there was nothing to notice.
  const content = (ids: string[]) =>
    ({
      content: {
        songs: ids.map((id) => ({ id, audioAlias: `music.${id}`, bpm: 146, beatOffsetTicks: 24 })),
      },
    }) as Parameters<typeof raceSong>[0];

  it("finds a song by its ID", () => {
    expect(songById(content(["a", "b"]), "b")?.audioAlias).toBe("music.b");
    expect(songById(content(["a", "b"]), "zzz")).toBeUndefined();
    expect(songById(content(["a"]), undefined)).toBeUndefined();
  });

  it("races the room's song, or Chrome in the Rain before one is chosen", () => {
    const catalog = content(["a", "chrome-in-the-rain", "b"]);
    expect(raceSong(catalog, "b")?.id).toBe("b");
    expect(raceSong(catalog, undefined)?.id).toBe("chrome-in-the-rain");
    expect(raceSong(catalog, "gone")?.id).toBe("chrome-in-the-rain");
    expect(raceSong(content(["a", "b"]), undefined)?.id).toBe("a");
  });

  it("returns nothing before content has arrived, which is silence not a fault", () => {
    expect(songById(undefined, "a")).toBeUndefined();
    expect(raceSong(undefined, "a")).toBeUndefined();
  });

  /** The shipped artifact, and every audio row of the shipped manifest, whatever bundle holds it. */
  const shipped = async () => {
    const [{ readFileSync }, { resolve }] = await Promise.all([import("node:fs"), import("node:path")]);
    const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "content/generated/content.json"), "utf8"));
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "packages/asset-contract/assets/art-manifest.json"), "utf8"),
    ) as { bundles: Record<string, { alias: string; durationMs?: number; loopStartMs?: number; loopEndMs?: number }[]> };
    return { artifact, rows: Object.values(manifest.bundles).flat() };
  };

  it("matches an alias the shipped manifest actually carries", async () => {
    // The two halves of the bug, joined: content names an alias, the manifest
    // carries one, and nothing else in the client is entitled to an opinion.
    const { artifact, rows } = await shipped();
    const song = raceSong(artifact, undefined);
    expect(song).toBeDefined();
    expect(rows.map((row) => row.alias)).toContain(song!.audioAlias);
  });

  it("loops the whole race song, and plays 1:19-1:36 of it on the results", async () => {
    const { artifact, rows } = await shipped();
    const song = raceSong(artifact, undefined)!;
    const asset = rows.find((row) => row.alias === song.audioAlias)!;

    // The player hears the manifest's loop; the song file says the same.
    expect([asset.loopStartMs, asset.loopEndMs]).toEqual([0, asset.durationMs]);
    expect([song.loopStartMs, song.loopEndMs]).toEqual([0, asset.durationMs]);
    expect([song.resultsStartMs, song.resultsEndMs]).toEqual([79_000, 96_000]);
    expect(song.resultsEndMs!).toBeLessThanOrEqual(asset.durationMs!);
  });
});

/** A graph that can also build a convolver, as every real browser's can. */
function hallContext(): ReturnType<typeof fakeContext> & { convolvers: { buffer: AudioBuffer | null }[] } {
  const context = fakeContext() as ReturnType<typeof fakeContext> & {
    convolvers: { buffer: AudioBuffer | null }[];
    createConvolver(): ConvolverNode;
    createBuffer(channels: number, length: number, rate: number): AudioBuffer;
  };
  context.convolvers = [];
  context.createConvolver = () => {
    const node = { buffer: null as AudioBuffer | null, normalize: true, connect: () => undefined };
    context.convolvers.push(node);
    return node as unknown as ConvolverNode;
  };
  context.createBuffer = (channels, length, rate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate: rate, getChannelData: (i: number) => data[i]! } as unknown as AudioBuffer;
  };
  return context;
}

describe("the hall", () => {
  it("rings effects, the interface and the announcer in one shared room, and leaves the music dry", async () => {
    const context = hallContext();
    const engine = new AudioEngine({ createContext: () => context, decode: async (alias) => track(alias) });
    await engine.unlock();

    expect(context.convolvers).toHaveLength(1);
    const impulse = context.convolvers[0]!.buffer!;
    // Long enough to read as a hall rather than a room, and it decays.
    expect(impulse.length / impulse.sampleRate).toBeGreaterThan(1.5);
    const head = Math.max(...impulse.getChannelData(0).slice(0, 4_800).map(Math.abs));
    const tail = Math.max(...impulse.getChannelData(0).slice(-4_800).map(Math.abs));
    expect(tail).toBeLessThan(head / 10);

    expect(engine.hallSend("music")).toBe(0);
    for (const bus of ["effects", "ui", "voice"] as const) expect(engine.hallSend(bus)).toBeGreaterThan(0);
    // The announcer is the one sound meant to fill the arena.
    expect(engine.hallSend("voice")).toBeGreaterThan(engine.hallSend("effects"));
    expect(engine.hallSend("effects")).toBeGreaterThan(engine.hallSend("ui"));
  });

  it("is left out on a graph with no convolver, and every cue still plays", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playCue("sfx.lapClash", { bus: "effects" });
    expect(context.started.at(-1)!.alias).toBe("sfx.lapClash");
  });
});

/** Any node the vintage graph builds, recording where it was wired. */
type WiredNode = { kind: string; targets: WiredNode[]; gain?: { value: number } };

/**
 * A graph that can build the whole chain -- hall, band, clip and echo -- and
 * remembers every node and every connection, so a test can follow a bus out.
 */
function vintageContext(): ReturnType<typeof hallContext> & { nodes: WiredNode[] } {
  const context = hallContext() as ReturnType<typeof hallContext> & {
    nodes: WiredNode[];
    createBiquadFilter(): BiquadFilterNode;
    createWaveShaper(): WaveShaperNode;
    createDelay(max?: number): DelayNode;
  };
  context.nodes = [];
  const wired = <T extends object>(kind: string, extra: T): WiredNode & T => {
    const node = {
      kind,
      targets: [] as WiredNode[],
      connect(target: WiredNode) {
        node.targets.push(target);
      },
      disconnect: () => undefined,
      ...extra,
    };
    context.nodes.push(node);
    return node;
  };
  const createGain = context.createGain.bind(context);
  context.createGain = () => {
    const inner = createGain();
    return wired("gain", { gain: inner.gain }) as unknown as GainNode;
  };
  const createConvolver = context.createConvolver!.bind(context);
  context.createConvolver = () => {
    const inner = createConvolver() as unknown as { buffer: AudioBuffer | null };
    const node = wired("convolver", {});
    Object.defineProperty(node, "buffer", { set: (value) => {
        inner.buffer = value;
      }, get: () => inner.buffer });
    return node as unknown as ConvolverNode;
  };
  context.createBiquadFilter = () =>
    wired("biquad", { type: "", frequency: { value: 0 } }) as unknown as BiquadFilterNode;
  context.createWaveShaper = () =>
    wired("shaper", { curve: null as Float32Array | null, oversample: "none" }) as unknown as WaveShaperNode;
  context.createDelay = () => wired("delay", { delayTime: { value: 0 } }) as unknown as DelayNode;
  return context;
}

/** Whether `to` can be reached from `from` along the wiring. */
function reaches(from: WiredNode, to: WiredNode | object, seen = new Set<WiredNode>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  // The destination is a plain object: nothing leads on from it.
  return (from.targets ?? []).some((next) => reaches(next, to, seen));
}

describe("the vintage stage", () => {
  /** Every buffer source the engine makes from here on, in order. */
  function sourcesOf(context: { createBufferSource(): AudioBufferSourceNode }): { playbackRate: { value: number } }[] {
    const sources: { playbackRate: { value: number } }[] = [];
    const make = context.createBufferSource.bind(context);
    context.createBufferSource = () => {
      const source = make();
      sources.push(source as unknown as { playbackRate: { value: number } });
      return source;
    };
    return sources;
  }

  async function built() {
    const context = vintageContext();
    const engine = new AudioEngine({ createContext: () => context, decode: async (alias) => track(alias) });
    await engine.unlock();
    const gains = context.nodes.filter((node) => node.kind === "gain");
    const master = gains[0]!;
    const bus = (name: string): WiredNode => gains[1 + [...engine.buses].indexOf(name as never)]!;
    const shaper = context.nodes.find((node) => node.kind === "shaper")!;
    return { context, engine, master, bus, shaper };
  }

  it("colours effects, the interface and the announcer, and leaves the music as mastered", async () => {
    const { engine, master, bus, shaper } = await built();
    for (const name of ["effects", "ui", "voice"] as const) {
      expect(engine.vintage(name)).toBe(true);
      expect(reaches(bus(name), shaper)).toBe(true);
    }
    expect(engine.vintage("music")).toBe(false);
    expect(bus("music").targets).toEqual([master]);
    expect(reaches(shaper, master)).toBe(true);
  });

  it("band-limits to an old speaker's range before the clip", async () => {
    const { context, shaper } = await built();
    const filters = context.nodes.filter((node) => node.kind === "biquad") as unknown as {
      type: string;
      frequency: { value: number };
    }[];
    const highpass = filters.find((filter) => filter.type === "highpass")!;
    const lowpasses = filters.filter(
      (filter) => filter.type === "lowpass" && reaches(filter as unknown as WiredNode, shaper),
    );
    expect(highpass.frequency.value).toBeGreaterThan(80);
    // One for the band, one darkening the echo's repeats below it.
    expect(lowpasses).toHaveLength(2);
    expect(Math.min(...lowpasses.map((filter) => filter.frequency.value))).toBeLessThan(
      Math.max(...lowpasses.map((filter) => filter.frequency.value)),
    );
  });

  it("filters the music for the climb on its way into its own bus, after the analyser's tap", async () => {
    const { engine, context, bus, shaper } = await built();
    const climb = context.nodes.find(
      (node) => node.kind === "biquad" && reaches(node, bus("music")),
    ) as unknown as WiredNode & { type: string; frequency: { value: number } };
    expect(climb.type).toBe("lowpass");
    expect(reaches(climb, shaper)).toBe(false);
    // Open until a race asks otherwise.
    expect(climb.frequency.value).toBe(20_000);

    engine.setMusicCutoff(1_800);
    expect(climb.frequency.value).toBe(1_800);
    engine.setMusicCutoff(90_000);
    expect(climb.frequency.value).toBe(20_000);
  });

  it("slows the race song and closes its filter with the finish, over whatever the race sets (race-flow spec §5.2)", async () => {
    const { engine, context, bus } = await built();
    const climb = context.nodes.find(
      (node) => node.kind === "biquad" && reaches(node, bus("music")),
    ) as unknown as WiredNode & { frequency: { value: number } };
    const sources = sourcesOf(context);
    await engine.playMusic("music.race", 0);
    const song = sources.at(-1)!;
    engine.slowMusic(0.25);
    expect(song.playbackRate.value).toBe(0.25);
    engine.setMusicCutoff(20_000);
    expect(climb.frequency.value).toBe(SLOW_MUSIC_CUTOFF_HZ);
    engine.setMusicCutoff(500);
    expect(climb.frequency.value).toBe(500);
    engine.slowMusic(1);
    engine.setMusicCutoff(20_000);
    expect(song.playbackRate.value).toBe(1);
    expect(climb.frequency.value).toBe(20_000);
  });

  it("starts the next track at full speed after a finish", async () => {
    const { engine, context } = await built();
    const sources = sourcesOf(context);
    await engine.playMusic("music.race", 0);
    engine.slowMusic(0.25);
    await engine.playMusic("music.results", 0);
    expect(sources.at(-1)!.playbackRate.value).toBe(1);
  });

  it("keeps the replay's rate for a track started after it was set, and under a finish (race-options spec §7.2)", async () => {
    const { engine, context } = await built();
    const sources = sourcesOf(context);
    // The replay sets its speed and then starts the song, which loads first:
    // the rate has to outlive the track it was set on.
    engine.setMusicRate(2);
    await engine.playMusic("music.race", 1_000);
    expect(sources.at(-1)!.playbackRate.value).toBe(2);
    engine.slowMusic(0.25);
    expect(sources.at(-1)!.playbackRate.value).toBe(0.5);
    engine.slowMusic(1);
    engine.setMusicRate(1);
    expect(sources.at(-1)!.playbackRate.value).toBe(1);
  });

  it("leaves the music's filter open at a slow replay speed: only the finish closes it", async () => {
    const { engine, context, bus } = await built();
    const climb = context.nodes.find(
      (node) => node.kind === "biquad" && reaches(node, bus("music")),
    ) as unknown as WiredNode & { frequency: { value: number } };
    await engine.playMusic("music.race", 0);
    engine.setMusicRate(0.5);
    engine.setMusicCutoff(20_000);
    expect(climb.frequency.value).toBe(20_000);
    engine.slowMusic(0.25);
    engine.setMusicCutoff(20_000);
    expect(climb.frequency.value).toBe(SLOW_MUSIC_CUTOFF_HZ);
  });

  it("slams the music's filter shut on a fall and opens it again toward the climb's", async () => {
    const { engine, context, bus } = await built();
    const climb = context.nodes.find(
      (node) => node.kind === "biquad" && reaches(node, bus("music")),
    ) as unknown as WiredNode & { frequency: { value: number } };
    const time = (seconds: number): void => {
      (context as { currentTime: number }).currentTime = seconds;
    };
    engine.setMusicCutoff(8_000);
    await engine.playCue("sfx.fallOff", { bus: "effects", muffle: true });
    expect(climb.frequency.value).toBeLessThan(500);

    time(0.45);
    engine.setMusicCutoff(8_000);
    const halfway = climb.frequency.value;
    expect(halfway).toBeGreaterThan(400);
    expect(halfway).toBeLessThan(8_000);

    time(1);
    engine.setMusicCutoff(8_000);
    expect(climb.frequency.value).toBe(8_000);
  });

  it("echoes the announcer most and the interface least, and repeats through the same band", async () => {
    const { engine, context, shaper } = await built();
    expect(engine.echoSend("music")).toBe(0);
    expect(engine.echoSend("voice")).toBeGreaterThan(engine.echoSend("effects"));
    expect(engine.echoSend("effects")).toBeGreaterThan(engine.echoSend("ui"));
    const delay = context.nodes.find((node) => node.kind === "delay")!;
    // Fed back into itself, so it repeats, and out through the clip.
    expect(delay.targets.some((next) => reaches(next, delay))).toBe(true);
    expect(reaches(delay, shaper)).toBe(true);
  });

  /** The gains a call built: the stretch's send, which leads on to the echo, and its dry level, which does not. */
  function stretchGains(context: { nodes: WiredNode[] }, before: number) {
    const delay = context.nodes.find((node) => node.kind === "delay")!;
    const made = context.nodes.slice(before).filter((node) => node.kind === "gain");
    return { sends: made.filter((node) => reaches(node, delay)), dry: made.filter((node) => !reaches(node, delay)) };
  }

  it("ends a section that plays out in the tape echo: the dry sound gives way to its repeats", async () => {
    const { engine, context } = await built();
    const before = context.nodes.length;
    await engine.playSection("music.chromeInTheRain", 80_000, 96_000);
    const { sends, dry } = stretchGains(context, before);
    // Open by the end, and the dry level gone by then (the fake lands each automation at its end).
    expect(sends).toHaveLength(1);
    expect(sends[0]!.gain!.value).toBeGreaterThan(0);
    expect(dry.map((node) => node.gain!.value)).toEqual([0]);
    // The music bus itself still feeds no echo: only the end of a stretch does.
    expect(engine.echoSend("music")).toBe(0);
  });

  it("ends a preview that plays out the same way", async () => {
    const { engine, context } = await built();
    const before = context.nodes.length;
    await engine.playPreview("music.aPreview");
    const { sends, dry } = stretchGains(context, before);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.gain!.value).toBeGreaterThan(0);
    expect(dry.map((node) => node.gain!.value)).toEqual([0]);
  });

  it("echoes the music's end at the player's music volume", async () => {
    const { engine, context } = await built();
    const delay = context.nodes.find((node) => node.kind === "delay")!;
    const before = context.nodes.length;
    await engine.playSection("music.chromeInTheRain", 80_000, 96_000);
    const send = stretchGains(context, before).sends[0]!;
    const level = send.targets.find((node) => node.targets.includes(delay))!;
    engine.setPlayerVolume("music", 0.4);
    expect(level.gain!.value).toBeCloseTo(0.16 * engine.busGain("music"));
  });

  it("rings the hall through the stage too", async () => {
    const { context, shaper } = await built();
    const hall = context.nodes.find((node) => node.kind === "convolver")!;
    expect(reaches(hall, shaper)).toBe(true);
  });

  it("keeps the ambient bed out of it, at the player's effects volume", async () => {
    const { engine, context, master, shaper } = await built();
    await engine.playBed("ambience.rooftop");
    const level = context.nodes.filter((node) => node.kind === "gain").at(-1)!;
    expect(reaches(level, shaper)).toBe(false);
    expect(reaches(level, master)).toBe(true);
    const out = level.targets[0]!;
    engine.setPlayerVolume("effects", 0.4);
    expect(out.gain!.value).toBeCloseTo(0.16 * engine.busGain("effects"));
  });

  it("keeps the climb's drone out of it too, so its low end reaches the speaker", async () => {
    const { engine, context, master, shaper } = await built();
    await engine.setDrone("ambience.climbDrone", 1);
    const level = context.nodes.filter((node) => node.kind === "gain").at(-1)!;
    expect(reaches(level, shaper)).toBe(false);
    expect(reaches(level, master)).toBe(true);
  });

  it("goes without on a graph that cannot build it, and every cue still plays", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    expect(engine.vintage("effects")).toBe(false);
    expect(engine.echoSend("voice")).toBe(0);
    await engine.playCue("sfx.lapClash", { bus: "effects" });
    expect(context.started.at(-1)!.alias).toBe("sfx.lapClash");
  });

  it("clips softly: a quiet signal passes at unity, a full-scale peak is rounded off", () => {
    const curve = softClipCurve(2_049, 1.5);
    const at = (x: number): number => curve[Math.round(((x + 1) / 2) * (curve.length - 1))]!;
    expect(at(0)).toBeCloseTo(0);
    expect(at(0.05)).toBeCloseTo(0.05, 2);
    expect(at(1)).toBeLessThan(0.7);
    expect(at(-1)).toBeCloseTo(-at(1));
  });

  it("still rounds a pile-up past full scale rather than holding it flat", () => {
    // The shaper reads [-1, 1]; with headroom 2, its edge is a sum of 2.
    const curve = softClipCurve(2_049, 1.5, 2);
    const at = (sum: number): number => curve[Math.round(((sum / 2 + 1) / 2) * (curve.length - 1))]!;
    expect(at(0.05)).toBeCloseTo(0.05, 2);
    expect(at(1.5)).toBeGreaterThan(at(1));
    expect(at(2)).toBeGreaterThan(at(1.5));
    expect(at(2)).toBeLessThanOrEqual(1 / 1.5);
  });
});

describe("the announcer", () => {
  it("has a bus of its own, so a player can turn the voice down and keep the effects", async () => {
    const { engine, context } = engineWith();
    const nodes: GainNode[] = [];
    const createGain = context.createGain.bind(context);
    context.createGain = () => {
      const node = createGain();
      nodes.push(node);
      return node;
    };
    await engine.unlock();
    const busNode = (bus: string): GainNode => nodes[1 + [...engine.buses].indexOf(bus as never)]!;

    engine.setPlayerVolume("voice", 0.2);
    expect(busNode("voice").gain.value).toBeCloseTo(0.04 * engine.busGain("voice"));
    expect(busNode("effects").gain.value).toBeCloseTo(engine.busGain("effects"));
  });

  it("starts a delayed line that far ahead on the graph's own clock", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playCue("vo.red", { bus: "voice", delayMs: 1_400 });
    expect(context.started.at(-1)!.when).toBeCloseTo(1.4);
  });

  it("silences queued lines of a called-off event, and only those", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    await engine.playCue("vo.three", { bus: "voice", eventId: "countdown:a:180/vo.three", delayMs: 1_000 });
    await engine.playCue("vo.climb", { bus: "voice", eventId: "countdown:a:180/climb", delayMs: 3_000 });
    await engine.playCue("vo.red", { bus: "voice", eventId: "join:x:1/name", delayMs: 500 });
    expect(engine.liveSources).toBe(3);
    engine.cancelPending("countdown:");
    expect(engine.liveSources).toBe(1);
  });

  it("stops a called-off event's line already speaking, as well as those queued", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    await engine.playCue("vo.three", { bus: "voice", eventId: "countdown:a:180/vo.three" });
    await engine.playCue("vo.two", { bus: "voice", eventId: "countdown:a:180/vo.two", delayMs: 1_000 });
    await engine.playCue("vo.red", { bus: "voice", eventId: "join:x:1/name" });
    expect(engine.liveSources).toBe(3);
    engine.stopCues("countdown:");
    expect(engine.liveSources).toBe(1);
  });

  it("starts nothing for a called-off event whose track was still decoding", async () => {
    const context = fakeContext();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const engine = new AudioEngine({
      createContext: () => context,
      decode: async (alias) => {
        await gate;
        return track(alias);
      },
    });
    await engine.unlock();
    const asked = engine.playCue("vo.one", { bus: "voice", eventId: "countdown:a:180/vo.one", delayMs: 1_000 });
    engine.cancelPending("countdown:");
    release();
    await asked;
    expect(engine.liveSources).toBe(0);
  });
});

describe("the ambient bed", () => {
  it("loops on its authored region under everything else", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playBed("ambience.rooftop");
    const bed = context.started.at(-1)!;
    expect(bed.alias).toBe("ambience.rooftop");
    expect(bed.loop).toBe(true);
    expect(bed.loopStart).toBeCloseTo(0.405);
    expect(bed.loopEnd).toBeCloseTo(53.008);
    expect(engine.liveSources).toBe(1);
  });

  it("does not stack when asked again, and stops", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.playBed("ambience.rooftop");
    await engine.playBed("ambience.rooftop");
    expect(context.started.filter((entry) => entry.alias === "ambience.rooftop")).toHaveLength(1);
    expect(engine.liveSources).toBe(1);

    engine.stopBed();
    expect(engine.liveSources).toBe(0);
  });

  it("is stopped by name only while that bed holds the slot", async () => {
    const { engine } = engineWith();
    await engine.unlock();
    await engine.playBed("ambience.menu");
    await engine.playBed("ambience.rooftop");
    // The menu lets go after the race has started its own bed.
    engine.stopBed("ambience.menu");
    expect(engine.liveSources).toBe(1);
    engine.stopBed("ambience.rooftop");
    expect(engine.liveSources).toBe(0);
  });

  it("starts nothing when stopped while it was still decoding", async () => {
    let release!: () => void;
    const context = fakeContext();
    const engine = new AudioEngine({
      createContext: () => context,
      decode: (alias) => new Promise((resolve) => (release = () => resolve(track(alias)))),
    });
    await engine.unlock();
    const pending = engine.playBed("ambience.rooftop");
    engine.stopBed();
    release();
    await pending;
    expect(context.started).toHaveLength(0);
  });

  it("is silent before sound was unlocked", async () => {
    const { engine, context } = engineWith();
    await engine.playBed("ambience.rooftop");
    expect(context.started).toHaveLength(0);
  });
});

describe("the climb's drone", () => {
  /** The drone's own level node: the last gain the graph built. */
  function droneLevel(context: ReturnType<typeof fakeContext>) {
    const nodes = recordGains(context);
    return () => nodes.at(-1)!.gain.value;
  }
  /** The buffer sources made from here on, for their playback rate. */
  function sources(context: ReturnType<typeof fakeContext>) {
    const made: { playbackRate: { value: number } }[] = [];
    const make = context.createBufferSource.bind(context);
    context.createBufferSource = () => {
      const source = make();
      made.push(source as unknown as { playbackRate: { value: number } });
      return source;
    };
    return made;
  }

  it("loops the whole file at the level asked, in one slot however often it is asked", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    const level = droneLevel(context);
    await engine.setDrone("ambience.climbDrone", 0.5);
    await engine.setDrone("ambience.climbDrone", 1);
    const drones = context.started.filter((entry) => entry.alias === "ambience.climbDrone");
    expect(drones).toHaveLength(1);
    expect(drones[0]!.loop).toBe(true);
    expect(level()).toBeCloseTo(DRONE_GAIN);
    expect(engine.liveSources).toBe(1);
  });

  it("bends with the rate asked, and falls silent at level zero without letting go", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    const made = sources(context);
    const level = droneLevel(context);
    await engine.setDrone("ambience.climbDrone", 1, 1.05);
    expect(made[0]!.playbackRate.value).toBeCloseTo(1.05);
    await engine.setDrone("ambience.climbDrone", 0);
    expect(level()).toBe(0);
    expect(engine.liveSources).toBe(1);
  });

  it("stops dead, and starts again when asked", async () => {
    const { engine, context } = engineWith();
    await engine.unlock();
    await engine.setDrone("ambience.climbDrone", 1);
    engine.stopDrone();
    expect(engine.liveSources).toBe(0);
    await engine.setDrone("ambience.climbDrone", 1);
    expect(context.started.filter((entry) => entry.alias === "ambience.climbDrone")).toHaveLength(2);
  });

  it("starts nothing when stopped while it was still decoding", async () => {
    let release!: () => void;
    const context = fakeContext();
    const engine = new AudioEngine({
      createContext: () => context,
      decode: (alias) => new Promise((resolve) => (release = () => resolve(track(alias)))),
    });
    await engine.unlock();
    const pending = engine.setDrone("ambience.climbDrone", 1);
    engine.stopDrone();
    release();
    await pending;
    expect(context.started).toHaveLength(0);
  });

  it("is silent before sound was unlocked", async () => {
    const { engine, context } = engineWith();
    await engine.setDrone("ambience.climbDrone", 1);
    expect(context.started).toHaveLength(0);
  });
});

describe("a track that could not be found", () => {
  it("is looked for again on the next ask rather than staying silent", async () => {
    // A manifest that had not arrived, or a file that answered 404 once, makes
    // the decode resolve to nothing. That must not be remembered: the splash
    // preloads the menu song straight after a manifest fetch that may have
    // failed, and a remembered nothing silences the song for the whole session.
    const context = fakeContext();
    let attempts = 0;
    const engine = new AudioEngine({
      createContext: () => context,
      decode: async (alias) => (++attempts === 1 ? undefined : track(alias)),
    });
    await engine.unlock();

    await engine.playMusic("music.mainMenu");
    expect(context.started).toHaveLength(0);

    await engine.playMusic("music.mainMenu");
    expect(context.started).toHaveLength(1);
  });
});

describe("the recording tap (unlockables spec §6.1)", () => {
  it("is nothing before the graph exists, or on a graph with no stream destination", async () => {
    const { engine } = engineWith();
    expect(engine.captureStream()).toBeUndefined();
    await engine.unlock();
    expect(engine.captureStream()).toBeUndefined();
  });

  it("taps the master beside the speakers, and releases it", async () => {
    const context = fakeContext() as unknown as Record<string, unknown>;
    const gains: { targets: unknown[]; disconnect: ReturnType<typeof vi.fn> }[] = [];
    const createGain = context["createGain"] as () => GainNode;
    context["createGain"] = () => {
      const gain = createGain() as unknown as { targets: unknown[]; disconnect: ReturnType<typeof vi.fn> };
      gain.disconnect = vi.fn();
      gains.push(gain);
      return gain as unknown as GainNode;
    };
    const destination = { stream: { id: "tap" } };
    context["createMediaStreamDestination"] = () => destination;
    const engine = new AudioEngine({ createContext: () => context as never, decode: async (alias) => track(alias) });
    await engine.unlock();
    const master = gains[0]!;
    const tap = engine.captureStream()!;
    expect(tap.stream).toBe(destination.stream);
    expect(master.targets).toContain(destination);
    expect(master.targets).toContain(context["destination"]);
    tap.release();
    expect(master.disconnect).toHaveBeenCalledWith(destination);
  });
});

/** A graph that can build everything, and the bus nodes by name. */
async function wiredEngine() {
  const context = vintageContext();
  const engine = new AudioEngine({ createContext: () => context, decode: async (alias) => track(alias) });
  await engine.unlock();
  const gains = context.nodes.filter((node) => node.kind === "gain");
  const bus = (name: string): WiredNode => gains[1 + [...engine.buses].indexOf(name as never)]!;
  return { context, engine, bus };
}

type Lowpass = WiredNode & { frequency: { value: number } };
/** The filters built since the graph had `count` nodes. */
const filtersSince = (context: { nodes: WiredNode[] }, count: number): Lowpass[] =>
  context.nodes.slice(count).filter((node) => node.kind === "biquad") as Lowpass[];

describe("the mix snapshots", () => {
  it("starts in the race's mix, everything open", async () => {
    const { engine } = await wiredEngine();
    expect(engine.mix).toBe("race");
    expect(engine.musicMixLevel).toBe(1);
    expect(engine.musicMixCutoff).toBe(20_000);
    expect(engine.ambienceCutoff).toBe(20_000);
  });

  it("muffles and lowers the music under the pause, and gives it back on resume", async () => {
    const { engine } = await wiredEngine();
    engine.setMix("paused");
    expect(engine.mix).toBe("paused");
    expect(engine.musicMixLevel).toBe(MIXES.paused.musicLevel);
    expect(engine.musicMixCutoff).toBe(MIXES.paused.musicHz);
    expect(MIXES.paused.musicHz).toBeLessThan(1_000);
    engine.setMix("race");
    expect(engine.musicMixLevel).toBe(1);
    expect(engine.musicMixCutoff).toBe(20_000);
  });

  it("holds its breath before the last floor: the music drops further than a pause and the far racers recede", async () => {
    const { engine } = await wiredEngine();
    await engine.playCue("sfx.landLow", { bus: "effects", distance: 1 });
    engine.setMix("breath");
    expect(MIXES.breath.musicLevel).toBeLessThan(MIXES.paused.musicLevel);
    expect(engine.musicMixLevel).toBe(MIXES.breath.musicLevel);
    expect(engine.farCutoff).toBe(MIXES.breath.farHz);
    expect(engine.ambienceCutoff).toBe(MIXES.breath.ambienceHz);
  });

  it("keeps the mix on its own stage of the music path, so the climb's filter and a duck never overwrite it", async () => {
    const { engine, context, bus } = await wiredEngine();
    engine.setMix("paused");
    engine.setMusicCutoff(8_000);
    engine.duckMusic({ level: 0.5, holdMs: 100 }, 0, 100);
    expect(engine.musicMixCutoff).toBe(MIXES.paused.musicHz);
    expect(engine.musicMixLevel).toBe(MIXES.paused.musicLevel);
    // The climb's, then the mix's.
    expect(context.nodes.filter((node) => node.kind === "biquad" && reaches(node, bus("music")))).toHaveLength(2);
  });

  it("is remembered before the graph exists, and applied once it does", async () => {
    const context = vintageContext();
    const engine = new AudioEngine({ createContext: () => context, decode: async (alias) => track(alias) });
    engine.setMix("paused");
    await engine.unlock();
    expect(engine.musicMixLevel).toBe(MIXES.paused.musicLevel);
  });
});

describe("distance", () => {
  it("darkens a far cue and rings more of it in the hall, still on its bus", async () => {
    const { context, engine, bus } = await wiredEngine();
    const convolver = context.nodes.find((node) => node.kind === "convolver")!;
    const before = context.nodes.length;
    await engine.playCue("sfx.landLow", { bus: "effects", distance: 1 });
    const own = filtersSince(context, before).find((node) => node.frequency.value === FAR_CUE_HZ)!;
    expect(own).toBeDefined();
    expect(reaches(own, bus("effects"))).toBe(true);
    expect(reaches(own, convolver)).toBe(true);
  });

  it("leaves a near cue alone: no filter, no extra send", async () => {
    const { context, engine } = await wiredEngine();
    const before = context.nodes.length;
    await engine.playCue("sfx.landLow", { bus: "effects", distance: 0 });
    expect(filtersSince(context, before)).toHaveLength(0);
  });

  it("darkens by octaves with distance: halfway is between open and far", async () => {
    const { context, engine } = await wiredEngine();
    const before = context.nodes.length;
    await engine.playCue("sfx.landLow", { bus: "effects", distance: 0.5 });
    const own = filtersSince(context, before).find((node) => node.frequency.value !== engine.farCutoff)!;
    expect(own.frequency.value).toBeLessThan(20_000);
    expect(own.frequency.value).toBeGreaterThan(FAR_CUE_HZ);
  });

  it("closes the far racers further while the race holds its breath", async () => {
    const { engine } = await wiredEngine();
    await engine.playCue("sfx.landLow", { bus: "effects", distance: 1 });
    expect(engine.farCutoff).toBe(20_000);
    engine.setMix("breath");
    expect(engine.farCutoff).toBe(MIXES.breath.farHz);
  });

  it("is open before any far cue has built its path", async () => {
    const { engine } = await wiredEngine();
    engine.setMix("breath");
    expect(engine.farCutoff).toBe(20_000);
  });

  it("rings a far cue in the hall only through the far path, which the breath darkens and the player's volume turns down", async () => {
    const { context, engine } = await wiredEngine();
    const convolver = context.nodes.find((node) => node.kind === "convolver")!;
    const before = context.nodes.length;
    await engine.playCue("sfx.landLow", { bus: "effects", distance: 1 });
    const added = context.nodes.slice(before);
    // No node the cue built feeds the hall directly: the ring passes the shared wet path.
    expect(added.filter((node) => node.targets.includes(convolver))).toHaveLength(1);
    const wetLevel = added.find((node) => node.targets.includes(convolver))!;
    expect(wetLevel.kind).toBe("gain");
    expect(engine.farWetLevel("effects")).toBeCloseTo(DEFAULT_GAINS.effects, 9);
    engine.setPlayerVolume("effects", 0);
    expect(engine.farWetLevel("effects")).toBe(0);
    engine.setMix("breath");
    const wet = added.filter((node) => node.kind === "biquad" && node.targets.includes(wetLevel)) as Lowpass[];
    expect(wet).toHaveLength(1);
    expect(wet[0]!.frequency.value).toBe(MIXES.breath.farHz);
  });
});

describe("Survival's danger", () => {
  it("swells a synthesized rumble with the square of the danger, and closes the music toward the lava", async () => {
    const { engine, context } = await wiredEngine();
    expect(engine.rumbleLevel).toBe(0);
    engine.setDanger(0.5);
    expect(engine.rumbleLevel).toBeCloseTo(DANGER_RUMBLE_GAIN * 0.25);
    expect(context.started.filter((start) => start.loop)).toHaveLength(1);
    const half = engine.musicMixCutoff;
    expect(half).toBeLessThan(20_000);
    engine.setDanger(1);
    expect(engine.rumbleLevel).toBeCloseTo(DANGER_RUMBLE_GAIN);
    expect(engine.musicMixCutoff).toBe(DANGER_MUSIC_HZ);
    expect(engine.musicMixCutoff).toBeLessThan(half);
  });

  it("starts one rumble however often the danger is set, and lets it fall silent at zero", async () => {
    const { engine, context } = await wiredEngine();
    for (const level of [0.2, 0.4, 0.6]) engine.setDanger(level);
    expect(context.started.filter((start) => start.loop)).toHaveLength(1);
    engine.setDanger(0);
    expect(engine.rumbleLevel).toBe(0);
    expect(engine.musicMixCutoff).toBe(20_000);
  });

  it("stops the rumble once the danger is gone, after a short fade, so nothing loops on through the menus", async () => {
    const { engine, context } = await wiredEngine();
    engine.setDanger(0.5);
    expect(engine.liveSources).toBe(1);
    engine.setDanger(0);
    expect(engine.liveSources).toBe(1);
    context.advance(1);
    expect(engine.liveSources).toBe(0);
    // A new danger starts a new rumble.
    engine.setDanger(0.4);
    expect(context.started.filter((start) => start.loop)).toHaveLength(2);
    engine.destroy();
    expect(engine.liveSources).toBe(0);
  });

  it("turns the rumble down under the pause, which no low-pass can do to 140 Hz", async () => {
    const { engine } = await wiredEngine();
    engine.setDanger(1);
    engine.setMix("paused");
    expect(engine.rumbleLevel).toBeCloseTo(DANGER_RUMBLE_GAIN * MIXES.paused.rumble, 9);
    expect(MIXES.paused.rumble).toBeLessThan(0.5);
    engine.setMix("race");
    expect(engine.rumbleLevel).toBeCloseTo(DANGER_RUMBLE_GAIN, 9);
  });

  it("is quiet before the graph exists", () => {
    const engine = new AudioEngine({ createContext: () => vintageContext(), decode: async (alias) => track(alias) });
    expect(() => engine.setDanger(1)).not.toThrow();
  });
});

it("loads both gameplay feedback cues from the generated manifest and passes their real WAV bytes to decoding", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const manifest = JSON.parse(readFileSync("apps/client/public/assets/manifest.json", "utf8"));
  const decoded: number[] = [];
  vi.stubGlobal("OfflineAudioContext", class {
    async decodeAudioData(bytes: ArrayBuffer) {
      const header = new TextDecoder().decode(new Uint8Array(bytes, 0, 12));
      expect(header.slice(0, 4)).toBe("RIFF");
      expect(header.slice(8)).toBe("WAVE");
      expect(bytes.byteLength).toBeGreaterThan(44);
      decoded.push(bytes.byteLength);
      return { duration: 1, sampleRate: 48000, numberOfChannels: 1, length: 48000 } as AudioBuffer;
    }
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("manifest.json")
    ? { ok: true, json: async () => manifest }
    : { ok: true, arrayBuffer: async () => { const bytes = readFileSync(resolve("apps/client/public", url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } }));
  const context = fakeContext();
  const manager = new AudioManager({ createContext: () => context });
  try {
    await manager.load("audio");
    for (const cue of [MISSED_FLOOR_CUE, WALL_SCUFF_CUE]) {
      expect(manager.hasSource(cue.alias)).toBe(true);
      await manager.preload(cue.alias);
    }
    expect(decoded.length).toBe(2);
    expect(manager.hasSource("sfx.deliberatelyUnknown")).toBe(false);
  } finally { manager.destroy(); vi.unstubAllGlobals(); }
});
