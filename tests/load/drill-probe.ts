/**
 * Failure-drill probe: rooms of four SDK clients that race like `bots.ts`, but
 * report what happens to each seat when the server goes away, rather than what
 * a healthy run looks like.
 *
 * `bots.ts` measures load. When the server dies or drains under it, its seats
 * lose their sockets and the process ends with nothing printed, so a drill
 * cannot read its outcome. This probe keeps a timer alive for its whole run,
 * prints one status line every five seconds, and ends with how each seat left:
 * the close code, and any `serverError` the room sent first.
 *
 * Usage (vite-node, against a copy started with FLOOR_FIFTY_PROXY=fly):
 *   ./node_modules/.bin/vite-node tests/load/drill-probe.ts -- --url http://localhost:3100 \
 *     --origin https://a.test --rooms 10 --seconds 120
 */

import { Client, type Room } from "@colyseus/sdk";
import { PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";

type Args = { url: string; origin: string; rooms: number; seconds: number };

function parseArgs(argv: readonly string[]): Args {
  const value = (name: string): string | undefined => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };
  const url = value("url");
  if (url === undefined) throw new Error("--url is required");
  return { url, origin: value("origin") ?? "", rooms: Number(value("rooms") ?? 1), seconds: Number(value("seconds") ?? 120) };
}

type Seat = { room: Room; phase: string; races: number; left?: string; lastStateAt: number };

const TICK_MS = 1_000 / 60;
let requests = 0;
const requestId = (): string => `probe-${(requests += 1)}`;

function clientFor(args: Args, index: number): Client {
  const headers: Record<string, string> = { "fly-client-ip": `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}` };
  if (args.origin !== "") headers["origin"] = args.origin;
  return new Client(args.url, { headers });
}

function watch(room: Room, seats: Seat[]): Seat {
  const seat: Seat = { room, phase: "", races: 0, lastStateAt: Date.now() };
  let lastError = "";
  for (const type of ["seated", "commandResult", "raceEvents", "pong", "replay", "idleWarning"]) {
    room.onMessage(type, () => undefined);
  }
  room.onMessage("serverError", (error: { code?: string }) => {
    lastError = error.code ?? "unknown";
  });
  room.onStateChange((state: { phase?: string }) => {
    seat.lastStateAt = Date.now();
    const phase = state.phase ?? "";
    if (phase === seat.phase) return;
    if (phase === "lobby") room.send("setReady", { requestId: requestId(), ready: true });
    if (phase === "finished") {
      seat.races += 1;
      setTimeout(() => {
        if (seat.left === undefined) room.send("raceAgain", { requestId: requestId() });
      }, 2_000);
    }
    seat.phase = phase;
  });
  room.onLeave((code: number) => {
    seat.left = lastError === "" ? `close ${code}` : `close ${code} after ${lastError}`;
  });
  room.send("setReady", { requestId: requestId(), ready: true });
  seats.push(seat);
  return seat;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const seats: Seat[] = [];
  const refused = new Map<string, number>();
  const started = Date.now();
  const until = started + args.seconds * 1_000;
  let sequence = 0;

  // One timer for the whole run: inputs for every racing seat, and the reason
  // the process outlives a server that has gone away.
  const steer = setInterval(() => {
    for (const seat of seats) {
      if (seat.left !== undefined || (seat.phase !== "countdown" && seat.phase !== "racing")) continue;
      const tick = (seat.room.state as { tick?: number }).tick ?? 0;
      try {
        seat.room.send("input", { sequence: (sequence += 1), tick: tick + 2, left: Math.random() < 0.3, right: Math.random() < 0.3, fastFall: false, reset: false });
      } catch {
        // A seat whose socket just closed; onLeave records it.
      }
    }
  }, TICK_MS);
  const status = setInterval(() => {
    const live = seats.filter((seat) => seat.left === undefined);
    const phases = new Map<string, number>();
    for (const seat of live) phases.set(seat.phase, (phases.get(seat.phase) ?? 0) + 1);
    process.stdout.write(
      `${Math.round((Date.now() - started) / 1_000)}s seats live ${live.length}/${seats.length} ${[...phases].map(([p, n]) => `${p}:${n}`).join(" ")}\n`,
    );
  }, 5_000);

  await Promise.all(
    Array.from({ length: args.rooms }, async (_, index) => {
      await new Promise((resolve) => setTimeout(resolve, index * 300));
      const client = clientFor(args, index);
      const join = (name: string) => ({ name, protocolVersion: PROTOCOL_VERSION });
      try {
        const host = await client.create("race", join(`Probe ${index}A`));
        const guests = await Promise.all(["B", "C", "D"].map((seat) => client.joinById(host.roomId, join(`Probe ${index}${seat}`))));
        for (const room of [host, ...guests]) {
          room.reconnection.enabled = false;
          watch(room, seats);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = /^([A-Z_]{4,})/.exec(message)?.[1] ?? (message.slice(0, 60) || (error instanceof Error ? error.name : typeof error));
        if (process.env["PROBE_DEBUG"]) process.stderr.write(`refused: ${String(error)} code=${(error as {code?: unknown}).code} ${(error as Error).stack?.split("\n").slice(0,4).join(" | ")}\n`);
        refused.set(code, (refused.get(code) ?? 0) + 1);
      }
    }),
  );

  await new Promise((resolve) => setTimeout(resolve, Math.max(0, until - Date.now())));
  clearInterval(steer);
  clearInterval(status);

  const outcomes = new Map<string, number>();
  for (const seat of seats) {
    const outcome = seat.left ?? "still seated";
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
  }
  const frozen = seats.filter((seat) => seat.left === undefined && Date.now() - seat.lastStateAt > 10_000).length;
  process.stdout.write(
    [
      `seats           ${seats.length}`,
      `races finished  ${seats.reduce((sum, seat) => sum + seat.races, 0)}`,
      `refused         ${[...refused].map(([code, n]) => `${code} ${n}`).join(", ") || "none"}`,
      `how seats ended ${[...outcomes].map(([outcome, n]) => `${outcome}: ${n}`).join(", ")}`,
      `frozen seats    ${frozen}`,
      "",
    ].join("\n"),
  );
  for (const seat of seats) if (seat.left === undefined) void seat.room.leave(true).catch(() => undefined);
  setTimeout(() => process.exit(frozen > 0 ? 1 : 0), 500);
}

await main();
