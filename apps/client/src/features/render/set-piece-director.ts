/**
 * Set pieces on screen (Wonder spec §6.4, §6.6): what each kind does over its
 * hold, through the backdrop's mood, lights-out and sky flash, the sky's
 * weather, the camera's kick, and a sweep of named layers.
 *
 * Everything steps: a mood in four steps each way, the lights-out wave in
 * eight, and the palette lock snaps the colours between. No flash comes
 * faster than three a second. At `low` quality only the palette shift draws;
 * under reduced motion the mood and the lights still step, plainly, the
 * weather holds still at half density, and nothing flashes, kicks or sweeps.
 */

import type { SetPieceContent } from "@floor-fifty/shared/content/game-content";
import { MOOD_TINTS } from "./filters/palette-lock";
import type { QualityLevel } from "../profile/quality";
import type { ActiveGroup } from "./set-piece-clock";
import type { WeatherSpec } from "./sky-particles";

type Tint = readonly [number, number, number];

/** What a set piece asks of the scenery's filters: `GameplayBackdrop`. */
export type SetPieceBackdrop = {
  setMood(tint: Tint, mix: number): void;
  setLightsOut(share: number, invert: boolean, relit?: number): void;
  setSkyFlash(tint: Tint, strength: number): void;
};

export type SetPieceDirectorDeps = {
  /** The backdrop now: a quality change rebuilds it (`reapply`). */
  readonly backdrop: () => SetPieceBackdrop | undefined;
  readonly particles: { burst(spec: WeatherSpec, nowMs: number, reduced: boolean): void; stop(): void };
  /** Kicks the camera by `units`, downward. */
  readonly kick: (units: number) => void;
  readonly quality: () => QualityLevel;
  readonly reduced: () => boolean;
  /** The player has switched stage effects off, read every frame: nothing plays, and what was playing ends. */
  readonly off?: () => boolean;
};

/** A flash's tint on the sky's lock: lightning white, aurora green. The lock keeps it on the palette. */
export const SKY_FLASH_TINTS: Readonly<Record<"lightning" | "aurora", Tint>> = {
  lightning: [1.6, 1.6, 1.7],
  aurora: [0.8, 1.4, 1.2],
};

/** A mood steps in and out in four steps of this long. */
const MOOD_STEP_MS = 100;
const MOOD_STEPS = 4;
/** The lights-out wave climbs in eight steps of this long. */
const LIGHTS_STEP_MS = 100;
const LIGHTS_STEPS = 8;
/** One flash is on this long, and flashes start no closer than this: under three a second (WCAG 2.3.1). */
const FLASH_ON_MS = 80;
const FLASH_SPACING_MS = 334;
/** How fast a weather burst sweeps the layers it names, in units a second. */
const WEATHER_SWEEP = 3;
const NEUTRAL: Tint = [1, 1, 1];
const NO_SWARM: ReadonlyMap<string, number> = new Map();
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

type Running = { readonly piece: SetPieceContent; readonly startedMs: number; readonly durationMs: number; kicked: boolean };

export class SetPieceDirector {
  private running: Running[] = [];
  private mood: { tint: Tint; mix: number } = { tint: NEUTRAL, mix: 0 };
  private lights: { share: number; invert: boolean; relit: number } = { share: 0, invert: false, relit: 0 };
  /** A staying mood (a sunrise's step), held after its piece ends; the next shift steps on from it. */
  private held: { tint: Tint } | undefined;

  constructor(private readonly deps: SetPieceDirectorDeps) {}

  /** Starts what the clock started, ends what it ended, and steps everything running. */
  update(nowMs: number, change: { readonly started?: ActiveGroup | undefined; readonly ended?: ActiveGroup | undefined }): { readonly swarm: ReadonlyMap<string, number> } {
    if (this.deps.off?.() === true) {
      if (this.running.length > 0 || this.held !== undefined) this.destroy();
      return { swarm: NO_SWARM };
    }
    if (change.ended !== undefined) this.endAll();
    if (change.started !== undefined) this.start(change.started, nowMs);
    if (this.running.length === 0) return { swarm: NO_SWARM };

    const reduced = this.deps.reduced();
    const swarm = new Map<string, number>();
    const done: Running[] = [];
    for (const run of this.running) {
      const age = nowMs - run.startedMs;
      if (age >= run.durationMs) {
        done.push(run);
        continue;
      }
      this.step(run, age, reduced, swarm);
    }
    for (const run of done) this.finish(run);
    this.running = this.running.filter((run) => !done.includes(run));
    return { swarm };
  }

  /**
   * Re-sends the mood and the lights to a rebuilt backdrop. At `low`, the mood
   * alone: every other piece still running (a flash, the weather, a sweep, the
   * lights) is finished now, so nothing but the palette shift draws on.
   */
  reapply(): void {
    if (this.deps.quality() === "low") {
      const dropped = this.running.filter((run) => run.piece.kind !== "paletteShift");
      for (const run of dropped) this.finish(run);
      this.running = this.running.filter((run) => run.piece.kind === "paletteShift");
    }
    const backdrop = this.deps.backdrop();
    if (backdrop === undefined) return;
    backdrop.setMood(this.mood.tint, this.mood.mix);
    if (this.deps.quality() !== "low") backdrop.setLightsOut(this.lights.share, this.lights.invert, this.lights.relit);
  }

