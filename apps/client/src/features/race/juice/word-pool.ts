/**
 * The pop-up words on screen (Wonder spec §5.1): a small pool of Pixi texts,
 * reused. A racer's word pops above its head in the world, where the camera
 * carries it; a race beat is stamped in the beat layer, in the middle of the
 * view. Each pops on the word spring and rises, a racer's drifting right as
 * it goes, drawn on whole units and 1/32 scale steps, and fades over the last
 * third of its life.
 *
 * It owns no rules: `WordDirector` decides what shows, and a word the
 * director no longer holds (replaced, or forgotten) is hidden here at once.
 *
 * It does own where each word stands (the owner: words overlapped, and the
 * HUD covered them). A racer's words stack, newest nearest its head, each
 * older one staggered right of the one under it; given
 * the room, nothing rises past the HUD's bottom, and each racer's stack, the
 * local racer's first, slides right (or, at the right edge, left) until it is
 * clear of the beat and of every word placed before it, gliding there. Words
 * keep moving up and to the right: never below their racer (the owner).
 */

import { roleTint } from "@floor-fifty/asset-contract/roles";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { SpringTuning, WordsTuning } from "@floor-fifty/shared/content/game-content";
import { Container, Text } from "pixi.js";
import { localeFaces } from "../../i18n/fonts";
import { activeLocale } from "../../i18n/strategy";
import { SecondOrder, snapTo } from "../../../lib/second-order";
import type { Word } from "./word-director";
import { wordFont, wordText, type WordFace } from "./word-text";

const DEG = Math.PI / 180;
const SCALE_STEP = 1 / 32;
/** How far above a racer's centre its word stands, in world units: clear of its name tag. */
const HEAD_UNITS = 48;
/** How far right a racer's word drifts for each unit it rises (the owner: up and to the right). */
const DRIFT = 0.5;
/** How far right each older word in a stack stands of the one under it, in world units (the owner: stagger a stack). */
const STACK_STAGGER = 16;
/** Between two stacked words, and between a word and what it keeps clear of, in logical units. */
const WORD_GAP = 4;
/** How far a stack slides per try while it looks for a clear spot, in logical units. */
const SLIDE_STEP = 8;
/** How quickly a stack glides to a new spot, per second. */
const SLIDE_RATE = 14;
/** A reduced-motion word's fade in, in milliseconds. */
const FADE_IN_MS = 120;
const RESTING_SPRING: SpringTuning = { f: 5, zeta: 0.5, r: 0 };
/**
 * The letters' own motion (the owner's ask): each pops in a beat after the
 * one before it and pops out in the word's last moments, small and quick, so
 * the word reads as one thing that moves exactly as before.
 */
const LETTER_STAGGER_MS = 22;
const LETTER_POP_MS = 90;
const LETTER_FROM_SCALE = 0.55;
const LETTER_PEAK_SCALE = 1.08;
const LETTER_DROP_UNITS = 3;
const LETTER_EXIT_MS = 150;
const LETTER_EXIT_SCALE = 0.8;
const LETTER_EXIT_RISE_UNITS = 2;

/** What can say whether a face has loaded: `document.fonts` in the page. */
export type FaceCheck = { readonly check: (face: string) => boolean };
const ALWAYS: FaceCheck = { check: () => true };

type Letter = { readonly text: Text; x: number };

/**
 * Where the words have room, in the field's logical units (the overlay's
 * space, y-down): how the world is drawn into it, where the beat layer stands,
 * the bottom of the HUD's top band, which no word goes above, and the
 * field's width, which no word slides past.
 */
export type WordRoom = {
  readonly toField: { readonly x: number; readonly y: number; readonly scale: number };
  readonly beatAt: { readonly x: number; readonly y: number };
  readonly ceiling: number;
  readonly width: number;
};

type Box = { left: number; right: number; top: number; bottom: number };

type Entry = {
  /** The word: the letters' container, labelled with the whole word. */
  readonly root: Container;
  readonly letters: Letter[];
  /** How many of `letters` this word uses. */
  count: number;
  /** The laid-out word's width and its tallest letter, unscaled, for keeping words apart. */
  width: number;
  height: number;
  readonly beat: boolean;
  key: string;
  word: Word;
  readonly scale: SecondOrder;
  readonly rise: SecondOrder;
  /** When it first appeared on screen: a reduced-motion fade runs from here, and a re-pop keeps it. */
  shownMs: number;
  /** When its letters last popped in: a re-pop pops them again. */
  poppedMs: number;
};

