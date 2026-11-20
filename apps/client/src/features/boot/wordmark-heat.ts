/**
 * Heat on the wordmark: the sun's shimmer (`sun-shimmer.ts`), on the splash.
 *
 * The wordmark is DOM text, not a sprite, so the sun's shader cannot hang on
 * it. The same look is an SVG filter instead: a field of noise that breathes,
 * and the letters displaced through it, so their edges bulge and pinch the
 * way the sun's rim does. Worked in **em**, so the look is the same size at
 * every form factor's wordmark.
 *
 * The splash's copy burns for as long as it is up. The title's copy, sliding
 * over from it (`wordmark-handoff`), arrives burning and cools to still over
 * the slide, so the two read as one wordmark leaving the heat. Once cool, the
 * filter goes entirely: the menu pays nothing for it.
 *
 * The filter runs first in `.ff-wordmark--light`'s chain, through
 * `--ff-wordmark-heat`, so the glow and the drop shadows follow the bent
 * letters. Reduced motion leaves the wordmark still.
 */

import { reducedMotion } from "../kit/motion";

/** The authored look. */
export const WORDMARK_HEAT = {
  /** How far the letters are dragged, in em. */
  displacement: 0.06,
  /** Noise cells per em, across and down: finer down, so ripples run sideways like heat. */
  frequency: [0.7, 1.4],
  /** How far the field breathes, as a fraction of its frequency. */
  boil: 0.12,
  /** Seconds-scale of the motion. Higher is more restless. */
  speed: 1,
  /** How long the title's copy takes to cool, in seconds: the slide and a little after. */
  cool: 0.9,
} as const;

/** Burn for as long as it is up, cool from arrival to still, or none at all. */
export type WordmarkHeatMode = "burn" | "cool" | "off";

const SVG = "http://www.w3.org/2000/svg";

let nextId = 0;

const smoothstep = (x: number): number => x * x * (3 - 2 * x);

/**
 * Heat on a wordmark.
 *
 * A Svelte action: `<h1 use:wordmarkHeat={"cool"}>`. Each copy has its own
 * filter, since the splash's and the title's are both up for a moment.
 */
export function wordmarkHeat(node: HTMLElement, mode: WordmarkHeatMode = "burn") {
  if (mode === "off" || reducedMotion()) return {};

  const id = `ff-wordmark-heat-${nextId++}`;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  const filter = document.createElementNS(SVG, "filter");
  filter.id = id;
  // Room for the letters to bulge past their boxes.
  filter.setAttribute("x", "-10%");
  filter.setAttribute("y", "-10%");
  filter.setAttribute("width", "120%");
  filter.setAttribute("height", "120%");
  filter.setAttribute("color-interpolation-filters", "sRGB");
  const noise = document.createElementNS(SVG, "feTurbulence");
  noise.setAttribute("type", "fractalNoise");
  noise.setAttribute("numOctaves", "2");
  noise.setAttribute("seed", "7");
  noise.setAttribute("result", "heat");
  const bend = document.createElementNS(SVG, "feDisplacementMap");
  bend.setAttribute("in", "SourceGraphic");
  bend.setAttribute("in2", "heat");
  bend.setAttribute("xChannelSelector", "R");
  bend.setAttribute("yChannelSelector", "G");
  filter.append(noise, bend);
  svg.append(filter);
  document.body.append(svg);
  node.style.setProperty("--ff-wordmark-heat", `url(#${id})`);

  // Read once and on a resize, not per frame: the size only moves with the form factor.
  let em = 100;
  const measure = (): void => {
    em = Number.parseFloat(getComputedStyle(node).fontSize) || 100;
  };
  measure();
  window.addEventListener("resize", measure);

  const draw = (seconds: number): number => {
    const strength = mode === "cool" ? 1 - smoothstep(Math.min(1, seconds / WORDMARK_HEAT.cool)) : 1;
    const t = seconds * WORDMARK_HEAT.speed;
    const [across, down] = WORDMARK_HEAT.frequency;
    const fx = (across * (1 + WORDMARK_HEAT.boil * Math.sin(t * 0.9))) / em;
    const fy = (down * (1 + WORDMARK_HEAT.boil * Math.sin(t * 1.3 + 1.7))) / em;
    noise.setAttribute("baseFrequency", `${fx.toFixed(5)} ${fy.toFixed(5)}`);
    bend.setAttribute("scale", (WORDMARK_HEAT.displacement * em * strength).toFixed(2));
    return strength;
  };

  let frame = 0;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    window.removeEventListener("resize", measure);
    node.style.removeProperty("--ff-wordmark-heat");
    svg.remove();
  };

  draw(0);
  if (typeof requestAnimationFrame === "function") {
    let start: number | undefined;
    const step = (now: number): void => {
      start ??= now;
      if (draw((now - start) / 1000) <= 0) {
        stop();
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  } else if (mode === "cool") {
    // Nothing to cool it over: arrive still.
    stop();
  }

  return { destroy: stop };
}
