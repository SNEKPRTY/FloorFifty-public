/**
 * The last line of defence (release readiness §6.7).
 *
 * An error nothing else caught is reported by its class and a short reason --
 * the first line of its message, cut and scrubbed by `crashReason`, never its
 * stack (audit S27; the Owner's ruling, 2026-11-14: the first line, 120
 * characters at most). The caller shows the recovery panel with Reload. A
 * known, recoverable failure keeps its own panel; this is for the rest.
 */

/** The longest reason a crash report carries. */
export const CRASH_REASON_MAX = 120;

/**
 * The short reason for a crash: the first line of an error's message, scrubbed
 * of what a message can carry that a journal must not hold. A web or socket
 * address goes (a socket address can carry a reconnection token).
 * A quoted value goes unless it looks like a name in code, because that is where
 * interpolated data lives (a player's name, say) and a property name is what a
 * crash is about. Six characters of a room code's alphabet go. Never a stack.
 */
export function crashReason(value: unknown): string | undefined {
  if (!(value instanceof Error) || typeof value.message !== "string") return undefined;
  const reason = (value.message.split(/\r?\n/, 1)[0] ?? "")
    .replace(/(?:https?|wss?):\/\/\S+/gi, "")
    .replace(/(['"`])((?:(?!\1).)*)\1/g, (_whole, quote: string, inner: string) =>
      /^[A-Za-z_$][\w$]{0,23}$/.test(inner) ? `${quote}${inner}${quote}` : `${quote}…${quote}`,
    )
    .replace(/\b[A-HJ-NP-Z2-9]{6}\b/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CRASH_REASON_MAX)
    .trim();
  return reason === "" ? undefined : reason;
}

const installed = new WeakSet<Window>();

const classOf = (value: unknown): string => (value instanceof Error ? value.name : typeof value);

/** Installs once per window; a second call is a no-op. Returns the uninstall. */
export function installGlobalErrorHandlers(
  win: Window,
  onFatal: (errorClass: string, reason?: string) => void,
  /**
   * A promise nobody awaited that rejected. The game goes on -- a cue that
   * failed to fetch must not end a race -- so it is heard apart from `onFatal`.
   */
  onRejection: (errorClass: string) => void = () => undefined,
): () => void {
  if (installed.has(win)) return () => undefined;
  installed.add(win);
  // An ErrorEvent with no error object is the browser's own notice -- a
  // ResizeObserver loop, a cross-origin "Script error.", an extension -- and
  // never a failure of the game.
  const onError = (event: ErrorEvent): void => {
    if (event.error === null || event.error === undefined) return;
    onFatal(classOf(event.error), crashReason(event.error));
  };
  const onUnhandled = (event: PromiseRejectionEvent): void => onRejection(classOf(event.reason));
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onUnhandled);
  return () => {
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onUnhandled);
    installed.delete(win);
  };
}
