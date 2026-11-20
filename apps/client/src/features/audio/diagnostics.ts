/**
 * Audio diagnostics, for a device where the game is silent and nobody can see
 * why (the iPad mini, in Safari and DuckDuckGo alike: both WebKit).
 *
 * Off unless the page is opened with `?audiodebug`. Then every line goes to
 * the console (Safari's Web Inspector, over a cable from the Mac) and to a
 * small panel over the game, so the iPad shows it on its own screen. The
 * panel takes no touches: every gesture still reaches the game, since the
 * gestures are part of what is being watched.
 *
 * What it answers, in order:
 *
 * 1. Does the context ever run? Every `resume` is logged with the event it
 *    was called from and whether the browser counted that event as a user
 *    gesture, then what came of it; every state change is logged as it
 *    happens. A context that stays "suspended" or "interrupted" while the
 *    taps come in is an unlock WebKit refused.
 * 2. Is it running and still silent? Every two seconds: the state, whether
 *    the clock moved, and the loudest sample leaving the master. A clock
 *    that moves and a master with signal, on an iPad that plays nothing, is
 *    the system's audio session muting Web Audio (which follows Silent Mode,
 *    where a video's sound does not). `?audiodebug=playback` asks for the
 *    "playback" session before the context exists, to test exactly that.
 *
 * Decodes, the mute, the unfocused mute and the host's gain are logged too,
 * to rule them out rather than guess. Each decode's fetch and decode times
 * are pinned to the top of the panel, where the scrolling log cannot push
 * them out.
 *
 * 3. Why does the first sound take half a minute? `?audiodebug=bench` holds
 *    the game's own decodes back and first times, one thing at a time: the
 *    CPU, a short clip decoded alone, the menu song decoded alone with the
 *    clip started in a second context beside it, the song decoded by a live
 *    context, the song streamed by a media element, and, where it has been
 *    put in place, the song as it was encoded before 2026-10-03. Then the
 *    game goes on as usual.
 *
 * Nothing here runs without the flag: `audioDebug` is undefined, and every
 * call site is `audioDebug?.`.
 */

/** The page's own state of the mix, read on every report. */
export type MixReport = () => Record<string, unknown>;

/** WebKit's `navigator.audioSession` (Safari 16.4+), not in the DOM typings. */
type AudioSessionLike = { type?: string; state?: string; onstatechange?: (() => void) | null };

/** Chrome's and Safari's `navigator.userActivation`, which the DOM typings carry only in newer versions. */
type UserActivationLike = { isActive?: boolean; hasBeenActive?: boolean };

/** `outputLatency`, which older DOM typings lack. */
type ContextWithLatency = AudioContext & { outputLatency?: number };

/** How many lines the panel keeps; the console keeps them all. */
const PANEL_LINES = 40;
/** How often the running report is taken, in milliseconds. */
const REPORT_MS = 2_000;
/** Gestures logged in full; after these, only those that come while the context is not running. */
const GESTURE_LINES = 12;
/** The gestures a browser may or may not count as the one that lets sound start. */
const GESTURES = ["touchstart", "touchend", "pointerdown", "pointerup", "click", "keydown"] as const;

export type AudioDebug = {
  /** What the flag asked for: watch only, ask for the "playback" session first, or time the decodes first. */
  readonly mode: "watch" | "playback" | "bench";
  /**
   * Settles when the game's decodes may start: at once, or once the bench
   * has run, so its timings are not shared with the game's own work.
   */
  readonly benchDone: Promise<void>;
  log(line: string): void;
  /** Keeps one line at the top of the panel, replacing the last one under the same key. */
  pin(key: string, line: string): void;
  /** Watches a context the moment it is made: its state, its resumes, and what leaves its master. */
  watchContext(context: AudioContext): void;
  /** Logs one decode's outcome. */
  decoded(alias: string, outcome: { buffer?: AudioBuffer | undefined; error?: unknown; ms: number }): void;
  /** Starts the running report; `mix` is read on each one. */
  watchMix(mix: MixReport): void;
};

/** The flag's value, or undefined with no flag. */
export function readAudioDebugMode(search: string): AudioDebug["mode"] | undefined {
  const params = new URLSearchParams(search);
  if (!params.has("audiodebug")) return undefined;
  const value = params.get("audiodebug");
  return value === "playback" || value === "bench" ? value : "watch";
}

