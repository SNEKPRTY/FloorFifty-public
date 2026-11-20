import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { roleTint } from "@floor-fifty/asset-contract/roles";
import { Container, type Text } from "pixi.js";
import { afterEach, describe, expect, it } from "vitest";
import { applyLocale, installLocaleStrategy } from "../../../../../apps/client/src/features/i18n/strategy";
import { SettingsStore } from "../../../../../apps/client/src/features/profile/store/settings.svelte";
import type { Word } from "../../../../../apps/client/src/features/race/juice/word-director";
import { WordPool } from "../../../../../apps/client/src/features/race/juice/word-pool";
import { GENERATED_CONTENT } from "../../../../../apps/server/src/content/generated-content";
import { memoryStorage } from "../../../support/fakes/settings";

const JUICE = GENERATED_CONTENT.content.juice;
const WORDS = JUICE.words;
const DEG = Math.PI / 180;
const FACES_READY = { check: () => true };

let teardown: Array<() => void> = [];
afterEach(() => {
  teardown.forEach((undo) => undo());
  teardown = [];
});

const word = (kind: Word["kind"], playerId: string | undefined, local: boolean, extra: Partial<Word> = {}): Word => ({
  kind,
  key: `${playerId ?? "beat"}:${kind}`,
  group: "skill",
  playerId: playerId as PlayerId | undefined,
  local,
  bornMs: 0,
  ...extra,
});

/** A word as the tests read it: the whole word's text, its first letter's style, and the word's own transform. */
type WordView = {
  readonly text: string;
  readonly style: Text["style"];
  readonly resolution: number;
  readonly scale: Container["scale"];
  readonly position: Container["position"];
  readonly alpha: number;
  readonly skew: Container["skew"];
  readonly letters: Text[];
};
function view(root: Container): WordView {
  const letters = root.children as Text[];
  return {
    get text() {
      return root.label;
    },
    get style() {
      return letters[0]!.style;
    },
    get resolution() {
      return letters[0]!.resolution;
    },
    scale: root.scale,
    position: root.position,
    get alpha() {
      return root.alpha;
    },
    skew: root.skew,
    letters,
  };
}

function pool(fonts: { check: (face: string) => boolean } = FACES_READY) {
  const layers = { world: new Container(), beat: new Container() };
  const words = new WordPool(layers, () => WORDS, () => JUICE.springs.word, fonts);
  const shown = (layer: Container) => (layer.children[0]?.children ?? []).filter((child) => child.visible).map((root) => view(root as Container));
  return { layers, words, world: () => shown(layers.world), beats: () => shown(layers.beat) };
}

const at = (x: number, y: number) => () => ({ x, y });

