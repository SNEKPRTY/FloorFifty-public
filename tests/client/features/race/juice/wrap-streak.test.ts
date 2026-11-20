// @vitest-environment node
import { Container, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { WrapStreak } from "../../../../../apps/client/src/features/race/juice/wrap-streak";

const shown = (layer: Container) => layer.children.filter((child) => child.visible);
const make = () => {
  const layer = new Container();
  return { layer, streak: new WrapStreak(layer, { size: 32, feet: 20 }) };
};

describe("WrapStreak", () => {
  it("leaves one ghost at the seam left and one at the seam entered", () => {
    const { layer, streak } = make();
    streak.show({ texture: Texture.WHITE, fromX: 470, x: -470, y: 100, facingRight: true }, 3);
    expect(shown(layer).map((ghost) => ghost.x).sort((a, b) => a - b)).toEqual([-470, 470]);
    expect(shown(layer).every((ghost) => ghost.y === -100 + 20)).toBe(true);
  });

  it("fades over its frames, in steps, then is gone", () => {
    const { layer, streak } = make();
    streak.show({ texture: Texture.WHITE, fromX: 470, x: -470, y: 100, facingRight: true }, 3);
    const alphas = [shown(layer)[0]!.alpha];
    streak.update();
    alphas.push(shown(layer)[0]!.alpha);
    streak.update();
    alphas.push(shown(layer)[0]!.alpha);
    expect(alphas[1]).toBeLessThan(alphas[0]!);
    expect(alphas[2]).toBeLessThan(alphas[1]!);
    streak.update();
    expect(shown(layer)).toHaveLength(0);
  });

  it("mirrors a racer facing left", () => {
    const { layer, streak } = make();
    streak.show({ texture: Texture.WHITE, fromX: 470, x: -470, y: 0, facingRight: false }, 3);
    expect(shown(layer).every((ghost) => ghost.scale.x < 0)).toBe(true);
  });

  it("does not keep a reused ghost's old facing", () => {
    const { layer, streak } = make();
    streak.show({ texture: Texture.WHITE, fromX: 470, x: -470, y: 0, facingRight: false }, 1);
    streak.update();
    streak.show({ texture: Texture.WHITE, fromX: 470, x: -470, y: 0, facingRight: true }, 1);
    expect(shown(layer).every((ghost) => ghost.scale.x > 0)).toBe(true);
  });

  it("never holds more than eight ghosts", () => {
    const { layer, streak } = make();
    for (let index = 0; index < 10; index += 1) {
      streak.show({ texture: Texture.WHITE, fromX: 470, x: -470, y: index, facingRight: true }, 3);
    }
    expect(layer.children.length).toBeLessThanOrEqual(8);
    expect(streak.live).toBeLessThanOrEqual(8);
  });

  it("shows nothing for zero frames, and destroy empties the layer", () => {
    const { layer, streak } = make();
    streak.show({ texture: Texture.WHITE, fromX: 470, x: -470, y: 0, facingRight: true }, 0);
    expect(shown(layer)).toHaveLength(0);
    streak.show({ texture: Texture.WHITE, fromX: 470, x: -470, y: 0, facingRight: true }, 3);
    streak.destroy();
    expect(layer.children).toHaveLength(0);
  });
});
