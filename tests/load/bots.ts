/**
 * Load-test bots (release readiness §6.2): rooms of four SDK clients that
 * ready up, race with a seeded random walk of inputs at 60 Hz, and race again
 * until stopped.
 *
 * Usage (vite-node):
 *   pnpm exec vite-node tests/load/bots.ts -- --url https://staging-api.<domain> \
 *     --rooms 10 --origin https://staging.<domain> [--seconds 600] [--seed 7] [--spread-addresses]
 *
 * Only against staging, or against a production box before it is announced
 * (sizing MAX_ROOMS). Each room is private, so no player is ever matched with
 * a bot. Prints rooms created, races finished, refusals by code and stuck
 * bots, and exits non-zero if any bot got stuck.
 */

import { Client, type Room } from "@colyseus/sdk";
import { PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";

type Args = { url: string; rooms: number; origin: string; seconds: number; seed: number; spread: boolean };

function parseArgs(argv: readonly string[]): Args {
  const value = (name: string): string | undefined => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };
  const url = value("url");
  if (url === undefined) throw new Error("--url is required");
  return {
    url,
    rooms: Number(value("rooms") ?? 1),
    origin: value("origin") ?? "",
    seconds: Number(value("seconds") ?? 600),
    seed: Number(value("seed") ?? 7),
    spread: argv.includes("--spread-addresses"),
  };
}

/** A small seeded generator, so a run can be repeated. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Tally = { created: number; finished: number; refused: Map<string, number>; stuck: number };

const STUCK_AFTER_MS = 30_000;
const TICK_MS = 1_000 / 60;

let requests = 0;
const requestId = (): string => `bot-${(requests += 1)}`;

function refusalCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^([A-Z_]{4,})/.exec(message)?.[1] ?? message.slice(0, 40);
}

/** One bot: joins, readies, races at 60 Hz, races again, and reports a stall. */
async function bot(room: Room, random: () => number, until: number, tally: Tally): Promise<void> {
  let lastChange = Date.now();
  let lastPhase = "";
  let sequence = 0;
  let heading = { left: false, right: false };
  // A bot reads the state alone; the room's messages are heard and dropped.
  for (const type of ["seated", "commandResult", "raceEvents", "serverError", "pong", "replay"]) {
    room.onMessage(type, () => undefined);
  }
  room.onStateChange((state: { phase?: string; tick?: number }) => {
    lastChange = Date.now();
    if (state.phase === lastPhase) return;
    if (state.phase === "lobby") room.send("setReady", { requestId: requestId(), ready: true });
    if (state.phase === "finished" && lastPhase !== "finished") {
      tally.finished += 1;
      setTimeout(() => room.send("raceAgain", { requestId: requestId() }), 2_000 + random() * 2_000);
    }
    lastPhase = state.phase ?? "";
  });
  room.send("setReady", { requestId: requestId(), ready: true });

  while (Date.now() < until) {
    const state = room.state as { phase?: string; tick?: number };
    if (state.phase === "countdown" || state.phase === "racing") {
      if (random() < 0.05) heading = { left: random() < 0.5, right: random() < 0.5 };
      room.send("input", {
        sequence: (sequence += 1),
        tick: (state.tick ?? 0) + 2,
        ...heading,
        fastFall: random() < 0.02,
        reset: false,
      });
    }
    if (Date.now() - lastChange > STUCK_AFTER_MS) {
      tally.stuck += 1;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
  await room.leave(true).catch(() => undefined);
}

async function roomOfFour(shared: Client, index: number, args: Args, until: number, tally: Tally): Promise<void> {
  const client = args.spread ? clientFor(args, index) : shared;
  const random = mulberry32(args.seed + index);
  const join = (name: string) => ({ name, protocolVersion: PROTOCOL_VERSION });
  try {
    const host = await client.create("race", join(`Bot ${index}A`));
    tally.created += 1;
    const guests = await Promise.all(["B", "C", "D"].map((seat) => client.joinById(host.roomId, join(`Bot ${index}${seat}`))));
    for (const room of [host, ...guests]) room.reconnection.enabled = false;
    await Promise.all([host, ...guests].map((room) => bot(room, random, until, tally)));
  } catch (error) {
    const code = refusalCode(error);
    tally.refused.set(code, (tally.refused.get(code) ?? 0) + 1);
  }
}

/**
 * With `--spread-addresses`, each room's four bots claim their own address in
 * `Fly-Client-IP`, from the documentation range 198.18.0.0/15. Only a copy of
 * the server started by hand with FLOOR_FIFTY_PROXY=fly believes the header:
 * on Fly, Fly's proxy writes it, so against the live server the flag changes
 * nothing and one address still holds 3 rooms and 16 sockets.
 */
function clientFor(args: Args, index: number): Client {
  const headers: Record<string, string> = {};
  if (args.origin !== "") headers["origin"] = args.origin;
  if (args.spread) headers["fly-client-ip"] = `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}`;
  return new Client(args.url, { headers });
}

export async function runBots(args: Args): Promise<Tally> {
  const client = clientFor({ ...args, spread: false }, 0);
  const until = Date.now() + args.seconds * 1_000;
  const tally: Tally = { created: 0, finished: 0, refused: new Map(), stuck: 0 };
  // Rooms open a few at a time, as a creation limit per address allows.
  await Promise.all(
    Array.from({ length: args.rooms }, (_, index) =>
      new Promise((resolve) => setTimeout(resolve, index * 500)).then(() => roomOfFour(client, index, args, until, tally)),
    ),
  );
  return tally;
}

if (process.env["VITEST"] === undefined) {
  const args = parseArgs(process.argv.slice(2));
  const tally = await runBots(args);
  process.stdout.write(
    [
      `rooms created   ${tally.created} of ${args.rooms}`,
      `races finished  ${tally.finished}`,
      `refused         ${[...tally.refused].map(([code, n]) => `${code} ${n}`).join(", ") || "none"}`,
      `stuck bots      ${tally.stuck}`,
      "",
    ].join("\n"),
  );
  process.exit(tally.stuck > 0 ? 1 : 0);
}