export class WordPool {
  private readonly world = new Container({ label: "juice-words" });
  private readonly beat = new Container({ label: "juice-beats" });
  private readonly entries: Entry[] = [];
  /** How far each racer's stack has slid sideways to keep clear, in world units, as drawn. */
  private readonly slides = new Map<PlayerId, number>();
  private face: WordFace = wordFont(activeLocale());
  private fontFamily = this.face.family;
  private fontWeight = String(this.face.weight);

  constructor(
    layers: { readonly world: Container; readonly beat: Container },
    private readonly words: () => WordsTuning | undefined,
    private readonly spring: () => SpringTuning | undefined,
    private readonly fonts: FaceCheck = globalThis.document?.fonts ?? ALWAYS,
  ) {
    layers.world.addChild(this.world);
    layers.beat.addChild(this.beat);
  }

  /**
   * Shows a word in `colour`, or re-pops the one on screen under its key with
   * its new text. Under reduced motion it starts unseen and fades in.
   */
  show(word: Word, colour: number, reduced = false): void {
    const words = this.words();
    if (words === undefined) return;
    this.followLocale();
    // Never a fallback serif: a Latin word waits for Fraunces at 900.
    if (this.face.skew && !this.fonts.check(`900 1em ${this.face.family}`)) return;
    // And CJK for its Noto face, at the weight it is set in.
    if (!this.face.skew && !this.fonts.check(localeFaces(activeLocale())[1] ?? "")) return;
    const beat = word.playerId === undefined;
    const live = this.entries.find((each) => each.root.visible && each.key === word.key);
    const entry = live ?? this.take(beat);
    // A re-pop changes the text and the pop, never the fade a word has already made.
    if (live === undefined) entry.shownMs = word.bornMs;
    entry.poppedMs = word.bornMs;
    entry.key = word.key;
    entry.word = word;
    const fontSize = beat ? words.beatSize : word.local ? words.size : words.size * words.rivalScale;
    // About an eighth of the type at every size: `outline` is authored at the local size.
    const stroke = { color: roleTint("outline"), width: (words.outline * fontSize) / words.size, join: "round" as const };
    this.layout(entry, wordText(word, words), colour, fontSize, stroke);
    entry.root.skew.x = this.face.skew ? -words.skewDeg * DEG : 0;
    const tuning = this.spring() ?? RESTING_SPRING;
    entry.scale.retune(tuning);
    entry.rise.retune(tuning);
    entry.scale.set(1);
    entry.scale.lift(words.popScale);
    if (entry.word.kind !== "streak" || !entry.root.visible) entry.rise.set(0);
    entry.root.visible = true;
    this.draw(entry, words, 0, reduced);
  }

  /**
   * Steps every word: its spring, its rise, its fade, its letters, and where
   * it stands. `live` is the keys the director still holds; `positionOf`
   * where a racer is drawn, in the simulation's y-up space.
   */
  update(
    dtSeconds: number,
    nowMs: number,
    reduced: boolean,
    positionOf: (id: PlayerId) => { readonly x: number; readonly y: number } | undefined,
    live: ReadonlySet<string>,
    room?: WordRoom,
  ): void {
    const words = this.words();
    this.followLocale();
    const shown: { readonly entry: Entry; readonly at: { readonly x: number; readonly y: number } | undefined }[] = [];
    for (const entry of this.entries) {
      if (!entry.root.visible) continue;
      const age = nowMs - entry.word.bornMs;
      if (words === undefined || !live.has(entry.key) || age > words.lifeMs) {
        entry.root.visible = false;
        continue;
      }
      if (reduced) {
        entry.scale.set(1);
        entry.rise.set(0);
      } else {
        entry.scale.update(dtSeconds, 1);
        entry.rise.update(dtSeconds, words.riseUnits);
      }
      const at = entry.word.playerId === undefined ? undefined : positionOf(entry.word.playerId);
      if (entry.word.playerId !== undefined && at === undefined) {
        entry.root.visible = false;
        continue;
      }
      this.draw(entry, words, age, reduced);
      shown.push({ entry, at });
    }
    if (words !== undefined) this.place(shown, room, dtSeconds, reduced);
  }

