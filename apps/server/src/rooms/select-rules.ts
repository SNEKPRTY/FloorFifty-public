/**
 * The select phase's rules (stage, song and character select spec §5.1-5.4).
 *
 * Plain functions over `RaceState`, as `lobby-rules.ts` is. The room calls
 * `enterSelect` when the lobby's last seat readies, the three commands as they
 * arrive, and `advanceSelect` once per tick. The song steps are one entry in
 * `POOL` and one in `RESOLVE` (plan 2b.3).
 */

import {
  COUNTDOWN_TICKS,
  LOADING_TIMEOUT_TICKS,
  RANDOM_PICK,
  REVEAL_TICKS,
  SELECT_STEP_TICKS,
  SOLO_REVEAL_TICKS,
} from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { createMovingFloorStates, createPlayerState, type RaceState } from "@floor-fifty/shared/common/state";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import type { AccessSets } from "@floor-fifty/shared/content/access";
import { createCourse } from "@floor-fifty/shared/level/course";
import { drawUniform, rouletteRng } from "@floor-fifty/shared/room/roulette";
import {
  isSeed,
  nextStep,
  PICK_STEP,
  pickKindOf,
  REVEAL_STEP,
  SEED_MAX,
  SEED_MIN,
  type PickKind,
  type SeedChoice,
  type SelectPick,
  type SelectResult,
  type SelectStep,
} from "@floor-fifty/shared/room/select";
import { resolveRandomCharacters } from "./character-rules";
import { RoomCommandError } from "./room-errors";
import { seatAtStart } from "./lobby-rules";

/** What the rules ask of the room: each seat's access, and a stage's authored (Classic) seed and its tuning. */
export type SelectContext = {
  accessOf(playerId: PlayerId): AccessSets;
  stageCourse(stageId: string): { seed: number; tuning: ResolvedTuning };
};

/** What a seat may pick in each kind of step, from its access. */
const POOL: Record<PickKind, (access: AccessSets) => readonly string[]> = {
  stage: (access) => access.stages,
  song: (access) => access.songs,
};

/** How many of a room's last results "?" steers clear of. */
const RECENT_PICKS = 2;

/**
 * The pool "?" draws from: the seat's own, less what the room landed on
 * lately. A pool too small to miss them all misses the newest it can; one
 * that is nothing but them is drawn whole.
 */
function freshPool(pool: readonly string[], recent: readonly string[]): readonly string[] {
  for (let skip = recent.length; skip > 0; skip -= 1) {
    const avoid = recent.slice(-skip);
    const fresh = pool.filter((id) => !avoid.includes(id));
    if (fresh.length > 0) return fresh;
  }
  return pool;
}

/** Remembers a result, keeping the newest `RECENT_PICKS`. */
function remember(race: RaceState, kind: PickKind, id: string): void {
  const recent = [...(race.recentPicks?.[kind] ?? []), id].slice(-RECENT_PICKS);
  race.recentPicks = { ...race.recentPicks, [kind]: recent };
}

/** What a roulette result does to the race. */
const RESOLVE: Record<PickKind, (race: RaceState, result: SelectResult, ctx: SelectContext) => void> = {
  stage: (race, result, ctx) => {
    race.select!.stage = result;
    const course = ctx.stageCourse(result.id);
    applyStage(race, result.id, { ...course, seed: result.seed ?? course.seed });
  },
  song: (race, result) => {
    race.select!.song = result;
    race.songId = result.id;
  },
};

/**
 * Rebuilds the course from the chosen stage's tuning and the resolved seed
 * (select spec §4.5, stage seeds spec §3.3), keeping every seat: its connection, readiness, body, colour and device.
 */
function applyStage(race: RaceState, stageId: string, course: { seed: number; tuning: ResolvedTuning }): void {
  race.stageId = stageId;
  race.seed = course.seed;
  race.tuning = course.tuning;
  race.course = createCourse(course.seed, course.tuning);
  race.movingFloors = createMovingFloorStates(race.course);
  for (const player of Object.values(race.players)) {
    const fresh = createPlayerState(player.id, player.name, race.course, race.tuning, player.colour, player.deviceClass);
    Object.assign(player, fresh, {
      status: player.status,
      ready: player.ready,
      characterId: player.characterId,
      cpu: player.cpu,
      ...(player.ghostDeadlineTick === undefined ? {} : { ghostDeadlineTick: player.ghostDeadlineTick }),
    });
  }
}

