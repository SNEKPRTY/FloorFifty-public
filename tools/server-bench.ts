/**
 * Server load benchmark: N real race rooms of four racers, ticked in lockstep.
 *
 *   pnpm bench:server [--rooms 8] [--ticks 3600] [--warmup 600]
 *                     [--mode race|infinite] [--humans 1] [--laps 1|3] [--json]
 *                     [--cpu-prof out.cpuprofile] [--alloc-prof out.heapprofile [--live]]
 *
 * Real Colyseus rooms on an in-process server, with real SDK clients receiving
 * every patch over a socket. Each room seats `--humans` clients steered by the
 * reference climb controller (as the test driver steers them) and fills the
 * rest of its four seats with the room's own CPUs. Time is driven by hand: each
 * frame steps every room once, so the per-frame sum is the box's work for one
 * sixty-hertz period on one core (Node is single-threaded; rooms share it).
 *
 * Tick cost is this thread's CPU time (`process.threadCpuUsage`), not the wall
 * clock, so a loaded machine stretches the run but not the numbers. Reported:
 * per-room tick CPU (mean/p50/p95/p99), frames whose rooms together run past
 * the 16.7 ms budget, heap per room, allocation rate and GC pauses (from
 * `v8.GCProfiler`), and bytes handed to client sockets per room-tick. The
 * clients decode in this process, so heap and allocation include theirs.
 *
 * Profiles cover the measured frames only: `--cpu-prof` writes a
 * `.cpuprofile`, `--alloc-prof` a sampled `.heapprofile` of every allocation,
 * or with `--live` only of what is still reachable at the end. Read the room's
 * frames (`stepOnce` and below) and skip the SDK's.
 */

import { boot } from "@colyseus/testing";
import config from "@colyseus/tools";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Session } from "node:inspector/promises";
import v8 from "node:v8";
import { COUNTDOWN_TICKS, PROTOCOL_VERSION, REVEAL_TICKS, TICK_MS } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { createClimbController, type ClimbController } from "@floor-fifty/shared/level/steering";
import { pickKindOf } from "@floor-fifty/shared/room/select";
import { createAppConfig } from "../apps/server/src/colyseus-app";
import { ContentStore } from "../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../apps/server/src/content/generated-content";
import type { RaceRoom } from "../apps/server/src/rooms/race-room";

type Options = { tree: string | undefined; compare: string | undefined; live: boolean; allocProf: string | undefined; cpuProf: string | undefined; rooms: number; ticks: number; warmup: number; mode: string; humans: number; laps: number; json: boolean; seed: number };

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { tree: undefined, compare: undefined, live: false, allocProf: undefined, cpuProf: undefined, rooms: 8, ticks: 3600, warmup: 600, mode: "race", humans: 1, laps: 3, json: false, seed: 4182 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    const value = argv[index + 1];
    switch (flag) {
      case "--rooms": options.rooms = Number(value); index += 1; break;
      case "--ticks": options.ticks = Number(value); index += 1; break;
      case "--alloc-prof": options.allocProf = String(value); index += 1; break;
      case "--cpu-prof": options.cpuProf = String(value); index += 1; break;
      case "--warmup": options.warmup = Number(value); index += 1; break;
      case "--mode": options.mode = String(value); index += 1; break;
      case "--humans": options.humans = Number(value); index += 1; break;
      case "--laps": options.laps = Number(value); index += 1; break;
      case "--seed": options.seed = Number(value); index += 1; break;
      case "--tree": options.tree = String(value); index += 1; break;
      case "--compare": options.compare = String(value); index += 1; break;
      case "--live": options.live = true; break;
      case "--json": options.json = true; break;
      default: throw new Error(`unknown flag ${flag}`);
    }
  }
  if (options.humans < 1 || options.humans > 4) throw new Error("--humans is 1 to 4");
  return options;
}

type SdkRoom = {
  roomId: string;
  reconnection: { enabled: boolean };
  onMessage(type: string, handler: (payload: unknown) => void): unknown;
  send(type: string, payload?: unknown): void;
  leave(consented?: boolean): Promise<number>;
};

