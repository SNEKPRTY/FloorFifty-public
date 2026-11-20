/**
 * When a stage's set pieces play (Wonder spec §6.5): each is placed on a
 * fifty-floor arc, and plays when the viewer's camera reaches that share of
 * the race's height, so a 20-floor race plays floor 45 at its floor 18 and
 * three laps play the arc once across the whole race. Infinite repeats the
 * arc every fifty floors.
 *
 * Pieces sharing a floor play together as one group, held for the longest.
 * Groups never overlap: one that comes due while another holds waits for it.
 * Each plays once per pass; a camera that falls back below a floor does not
 * replay it. Pure: the director renders what this starts and ends.
 */

import type { SetPieceContent } from "@floor-fifty/shared/content/game-content";

export type SetPieceGroup = { readonly floor: number; readonly pieces: readonly SetPieceContent[]; readonly holdMs: number };
/** A playing group: its hold scaled to the race (`holdScale`), so a short race still reaches its climax. */
export type ActiveGroup = SetPieceGroup & { readonly startedMs: number; readonly pass: number; readonly holdScale: number };
export type SetPieceChange = { readonly started: ActiveGroup | undefined; readonly ended: ActiveGroup | undefined };

/** The arc's length in floors: every stage is designed for fifty. */
export const ARC_FLOORS = 50;
const EPSILON = 1e-9;
/** The shortest a scaled hold gets: two fifths of the authored, a 20-floor race's share. */
const MIN_HOLD_SCALE = 0.4;

/**
 * How far up the whole race the viewer is, in floors: the laps already
 * climbed plus the camera's height on this one. A lap starts again at the
 * bottom of the ladder, so the camera alone never climbs past one ladder.
 */
export function climbFloor(lap: number, ladderFloors: number, cameraY: number, gap: number): number {
  const done = Math.max(0, lap - 1) * ladderFloors;
  return done + Math.max(0, cameraY / gap);
}

export class SetPieceClock {
  private readonly groups: readonly SetPieceGroup[];
  private readonly played = new Set<number>();
  private pass = 0;
  /** The highest pass reached: a fall back into a lower pass replays nothing there. */
  private maxPass = 0;
  private current: ActiveGroup | undefined;
  private holdScale = 1;

  constructor(pieces: readonly SetPieceContent[]) {
    const byFloor = new Map<number, SetPieceContent[]>();
    for (const piece of pieces) byFloor.set(piece.floor, [...(byFloor.get(piece.floor) ?? []), piece]);
    this.groups = [...byFloor.entries()]
      .sort(([a], [b]) => a - b)
      .map(([floor, group]) => ({ floor, pieces: group, holdMs: Math.max(...group.map((piece) => piece.holdMs)) }));
  }

  /**
   * Steps the clock. `cameraFloor` is the camera's height in floors;
   * `raceFloors` the race's (goal × laps), or undefined in Infinite.
   */
  update(nowMs: number, cameraFloor: number, raceFloors: number | undefined): SetPieceChange {
    let ended: ActiveGroup | undefined;
    if (this.current !== undefined && nowMs - this.current.startedMs >= this.current.holdMs) {
      ended = this.current;
      this.current = undefined;
    }

    // Holds shrink with the race, so a 20-floor race's pieces fit its climb.
    this.holdScale = raceFloors === undefined ? 1 : Math.min(1, Math.max(MIN_HOLD_SCALE, raceFloors / ARC_FLOORS));
    let share: number;
    if (raceFloors === undefined) {
      const pass = Math.max(0, Math.floor(cameraFloor / ARC_FLOORS));
      if (pass > this.maxPass) {
        this.maxPass = pass;
        this.played.clear();
      }
      this.pass = pass;
      // A pass below the highest reached has played already, all of it.
      share = pass < this.maxPass ? -1 : (Math.max(0, cameraFloor) % ARC_FLOORS) / ARC_FLOORS;
    } else {
      share = raceFloors <= 0 ? 0 : Math.max(0, cameraFloor) / raceFloors;
    }

    let started: ActiveGroup | undefined;
    if (this.current === undefined) {
      // The latest group due plays; any the climb passed while another held are
      // skipped rather than queued, so the arc never runs behind the race.
      const due = this.groups.filter((group) => !this.played.has(group.floor) && group.floor / ARC_FLOORS <= share + EPSILON);
      for (const group of due) this.played.add(group.floor);
      const latest = due[due.length - 1];
      if (latest !== undefined) started = this.start(latest, nowMs);
    }
    return { started, ended };
  }

  /** The group holding now, if any. */
  get active(): ActiveGroup | undefined {
    return this.current;
  }

  /** Starts the group at `floor` now, ending any that holds: the frame-budget gate's hook. */
  force(floor: number, nowMs: number): ActiveGroup | undefined {
    const group = this.groups.find((each) => each.floor === floor);
    if (group === undefined) return undefined;
    this.current = undefined;
    return this.start(group, nowMs);
  }

  /** Forgets every pass: a rewind, or a new race. */
  reset(): void {
    this.played.clear();
    this.pass = 0;
    this.maxPass = 0;
    this.current = undefined;
  }

  private start(group: SetPieceGroup, nowMs: number): ActiveGroup {
    this.played.add(group.floor);
    this.current = { ...group, holdMs: group.holdMs * this.holdScale, startedMs: nowMs, pass: this.pass, holdScale: this.holdScale };
    return this.current;
  }
}