/** Every person still in the room, connected or a ghost, in seat-ID order. A DNS has left; a CPU never picks (CPU players spec D-C6). */
const inPlay = (race: RaceState): PlayerId[] =>
  (Object.keys(race.players) as PlayerId[]).filter((id) => race.players[id]!.status !== "dns" && !race.players[id]!.cpu).sort();
/** The seats the room waits on: a ghost cannot lock in or load, so it never holds a step up. */
const connected = (race: RaceState): PlayerId[] =>
  inPlay(race).filter((id) => race.players[id]!.status === "connected");

/** Opens a pick step, every seat focused on the first item it may pick, its seed on Random (stage seeds spec §3.1). */
function openPickStep(race: RaceState, kind: PickKind, ctx: SelectContext): void {
  const picks: Record<PlayerId, SelectPick> = {};
  for (const id of inPlay(race)) picks[id] = { focus: POOL[kind](ctx.accessOf(id))[0] ?? RANDOM_PICK, locked: false, seed: "random" };
  race.select!.step = PICK_STEP[kind];
  race.select!.endsAtTick = race.tick + SELECT_STEP_TICKS;
  race.select!.picks = picks;
}

/**
 * Lobby to select: resolves every "?" character on the roulette's RNG, then
 * opens the first pick step. Runs once; a second call finds `select` and
 * returns.
 */
export function enterSelect(race: RaceState, ctx: SelectContext): void {
  if (race.select !== undefined) return;
  if (race.phase !== "select") return;
  resolveRandomCharacters(race, (id) => ctx.accessOf(id));
  race.select = { step: "stage", endsAtTick: race.tick + SELECT_STEP_TICKS, picks: {}, loaded: [] };
  openPickStep(race, "stage", ctx);
}

/** The pick kind open now, refusing any command that needs one when none is. */
function requirePickStep(race: RaceState, kind?: PickKind): PickKind {
  const current = race.phase === "select" && race.select !== undefined ? pickKindOf(race.select.step) : undefined;
  if (current === undefined || (kind !== undefined && current !== kind)) {
    throw new RoomCommandError("MALFORMED_MESSAGE", "that pick is not open now");
  }
  return current;
}

/** Moves a seat's focus: an item it may pick, or "?". Everyone's cursors are drawn from it. */
export function pickFocus(race: RaceState, playerId: PlayerId, kind: PickKind, choice: string, access: AccessSets): void {
  requirePickStep(race, kind);
  const pick = race.select!.picks[playerId];
  if (pick === undefined) throw new RoomCommandError("INVALID_ROOM", "no such seat in this select");
  if (pick.locked) throw new RoomCommandError("MALFORMED_MESSAGE", "you have locked in");
  if (choice !== RANDOM_PICK && !POOL[kind](access).includes(choice)) {
    throw new RoomCommandError("MALFORMED_MESSAGE", "that is not yours to pick");
  }
  pick.focus = choice;
}

/** A seat's seed choice in the stage step (stage seeds spec §3.1); it stays with the seat as its focus moves. */
export function pickSeed(race: RaceState, playerId: PlayerId, choice: SeedChoice): void {
  requirePickStep(race, "stage");
  const pick = race.select!.picks[playerId];
  if (pick === undefined) throw new RoomCommandError("INVALID_ROOM", "no such seat in this select");
  if (pick.locked) throw new RoomCommandError("MALFORMED_MESSAGE", "you have locked in");
  if (choice !== "random" && choice !== "classic" && !isSeed(choice)) {
    throw new RoomCommandError("MALFORMED_MESSAGE", "a seed is a whole number from 0 to 999999");
  }
  pick.seed = choice;
}

/** Locks a seat's focus. The step ends early once every connected seat has. */
export function lockIn(race: RaceState, playerId: PlayerId): void {
  requirePickStep(race);
  const pick = race.select!.picks[playerId];
  if (pick === undefined) throw new RoomCommandError("INVALID_ROOM", "no such seat in this select");
  pick.locked = true;
}

/** A seat has loaded the chosen content. */
export function markLoaded(race: RaceState, playerId: PlayerId): void {
  if (race.phase !== "select" || race.select?.step !== "loading") {
    throw new RoomCommandError("MALFORMED_MESSAGE", "nothing is loading now");
  }
  if (!race.select.loaded.includes(playerId)) race.select.loaded.push(playerId);
}