describe("WordPool (Wonder spec §5.1)", () => {
  it("reuses unchanged glyph styles when a pooled slam appears again", () => {
    const { words, world } = pool();
    words.show(word("slam", "p1", true), 0xff0000);
    const letters = world()[0]!.letters;
    let updates = 0;
    for (const letter of letters) letter.style.on("update", () => { updates += 1; });
    words.clear();
    words.show(word("slam", "p1", true, { key: "second-slam", bornMs: 100 }), 0xff0000);
    expect(updates).toBe(0);
    expect(world()[0]!.text).toBe("SLAM!");
    words.destroy();
  });

  it.each([
    { color: 0x123456, width: WORDS.outline, join: "round" as const },
    { color: roleTint("outline"), width: 999, join: "round" as const },
    { color: roleTint("outline"), width: WORDS.outline, join: "bevel" as const },
  ])("restores the required outline when a pooled stroke differs: %j", (stroke) => {
    const { words, world } = pool();
    words.show(word("slam", "p1", true), 0xff0000);
    const letters = world()[0]!.letters;
    for (const letter of letters) letter.style.stroke = stroke;
    words.clear();
    words.show(word("slam", "p1", true, { key: "second-slam" }), 0xff0000);
    for (const letter of letters) {
      expect(letter.style.stroke).toMatchObject({ color: roleTint("outline"), width: WORDS.outline, join: "round" });
    }
    words.destroy();
  });

  it("draws a local word above its racer in the seat colour, outlined, knocked to the pop scale", () => {
    const { words, world } = pool();
    const slam = word("slam", "p1", true);
    words.show(slam, 0xff0000);
    words.update(0, 0, false, at(10, 100), new Set([slam.key]));
    const text = world()[0]!;
    expect(text.text).toBe("SLAM!");
    expect(text.style.fill).toBe(0xff0000);
    expect(text.style.stroke).toMatchObject({ color: roleTint("outline") });
    expect(text.scale.y).toBe(Math.round(WORDS.popScale * 32) / 32); // drawn on 1/32 steps
    expect(text.position.y).toBeLessThan(-100); // above the head, in the world's y-down space
    expect(text.position.x).toBe(10);
  });

  it("settles the pop through an overshoot and rises, drawn on whole units", () => {
    const { words, world } = pool();
    const slam = word("slam", "p1", true);
    words.show(slam, 0xffffff);
    const scales: number[] = [];
    const ys: number[] = [];
    for (let i = 1; i <= 40; i += 1) {
      words.update(1 / 60, i * 16, false, at(0, 0), new Set([slam.key]));
      const text = world()[0];
      if (text === undefined) break;
      scales.push(text.scale.y);
      ys.push(text.position.y);
      expect(Number.isInteger(text.position.y)).toBe(true);
    }
    expect(Math.min(...scales)).toBeLessThan(1);
    expect(Math.min(...ys)).toBeLessThan(ys[0]!); // it rose
  });

  it("draws a rival's word smaller and fainter, and a beat in the middle at beat size", () => {
    const { words, world, beats } = pool();
    const rival = word("slam", "p2", false);
    const lap = word("lap", undefined, true, { group: "beat", lap: 2 });
    words.show(rival, 0xffffff);
    words.show(lap, roleTint("finishBurst"));
    words.update(0, 0, false, at(0, 0), new Set([rival.key, lap.key]));
    expect(world()[0]!.alpha).toBeCloseTo(WORDS.rivalAlpha, 6);
    expect(world()[0]!.style.fontSize).toBeCloseTo(WORDS.size * WORDS.rivalScale, 6);
    expect(beats()[0]!.style.fontSize).toBe(WORDS.beatSize);
    expect(beats()[0]!.text).toBe("LAP 2!");
  });

  it("slants Latin and leaves CJK upright", async () => {
    const { words, world } = pool();
    const slam = word("slam", "p1", true);
    words.show(slam, 0xffffff);
    words.update(0, 0, false, at(0, 0), new Set([slam.key]));
    expect(world()[0]!.skew.x).toBeCloseTo(-WORDS.skewDeg * DEG, 6);

    const settings = new SettingsStore(memoryStorage());
    teardown.push(installLocaleStrategy(settings, () => ["en-US"]));
    await applyLocale("ja");
    const japanese = pool();
    japanese.words.show(slam, 0xffffff);
    japanese.words.update(0, 0, false, at(0, 0), new Set([slam.key]));
    expect(japanese.world()[0]!.skew.x).toBe(0);
    expect(japanese.world()[0]!.style.fontWeight).toBe("600");
  });

  it("fades in place under reduced motion: no pop, no rise", () => {
    const { words, world } = pool();
    const slam = word("slam", "p1", true);
    words.show(slam, 0xffffff, true);
    expect(world()[0]!.alpha).toBe(0); // fades in from nothing, never a one-frame blink
    words.update(1 / 60, 16, true, at(0, 0), new Set([slam.key]));
    const first = world()[0]!;
    expect(first.scale.y).toBe(1);
    expect(first.alpha).toBeGreaterThan(0);
    expect(first.alpha).toBeLessThan(1);
    const y = first.position.y;
    words.update(1 / 60, 300, true, at(0, 0), new Set([slam.key]));
    expect(world()[0]!.position.y).toBe(y);
  });

  it("hides a word the director no longer holds, and one past its life", () => {
    const { words, world } = pool();
    const slam = word("slam", "p1", true);
    words.show(slam, 0xffffff);
    words.update(0, 0, false, at(0, 0), new Set());
    expect(world()).toHaveLength(0);
    const again = word("slam", "p1", true, { key: "p1:slam:2", bornMs: 0 });
    words.show(again, 0xffffff);
    words.update(0, WORDS.lifeMs + 1, false, at(0, 0), new Set([again.key]));
    expect(world()).toHaveLength(0);
  });

  it("re-pops a word shown again under the same key, with its new text", () => {
    const { words, world } = pool();
    const streak = word("streak", "p1", true, { key: "p1:streak", count: 3 });
    words.show(streak, 0xffffff);
    words.update(0.5, 500, false, at(0, 0), new Set([streak.key]));
    words.show({ ...streak, count: 4, bornMs: 500 }, 0xffffff);
    words.update(0, 500, false, at(0, 0), new Set([streak.key]));
    expect(world()).toHaveLength(1);
    expect(world()[0]!.text).toBe("×4");
    expect(world()[0]!.scale.y).toBe(Math.round(WORDS.popScale * 32) / 32);
  });

  it("reuses its texts: a hundred words never make more than it needs", () => {
    const { layers, words } = pool();
    for (let i = 0; i < 100; i += 1) {
      const each = word("slam", "p2", false, { key: `p2:slam:${i}`, bornMs: i * 1000 });
      words.show(each, 0xffffff);
      words.update(1, i * 1000, false, at(0, 0), new Set([each.key]));
    }
    expect(layers.world.children[0]!.children.length).toBeLessThanOrEqual(2);
  });

  it("draws no word before its face has loaded, rather than a fallback serif", () => {
    const { words, world } = pool({ check: () => false });
    const slam = word("slam", "p1", true);
    words.show(slam, 0xffffff);
    words.update(0, 0, false, at(0, 0), new Set([slam.key]));
    expect(world()).toHaveLength(0);
  });

  it("draws no CJK word before its Noto face has loaded either", async () => {
    const settings = new SettingsStore(memoryStorage());
    teardown.push(installLocaleStrategy(settings, () => ["en-US"]));
    await applyLocale("ja");
    const checked: string[] = [];
    const { words, world } = pool({ check: (face: string) => (checked.push(face), false) });
    const slam = word("slam", "p1", true);
    words.show(slam, 0xffffff);
    words.update(0, 0, false, at(0, 0), new Set([slam.key]));
    expect(world()).toHaveLength(0);
    expect(checked.some((face) => face.includes("FF Pixel JP"))).toBe(true);
  });

  it("keeps a re-popped word's fade under reduced motion: the text changes, it never blinks (audit)", () => {
    const { words, world } = pool();
    const streak = word("streak", "p1", true, { key: "p1:streak", count: 3 });
    words.show(streak, 0xffffff, true);
    words.update(0.3, 300, true, at(0, 0), new Set([streak.key]));
    words.show({ ...streak, count: 4, bornMs: 300 }, 0xffffff, true);
    words.update(1 / 60, 316, true, at(0, 0), new Set([streak.key]));
    expect(world()[0]!.text).toBe("×4");
    expect(world()[0]!.alpha).toBe(1);
  });

  it("draws at resolution 1, as the world it sits in, and scales its outline with its size (audit)", () => {
    const { words, world, beats } = pool();
    const slam = word("slam", "p1", true);
    const lap = word("lap", undefined, true, { group: "beat", lap: 2 });
    words.show(slam, 0xffffff);
    words.show(lap, 0xffffff);
    words.update(0, 0, false, at(0, 0), new Set([slam.key, lap.key]));
    expect(world()[0]!.resolution).toBe(1);
    expect((world()[0]!.style.stroke as { width: number }).width).toBeCloseTo(WORDS.outline, 6);
    expect((beats()[0]!.style.stroke as { width: number }).width).toBeCloseTo((WORDS.outline * WORDS.beatSize) / WORDS.size, 6);
  });

  it("pops its letters in one after another, then stands them all at full size (owner)", () => {
    const { words, world } = pool();
    const slam = word("slam", "p1", true);
    words.show(slam, 0xffffff);
    words.update(1 / 60, 10, false, at(0, 0), new Set([slam.key]));
    const early = world()[0]!.letters.slice(0, 5);
    expect(early).toHaveLength(5);
    expect(early[0]!.visible).toBe(true);
    expect(early[4]!.visible).toBe(false);
    words.update(1 / 60, 300, false, at(0, 0), new Set([slam.key]));
    for (const letter of world()[0]!.letters.slice(0, 5)) {
      expect(letter.visible).toBe(true);
      expect(letter.scale.y).toBe(1);
      expect(letter.position.y).toBe(0);
    }
  });

  it("pops its letters out in its last moments, and lives exactly as long (owner)", () => {
    const { words, world } = pool();
    const slam = word("slam", "p1", true);
    words.show(slam, 0xffffff);
    words.update(1 / 60, WORDS.lifeMs - 10, false, at(0, 0), new Set([slam.key]));
    expect(world()[0]!.letters[0]!.scale.y).toBeLessThan(1);
    words.update(1 / 60, WORDS.lifeMs + 1, false, at(0, 0), new Set([slam.key]));
    expect(world()).toHaveLength(0);
  });

  it("stands every letter at once under reduced motion", () => {
    const { words, world } = pool();
    const slam = word("slam", "p1", true);
    words.show(slam, 0xffffff, true);
    words.update(1 / 60, 1, true, at(0, 0), new Set([slam.key]));
    for (const letter of world()[0]!.letters.slice(0, 5)) {
      expect(letter.visible).toBe(true);
      expect(letter.scale.y).toBe(1);
    }
  });

  it("re-pops a streak's letters when its count changes", () => {
    const { words, world } = pool();
    const streak = word("streak", "p1", true, { key: "p1:streak", count: 3 });
    words.show(streak, 0xffffff);
    words.update(0.4, 400, false, at(0, 0), new Set([streak.key]));
    words.show({ ...streak, count: 4, bornMs: 400 }, 0xffffff);
    words.update(1 / 60, 405, false, at(0, 0), new Set([streak.key]));
    expect(world()[0]!.letters[1]!.visible).toBe(false); // the second letter waits its turn again
  });
});

