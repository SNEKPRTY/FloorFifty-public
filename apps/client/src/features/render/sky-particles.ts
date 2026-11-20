/**
 * A set piece's weather (Wonder spec §6.4): a sheet of plain specks over the
 * scenery and behind the play layer, in logical screen units. Snow drifts
 * down, rain falls fast and slanted, bubbles rise. No stage needs weather art:
 * each speck is one tinted texel from a palette role, so the palette lock has
 * nothing to correct. While a burst lasts, a speck that leaves the view comes
 * back at the far edge; once it stops, each falls out and is gone.
 */

import { roleTint, type RoleName } from "@floor-fifty/asset-contract/roles";
import { Container, Sprite, type Texture } from "pixi.js";
import { LOGICAL_VIEWPORT } from "../../lib/constants";

export type WeatherSpec = { readonly particle: "snow" | "rain" | "bubble"; readonly density: number };

type Motion = { readonly vx: number; readonly vy: number; readonly size: number; readonly role: RoleName };
/** Each kind's speed in units a second, its side in units, and its palette role. */
const MOTION: Readonly<Record<WeatherSpec["particle"], Motion>> = {
  snow: { vx: 12, vy: 40, size: 2, role: "uiText" },
  rain: { vx: -120, vy: 420, size: 1, role: "cloud" },
  bubble: { vx: 8, vy: -60, size: 2, role: "dawnTeal" },
};
/** The golden ratio's fraction: an even, repeatable spread with no random source. */
const SPREAD_STEP = 0.618_033_988_75;
const SPREAD_STEP_Y = 0.754_877_666_25;

type Speck = { readonly sprite: Sprite; x: number; y: number; sway: number };

export class SkyParticles {
  readonly root = new Container({ label: "sky-particles" });
  private readonly specks: Speck[] = [];
  private motion: Motion = MOTION.snow;
  private active = false;
  private still = false;
  private spreadX = 0;
  private spreadY = 0;

  constructor(
    private readonly texture: Texture,
    private readonly limit: () => number,
    private readonly bounds: { readonly width: number; readonly height: number } = LOGICAL_VIEWPORT,
  ) {}

  /** Fills the view to `density` of the limit; half, and still, under reduced motion. */
  burst(spec: WeatherSpec, _nowMs: number, reduced: boolean): void {
    this.motion = MOTION[spec.particle];
    this.active = true;
    this.still = reduced;
    const wanted = Math.round(spec.density * this.limit() * (reduced ? 0.5 : 1));
    this.clear();
    for (let index = 0; index < wanted; index += 1) {
      const speck = this.take(index);
      this.spreadX = (this.spreadX + SPREAD_STEP) % 1;
      this.spreadY = (this.spreadY + SPREAD_STEP_Y) % 1;
      speck.x = this.spreadX * this.bounds.width;
      speck.y = this.spreadY * this.bounds.height;
      speck.sway = this.spreadX - 0.5;
      speck.sprite.width = this.motion.size;
      speck.sprite.height = this.motion.size;
      speck.sprite.tint = roleTint(this.motion.role);
      speck.sprite.visible = true;
      this.place(speck);
    }
  }

  /** Moves every speck by `dtSeconds`. */
  update(_nowMs: number, dtSeconds: number): void {
    if (this.still) return;
    for (const speck of this.specks) {
      if (!speck.sprite.visible) continue;
      speck.x += (this.motion.vx + speck.sway * this.motion.vx) * dtSeconds;
      speck.y += this.motion.vy * dtSeconds;
      const out = speck.y > this.bounds.height || speck.y < 0;
      if (out && !this.active) {
        speck.sprite.visible = false;
        continue;
      }
      if (out) speck.y = this.motion.vy > 0 ? speck.y - this.bounds.height : speck.y + this.bounds.height;
      speck.x = ((speck.x % this.bounds.width) + this.bounds.width) % this.bounds.width;
      this.place(speck);
    }
  }

  /** Ends the burst: each speck falls out and is gone. */
  stop(): void {
    this.active = false;
    if (this.still) this.clear();
  }

  get live(): number {
    return this.specks.filter((speck) => speck.sprite.visible).length;
  }

  clear(): void {
    for (const speck of this.specks) speck.sprite.visible = false;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.specks.length = 0;
  }

  private take(index: number): Speck {
    const existing = this.specks[index];
    if (existing !== undefined) return existing;
    const sprite = new Sprite(this.texture);
    sprite.anchor.set(0.5);
    sprite.visible = false;
    this.root.addChild(sprite);
    const speck: Speck = { sprite, x: 0, y: 0, sway: 0 };
    this.specks.push(speck);
    return speck;
  }

  private place(speck: Speck): void {
    speck.sprite.position.set(Math.round(speck.x), Math.round(speck.y));
  }
}
