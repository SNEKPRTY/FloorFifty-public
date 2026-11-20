import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { SkyParticles } from "../../../../apps/client/src/features/render/sky-particles";

const shown = (sky: SkyParticles) => sky.root.children.filter((child) => child.visible);

describe("SkyParticles (Wonder spec §6.4)", () => {
  it("bursts to its density of the limit, inside the limit, on whole units", () => {
    const sky = new SkyParticles(Texture.WHITE, () => 100);
    sky.burst({ particle: "snow", density: 0.6 }, 0, false);
    expect(sky.live).toBe(60);
    sky.update(500, 0.5);
    for (const child of shown(sky)) {
      expect(Number.isInteger(child.x)).toBe(true);
      expect(Number.isInteger(child.y)).toBe(true);
    }
    expect(sky.live).toBeLessThanOrEqual(100);
  });

  it("keeps falling while it lasts, and falls out once stopped", () => {
    const sky = new SkyParticles(Texture.WHITE, () => 40);
    sky.burst({ particle: "rain", density: 1 }, 0, false);
    for (let i = 1; i <= 120; i += 1) sky.update(i * 16, 1 / 60);
    expect(sky.live).toBe(40);
    sky.stop();
    for (let i = 121; i <= 600; i += 1) sky.update(i * 16, 1 / 60);
    expect(sky.live).toBe(0);
  });

  it("moves each kind its own way: snow drifts down slowly, rain falls fast and slanted, bubbles rise", () => {
    const travel = (particle: "snow" | "rain" | "bubble") => {
      const sky = new SkyParticles(Texture.WHITE, () => 1);
      sky.burst({ particle, density: 1 }, 0, false);
      const before = { x: shown(sky)[0]!.x, y: shown(sky)[0]!.y };
      sky.update(100, 0.1);
      const after = shown(sky)[0]!;
      return { dx: after.x - before.x, dy: after.y - before.y };
    };
    const snow = travel("snow");
    const rain = travel("rain");
    const bubble = travel("bubble");
    expect(snow.dy).toBeGreaterThan(0);
    expect(rain.dy).toBeGreaterThan(snow.dy * 3);
    expect(Math.abs(rain.dx)).toBeGreaterThan(0);
    expect(bubble.dy).toBeLessThan(0);
  });

  it("holds half the density, still, under reduced motion", () => {
    const sky = new SkyParticles(Texture.WHITE, () => 100);
    sky.burst({ particle: "snow", density: 0.6 }, 0, true);
    expect(sky.live).toBe(30);
    const before = shown(sky).map((child) => child.y);
    sky.update(500, 0.5);
    expect(shown(sky).map((child) => child.y)).toEqual(before);
  });

  it("clears and destroys", () => {
    const sky = new SkyParticles(Texture.WHITE, () => 10);
    sky.burst({ particle: "snow", density: 1 }, 0, false);
    sky.clear();
    expect(sky.live).toBe(0);
    sky.destroy();
    expect(sky.root.destroyed).toBe(true);
  });
});