  /**
   * The widest of `texts` at the beat size, in this language's face, slant
   * and outline included, in logical units: what the fit check measures
   * (Wonder spec §8). Lays them out once, off screen, and keeps nothing.
   */
  widest(texts: readonly string[]): number {
    const words = this.words();
    if (words === undefined) return 0;
    this.followLocale();
    const probe = new Text({
      text: "",
      resolution: 1,
      style: {
        fontFamily: this.fontFamily,
        fontWeight: this.fontWeight as Text["style"]["fontWeight"],
        fontSize: words.beatSize * words.popScale,
        stroke: { color: roleTint("outline"), width: (words.outline * words.beatSize) / words.size, join: "round" },
      },
    });
    probe.skew.x = this.face.skew ? -words.skewDeg * DEG : 0;
    let widest = 0;
    for (const text of texts) {
      probe.text = text;
      widest = Math.max(widest, probe.getBounds().width);
    }
    probe.destroy();
    return widest;
  }

  /** Words on screen now. */
  get live(): number {
    return this.entries.filter((entry) => entry.root.visible).length;
  }

  /** Hides every word: a rewind, or a new race. */
  clear(): void {
    for (const entry of this.entries) entry.root.visible = false;
    this.slides.clear();
  }

  destroy(): void {
    this.world.destroy({ children: true });
    this.beat.destroy({ children: true });
    this.entries.length = 0;
  }

  /** Sets a word's letters, one text each, laid out side by side around the word's centre. */
  private layout(entry: Entry, word: string, colour: number, fontSize: number, stroke: { color: number; width: number; join: "round" }): void {
    const glyphs = Array.from(word);
    entry.root.label = word;
    let x = 0;
    for (let index = 0; index < glyphs.length; index += 1) {
      const letter = this.letterOf(entry, index);
      const text = letter.text;
      text.text = glyphs[index]!;
      text.style.fill = colour;
      text.style.fontSize = fontSize;
      // Reassigning an identical stroke invalidates the pooled glyph texture.
      const current = text.style.stroke as { color?: number; width?: number; join?: string } | undefined;
      if (current?.color !== stroke.color || current.width !== stroke.width || current.join !== stroke.join) {
        text.style.stroke = stroke;
      }
      text.visible = true;
      letter.x = x + text.width / 2;
      x += text.width;
    }
    for (let index = glyphs.length; index < entry.letters.length; index += 1) entry.letters[index]!.text.visible = false;
    entry.count = glyphs.length;
    entry.width = x;
    entry.height = 0;
    for (let index = 0; index < glyphs.length; index += 1) entry.height = Math.max(entry.height, entry.letters[index]!.text.height);
    for (let index = 0; index < glyphs.length; index += 1) entry.letters[index]!.x -= x / 2;
  }

  private letterOf(entry: Entry, index: number): Letter {
    const existing = entry.letters[index];
    if (existing !== undefined) return existing;
    const text = new Text({
      text: "",
      // The world draws into a 1x target: a word at the canvas's 2x is four times the pixels for nothing.
      resolution: 1,
      style: {
        fontFamily: this.fontFamily,
        fontWeight: this.fontWeight as Text["style"]["fontWeight"],
        fontSize: 16,
        fill: 0xffffff,
      },
    });
    text.anchor.set(0.5, 1);
    entry.root.addChild(text);
    const letter: Letter = { text, x: 0 };
    entry.letters.push(letter);
    return letter;
  }

  private draw(entry: Entry, words: WordsTuning, age: number, reduced: boolean): void {
    const root = entry.root;
    root.scale.set(snapTo(entry.scale.value, SCALE_STEP));
    const base = entry.word.local || entry.beat ? 1 : words.rivalAlpha;
    const fadeOut = Math.min(1, Math.max(0, (words.lifeMs - age) / (words.lifeMs / 3)));
    const sinceShown = age + entry.word.bornMs - entry.shownMs;
    const fadeIn = reduced ? Math.min(1, Math.max(0, sinceShown / FADE_IN_MS)) : 1;
    root.alpha = base * fadeOut * fadeIn;
    this.drawLetters(entry, words, age, reduced);
  }

