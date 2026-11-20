/**
 * The wordmark carried from the splash to the title.
 *
 * Both screens draw the same wordmark at the same size: the splash centres it,
 * the title sets it at the hero's left edge. Rather than the splash's copy
 * vanishing and the title's rising in, the splash notes where each line of
 * its wordmark sat as it leaves, and the title's lines slide over from there
 * to their own places -- a FLIP, so the two copies read as one.
 *
 * Measured per line and by its text, not its box: each line is a block as
 * wide as the wordmark, and the splash centres the words inside it, so only
 * the text's own rect says where the letters are.
 */

import gsap from "gsap";
import { reducedMotion } from "../kit/motion";

/** Where each line's text sat, in viewport pixels, top line first. */
export type WordmarkPlaces = readonly { left: number; top: number }[];

/** How long the slide takes, in seconds: a move across the screen, not a beat. */
const SLIDE = 0.6;

let left: WordmarkPlaces | undefined;

function textPlace(line: Element): { left: number; top: number } {
  const range = document.createRange();
  range.selectNodeContents(line);
  // jsdom lays no text out; the line's own box stands in there.
  const rect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : line.getBoundingClientRect();
  return { left: rect.left, top: rect.top };
}

function places(wordmark: Element): { left: number; top: number }[] {
  return [...wordmark.children].map(textPlace);
}

/** The splash, as it leaves: notes where its wordmark's lines are. */
export function leaveWordmark(wordmark: Element | null): void {
  left = wordmark === null ? undefined : places(wordmark);
}

/** The title, arriving: what the splash left, once; later arrivals get nothing. */
export function takeWordmark(): WordmarkPlaces | undefined {
  const taken = left;
  left = undefined;
  return taken;
}

/**
 * Slides each line of the wordmark from where the splash had it to here.
 *
 * A Svelte action: `<h1 use:slideFrom={places}>`. Nothing to do without
 * places, with lines that do not match, or when motion is reduced.
 *
 * Eased rather than stepped (`motion.ts` rule 3): a line crossing half the
 * screen in eight jumps reads as a flicker, not a move. Positions still land
 * on whole pixels.
 */
export function slideFrom(node: HTMLElement, from: WordmarkPlaces | undefined) {
  if (from === undefined || reducedMotion()) return {};
  const lines = [...node.children] as HTMLElement[];
  if (lines.length !== from.length) return {};

  const here = places(node);
  const tweens = lines.map((line, index) =>
    gsap.from(line, {
      x: from[index]!.left - here[index]!.left,
      y: from[index]!.top - here[index]!.top,
      duration: SLIDE,
      ease: "power2.inOut",
      roundProps: "x,y",
      onComplete: () => gsap.set(line, { clearProps: "transform" }),
    }),
  );

  return { destroy: () => tweens.forEach((tween) => tween.kill()) };
}