export function createAudioDebug(
  mode: AudioDebug["mode"],
  win: Window = window,
  sink: (line: string) => void = (line) => console.info(line),
): AudioDebug {
  const started = win.performance.now();
  const lines: string[] = [];
  const pinned = new Map<string, string>();
  let panel: { pinned: HTMLDivElement; log: HTMLPreElement } | undefined;
  let context: AudioContext | undefined;
  let gestures = 0;

  const stamp = (): string => `${((win.performance.now() - started) / 1000).toFixed(2)}s`;

  const showPanel = (): void => {
    if (panel !== undefined || win.document.body === null) return;
    const root = win.document.createElement("div");
    root.setAttribute("data-audio-debug", "");
    Object.assign(root.style, {
      position: "fixed",
      left: "0",
      top: "0",
      zIndex: "2147483647",
      maxWidth: "100vw",
      padding: "4px 6px",
      font: "10px/1.25 ui-monospace, Menlo, monospace",
      color: "#0f0",
      background: "rgba(0, 0, 0, 0.75)",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    const top = win.document.createElement("div");
    Object.assign(top.style, { color: "#ff0", whiteSpace: "pre-wrap" } satisfies Partial<CSSStyleDeclaration>);
    const pre = win.document.createElement("pre");
    Object.assign(pre.style, {
      margin: "0",
      maxHeight: "40vh",
      overflow: "hidden",
      whiteSpace: "pre-wrap",
      font: "inherit",
    } satisfies Partial<CSSStyleDeclaration>);
    root.append(top, pre);
    win.document.body.appendChild(root);
    panel = { pinned: top, log: pre };
  };

  const render = (): void => {
    showPanel();
    if (panel === undefined) return;
    panel.pinned.textContent = [...pinned.values()].join("\n");
    panel.log.textContent = lines.join("\n");
    // The newest line at the bottom, in view: the log is clipped, and
    // wrapped lines otherwise push the latest out of it.
    panel.log.scrollTop = panel.log.scrollHeight;
  };

  const log = (line: string): void => {
    const stamped = `[audio ${stamp()}] ${line}`;
    sink(stamped);
    lines.push(stamped);
    if (lines.length > PANEL_LINES) lines.shift();
    render();
  };

  const pin = (key: string, line: string): void => {
    sink(`[audio ${stamp()}] PIN ${line}`);
    pinned.set(key, line);
    render();
  };

  const nav = win.navigator as Navigator & { audioSession?: AudioSessionLike; userActivation?: UserActivationLike };

  const activation = (): string => {
    const user = nav.userActivation;
    if (user === undefined) return "activation=n/a";
    return `activation=${user.isActive ? "active" : "inactive"}${user.hasBeenActive ? "" : " (never)"}`;
  };

  const session = (): string =>
    nav.audioSession === undefined ? "session=n/a" : `session=${nav.audioSession.type}/${nav.audioSession.state ?? "?"}`;

  // Before any context exists: the device, and the session it will start in.
  log(`ua=${nav.userAgent}`);
  log(`touchPoints=${nav.maxTouchPoints} visible=${win.document.visibilityState} focus=${win.document.hasFocus()}`);
  if (mode === "playback") {
    if (nav.audioSession === undefined) log("playback asked for, but this browser has no navigator.audioSession");
    else {
      try {
        nav.audioSession.type = "playback";
      } catch (error) {
        log(`setting audioSession.type threw: ${describe(error)}`);
      }
    }
  }
  log(session());
  if (nav.audioSession !== undefined) {
    nav.audioSession.onstatechange = () => log(`audioSession changed: ${session()}`);
  }

  // Bubbling on the window, so a gesture a control swallowed never shows,
  // and one whose default a handler prevented says so.
  const onGesture = (event: Event): void => {
    const running = context?.state === "running";
    if (gestures >= GESTURE_LINES && running) return;
    gestures += 1;
    log(
      `gesture ${event.type} trusted=${event.isTrusted} prevented=${event.defaultPrevented} ` +
        `${activation()} context=${context?.state ?? "none"}`,
    );
  };
  for (const type of GESTURES) win.addEventListener(type, onGesture, { passive: true });

  win.document.addEventListener("visibilitychange", () => log(`visibility=${win.document.visibilityState}`));
  win.addEventListener("pagehide", () => log("pagehide"));
  win.addEventListener("pageshow", () => log("pageshow"));
  win.addEventListener("blur", () => log("window blur"));
  win.addEventListener("focus", () => log("window focus"));

  // The loudest sample leaving the master, read off a tap between the graph
  // and the speakers; see `watchContext`.
  let tap: AnalyserNode | undefined;
  let samples: Float32Array<ArrayBuffer> | undefined;
  const masterPeak = (): string => {
    if (tap === undefined || samples === undefined) return "peak=n/a";
    tap.getFloatTimeDomainData(samples);
    let peak = 0;
    let nan = false;
    for (const sample of samples) {
      if (Number.isNaN(sample)) nan = true;
      else peak = Math.max(peak, Math.abs(sample));
    }
    const db = peak > 0 ? `${(20 * Math.log10(peak)).toFixed(1)}dBFS` : "-inf";
    return `peak=${db}${nan ? " NaN!" : ""}`;
  };

  const benchDone = mode === "bench" ? runBench(win, log, pin) : Promise.resolve();

  return {
    mode,
    benchDone,
    log,
    pin,

    watchContext(created) {
      context = created;
      const latency = created as ContextWithLatency;
      log(
        `context made: state=${created.state} rate=${created.sampleRate} ` +
          `base=${created.baseLatency?.toFixed(4) ?? "?"} out=${latency.outputLatency?.toFixed(4) ?? "?"} ${activation()}`,
      );
      created.addEventListener("statechange", () => log(`context state -> ${created.state} t=${created.currentTime.toFixed(2)} ${session()}`));

      // Every resume: what called it and whether the browser saw a gesture
      // then. Wrapped, not replaced: the real resume is called first and
      // synchronously, so a gesture it came from still counts.
      const resume = created.resume.bind(created);
      created.resume = () => {
        const from = (win as Window & { event?: Event }).event?.type ?? "no event";
        const before = created.state;
        const asked = resume();
        log(`resume() from ${from} ${activation()} state=${before}`);
        asked.then(
          () => log(`resume() from ${from} resolved: state=${created.state}`),
          (error: unknown) => log(`resume() from ${from} rejected: ${describe(error)} state=${created.state}`),
        );
        return asked;
      };
      const suspend = created.suspend.bind(created);
      created.suspend = () => {
        log(`suspend() state=${created.state}`);
        return suspend();
      };

      // A tap between the graph and the speakers: the graph connects its
      // master to `destination`, which here is a unity gain that feeds both
      // the real destination and an analyser. An own property shadows the
      // prototype's getter on this one context alone.
      const destination = created.destination;
      const through = created.createGain();
      through.connect(destination);
      tap = created.createAnalyser();
      tap.fftSize = 2_048;
      samples = new Float32Array(tap.fftSize);
      through.connect(tap);
      Object.defineProperty(created, "destination", { value: through, configurable: true });
    },

    decoded(alias, outcome) {
      const took = `after ${Math.round(outcome.ms)}ms`;
      if (outcome.error !== undefined) log(`decode ${alias} FAILED ${took}: ${describe(outcome.error)}`);
      else if (outcome.buffer === undefined) log(`decode ${alias}: no source or fetch failed ${took}`);
      else {
        const buffer = outcome.buffer;
        log(`decode ${alias} ok ${took}: ${buffer.duration.toFixed(2)}s ${buffer.sampleRate}Hz ${buffer.numberOfChannels}ch`);
      }
    },

    watchMix(mix) {
      let lastTime: number | undefined;
      win.setInterval(() => {
        const time = context?.currentTime;
        const moved = time === undefined || lastTime === undefined ? "" : time > lastTime ? " clock=moving" : " clock=STOPPED";
        lastTime = time;
        const facts = Object.entries(mix())
          .map(([key, value]) => `${key}=${typeof value === "number" ? Number(value.toFixed(3)) : JSON.stringify(value)}`)
          .join(" ");
        log(`report context=${context?.state ?? "none"}${moved} ${masterPeak()} ${session()} ${facts}`);
      }, REPORT_MS);
    },
  };
}

/**
 * Where the bench looks for the menu song as it was encoded before
 * 2026-10-03, to compare. Copied there by hand, never shipped (git ignores
 * it), and beside `assets/` rather than in it, which every `pnpm dev` wipes:
 * `git show b0e79de1^:packages/asset-contract/assets/production/main-menu.m4a > apps/client/public/main-menu-160k.m4a`
 */
const OLD_SONG_URL = "main-menu-160k.m4a";

/** A fresh decode-only context, as the game's own decoder is (`AudioManager.decodeContext`). */
const offlineContext = (): OfflineAudioContext => new OfflineAudioContext(2, 1, 48_000);

/**
 * Times what the slow first sound could be made of, one step at a time, and
 * pins each result. Never throws: a step that fails pins why and the next
 * one runs, and the game's decodes go on either way.
 */
async function runBench(win: Window, log: (line: string) => void, pin: (key: string, line: string) => void): Promise<void> {
  const now = (): number => win.performance.now();
  const ms = (since: number): string => `${Math.round(now() - since)}ms`;
  const step = async (key: string, label: string, run: () => Promise<string>): Promise<void> => {
    pin(key, `${label}: running...`);
    try {
      pin(key, `${label}: ${await run()}`);
    } catch (error) {
      pin(key, `${label}: FAILED ${describe(error)}`);
    }
  };
  const decode = async (context: BaseAudioContext, bytes: ArrayBuffer): Promise<number> => {
    const start = now();
    // decodeAudioData detaches what it is given, so every decode gets a copy.
    await context.decodeAudioData(bytes.slice(0));
    return Math.round(now() - start);
  };

  log("bench: the game's decodes wait until it is done");
  pin("bench", "BENCH running (about a minute); keep the page open");

  await step("bench:cpu", "cpu (20M-step JS loop)", async () => {
    const start = now();
    let x = 0;
    for (let i = 0; i < 20_000_000; i += 1) x = (x + i * 7) % 1_000_003;
    return `${ms(start)} cores=${win.navigator.hardwareConcurrency} (${x > -1 ? "ok" : ""})`;
  });

  let song: ArrayBuffer | undefined;
  let clip: ArrayBuffer | undefined;
  let songUrl: string | undefined;
  await step("bench:fetch", "fetch", async () => {
    const response = await win.fetch("assets/manifest.json");
    const manifest = (await response.json()) as { bundles?: { name: string; assets: { alias: string[]; src: string }[] }[] };
    const assets = manifest.bundles?.find((bundle) => bundle.name === "audio")?.assets ?? [];
    const src = (alias: string): string => {
      const found = assets.find((asset) => asset.alias.includes(alias))?.src;
      if (found === undefined) throw new Error(`${alias} is not in the manifest`);
      return found;
    };
    songUrl = src("music.mainMenu");
    let start = now();
    song = await (await win.fetch(songUrl)).arrayBuffer();
    const songMs = ms(start);
    start = now();
    clip = await (await win.fetch(src("ui.title"))).arrayBuffer();
    return `song ${(song.byteLength / 1e6).toFixed(1)}MB in ${songMs}, clip ${Math.round(clip.byteLength / 1e3)}KB in ${ms(start)}`;
  });
  if (song === undefined || clip === undefined) {
    pin("bench", "BENCH stopped: could not fetch the files");
    return;
  }
  const songBytes = song;
  const clipBytes = clip;

  await step("bench:clip", "A. clip (ui.title) decoded alone", async () => `${await decode(offlineContext(), clipBytes)}ms`);

  // The song in one context, and a second later the clip in another. If the
  // clip still takes as long as the song, the browser decodes one file at a
  // time across every context, not just within one.
  await step("bench:song", "B. song decoded alone (offline context)", async () => {
    const songDone = decode(offlineContext(), songBytes);
    await new Promise((resolve) => win.setTimeout(resolve, 1_000));
    await step("bench:beside", "C. clip in a 2nd context while B runs", async () => `${await decode(offlineContext(), clipBytes)}ms`);
    return `${await songDone}ms`;
  });

  await step("bench:live", "D. song decoded by a live AudioContext", async () => {
    const live = new AudioContext();
    try {
      return `${await decode(live, songBytes)}ms`;
    } finally {
      void live.close();
    }
  });

  // Muted, so it may start without a gesture and is never heard.
  await step("bench:stream", "E. song streamed by an <audio> element (muted)", async () => {
    const element = new Audio();
    element.muted = true;
    element.preload = "auto";
    const start = now();
    const playing = new Promise<string>((resolve) => {
      element.addEventListener("playing", () => resolve(`playing after ${ms(start)}`), { once: true });
      win.setTimeout(() => resolve(`not playing after 15000ms (readyState=${element.readyState})`), 15_000);
    });
    element.src = songUrl!;
    try {
      await element.play();
    } catch (error) {
      return `play() refused: ${describe(error)}`;
    }
    const result = await playing;
    element.pause();
    element.removeAttribute("src");
    element.load();
    return result;
  });

  // The same song as it shipped before 2026-10-03 (160 kbps rather than 256),
  // when the iPad's sound was still prompt. Not served by default: put it in
  // place by hand to compare (see `OLD_SONG_URL`).
  const old = await win.fetch(OLD_SONG_URL).catch(() => undefined);
  const oldType = old?.headers.get("content-type") ?? "";
  if (old === undefined || !old.ok || !/audio|mp4/.test(oldType)) {
    pin("bench:old", `F/G. old 160 kbps song: skipped, ${OLD_SONG_URL} is not there`);
  } else {
    const oldBytes = await old.arrayBuffer();
    await step("bench:old-offline", `F. old 160 kbps song (${(oldBytes.byteLength / 1e6).toFixed(1)}MB), offline context`, async () => `${await decode(offlineContext(), oldBytes)}ms`);
    await step("bench:old-live", "G. old 160 kbps song, live AudioContext", async () => {
      const live = new AudioContext();
      try {
        return `${await decode(live, oldBytes)}ms`;
      } finally {
        void live.close();
      }
    });
  }

  pin("bench", "BENCH done; the game's sound now loads as usual");
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** The page's diagnostics, or undefined without `?audiodebug`. */
export const audioDebug: AudioDebug | undefined = (() => {
  if (typeof window === "undefined") return undefined;
  const mode = readAudioDebugMode(window.location.search);
  return mode === undefined ? undefined : createAudioDebug(mode);
})();