  /** Each letter's pop in and out, after the one before it; under reduced motion they stand still, together. */
  private drawLetters(entry: Entry, words: WordsTuning, age: number, reduced: boolean): void {
    const sincePop = age + entry.word.bornMs - entry.poppedMs;
    const exitFrom = words.lifeMs - LETTER_EXIT_MS;
    for (let index = 0; index < entry.count; index += 1) {
      const letter = entry.letters[index]!;
      const text = letter.text;
      if (reduced) {
        text.visible = true;
        text.scale.set(1);
        text.position.set(Math.round(letter.x), 0);
        continue;
      }
      const into = (sincePop - index * LETTER_STAGGER_MS) / LETTER_POP_MS;
      if (into < 0) {
        text.visible = false;
        continue;
      }
      text.visible = true;
      let scale = 1;
      let y = 0;
      if (into < 1) {
        // Up past full and back: 0.55 to 1.08 over the first 60%, then to 1.
        scale = into < 0.6 ? LETTER_FROM_SCALE + (LETTER_PEAK_SCALE - LETTER_FROM_SCALE) * (into / 0.6) : LETTER_PEAK_SCALE - (LETTER_PEAK_SCALE - 1) * ((into - 0.6) / 0.4);
        y = -LETTER_DROP_UNITS * (1 - into);
      }
      const out = Math.min(1, Math.max(0, (age - exitFrom - index * (LETTER_STAGGER_MS / 2)) / (LETTER_EXIT_MS / 2)));
      if (out > 0) {
        scale *= 1 - (1 - LETTER_EXIT_SCALE) * out;
        y -= LETTER_EXIT_RISE_UNITS * out;
      }
      text.scale.set(snapTo(scale, SCALE_STEP));
      text.position.set(Math.round(letter.x), Math.round(y));
    }
  }