  /** Ends everything at once, held moods too: a rewind, a new race, or the scene leaving. */
  destroy(): void {
    this.endAll();
    if (this.held !== undefined) {
      this.held = undefined;
      this.mood = { tint: NEUTRAL, mix: 0 };
      this.deps.backdrop()?.setMood(NEUTRAL, 0);
    }
  }

  private start(group: ActiveGroup, nowMs: number): void {
    this.endAll();
    const low = this.deps.quality() === "low";
    const reduced = this.deps.reduced();
    for (const piece of group.pieces) {
      if (low && piece.kind !== "paletteShift") continue;
      const holdMs = piece.holdMs * group.holdScale;
      const durationMs =
        piece.kind === "skyFlash" ? Math.max(holdMs, (piece.flashes - 1) * this.spacingOf(piece) + FLASH_ON_MS + 1) : holdMs;
      this.running.push({ piece, startedMs: nowMs, durationMs, kicked: false });
      if (piece.kind === "weatherBurst") this.deps.particles.burst({ particle: piece.particle, density: piece.density }, nowMs, reduced);
    }
    // Their first frame now, so a piece is on screen the frame it starts.
    for (const run of this.running) this.step(run, 0, reduced, new Map());
  }

  private step(run: Running, age: number, reduced: boolean, swarm: Map<string, number>): void {
    const piece = run.piece;
    const backdrop = this.deps.backdrop();
    switch (piece.kind) {
      case "paletteShift": {
        const target = MOOD_TINTS[piece.mood];
        const stepsIn = Math.min(Math.floor(age / MOOD_STEP_MS), MOOD_STEPS);
        if (this.held !== undefined) {
          // On from a held mood: the tint steps across, the mix stays full.
          const from = this.held.tint;
          const t = stepsIn / MOOD_STEPS;
          this.mood = { tint: [lerp(from[0], target[0], t), lerp(from[1], target[1], t), lerp(from[2], target[2], t)], mix: 1 };
          if (stepsIn === MOOD_STEPS) this.mood = { tint: target, mix: 1 };
        } else {
          const stepsOut = piece.stay === true ? MOOD_STEPS : Math.floor((run.durationMs - age) / MOOD_STEP_MS);
          this.mood = { tint: target, mix: Math.max(0, Math.min(stepsIn, stepsOut)) / MOOD_STEPS };
        }
        backdrop?.setMood(this.mood.tint, this.mood.mix);
        return;
      }
      case "lightsOut": {
        // The wave climbs in eight steps, holds, then the lights come back on
        // from the bottom up in eight more (the owner's ruling).
        const up = Math.min(Math.floor(age / LIGHTS_STEP_MS), LIGHTS_STEPS);
        const left = Math.floor((run.durationMs - age) / LIGHTS_STEP_MS);
        const back = Math.max(0, Math.min(LIGHTS_STEPS, LIGHTS_STEPS - left));
        this.lights = { share: up / LIGHTS_STEPS, invert: piece.invert === true, relit: back / LIGHTS_STEPS };
        backdrop?.setLightsOut(this.lights.share, this.lights.invert, this.lights.relit);
        return;
      }
      case "skyFlash": {
        if (reduced) {
          backdrop?.setSkyFlash(SKY_FLASH_TINTS[piece.tone], 0);
          return;
        }
        const spacing = this.spacingOf(piece);
        const index = Math.floor(age / spacing);
        const on = index < piece.flashes && age - index * spacing < FLASH_ON_MS;
        backdrop?.setSkyFlash(SKY_FLASH_TINTS[piece.tone], on ? 1 : 0);
        if (on && !run.kicked && piece.kick !== undefined && piece.kick > 0) {
          run.kicked = true;
          this.deps.kick(piece.kick);
        }
        return;
      }
      case "swarm":
        if (!reduced) for (const layer of piece.layers) swarm.set(layer, piece.speed);
        return;
      case "weatherBurst":
        if (!reduced) for (const layer of piece.layers ?? []) swarm.set(layer, WEATHER_SWEEP);
        return;
    }
  }

  private finish(run: Running): void {
    const backdrop = this.deps.backdrop();
    switch (run.piece.kind) {
      case "paletteShift":
        if (run.piece.stay === true) {
          // A sunrise's step holds: the mood stays, and the next shift steps on from it.
          this.held = { tint: MOOD_TINTS[run.piece.mood] };
          this.mood = { tint: MOOD_TINTS[run.piece.mood], mix: 1 };
          backdrop?.setMood(this.mood.tint, 1);
          return;
        }
        this.held = undefined;
        this.mood = { tint: NEUTRAL, mix: 0 };
        backdrop?.setMood(NEUTRAL, 0);
        return;
      case "lightsOut":
        this.lights = { share: 0, invert: false, relit: 0 };
        backdrop?.setLightsOut(0, false, 0);
        return;
      case "skyFlash":
        backdrop?.setSkyFlash(SKY_FLASH_TINTS[run.piece.tone], 0);
        return;
      case "weatherBurst":
        this.deps.particles.stop();
        return;
      case "swarm":
        return;
    }
  }

  private endAll(): void {
    for (const run of this.running) this.finish(run);
    this.running = [];
  }

  /** Flashes start no closer than a third of a second, spread over the hold. */
  private spacingOf(piece: Extract<SetPieceContent, { kind: "skyFlash" }>): number {
    return Math.max(FLASH_SPACING_MS, piece.holdMs / piece.flashes);
  }
}
