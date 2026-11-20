/**
 * How a server process leaves without dropping a race.
 *
 * A deploy starts the new build beside this one and points new connections at
 * it; this process is then sent SIGTERM. Exiting at once would end every race
 * in progress, so it waits for its rooms to close by themselves -- a race ends,
 * its players leave, the room disposes -- and exits when none is left. The
 * wait is capped, because a room nobody leaves would otherwise hold the old
 * build up forever (release readiness spec §5.4). Before the wait, every room
 * is told (`RaceRoom.beginDrain`): a lobby moves its players on at once, and
 * a race finishes first.
 *
 * No Colyseus here: the room count is passed in, so the rule can be tested on
 * a clock that only moves when it is told to.
 */

/**
 * The longest a drain waits for rooms to close: 270 s. Fly stops a Machine
 * after `kill_timeout`, at most 300 s and best-effort, so the cap leaves it a
 * margin; staging's systemd allows 330 s.
 */
export const DRAIN_MAX_MS = 270_000;

/** How often the room count is read while draining. */
export const DRAIN_POLL_MS = 1_000;

/** "empty" when the last room closed; "cap" when the wait ran out first. */
export type DrainResult = "empty" | "cap";

export type DrainOptions = {
  countRooms: () => Promise<number>;
  capMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export async function waitForRoomsToEmpty(options: DrainOptions): Promise<DrainResult> {
  const capMs = options.capMs ?? DRAIN_MAX_MS;
  const pollMs = options.pollMs ?? DRAIN_POLL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + capMs;

  for (;;) {
    if ((await options.countRooms()) === 0) return "empty";
    const left = deadline - now();
    if (left <= 0) return "cap";
    await sleep(Math.min(pollMs, left));
  }
}

/**
 * Starts the drain on the first SIGTERM and ignores the rest.
 *
 * systemd can signal again, and an operator's second Ctrl-C is common; a
 * second drain would race the first to `exit`, and falling back to Node's
 * default handler would kill the races the first one is waiting for.
 */
export function drainOnSigterm(
  server: { drain(): Promise<DrainResult> },
  signals: { on(event: "SIGTERM", listener: () => void): unknown },
  exit: (code: number) => void,
  write: (line: string) => void,
): void {
  let started = false;
  signals.on("SIGTERM", () => {
    if (started) return;
    started = true;
    write("floor-fifty server draining");
    void server.drain().then(
      (result) => {
        write(`floor-fifty server drained (${result})`);
        exit(0);
      },
      (error: unknown) => {
        write(`floor-fifty server drain failed: ${String(error)}`);
        exit(1);
      },
    );
  });
}
