/**
 * One CPU's word, drawn over its nameplate (CPU banding spec §4).
 *
 * It grows in with a pop, holds, and fades by `BARK_MS`. Under reduced motion
 * it appears at full size and fades, with no growth. The racer's own clock
 * advances it, so the finish's slow motion slows it with the rest.
 */

import { Text } from "pixi.js";
import { playerColorTint } from "@floor-fifty/asset-contract/roles";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import { FONT_UI } from "../../i18n/fonts";
import { BARK_MS } from "./cpu-barks";

/** The pop: the word overshoots to this scale, then settles. */
const OVERSHOOT = 1.25;
const GROW_MS = 120;
const SETTLE_MS = 120;
/** The fade, at the end of the word's time. */
const FADE_MS = 400;
const FONT_SIZE = 9;

export class Bark {
  readonly root = new Text({
    text: "",
    style: { fontFamily: FONT_UI, fontWeight: "600", fontSize: FONT_SIZE, stroke: { color: 0xffffff, width: 3 } },
    anchor: { x: 0.5, y: 1 },
  });
  private ageMs = BARK_MS;

  constructor() {
    this.root.label = "cpu-bark";
    this.root.visible = false;
  }

  /** `face` is the nameplates' own stack, which follows the language (CJK needs its Noto face). */
  show(text: string, colour: SeatColour, face: string): void {
    if (this.root.text !== text) this.root.text = text;
    if (this.root.style.fontFamily !== face) this.root.style.fontFamily = face;
    const tint = playerColorTint(colour);
    if (this.root.style.fill !== tint) this.root.style.fill = tint;
    this.ageMs = 0;
    this.root.visible = true;
  }


  /** One frame: its size and its fade. `scale` is the nameplates' own, so the word reads at their size. */
  advance(deltaMs: number, reduced: boolean, scale: number): void {
    if (!this.root.visible) return;
    this.ageMs += deltaMs;
    if (this.ageMs >= BARK_MS) {
      this.root.visible = false;
      return;
    }
    this.root.alpha = this.ageMs > BARK_MS - FADE_MS ? (BARK_MS - this.ageMs) / FADE_MS : 1;
    this.root.scale.set(scale * (reduced ? 1 : popOf(this.ageMs)));
  }
}

/** Grows past full size, then settles back to it. */
function popOf(ageMs: number): number {
  if (ageMs < GROW_MS) return (ageMs / GROW_MS) * OVERSHOOT;
  if (ageMs < GROW_MS + SETTLE_MS) return OVERSHOOT - ((ageMs - GROW_MS) / SETTLE_MS) * (OVERSHOOT - 1);
  return 1;
}
