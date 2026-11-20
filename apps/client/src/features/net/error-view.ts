/**
 * Recoverable failures.
 *
 * Every failure a player can meet is one of these, and each one says what the
 * player can do about it. A failure with no action is a bug, not a state: if
 * the client cannot name a way forward, it should not be showing a panel.
 *
 * Nothing here ever fabricates a race outcome. A room that fails returns the
 * player to the menu; it never produces a results screen.
 *
 * This file is the model only. The panel that draws one of these lives in
 * `features/screen/ErrorPanel.svelte`, mounted through `features/screen/error-panel.svelte.ts`.
 */

export type RecoverableErrorCode =
  | "INVALID_ROOM"
  | "ROOM_FULL"
  | "VERSION_MISMATCH"
  | "ASSET_LOAD_FAILED"
  | "ROOM_CLOSED"
  /** The room stopped rather than publish a result it could not stand behind. */
  | "SIMULATION_FAILURE"
  /** A deploy is under way, or this tab is newer than the server (release readiness §4.2, §5.4). */
  | "SERVER_UPDATING"
  /** The server is at its room cap (release readiness §6.1). */
  | "SERVER_BUSY"
  /** Nothing answered: the phone is offline, the server is down, or a gateway failed (audit S7). */
  | "UNREACHABLE"
  /** Too many attempts from this address (release readiness §6.1). */
  | "RATE_LIMITED";

/**
 * Which of a code's situations a failure is, where the code alone would say
 * too little: a room that closed while you were away is not a seat you lost.
 * A closed set rather than prose, so the words are chosen in the player's
 * language when shown (`error-copy.ts`), never carried across a screen change.
 */
export type ErrorDetail =
  | "last-room-closed"
  | "presentation-failed"
  | "seat-lost"
  | "room-silent"
  | "room-racing"
  | "game-assets"
  | "race-assets"
  /** A draining server closed this lobby; the way forward is the same flow on the new build (§5.4). */
  | "server-moving-public"
  | "server-moving-private";

export type RecoverableError = {
  code: RecoverableErrorCode;
  detail?: ErrorDetail;
  /** Whether trying the same thing again could succeed. */
  retry: boolean;
};

/**
 * Whether retrying could possibly help.
 *
 * A version mismatch is the interesting case: the client and server disagree
 * about the wire format, so the identical request would fail identically. The
 * only way forward is to load a newer client, which is a reload and not a
 * retry.
 */
export function isRetryable(code: RecoverableErrorCode): boolean {
  // A full server, a rate limit or a dropped connection clears with time; the same request can succeed.
  return code === "ASSET_LOAD_FAILED" || code === "SERVER_BUSY" || code === "RATE_LIMITED" || code === "UNREACHABLE";
}

export function recoverableError(code: RecoverableErrorCode, detail?: ErrorDetail): RecoverableError {
  return { code, ...(detail === undefined ? {} : { detail }), retry: isRetryable(code) };
}

/**
 * Carries a failure across a screen transition.
 *
 * Gameplay may discover a failure it cannot render -- the room closed, the
 * protocol does not match -- and has to leave. The screen that takes over reads
 * the reason here, so the player is told why they were moved.
 */
export class ErrorChannel {
  private pending: RecoverableError | undefined;
  private readonly watchers = new Set<(error: RecoverableError) => void>();

  report(error: RecoverableError): void {
    this.pending = error;
    for (const watcher of [...this.watchers]) watcher(error);
  }

  /** Hears every failure as it is reported, without taking it (operational telemetry, §7.1). */
  watch(watcher: (error: RecoverableError) => void): () => void {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  /** Reads and clears the pending failure, so it is shown exactly once. */
  take(): RecoverableError | undefined {
    const error = this.pending;
    this.pending = undefined;
    return error;
  }

  get hasPending(): boolean {
    return this.pending !== undefined;
  }
}