type Seat = { sdk: SdkRoom; playerId: PlayerId | undefined; answered: Set<string> };

type Bench = { side: "A" | "B"; room: RaceRoom; seats: Seat[]; controllers: Map<PlayerId, ClimbController> };

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let requests = 0;

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await turn();
  }
}

function seat(sdk: SdkRoom): Seat {
  sdk.reconnection.enabled = false;
  const entry: Seat = { sdk, playerId: undefined, answered: new Set() };
  sdk.onMessage("seated", (payload) => {
    entry.playerId = (payload as { playerId: PlayerId }).playerId;
  });
  sdk.onMessage("commandResult", (payload) => {
    const result = payload as { requestId: string; ok?: boolean; error?: unknown };
    entry.answered.add(result.requestId);
  });
  for (const type of ["raceEvents", "serverError", "pong", "replay"]) sdk.onMessage(type, () => undefined);
  return entry;
}

async function command(bench: Bench, entry: Seat, type: string, payload: Record<string, unknown> = {}): Promise<void> {
  requests += 1;
  const requestId = `bench-${requests}`;
  entry.sdk.send(type, { requestId, ...payload });
  await waitFor(() => entry.answered.has(requestId), `${type} answered`);
  bench.room.stepOnce();
  bench.room.broadcastPatch();
  await settle();
}

async function steps(bench: Bench, count: number): Promise<void> {
  for (let tick = 0; tick < count; tick += 1) bench.room.stepOnce();
  bench.room.broadcastPatch();
  await settle();
}

async function openRoom(server: Awaited<ReturnType<typeof boot>>, index: number, options: Options, side: "A" | "B"): Promise<Bench> {
  const join = { protocolVersion: PROTOCOL_VERSION };
  const hostSdk = (await server.sdk.create(side === "A" ? "race" : COMPARED_ROOM, { ...join, name: `Host ${index}` })) as unknown as SdkRoom;
  const room = server.getRoomById(hostSdk.roomId) as unknown as RaceRoom;
  room.stopClock();
  const bench: Bench = { side, room, seats: [seat(hostSdk)], controllers: new Map() };
  await steps(bench, 1);
  for (let guest = 1; guest < options.humans; guest += 1) {
    const sdk = (await server.sdk.joinById(room.roomId, { ...join, name: `Guest ${index}-${guest}` })) as unknown as SdkRoom;
    bench.seats.push(seat(sdk));
    await steps(bench, 1);
  }
  await waitFor(() => bench.seats.every((entry) => entry.playerId !== undefined), "every seat");
  const host = bench.seats[0]!;
  if (options.mode !== "race") await command(bench, host, "setMode", { modeId: options.mode });
  if (options.laps !== 1) await command(bench, host, "setLapCount", { lapCount: options.laps });
  for (let cpu = options.humans; cpu < 4; cpu += 1) await command(bench, host, "addCpu");
  for (const entry of bench.seats) await command(bench, entry, "setReady", { ready: true });
  for (let guard = 0; guard < 16 && room.raceState.phase === "select"; guard += 1) {
    const step = room.raceState.select!.step;
    if (step === "loading") for (const entry of bench.seats) await command(bench, entry, "loaded");
    else if (pickKindOf(step) !== undefined) for (const entry of bench.seats) await command(bench, entry, "lockIn");
    else await steps(bench, REVEAL_TICKS + 1);
  }
  if (room.raceState.phase !== "countdown") throw new Error(`room ${index} is in ${room.raceState.phase}, not the countdown`);
  await steps(bench, COUNTDOWN_TICKS + 1);
  if (room.raceState.phase !== "racing") throw new Error(`room ${index} did not start racing`);
  for (const entry of bench.seats) bench.controllers.set(entry.playerId!, createClimbController(entry.playerId!));
  return bench;
}

/** The driver's frame for each steered seat, as `driveRoom` sends it. */
function steer(bench: Bench): void {
  const state = bench.room.raceState;
  if (state.phase !== "racing") return;
  for (const [playerId, controller] of bench.controllers) {
    const sequence = (state.players[playerId]?.lastSequence ?? 0) + 1;
    const intent = controller.next(state, sequence);
    if (intent !== undefined) bench.room.submitInput(playerId, { ...intent, tick: state.tick + 1 }, false);
  }
}