  /**
   * Stands every word on screen: the beats, then each racer's stack, the
   * local racer's first, each kept under the HUD and clear of the words placed
   * before it where the room is known. Positions are whole units.
   */
  private place(
    shown: readonly { readonly entry: Entry; readonly at: { readonly x: number; readonly y: number } | undefined }[],
    room: WordRoom | undefined,
    dtSeconds: number,
    reduced: boolean,
  ): void {
    const placed: Box[] = [];
    const ceiling = room?.ceiling ?? Number.NEGATIVE_INFINITY;
    const slant = this.face.skew ? Math.tan((this.words()?.skewDeg ?? 0) * DEG) : 0;
    const sizeOf = (entry: Entry) => ({ width: entry.width * entry.root.scale.x, height: entry.height * entry.root.scale.y });

    for (const { entry } of shown) {
      if (!entry.beat) continue;
      const { width, height } = sizeOf(entry);
      let bottom = -snapTo(entry.rise.value, 1);
      if (room !== undefined) {
        bottom = Math.max(bottom, Math.ceil(ceiling + WORD_GAP + height - room.beatAt.y));
        const half = width / 2 + height * slant;
        placed.push({ left: room.beatAt.x - half, right: room.beatAt.x + half, top: room.beatAt.y + bottom - height, bottom: room.beatAt.y + bottom });
      }
      entry.root.position.set(0, bottom);
    }

    // Each racer's words, newest first: the newest stands nearest the racer.
    const stacks = new Map<PlayerId, { at: { readonly x: number; readonly y: number }; local: boolean; entries: Entry[] }>();
    for (const { entry, at } of shown) {
      const id = entry.word.playerId;
      if (entry.beat || id === undefined || at === undefined) continue;
      const stack = stacks.get(id) ?? { at, local: false, entries: [] };
      stack.local ||= entry.word.local;
      stack.entries.push(entry);
      stacks.set(id, stack);
    }
    for (const id of this.slides.keys()) if (!stacks.has(id)) this.slides.delete(id);
    const order = [...stacks].sort(([, a], [, b]) => Number(b.local) - Number(a.local));
    const toField = room?.toField ?? { x: 0, y: 0, scale: 1 };

    for (const [id, stack] of order) {
      stack.entries.sort((a, b) => b.word.bornMs - a.word.bornMs || b.poppedMs - a.poppedMs);
      const head = Math.round(-(stack.at.y + HEAD_UNITS));
      // Each word rises from over the head and drifts right as it goes; each older word stands over the newer, staggered right of it.
      const xs: number[] = [];
      let bottoms: number[] = [];
      let edge = head;
      for (const [index, entry] of stack.entries.entries()) {
        const rise = snapTo(entry.rise.value, 1);
        const bottom = Math.min(head - rise, edge);
        xs.push(Math.round(stack.at.x + rise * DRIFT + index * STACK_STAGGER));
        bottoms.push(bottom);
        edge = Math.floor(bottom - sizeOf(entry).height - WORD_GAP / toField.scale);
      }
      const boxes = (slide: number): Box[] =>
        stack.entries.map((entry, index) => {
          const { width, height } = sizeOf(entry);
          const half = (width / 2 + height * slant) * toField.scale;
          const centre = toField.x + (xs[index]! + slide) * toField.scale;
          const bottom = toField.y + bottoms[index]! * toField.scale;
          return { left: centre - half, right: centre + half, top: bottom - height * toField.scale, bottom };
        });
      // No higher than the HUD's bottom: the stack stops rising there, and keeps drifting.
      const top = Math.min(...boxes(0).map((box) => box.top));
      if (top < ceiling + WORD_GAP) {
        const down = Math.ceil((ceiling + WORD_GAP - top) / toField.scale);
        bottoms = bottoms.map((bottom) => bottom + down);
      }

      let target = 0;
      if (room !== undefined) {
        const clear = (candidate: readonly Box[]): boolean =>
          candidate.every((box) => placed.every((other) => box.right <= other.left || other.right <= box.left || box.bottom + WORD_GAP <= other.top || other.bottom + WORD_GAP <= box.top));
        const inField = (candidate: readonly Box[]): boolean => candidate.every((box) => box.left >= 0 && box.right <= room.width);
        const step = SLIDE_STEP / toField.scale;
        if (!clear(boxes(0))) {
          // Right first, as the words drift; left only when the right edge leaves no room.
          let found: number | undefined;
          for (let slide = step; found === undefined && inField(boxes(slide)); slide += step) if (clear(boxes(slide))) found = slide;
          for (let slide = -step; found === undefined && inField(boxes(slide)); slide -= step) if (clear(boxes(slide))) found = slide;
          target = found ?? 0;
        }
      }
      const was = this.slides.get(id);
      const slide = reduced || was === undefined ? target : was + (target - was) * Math.min(1, dtSeconds * SLIDE_RATE);
      this.slides.set(id, slide);
      placed.push(...boxes(target));
      stack.entries.forEach((entry, index) => entry.root.position.set(Math.round(xs[index]! + slide), bottoms[index]!));
    }
  }

  /** Re-reads the player's language: CJK takes upright Noto, Latin slanted Fraunces. */
  private followLocale(): void {
    const face = wordFont(activeLocale());
    if (face.family === this.face.family && face.weight === this.face.weight) return;
    this.face = face;
    this.fontFamily = face.family;
    this.fontWeight = face.weight;
    for (const entry of this.entries) {
      for (const letter of entry.letters) {
        letter.text.style.fontFamily = this.fontFamily;
        letter.text.style.fontWeight = this.fontWeight as Text["style"]["fontWeight"];
      }
    }
  }

  private take(beat: boolean): Entry {
    const free = this.entries.find((entry) => entry.beat === beat && !entry.root.visible);
    if (free !== undefined) return free;
    const root = new Container();
    root.visible = false;
    (beat ? this.beat : this.world).addChild(root);
    const tuning = this.spring() ?? RESTING_SPRING;
    const entry: Entry = {
      root,
      letters: [],
      count: 0,
      width: 0,
      height: 0,
      beat,
      key: "",
      word: { kind: "slam", key: "", group: "skill", playerId: undefined, local: false, bornMs: 0 },
      scale: new SecondOrder(tuning, 1),
      rise: new SecondOrder(tuning, 0),
      shownMs: 0,
      poppedMs: 0,
    };
    this.entries.push(entry);
    return entry;
  }
}