describe("WordPool's room (owner: words overlapped, and the HUD covered them)", () => {
  /** A word's box in its layer, y-down: letters are anchored at the bottom centre. */
  const box = (text: WordView) => {
    const letters = text.letters.filter((letter) => letter.visible);
    const height = Math.max(...letters.map((letter) => letter.height)) * text.scale.y;
    const width = letters.reduce((sum, letter) => sum + letter.width, 0) * text.scale.x;
    return { left: text.position.x - width / 2, right: text.position.x + width / 2, top: text.position.y - height, bottom: text.position.y };
  };
  const apartY = (a: { top: number; bottom: number }, b: { top: number; bottom: number }) => a.bottom <= b.top || b.bottom <= a.top;
  const apart = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => apartY(a, b) || a.right <= b.left || b.right <= a.left;
  /** The world drawn 1:1 in the field, with its origin 300 units down: a racer at y 0 stands at field y 300. */
  const ROOM = { toField: { x: 480, y: 300, scale: 1 }, beatAt: { x: 480, y: 184 }, ceiling: 0, width: 960 };
  const inField = (text: WordView) => {
    const b = box(text);
    return { left: ROOM.toField.x + b.left, right: ROOM.toField.x + b.right, top: ROOM.toField.y + b.top, bottom: ROOM.toField.y + b.bottom };
  };
  const inBeat = (text: WordView) => {
    const b = box(text);
    return { left: ROOM.beatAt.x + b.left, right: ROOM.beatAt.x + b.right, top: ROOM.beatAt.y + b.top, bottom: ROOM.beatAt.y + b.bottom };
  };

  it("stacks a racer's two words rather than drawing one over the other", () => {
    const { words, world } = pool();
    const slam = word("slam", "p1", true);
    const streak = word("streak", "p1", true, { key: "p1:streak", count: 8, bornMs: 16 });
    words.show(slam, 0xffffff);
    words.show(streak, 0xffffff);
    for (let i = 1; i <= 30; i += 1) {
      words.update(1 / 60, 16 * i, false, at(0, 0), new Set([slam.key, streak.key]), ROOM);
      const [a, b] = world();
      expect(apartY(box(a!), box(b!))).toBe(true);
    }
  });

  it("staggers a stack: each older word stands further right than the one under it (owner)", () => {
    const { words, world } = pool();
    const slam = word("slam", "p1", true);
    const streak = word("streak", "p1", true, { key: "p1:streak", count: 8, bornMs: 16 });
    words.show(slam, 0xffffff);
    words.show(streak, 0xffffff);
    for (let i = 1; i <= 40; i += 1) words.update(1 / 60, 16 * i, false, at(0, 0), new Set([slam.key, streak.key]), ROOM);
    const [older, newer] = world();
    expect(older!.position.y).toBeLessThan(newer!.position.y);
    expect(older!.position.x - newer!.position.x).toBeGreaterThanOrEqual(10);
  });

  it("drifts up and to the right as it rises, never below its racer", () => {
    const { words, world } = pool();
    const slam = word("slam", "p1", true);
    words.show(slam, 0xffffff);
    const first = { x: 0, y: 0 };
    for (let i = 1; i <= 40; i += 1) {
      words.update(1 / 60, 16 * i, false, at(0, 0), new Set([slam.key]), ROOM);
      const text = world()[0]!;
      if (i === 1) Object.assign(first, { x: text.position.x, y: text.position.y });
      expect(text.position.y).toBeLessThan(0);
    }
    const last = world()[0]!;
    expect(last.position.x).toBeGreaterThan(first.x);
    expect(last.position.y).toBeLessThan(first.y);
  });

  it("slides right of the beat, rather than under it or below its racer", () => {
    const { words, world, beats } = pool();
    const streak = word("streak", "p1", true, { key: "p1:streak", count: 8 });
    const lap = word("lap", undefined, true, { group: "beat", lap: 3 });
    words.show(streak, 0xffffff);
    words.show(lap, 0xffffff);
    // The racer stands at field y 260, straight under the beat at 184.
    words.update(0, 0, false, at(0, 40), new Set([streak.key, lap.key]), ROOM);
    const head = world()[0]!;
    expect(apart(inBeat(beats()[0]!), inField(head))).toBe(true);
    expect(head.position.x).toBeGreaterThan(0);
    expect(head.position.y).toBeLessThan(-40); // still above the racer, in y-down space
  });

  it("slides left of the beat only when the right edge leaves no room", () => {
    const { words, world, beats } = pool();
    const streak = word("streak", "p1", true, { key: "p1:streak", count: 8 });
    const lap = word("lap", undefined, true, { group: "beat", lap: 3 });
    words.show(streak, 0xffffff);
    words.show(lap, 0xffffff);
    // A field only as wide as the beat: there is no room on its right.
    const narrow = { ...ROOM, width: 480 + 120 };
    words.update(0, 0, false, at(0, 40), new Set([streak.key, lap.key]), narrow);
    const head = world()[0]!;
    expect(apart(inBeat(beats()[0]!), inField(head))).toBe(true);
    expect(head.position.x).toBeLessThan(0);
  });

  it("glides to its new spot rather than jumping there", () => {
    const { words, world } = pool();
    const streak = word("streak", "p1", true, { key: "p1:streak", count: 8 });
    const lap = word("lap", undefined, true, { group: "beat", lap: 3, bornMs: 16 });
    words.show(streak, 0xffffff);
    words.update(1 / 60, 16, false, at(0, 40), new Set([streak.key]), ROOM);
    const before = world()[0]!.position.x;
    words.show(lap, 0xffffff);
    words.update(1 / 60, 32, false, at(0, 40), new Set([streak.key, lap.key]), ROOM);
    const during = world()[0]!.position.x;
    for (let i = 3; i <= 30; i += 1) words.update(1 / 60, 16 * i, false, at(0, 40), new Set([streak.key, lap.key]), ROOM);
    const after = world()[0]!.position.x;
    expect(during).toBeGreaterThan(before);
    expect(during).toBeLessThan(after);
  });

  it("keeps a word out from under the HUD: it stops rising at the HUD's bottom", () => {
    const { words, world } = pool();
    const slam = word("slam", "p1", true);
    words.show(slam, 0xffffff);
    // A racer 170 units up stands at field y 130, just under a HUD ending at 110.
    for (let i = 0; i <= 40; i += 1) {
      words.update(1 / 60, 16 * i, false, at(0, 170), new Set([slam.key]), { ...ROOM, ceiling: 110 });
      expect(inField(world()[0]!).top).toBeGreaterThanOrEqual(110);
    }
  });

  it("stamps a beat below the HUD", () => {
    const { words, beats } = pool();
    const lap = word("lap", undefined, true, { group: "beat", lap: 3 });
    words.show(lap, 0xffffff);
    words.update(0, 0, false, at(0, 0), new Set([lap.key]), { ...ROOM, ceiling: 170 });
    expect(inBeat(beats()[0]!).top).toBeGreaterThanOrEqual(170);
  });
});
