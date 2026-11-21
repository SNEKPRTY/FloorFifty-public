import { readFileSync } from "node:fs";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import type { HeldInput, RaceEvent } from "@floor-fifty/shared/common/protocol";
import { cloneRaceState, createRaceState, floorX, type RaceState } from "@floor-fifty/shared/common/state";
import type { StoryContent } from "@floor-fifty/shared/content/game-content";
import { steerPlayer } from "@floor-fifty/shared/level/steering";
import { StoryScript } from "@floor-fifty/shared/level/tutorial";
import { respawnPlayer } from "@floor-fifty/shared/simulation/players";
import { createRaceSimulation, type RaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import type { Press } from "./demo-slides";

const PLAYER = asPlayerId("story");

/** The game's content as `pnpm content` wrote it. */
export function readContent(): { baseTuning: RaceState["tuning"]; story: StoryContent } {
  return JSON.parse(readFileSync("content/generated/content.json", "utf8")).content;
}

/**
 * The story's run, stepped here in Node the way `StoryRun` steps it in the page (same simulation, same
 * script, same start), so a recording can decide what to press from what the page will do. Only what a
 * recording reads is kept; nothing here is shipped.
 */
export class Mirror {
  state: RaceState;
  readonly script: StoryScript;
  events: RaceEvent[] = [];
  private readonly simulation: RaceSimulation;
  private sequence = 0;
  private lavaSaved = false;

  constructor(seed: number, beats: ConstructorParameters<typeof StoryScript>[0]["beats"], tuning = readContent().baseTuning) {
    const start = createRaceState({ seed, lapCount: 1, tuning, players: [{ id: PLAYER, name: asPlayerName("You") }] });
    this.state = { ...start, phase: "racing", raceStartedAtTick: 0 };
    this.simulation = createRaceSimulation(this.state);
    this.simulation.restore(this.state);
    this.script = new StoryScript({ goalFloor: 999, beats }, this.state.course);
  }

  get player() {
    return this.state.players[PLAYER]!;
  }

  /** What the shared climb steering would press now. */
  bot(): Press[] {
    const input = steerPlayer(this.state, PLAYER, this.sequence + 1) ?? { left: false, right: false, fastFall: false };
    return [...(input.left ? (["left"] as const) : []), ...(input.right ? (["right"] as const) : []), ...(input.fastFall ? (["fastFall"] as const) : [])];
  }

  /** One tick with `press` held. */
  step(press: readonly Press[]): void {
    const intent = { left: press.includes("left"), right: press.includes("right"), fastFall: press.includes("fastFall"), reset: false };
    const frame: HeldInput = { sequence: (this.sequence += 1), ...intent };
    const result = this.simulation.step({ ...this.state, tick: this.state.tick + 1 }, new Map([[PLAYER, frame]]));
    this.state = result.state;
    this.events = [...result.events];
    this.script.observe({ playerId: PLAYER, input: intent, after: this.state, events: result.events });
    if (this.script.edgeY !== undefined && !this.lavaSaved) {
      this.lavaSaved = true;
      if (this.script.needsStart) {
        const state = cloneRaceState(this.state);
        respawnPlayer(state, state.players[PLAYER]!, state.tuning);
        this.state = state;
        this.simulation.restore(state);
        this.script.startHandled();
      }
    }
  }

  /** Whether the lava has caught her: the page would stop and put her back, and a recording must not. */
  get caught(): boolean {
    return this.script.standing;
  }

  /** The floor she last landed on, and whether it moves. */
  landedOn(): { index: number; moving: boolean } | undefined {
    const landing = this.events.find((event) => event.type === "floorLanded");
    if (landing === undefined || landing.type !== "floorLanded") return undefined;
    const floor = this.state.course.floors[landing.floorIndex];
    return { index: landing.floorIndex, moving: floor?.kind === "moving" };
  }

  floorXOf(index: number): number {
    return floorX(this.state, this.state.course.floors[index]!);
  }
}
