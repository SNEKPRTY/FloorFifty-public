/**
 * Parabolic bounce trajectory and apex guide.
 *
 * Provides visual assistance for jump planning by calculating the ballistic
 * arc from the racer's current velocity and gravity, projecting an apex
 * crosshair notch and equidistant trajectory dots along the ascent.
 */

import { Container, Graphics } from "pixi.js";
import { wrapSymmetric } from "@floor-fifty/shared/common/math";
import { LOGICAL_VIEWPORT } from "../../lib/constants";

const COURSE_HALF_WIDTH = LOGICAL_VIEWPORT.width / 2;
const MIN_ASCENT_VY = 30;
const POINT_COUNT = 6;
const NOTCH_WIDTH = 16;
const NOTCH_HALF = NOTCH_WIDTH / 2;
const DOT_RADIUS = 1.5;
const GUIDE_COLOR = 0xffffff;
const GUIDE_ALPHA = 0.45;

export type ApexProjection = {
  readonly timeToApex: number;
  readonly apexX: number;
  readonly apexY: number;
  readonly dx: number;
  readonly dy: number;
  readonly points: readonly { readonly x: number; readonly y: number }[];
};

export type TrajectoryGuideOptions = {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly gravity: number;
  readonly visible: boolean;
};

/**
 * Calculates apex projection and parabolic arc points.
 *
 * Returns `undefined` when racer is descending or near rest (vy <= 30).
 */
export function computeApex(
  x: number,
  y: number,
  vx: number,
  vy: number,
  gravity: number,
  courseHalfWidth: number = COURSE_HALF_WIDTH,
  pointCount: number = POINT_COUNT,
): ApexProjection | undefined {
  if (vy <= MIN_ASCENT_VY) return undefined;

  // Floor Fifty convention: gravity is negative (e.g. -275), vy is positive upwards.
  const g = gravity < 0 ? gravity : -gravity;
  const timeToApex = -vy / g;
  const dy = -(vy * vy) / (2 * g);
  const dx = vx * timeToApex;
  const apexX = wrapSymmetric(x + dx, courseHalfWidth);
  const apexY = y + dy;

  const points: { x: number; y: number }[] = [];
  for (let step = 1; step <= pointCount; step += 1) {
    const fraction = step / (pointCount + 1);
    const t = fraction * timeToApex;
    const ptX = wrapSymmetric(x + vx * t, courseHalfWidth);
    const ptY = y + vy * t + 0.5 * g * t * t;
    points.push({ x: ptX, y: ptY });
  }

  return { timeToApex, apexX, apexY, dx, dy, points };
}

export class TrajectoryGuide {
  readonly root = new Container({ label: "trajectory-guide" });
  private readonly graphics = new Graphics();
  private isDrawn = false;

  constructor() {
    this.root.addChild(this.graphics);
    this.root.alpha = GUIDE_ALPHA;
  }

  get active(): boolean {
    return this.isDrawn;
  }

  update(options: TrajectoryGuideOptions): void {
    if (!options.visible || options.vy <= MIN_ASCENT_VY) {
      this.clear();
      return;
    }

    const projection = computeApex(
      options.x,
      options.y,
      options.vx,
      options.vy,
      options.gravity,
      COURSE_HALF_WIDTH,
      POINT_COUNT,
    );


    if (projection === undefined) {
      this.clear();
      return;
    }

    this.render(projection);
  }

  clear(): void {
    if (this.isDrawn) {
      this.graphics.clear();
      this.isDrawn = false;
    }
  }

  private render(projection: ApexProjection): void {
    this.graphics.clear();

    // Draw dots along the parabolic arc: coordinates are in world space (x, -y)
    for (let i = 0; i < projection.points.length; i += 1) {
      const pt = projection.points[i]!;
      const alpha = 0.3 + 0.5 * (1 - i / projection.points.length);
      this.graphics.circle(Math.round(pt.x), Math.round(-pt.y), DOT_RADIUS);
      this.graphics.fill({ color: GUIDE_COLOR, alpha });
    }

    // Draw apex crosshair notch (width 16px) at (apexX, -apexY)
    const ax = Math.round(projection.apexX);
    const ay = Math.round(-projection.apexY);
    this.drawNotch(ax, ay);

    // If near the seam, draw wrapped clone so notch wraps seamlessly
    if (ax + NOTCH_HALF > COURSE_HALF_WIDTH) {
      this.drawNotch(ax - LOGICAL_VIEWPORT.width, ay);
    } else if (ax - NOTCH_HALF < -COURSE_HALF_WIDTH) {
      this.drawNotch(ax + LOGICAL_VIEWPORT.width, ay);
    }


    this.isDrawn = true;
  }

  private drawNotch(x: number, y: number): void {
    this.graphics.rect(x - NOTCH_HALF, y - 1, NOTCH_WIDTH, 2);
    this.graphics.fill({ color: GUIDE_COLOR, alpha: 0.8 });
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
