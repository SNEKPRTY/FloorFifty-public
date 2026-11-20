/**
 * Pooled dust: puffs, rings and bursts (polish spec §4.1).
 *
 * One container in the world layer, so it inherits the camera, the mask and
 * the palette lock, and every particle is tinted from a palette role. Sprites
 * are made up to the limit and then reused; past the limit, the oldest live
 * particle is recycled first. Positions land on whole logical units, and a
 * particle's flight steps rather than glides, as the chrome's motion does.
 */

import { Container, Sprite, type Texture } from "pixi.js";
import type { DustSpec } from "@floor-fifty/shared/content/game-content";
import { wrapSymmetric } from "@floor-fifty/shared/common/math";
import { LOGICAL_VIEWPORT } from "../../../lib/constants";

/** Steps a particle's flight takes from where it is thrown to where it fades. */
const FLIGHT_STEPS = 6;
/** A particle's side, in logical units. */
const SIZE = 2;
/** A spark's side: smaller than the dust it flies with (Wonder spec §4.3). */
const SPARK_SIZE = 1;
/** How much farther a spark flies than the dust, and how much of the dust's life it lives. */
const SPARK_REACH = 1.6;
const SPARK_LIFE = 0.6;
/** The golden ratio's fraction: an even, repeatable spread with no random source. */
const SPREAD_STEP = 0.618_033_988_75;
const COURSE_WIDTH = LOGICAL_VIEWPORT.width;
const WALL_SPARK_TINTS = [0xfb6b1d, 0xf79617, 0xf9c22b, 0xfbff86];

type Particle = {
  readonly sprite: Sprite;
  bornMs: number;
  lifeMs: number;
  /** Where it was thrown, in the simulation's y-up space. */
  x: number;
  y: number;
  /** Its full flight, in the world's y-down space. */
  dx: number;
  dy: number;
  still: boolean;
};

export class DustPool {
  readonly root = new Container({ label: "juice-dust" });
  private readonly particles: Particle[] = [];
  private spread = 0;

  constructor(
    private readonly texture: Texture,
    private readonly limit: () => number,
  ) {}

  /**
   * Throws `spec.count` particles from (`x`, `y`), in simulation units, and
   * `spec.sparks` sparks with them: smaller, farther, shorter-lived, in
   * `sparkTint`. A still throw (reduced motion) is placed once, part way out,
   * and never moves.
   */
  emit(
    spec: DustSpec,
    x: number,
    y: number,
    tints: readonly number[],
    nowMs: number,
    still: boolean,
    sparkTint?: number,
  ): void {
    const ring = spec.ring === true;
    for (let index = 0; index < spec.count; index += 1) {
      // A puff fans upward across the top half; a ring goes evenly round.
      const angle = ring ? (index / spec.count) * Math.PI * 2 : Math.PI * (0.15 + 0.7 * this.nextSpread());
      const reach = spec.spread * (ring ? 1 : 0.5 + 0.5 * this.nextSpread());
      this.throw(x, y, angle, reach, spec.rise, spec.lifeMs, SIZE, tints[index % tints.length] ?? 0xffffff, nowMs, still);
    }
    const sparks = spec.sparks ?? 0;
    for (let index = 0; index < sparks; index += 1) {
      // Sparks go evenly round, whatever the dust does: a glint, not a puff.
      const angle = ((index + 0.5) / sparks) * Math.PI * 2;
      const reach = spec.spread * SPARK_REACH * (0.75 + 0.25 * this.nextSpread());
      const tint = sparkTint ?? tints[0] ?? 0xffffff;
      this.throw(x, y, angle, reach, spec.rise, spec.lifeMs * SPARK_LIFE, SPARK_SIZE, tint, nowMs, still);
    }
  }

  /**
   * Spawns 4–6 high-speed vertical friction sparks trailing down a platform face on wall contact.
   */
  emitWallSparks(
    x: number,
    y: number,
    isFacingLeft: boolean,
    nowMs = 0,
    still = false,
  ): void {
    const sparkCount = 5;
    const wrappedX = wrapSymmetric(x, COURSE_WIDTH / 2);
    for (let index = 0; index < sparkCount; index += 1) {
      const particle = this.take(nowMs);
      particle.bornMs = nowMs;
      particle.lifeMs = 140 + 60 * this.nextSpread();
      particle.x = wrappedX;
      particle.y = y;
      const spraySign = isFacingLeft ? -1 : 1;
      particle.dx = spraySign * (2 + 4 * this.nextSpread());
      // dy in world coordinates is positive downward (Pixi y is negated simulation y)
      particle.dy = 16 + 20 * this.nextSpread();
      particle.still = still;
      particle.sprite.width = SPARK_SIZE;
      particle.sprite.height = SPARK_SIZE * 2;
      particle.sprite.tint = WALL_SPARK_TINTS[index % WALL_SPARK_TINTS.length] ?? 0xf9c22b;
      particle.sprite.visible = true;
      this.place(particle, still ? 0.5 : 0);
    }
  }

  private throw(
    x: number,
    y: number,
    angle: number,
    reach: number,
    rise: number,
    lifeMs: number,
    size: number,
    tint: number,
    nowMs: number,
    still: boolean,
  ): void {
    const particle = this.take(nowMs);
    particle.bornMs = nowMs;
    particle.lifeMs = lifeMs;
    particle.x = wrapSymmetric(x, COURSE_WIDTH / 2);
    particle.y = y;
    particle.dx = Math.cos(angle) * reach;
    particle.dy = -rise - Math.abs(Math.sin(angle)) * reach * 0.25;
    particle.still = still;
    particle.sprite.width = size;
    particle.sprite.height = size;
    particle.sprite.tint = tint;
    particle.sprite.visible = true;
    this.place(particle, still ? 0.5 : 0);
  }

  /** Steps every live particle to `nowMs`, and returns the spent ones to the pool. */
  update(nowMs: number): void {
    for (const particle of this.particles) {
      if (!particle.sprite.visible) continue;
      const age = nowMs - particle.bornMs;
      if (age >= particle.lifeMs) {
        particle.sprite.visible = false;
        continue;
      }
      if (!particle.still) this.place(particle, Math.floor((age / particle.lifeMs) * FLIGHT_STEPS) / FLIGHT_STEPS);
    }
  }

  /** Particles on screen now. */
  get live(): number {
    let count = 0;
    for (const particle of this.particles) if (particle.sprite.visible) count += 1;
    return count;
  }

  /** Returns every particle to the pool at once. */
  clear(): void {
    for (const particle of this.particles) particle.sprite.visible = false;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.particles.length = 0;
  }

  private take(nowMs: number): Particle {
    const free = this.particles.find((particle) => !particle.sprite.visible);
    if (free !== undefined) return free;
    if (this.particles.length < this.limit()) {
      const sprite = new Sprite(this.texture);
      sprite.width = SIZE;
      sprite.height = SIZE;
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.root.addChild(sprite);
      const particle: Particle = { sprite, bornMs: nowMs, lifeMs: 0, x: 0, y: 0, dx: 0, dy: 0, still: false };
      this.particles.push(particle);
      return particle;
    }
    return this.particles.reduce((oldest, particle) => (particle.bornMs < oldest.bornMs ? particle : oldest));
  }

  private place(particle: Particle, progress: number): void {
    const px = wrapSymmetric(particle.x + particle.dx * progress, COURSE_WIDTH / 2);
    particle.sprite.position.set(
      Math.round(px),
      Math.round(-particle.y + particle.dy * progress),
    );
  }

  private nextSpread(): number {
    this.spread = (this.spread + SPREAD_STEP) % 1;
    return this.spread;
  }
}
