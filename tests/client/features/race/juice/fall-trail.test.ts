// @vitest-environment node
/**
 * The fast-fall's trail (A/V polish plan, G4): speed lines rising past the
 * view and afterimages of the racer, both as strong as the fall is fast.
 */

import { Container, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { FallTrail, type FallTrailFrame } from "../../../../../apps/client/src/features/race/juice/fall-trail";

const TUNING = { lines: 14, alpha: 0.5, afterimages: 3, afterimageAlpha: 0.35 };

function rig() {
  const screen = new Container();
  const world = new Container();
  const trail = new FallTrail(screen, world, { size: 32, feet: 20 }, 0xffffff);
  return { trail, screen, world };
}

const visible = (layer: Container) => layer.children[0]!.children.filter((child) => child.visible);

const at = (nowMs: number, share: number, y = 1000): FallTrailFrame => ({
  nowMs,
  share,
  racer: { x: 0, y, texture: Texture.WHITE, facingRight: true },
  field: { width: 960, top: 0, bottom: 540 },
  tuning: TUNING,
});

describe("the fast-fall's trail", () => {
  it("shows nothing at rest", () => {
    const { trail, screen, world } = rig();
    trail.update(at(0, 0));
    expect(visible(screen)).toHaveLength(0);
    expect(visible(world)).toHaveLength(0);
  });

  it("draws every speed line across the field, as strong as the fall", () => {
    const { trail, screen } = rig();
    trail.update(at(0, 0.5));
    const lines = visible(screen);
    expect(lines).toHaveLength(TUNING.lines);
    for (const line of lines) {
      expect(line.alpha).toBeCloseTo(TUNING.alpha * 0.5, 6);
      expect(line.x).toBeGreaterThanOrEqual(0);
      expect(line.x).toBeLessThanOrEqual(960);
    }
  });

  it("moves the lines up the field as time passes, the world rushing past a falling racer", () => {
    const { trail, screen } = rig();
    trail.update(at(0, 1));
    const before = visible(screen).map((line) => line.y);
    trail.update(at(16, 1));
    const after = visible(screen).map((line) => line.y);
    const moved = before.filter((y, index) => after[index]! < y);
    expect(moved.length).toBeGreaterThan(TUNING.lines / 2);
    for (const y of after) {
      expect(y).toBeGreaterThanOrEqual(0 - 200);
      expect(y).toBeLessThanOrEqual(540);
    }
  });

  it("trails afterimages of the racer where it was, each fainter than the last", () => {
    const { trail, world } = rig();
    for (let i = 0; i < 12; i += 1) trail.update(at(i * 16, 1, 1000 - i * 20));
    const ghosts = visible(world);
    expect(ghosts).toHaveLength(TUNING.afterimages);
    // Behind the racer: above it, since it is falling.
    for (const ghost of ghosts) expect(-ghost.y).toBeGreaterThan(1000 - 11 * 20 - 20 - 1);
    const alphas = ghosts.map((ghost) => ghost.alpha);
    expect([...alphas].sort((a, b) => b - a)).toEqual(alphas);
    expect(alphas[0]).toBeLessThanOrEqual(TUNING.afterimageAlpha);
  });

  it("clears at once when the fall ends, so a landing leaves no ghost", () => {
    const { trail, screen, world } = rig();
    for (let i = 0; i < 12; i += 1) trail.update(at(i * 16, 1, 1000 - i * 20));
    trail.update(at(200, 0));
    expect(visible(screen)).toHaveLength(0);
    expect(visible(world)).toHaveLength(0);
  });

  it("frees its sprites", () => {
    const { trail, screen, world } = rig();
    trail.update(at(0, 1));
    trail.destroy();
    expect(screen.children).toHaveLength(0);
    expect(world.children).toHaveLength(0);
  });
});
