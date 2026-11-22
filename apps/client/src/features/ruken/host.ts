/**
 * The hosting seam: everything Floor Fifty says to, or hears from, Ruken
 * (Ruken P6 spec §3, M1.7 brief).
 *
 * Ruken runs a game in a sandboxed iframe and can talk to it over the Ruken
 * SDK (`@ruken/sdk`). Only `ruken-session.ts` touches that SDK, and nothing in
 * the game imports it, so the rest of the game asks plain questions ("is there
 * a host?", "what is the host's volume?") and never handles protocol messages.
 *
 * Outside Ruken -- the game's own site, a dev server, every existing test --
 * `localHosting()` answers instead, and it wraps today's behaviour unchanged:
 * the browser's own `localStorage`, ready at once, full volume, no breaks.
 * A top-level page never even calls `Ruken.init`, because the SDK's standalone
 * mode probes `localStorage` with a `ruken:` key and the standalone game must
 * not change what it stores.
 *
 * Since 2026-11-13 the game boots with `localHosting()` always: the new Ruken
 * serves a game as a plain folder with no SDK, so nothing waits for a host.
 * `createRukenHosting()` (the SDK handshake, in `ruken-session.ts`) stays for
 * the hosted-session tests.
 *
 * Every call into the host is fire-and-forget or settles without throwing:
 * a host that refuses, times out or has gone away must never stop a race, a
 * screen change or a save (brief §3, "Anonymous saves").
 */

import { deviceStorage, type SettingsStorage } from "../profile/settings";
import type { FfEvent } from "./analytics";

/** Which fullscreen, if any, the browser can give the game (`platform/fullscreen.ts` asks). */
export type FullscreenSupport = "element" | "ios-home-screen" | "none";

/** How a round ended, for Ruken's play metrics (M1 contracts §6, `telemetry.round`). */
export type RoundOutcome = "complete" | "fail" | "quit";

/** The width, in CSS pixels, the host keeps for its own controls on each side. */
export type HostReserved = { readonly left: number; readonly right: number };

export type HostLifecycle = { readonly state: "active" | "background"; readonly reasons: readonly string[] };

export type Hosting = {
  /** True inside a Ruken frame that answered the handshake. */
  readonly hosted: boolean;
  /**
   * Where settings, progress and the player's name are kept. Inside Ruken that
   * is the player's account, except for the sound settings, which stay in this
   * device's own browser storage (`keepAudioOnDevice`).
   */
  readonly storage: SettingsStorage | undefined;
  /** Resolves when the host says the game may show itself (R-04); at once standalone. */
  readonly ready: Promise<void>;
  /** Asks the host for fullscreen; resolves with what the device supports. */
  setFullscreen(on: boolean): Promise<FullscreenSupport>;
  /** Whether the host has the game fullscreen. Always false standalone. */
  isFullscreen(): boolean;
  onFullscreenChange(listener: (fullscreen: boolean) => void): () => void;
  /** Opens an outside link through the host, which asks the player first. */
  openLink(url: string): Promise<void>;
  /** Hands the player back to Ruken (`session.exit`, reason "player"). */
  exit(): Promise<void>;
  /** One natural ad break. Resolves on every outcome and never throws. */
  naturalBreak(): Promise<void>;
  /**
   * Sends a finished race's score to Ruken's leaderboard (`leaderboard.submit`).
   * Settles on every outcome and never throws: a refused, out-of-range or
   * unreachable score is simply not on the board, and the race goes on.
   * Nothing standalone.
   */
  submitScore(board: string, score: number): Promise<void>;
  /** A disclosed analytics event; silent without consent or a host. */
  track(event: FfEvent): void;
  /** Answers the host's "Open game menu": true when the game opened its own. */
  setMenuHandler(handler: () => boolean): void;
  onLifecycle(listener: (lifecycle: HostLifecycle) => void): () => void;
  /** Runs before the host closes the game; the host waits for it, briefly. */
  onExiting(listener: () => Promise<void>): () => void;
  /** Waits until every save write has reached the host. */
  flushSaves(): Promise<void>;
  /** The host's volume for the game, 0..1 (its master volume, ducking and ads). */
  hostGain(): number;
  onHostGain(listener: (gain: number) => void): () => void;
  hostReserved(): HostReserved;
  onHostReserved(listener: (reserved: HostReserved) => void): () => void;
  /** A round (a race) began. A second start before an end is ignored. */
  roundStart(): void;
  /** The open round ended. Without an open round it is ignored. */
  roundEnd(outcome: RoundOutcome): void;
  dispose(): void;
};

const NO_RESERVED: HostReserved = { left: 0, right: 0 };
const nothing = (): (() => void) => () => undefined;

/** Today's behaviour, for a game that is not inside Ruken. */
export function localHosting(): Hosting {
  return {
    hosted: false,
    storage: deviceStorage(),
    ready: Promise.resolve(),
    setFullscreen: () => Promise.resolve("none"),
    isFullscreen: () => false,
    onFullscreenChange: nothing,
    openLink: () => Promise.resolve(),
    exit: () => Promise.resolve(),
    naturalBreak: () => Promise.resolve(),
    submitScore: () => Promise.resolve(),
    track: () => undefined,
    setMenuHandler: () => undefined,
    onLifecycle: nothing,
    onExiting: nothing,
    flushSaves: () => Promise.resolve(),
    hostGain: () => 1,
    onHostGain: nothing,
    hostReserved: () => NO_RESERVED,
    onHostReserved: nothing,
    roundStart: () => undefined,
    roundEnd: () => undefined,
    dispose: () => undefined,
  };
}

/**
 * What the game boots with. The new Ruken has no SDK: it serves the game as a
 * plain folder on its own origin and never answers a handshake, so the game
 * does not look for a host and never waits for one. Saves, settings and the
 * player's name live in the browser's `localStorage`.
 */
export function createHosting(): Hosting {
  return localHosting();
}

/**
 * Ruken counts rounds for its play metrics, and a start without an end (or
 * two starts) would count a round that never happened. This keeps every
 * caller honest, whichever screen calls first: a second start before an end
 * is dropped, and so is an end with no round open.
 */
export function guardRounds(round: {
  start(): void;
  end(outcome: RoundOutcome): void;
}): Pick<Hosting, "roundStart" | "roundEnd"> {
  let open = false;
  return {
    roundStart: () => {
      if (open) return;
      open = true;
      round.start();
    },
    roundEnd: (outcome) => {
      if (!open) return;
      open = false;
      round.end(outcome);
    },
  };
}