/**
 * The roulette (select spec §5.3). Part of the replay contract, so the order
 * is fixed: seats in seat-ID order, each "?" first becoming a uniform draw
 * from that seat's own access (less the room's last two results) on the
 * same RNG, then one seat's pick drawn
 * uniformly, one entry per seat. A DNS is not drawn.
 */
function spin(race: RaceState, kind: PickKind, ctx: SelectContext): SelectResult {
  const rng = rouletteRng(race.roomSeed, race.round, kind);
  const entries: SelectResult[] = [];
  for (const id of inPlay(race)) {
    const pick = race.select!.picks[id];
    if (pick === undefined) continue;
    const landed =
      pick.focus === RANDOM_PICK ? drawUniform(rng, freshPool(POOL[kind](ctx.accessOf(id)), race.recentPicks?.[kind] ?? [])) : pick.focus;
    entries.push({ id: landed, pickedBy: id });
  }
  if (entries.length === 0) {
    // Only reachable if every seat left in the same tick the step ended; the
    // room is closing, but the state stays valid until it does.
    const seat = inPlay(race)[0] ?? ("" as PlayerId);
    const fallback = POOL[kind](ctx.accessOf(seat))[0];
    if (fallback === undefined) throw new Error(`the roulette has no ${kind} to land on`);
    return kind === "stage" ? { id: fallback, pickedBy: seat, seed: ctx.stageCourse(fallback).seed, classic: true } : { id: fallback, pickedBy: seat };
  }
  const landed = drawUniform(rng, entries);
  if (kind !== "stage") return landed;
  // The winning pick's seed (stage seeds spec §3.3), drawn after the stage so
  // the roulette's stage draw is what it always was.
  const classicSeed = ctx.stageCourse(landed.id).seed;
  const choice = race.select!.picks[landed.pickedBy]?.seed ?? "random";
  const seed = choice === "classic" ? classicSeed : choice === "random" ? rng.nextInt(SEED_MIN, SEED_MAX) : choice;
  return { ...landed, seed, classic: seed === classicSeed };
}

/** Enters `step`: a pick step opens fresh; a reveal runs its clock; loading waits on seats. */
function enter(race: RaceState, step: SelectStep, ctx: SelectContext): void {
  const kind = pickKindOf(step);
  if (kind !== undefined) {
    openPickStep(race, kind, ctx);
    return;
  }
  race.select!.step = step;
  if (step === "loading") {
    race.select!.endsAtTick = race.tick + LOADING_TIMEOUT_TICKS;
    race.select!.loaded = [];
    return;
  }
  // With one seat there is nothing to spin, just the result.
  const solo = connected(race).length <= 1;
  race.select!.endsAtTick = race.tick + (solo ? SOLO_REVEAL_TICKS : REVEAL_TICKS);
}

/**
 * One tick of select. A pick step ends when every connected seat has locked
 * in or its clock runs out, and resolves exactly once, because resolving
 * leaves the step. Loading ends when every connected seat has loaded, or at
 * 10 s; a seat still loading races anyway.
 */
export function advanceSelect(race: RaceState, ctx: SelectContext): void {
  if (race.phase !== "select" || race.select === undefined) return;
  const select = race.select;
  const kind = pickKindOf(select.step);
  const expired = race.tick >= select.endsAtTick;
  // Early ends need someone there to have done it: with every seat a ghost,
  // "every connected seat" holds of nobody, and the room would race on its
  // own before a reloading player could come back to it. The clock decides.
  const live = connected(race);

  if (kind !== undefined) {
    const allLocked = live.length > 0 && live.every((id) => select.picks[id]?.locked === true);
    if (!allLocked && !expired) return;
    // A seat that has not locked in locks its focus, a ghost's included.
    for (const pick of Object.values(select.picks)) pick.locked = true;
    const result = spin(race, kind, ctx);
    RESOLVE[kind](race, result, ctx);
    remember(race, kind, result.id);
    enter(race, REVEAL_STEP[kind], ctx);
    return;
  }

  if (select.step === "loading") {
    const allLoaded = live.length > 0 && live.every((id) => select.loaded.includes(id));
    if (!allLoaded && !expired) return;
    race.phase = "countdown";
    race.countdownEndsAtTick = race.tick + COUNTDOWN_TICKS;
    seatAtStart(race);
    delete race.select;
    return;
  }

  if (!expired) return;
  const next = nextStep(select.step);
  if (next !== undefined) enter(race, next, ctx);
}
