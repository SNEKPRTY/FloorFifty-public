/**
 * Keeps a stranger from flooding the journal with refusals (audit S26).
 *
 * Every refused request wrote one `{"event":"refused","limit":...}` line with
 * no limit of its own, so a loop of refused requests buried the lines that
 * matter on launch day: a crash, a slow tick. The first refusal of a kind in a
 * window is written at once, exactly as before. The rest are counted, and
 * written as one line carrying their number (`n`) when the window has passed.
 * Nothing is lost to the weekly report, which adds `n`; only the lines are.
 * Every other line passes through untouched.
 */

const REFUSED = /^\{"event":"refused","limit":"([^"]+)"\}$/;

export type RefusalCoalescer = {
  /** The log function to hand out in place of the raw one. */
  log(line: string): void;
  /** Writes what has been counted for a window that has passed; `force` writes it all, as at shutdown. */
  flush(force?: boolean): void;
};

export function createRefusalCoalescer(
  write: (line: string) => void,
  options: { now?: () => number; windowMs?: number } = {},
): RefusalCoalescer {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? 1_000;
  const kinds = new Map<string, { at: number; pending: number }>();

  const counted = (limit: string, n: number): string => JSON.stringify({ event: "refused", limit, n });

  return {
    log(line) {
      const limit = REFUSED.exec(line)?.[1];
      if (limit === undefined) return write(line);
      const at = now();
      const kind = kinds.get(limit);
      if (kind === undefined || at - kind.at >= windowMs) {
        const n = (kind?.pending ?? 0) + 1;
        kinds.set(limit, { at, pending: 0 });
        write(n === 1 ? line : counted(limit, n));
        return;
      }
      kind.pending += 1;
    },
    flush(force = false) {
      const at = now();
      for (const [limit, kind] of kinds) {
        if (kind.pending === 0 || (!force && at - kind.at < windowMs)) continue;
        write(counted(limit, kind.pending));
        kind.pending = 0;
        kind.at = at;
      }
    },
  };
}