/** `--compare`'s room: the same room from another checkout, side by side in this process. */
const COMPARED_ROOM = "race-compared";

type Stats = { mean: number; p50: number; p95: number; p99: number; max: number };

function statsOf(values: Float64Array): Stats {
  const sorted = values.slice().sort();
  const mean = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length);
  return { mean, p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), p99: quantile(sorted, 0.99), max: quantile(sorted, 1) };
}

const quantile = (sorted: Float64Array | number[], q: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;

const heapUsed = (): number => {
  (globalThis as { gc?: () => void }).gc?.();
  (globalThis as { gc?: () => void }).gc?.();
  return process.memoryUsage().heapUsed;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const contentStore = new ContentStore(GENERATED_CONTENT);
  // `--compare <checkout>`: that checkout's room runs beside this one's, room
  // for room and tick for tick, so both see the same machine. On a loaded box
  // two separate runs differ by more than most changes do. `--tree <checkout>`
  // takes side A's room from a checkout too. Both must sit under this one
  // (a git-ignored `References/` will do): Vite serves nothing outside its root.
  const roomOf = async (tree: string): Promise<typeof RaceRoom> =>
    ((await import(/* @vite-ignore */ `/@fs${resolve(tree, "apps/server/src/rooms/race-room.ts")}`)) as { RaceRoom: typeof RaceRoom }).RaceRoom;
  const ownRoom = options.tree === undefined ? undefined : await roomOf(options.tree);
  const compared = options.compare === undefined ? undefined : await roomOf(options.compare);
  const app = createAppConfig({ contentStore, fixedSeed: options.seed });
  const server = await boot(
    config({
      initializeGameServer(gameServer) {
        const define = (name: string, room: typeof RaceRoom): void => {
          room.options = { contentStore, fixedSeed: options.seed } as never;
          gameServer.define(name, room as never);
        };
        if (ownRoom === undefined) app.initializeGameServer(gameServer);
        else define("race", ownRoom);
        if (compared !== undefined) define(COMPARED_ROOM, compared);
      },
    }),
    await freePort(),
  );

  const heapEmpty = heapUsed();
  const benches: Bench[] = [];
  for (let index = 0; index < options.rooms; index += 1) {
    benches.push(await openRoom(server, index, options, "A"));
    if (compared !== undefined) benches.push(await openRoom(server, index, options, "B"));
  }
  const heapRacing = heapUsed();

  // Bytes every socket is handed, patches and messages alike.
  let bytesOut = 0;
  for (const bench of benches) {
    for (const client of bench.room.clients as unknown as { ref: { send: (data: Uint8Array, ...rest: unknown[]) => void } }[]) {
      const send = client.ref.send.bind(client.ref);
      client.ref.send = (data, ...rest) => {
        bytesOut += data.byteLength;
        send(data, ...rest);
      };
    }
  }

  // Warm the JIT first: a cold room's first ticks measure the compiler.
  for (let frame = 0; frame < options.warmup; frame += 1) {
    for (const bench of benches) {
      steer(bench);
      bench.room.stepOnce();
    }
    await settle();
  }
  bytesOut = 0;

  // Thread CPU time, not wall time: on a loaded machine the wall clock measures
  // the scheduler. `threadCpuUsage` counts this thread's own microseconds only.
  const tickCpu = new Float64Array(options.ticks * benches.length);
  const tickWall = new Float64Array(options.ticks * benches.length);
  const sideCpu = { A: new Float64Array(options.ticks * options.rooms), B: new Float64Array(options.ticks * options.rooms) };
  const sideTicks = { A: 0, B: 0 };
  const frameCpu = new Float64Array(options.ticks);
  let racingTicks = 0;
  // Every allocation sampled, collected or not, while the measured frames run (`.heapprofile`, for DevTools).
  const inspector = options.allocProf === undefined && options.cpuProf === undefined ? undefined : new Session();
  inspector?.connect();
  if (options.cpuProf !== undefined) {
    await inspector!.post("Profiler.enable");
    await inspector!.post("Profiler.setSamplingInterval", { interval: 100 });
    await inspector!.post("Profiler.start");
  }
  if (options.allocProf !== undefined) {
    await inspector!.post("HeapProfiler.startSampling", {
      samplingInterval: 4096,
      // `--live` keeps only what is still reachable at the end: what the rooms retain.
      includeObjectsCollectedByMajorGC: !options.live,
      includeObjectsCollectedByMinorGC: !options.live,
    });
  }
  const profiler = new v8.GCProfiler();
  const cpuBefore = process.cpuUsage();
  const wallBefore = performance.now();
  const usedAtStart = v8.getHeapStatistics().used_heap_size;
  profiler.start();
  const reversed = [...benches].reverse();
  for (let frame = 0; frame < options.ticks; frame += 1) {
    let frameUs = 0;
    // Alternate the order, so neither side always runs on the other's warm cache.
    for (const bench of frame % 2 === 0 ? benches : reversed) {
      const racing = bench.room.raceState.phase === "racing";
      steer(bench);
      const wall = performance.now();
      const began = process.threadCpuUsage();
      bench.room.stepOnce();
      const spent = process.threadCpuUsage(began);
      const us = spent.user + spent.system;
      frameUs += us;
      if (racing) {
        tickWall[racingTicks] = performance.now() - wall;
        tickCpu[racingTicks++] = us / 1000;
        sideCpu[bench.side][sideTicks[bench.side]++] = us / 1000;
      }
    }
    frameCpu[frame] = frameUs / 1000;
    // Sockets flush and the clients decode between frames, as they would between timer callbacks.
    await settle();
  }
  const gc = profiler.stop();
  const usedAtStop = v8.getHeapStatistics().used_heap_size;
  if (options.allocProf !== undefined) {
    const { profile } = await inspector!.post("HeapProfiler.stopSampling");
    writeFileSync(options.allocProf, JSON.stringify(profile));
  }
  if (options.cpuProf !== undefined) {
    const { profile } = await inspector!.post("Profiler.stop");
    writeFileSync(options.cpuProf, JSON.stringify(profile));
  }
  inspector?.disconnect();
  const wallMs = performance.now() - wallBefore;
  const cpu = process.cpuUsage(cpuBefore);
  const heapAfter = heapUsed();

  // Allocated = growth between collections, plus what each collection freed.
  let allocated = 0;
  let pauseUs = 0;
  let maxPauseUs = 0;
  let previousAfter = usedAtStart;
  let scavenges = 0;
  let majors = 0;
  for (const entry of gc.statistics) {
    const before = entry.beforeGC.heapStatistics.usedHeapSize;
    const after = entry.afterGC.heapStatistics.usedHeapSize;
    allocated += Math.max(0, before - previousAfter);
    previousAfter = after;
    pauseUs += entry.cost;
    maxPauseUs = Math.max(maxPauseUs, entry.cost);
    if (entry.gcType === "Scavenge") scavenges += 1;
    else majors += 1;
  }

  allocated += Math.max(0, usedAtStop - previousAfter);
  const ticks = tickCpu.subarray(0, racingTicks).sort();
  const walls = tickWall.subarray(0, racingTicks).sort();
  const frames = frameCpu.slice().sort();
  const finished = benches.filter((bench) => bench.room.raceState.phase === "finished").length;
  const floors = benches.map((bench) => bench.room.raceState.course.floorCount);
  const totalTicks = options.ticks * benches.length;
  const sides =
    compared === undefined
      ? undefined
      : { A: statsOf(sideCpu.A.subarray(0, sideTicks.A)), B: statsOf(sideCpu.B.subarray(0, sideTicks.B)) };
  const meanTick = ticks.reduce((sum, value) => sum + value, 0) / Math.max(1, ticks.length);
  const result = {
    options,
    racingTicks,
    finishedRooms: finished,
    floorCount: { min: Math.min(...floors), max: Math.max(...floors) },
    tickMs: { mean: meanTick, p50: quantile(ticks, 0.5), p95: quantile(ticks, 0.95), p99: quantile(ticks, 0.99), max: quantile(ticks, 1) },
    tickWallMs: { p50: quantile(walls, 0.5), p99: quantile(walls, 0.99) },
    frameMs: { p50: quantile(frames, 0.5), p99: quantile(frames, 0.99), max: quantile(frames, 1) },
    framesOverBudget: frames.filter((value) => value > TICK_MS).length,
    sides,
    heapPerRoomKiB: (heapRacing - heapEmpty) / benches.length / 1024,
    heapGrowthDuringRunKiB: (heapAfter - heapRacing) / 1024,
    allocatedPerTickKiB: allocated / totalTicks / 1024,
    allocatedMiBPerSecondAt60Hz: (allocated / options.ticks) * 60 / 1024 / 1024,
    gc: { scavenges, majors, pauseMsTotal: pauseUs / 1000, pauseMsMax: maxPauseUs / 1000, pauseMsPerSecondAt60Hz: (pauseUs / 1000 / options.ticks) * 60 },
    bytesOutPerRoomTick: bytesOut / totalTicks,
    processCpuMsPerFrame: (cpu.user + cpu.system) / 1000 / options.ticks,
    wallMs,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    const f = (value: number, digits = 3): string => value.toFixed(digits);
    process.stdout.write(
      [
        `rooms ${options.rooms} x 4 racers (${options.humans} human), mode ${options.mode}, laps ${options.laps}, ${options.ticks} frames; ${racingTicks} racing ticks, ${finished} rooms finished, floors ${result.floorCount.min}-${result.floorCount.max}`,
        `room tick cpu ms: mean ${f(result.tickMs.mean)} p50 ${f(result.tickMs.p50)} p95 ${f(result.tickMs.p95)} p99 ${f(result.tickMs.p99)} max ${f(result.tickMs.max)}`,
        `room tick wall ms: p50 ${f(result.tickWallMs.p50)} p99 ${f(result.tickWallMs.p99)} (machine load shows here)`,
        `frame (all rooms) cpu ms: p50 ${f(result.frameMs.p50)} p99 ${f(result.frameMs.p99)} max ${f(result.frameMs.max)}; over ${f(TICK_MS, 1)} ms: ${result.framesOverBudget}`,
        `heap per room ${f(result.heapPerRoomKiB, 1)} KiB (incl. its clients' decoded state); growth during run ${f(result.heapGrowthDuringRunKiB, 1)} KiB`,
        `allocated ${f(result.allocatedPerTickKiB, 2)} KiB per room-tick (${f(result.allocatedMiBPerSecondAt60Hz, 2)} MiB/s at 60 Hz, all rooms + clients)`,
        `gc: ${scavenges} scavenges, ${majors} major; pause total ${f(result.gc.pauseMsTotal, 1)} ms, max ${f(result.gc.pauseMsMax, 2)} ms, ${f(result.gc.pauseMsPerSecondAt60Hz, 2)} ms per second`,
        `bytes out per room-tick ${f(result.bytesOutPerRoomTick, 1)}; process cpu per frame ${f(result.processCpuMsPerFrame)} ms (rooms + in-process clients)`,
        ...(sides === undefined
          ? []
          : [
              `compare: ${options.tree ?? "this checkout"} (A) mean ${f(sides.A.mean)} p50 ${f(sides.A.p50)} p95 ${f(sides.A.p95)} p99 ${f(sides.A.p99)}`,
              `         ${options.compare} (B) mean ${f(sides.B.mean)} p50 ${f(sides.B.p50)} p95 ${f(sides.B.p95)} p99 ${f(sides.B.p99)}; B/A mean ${f(sides.B.mean / sides.A.mean)}`,
            ]),
      ].join("\n") + "\n",
    );
  }

  for (const bench of benches) for (const entry of bench.seats) await entry.sdk.leave(true).catch(() => undefined);
  await server.shutdown();
  process.exit(0);
}

await main();
