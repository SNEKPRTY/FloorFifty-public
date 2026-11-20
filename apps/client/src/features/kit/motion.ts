/**
 * Motion.
 *
 * GSAP, constrained to what pixel art can survive.
 *
 * Three rules hold everywhere in this file, and they are the reason it exists
 * rather than each component calling `gsap.to` however it likes:
 *
 * 1. **Positions land on whole pixels.** The world renders nearest-neighbour,
 *    and a tween that passes through a fractional offset makes the browser
 *    resample a bitmap face mid-flight so it shimmers. The smooth Aquarian
 *    chrome is set at CSS resolution rather than on the world grid, but the
 *    pixel faces and drawn HUD are still on it, so every positional tween here
 *    rounds regardless of which layer it is moving.
 *
 * 2. **Nothing tweens colour.** An interpolation between two of the 64
 *    swatches is, by definition, a colour that is not one of them -- the exact
 *    thing the palette-lock shader exists to prevent, arriving through the one
 *    layer that shader does not cover. This holds for the authored UI palette
 *    too: a fade between two of its values is still a third value. Colour
 *    changes are swaps, never fades.
 *
 * 3. **Motion steps rather than glides.** Sprite animation in this game runs
 *    at a handful of frames per state, so chrome that eases smoothly reads as
 *    belonging to a different product. `STEP_EASE` quantises a tween into the
 *    same kind of discrete frames.
 *
 * Opacity is the one continuously-interpolated property used here. It is safe
 * because the composite is against a fixed backdrop and the result is a blend
 * rather than a palette entry -- and because the alternative, stepping alpha in
 * eight jumps, reads as a flicker rather than a fade.
 */

import gsap from "gsap";
import type { AnimationConfig } from "svelte/animate";
import type { TransitionConfig } from "svelte/transition";

/**
 * How many discrete frames a tween is quantised into.
 *
 * Eight is the same order as the sprite sheets' longest cycle, which is what
 * makes chrome motion and character motion read as one vocabulary.
 */
export const MOTION_STEPS = 8;

/** Stepped easing, so a tween advances in frames rather than continuously. */
export const STEP_EASE = `steps(${MOTION_STEPS})`;

/** A single beat, in seconds. Short: this is feedback, not a cutscene. */
export const BEAT = 0.24;

/**
 * How a panel or dialog arrives (UI overhaul spec, "Motion"): it slides up
 * `distance` px and fades in over `ms` milliseconds. Short and small, so a
 * screen never makes the player wait for it. The modal's CSS keyframe
 * (`Modal.svelte`) states the same two numbers.
 */
export const PANEL_IN = { distance: 8, ms: 150 } as const;

/**
 * How long one screen, overlay or select step takes to give way to the next:
 * a cross-fade of this many milliseconds with nothing sliding (spec, "Motion").
 */
export const SCREEN_FADE_MS = 200;

/**
 * The gap between two elements of a staggered entrance, in seconds.
 *
 * Sixty milliseconds, so a column of panels arrives as a sequence rather than
 * as one movement, and the whole sequence still finishes inside the time a
 * player would notice waiting. Only ever applied on entry.
 */
export const STAGGER = 0.06;

/**
 * Whether the player has asked for less movement.
 *
 * Checked at call time rather than cached, because the setting can change while
 * the game is open and a menu is exactly where someone would go to change it.
 */
export function reducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Puts an element in its final state with no tween.
 *
 * The honest way to honour `prefers-reduced-motion`: the element must still end
 * up visible and correctly placed, so reduced motion means arriving rather than
 * never appearing.
 */
function settle(node: Element): void {
  // Only what motion writes: a transform and an opacity. `"all"` would empty
  // the whole inline style, taking a control's own `display`, a Svelte
  // `style:` directive or a custom property with it.
  gsap.set(node, { clearProps: "transform,opacity" });
}

/**
 * Rises into place on mount.
 *
 * A Svelte action: `<div use:riseIn>` or `<div use:riseIn={{ delay: 2 }}>`,
 * where `delay` counts in `STAGGER` steps so a column of panels can be
 * staggered without any caller doing arithmetic in seconds.
 *
 * `duration` is overridable because the results screen wants one longer,
 * calmer reveal than a menu step; the default is `PANEL_IN`'s.
 */
export function riseIn(
  node: HTMLElement,
  options: { delay?: number; distance?: number; duration?: number; still?: boolean } = {},
) {
  // `still`: the element is already on screen as far as the player can tell
  // -- the menu hero, carried from the title to the lobby -- so it arrives.
  if (options.still === true || reducedMotion()) {
    settle(node);
    return {};
  }

  const distance = options.distance ?? PANEL_IN.distance;
  const tween = gsap.from(node, {
    // Whole pixels only, and `yPercent` is deliberately not used: a percentage
    // of an element's own height is fractional at almost every size.
    y: distance,
    opacity: 0,
    duration: options.duration ?? PANEL_IN.ms / 1000,
    delay: (options.delay ?? 0) * STAGGER,
    ease: STEP_EASE,
    // Rounds every intermediate value, so the element never occupies a
    // half-pixel offset that would resample any bitmap drawn inside it.
    roundProps: "y",
    onComplete: () => settle(node),
  });

  return { destroy: () => tween.kill() };
}

/**
 * A flash of light that steps out, for an arrival worth celebrating: the
 * unlock banner's plate as it lands. A Svelte action on an overlay that is
 * transparent at rest; `delay` is when it lands, in seconds. Never under
 * reduced motion: the caller does not render the overlay at all.
 */
export function flashOut(node: HTMLElement, options: { delay?: number } = {}) {
  const tween = gsap.fromTo(
    node,
    { opacity: 0.85 },
    { opacity: 0, duration: BEAT * 1.5, delay: options.delay ?? 0, ease: STEP_EASE, immediateRender: false },
  );
  return { destroy: () => tween.kill() };
}

/**
 * A short pulse, for an element whose meaning just changed.
 *
 * Scale rather than colour, because colour is not tweenable here. Anchored at
 * the element's own centre so a seat does not appear to shift in the list.
 */
export function pulse(node: Element, scale = 1.06): void {
  if (reducedMotion()) return;

  gsap.fromTo(
    node,
    { scale: 1 },
    {
      scale,
      duration: BEAT * 0.5,
      ease: STEP_EASE,
      yoyo: true,
      repeat: 1,
      transformOrigin: "50% 50%",
      onComplete: () => gsap.set(node, { clearProps: "scale,transform" }),
    },
  );
}

/**
 * Runs `pulse` whenever the value changes, but never on the first render.
 *
 * A Svelte action taking the value to watch. Without the first-render guard,
 * every seat in the room would pulse the moment the menu opened, which says
 * "four things just happened" when nothing has.
 */
export function pulseOnChange(node: Element, value: unknown) {
  let previous = value;
  return {
    update(next: unknown) {
      if (next === previous) return;
      previous = next;
      pulse(node);
    },
  };
}

/**
 * Nudges an element sideways and back, for a refusal.
 *
 * Whole pixels, and small: this is the difference between "that did not work"
 * and a page that appears to be falling over.
 */
export function refuse(node: Element): void {
  if (reducedMotion()) return;

  gsap.fromTo(
    node,
    { x: -3 },
    {
      x: 0,
      duration: BEAT,
      ease: "steps(6)",
      roundProps: "x",
      onComplete: () => gsap.set(node, { clearProps: "x,transform" }),
    },
  );
}

/**
 * A press: 1 px down, held while the pointer is down (polish spec §5.1).
 *
 * Set rather than tweened, because a press is one step; the spring is the
 * release's. None under reduced motion.
 */
export function pressDown(node: HTMLElement): void {
  if (reducedMotion()) return;
  gsap.killTweensOf(node, "y");
  gsap.set(node, { y: 1 });
}

/** The release: 1 px past rest, then rest -- a stepped spring. */
export function pressUp(node: HTMLElement): void {
  if (reducedMotion()) {
    settle(node);
    return;
  }
  gsap.fromTo(
    node,
    { y: -1 },
    { y: 0, duration: BEAT * 0.5, ease: "steps(2)", roundProps: "y", onComplete: () => settle(node) },
  );
}

/** A keyboard or pad activation, which has no pointer down to hold: both steps at once. */
export function pressThrough(node: HTMLElement): void {
  if (reducedMotion()) return;
  gsap.fromTo(
    node,
    { y: 1 },
    { y: 0, duration: BEAT * 0.5, ease: "steps(2)", roundProps: "y", onComplete: () => settle(node) },
  );
}

/** A 1 px lift while a mouse is on the control. Never from a finger: the caller checks. */
export function hoverLift(node: HTMLElement, on: boolean): void {
  if (reducedMotion()) return;
  gsap.to(node, { y: on ? -1 : 0, duration: BEAT * 0.25, ease: "steps(1)", roundProps: "y" });
}

/** `t` quantised into `MOTION_STEPS` frames, for the transitions Svelte runs. */
const stepped = (t: number): number => Math.floor(t * MOTION_STEPS) / MOTION_STEPS;

/**
 * FLIP for a keyed `{#each}` that reorders: `animate:flip`. Each item steps
 * from where it stood to where it stands, on whole pixels. Svelte writes the
 * frames as CSS, so this is not a GSAP tween.
 */
export function flip(_node: Element, { from, to }: { from: DOMRect; to: DOMRect }): AnimationConfig {
  const dx = Math.round(from.left - to.left);
  const dy = Math.round(from.top - to.top);
  if (reducedMotion() || (dx === 0 && dy === 0)) return { duration: 0 };
  return {
    duration: BEAT * 1000,
    css: (t) => `transform: translate(${Math.round(dx * (1 - stepped(t)))}px, ${Math.round(dy * (1 - stepped(t)))}px)`,
  };
}

/**
 * A number that rolls one digit at a time (polish spec §5.1).
 *
 * A Svelte action taking the text to show. Each digit that changed steps in
 * from below in its own cell; the new value is readable at once, so nothing
 * waits on the roll. Under reduced motion the text simply swaps.
 */
export function rollDigits(node: HTMLElement, value: string) {
  let current = value;
  node.textContent = value;
  return {
    update(next: string) {
      if (next === current) return;
      const previous = current;
      current = next;
      if (reducedMotion()) {
        node.textContent = next;
        return;
      }
      gsap.killTweensOf(node.querySelectorAll("*"));
      node.replaceChildren(
        ...[...next].map((char, index) => {
          const cell = document.createElement("span");
          cell.textContent = char;
          cell.style.display = "inline-block";
          // Else a cell holding only a space collapses to nothing.
          cell.style.whiteSpace = "pre";
          if (previous[index] !== char) {
            cell.dataset["rolling"] = "true";
            gsap.from(cell, {
              y: 6,
              opacity: 0,
              duration: BEAT * 0.5,
              delay: index * STAGGER * 0.5,
              ease: STEP_EASE,
              roundProps: "y",
            });
          }
          return cell;
        }),
      );
    },
    destroy() {
      gsap.killTweensOf(node.querySelectorAll("*"));
    },
  };
}

/**
 * Every exit (polish spec §5.3): inert from its first frame, so a leaving
 * element can never catch a press meant for what replaced it. Svelte calls a
 * transition function as the outro starts, which is that first frame.
 */
function leaving(node: HTMLElement, config: TransitionConfig): TransitionConfig {
  node.inert = true;
  return config;
}

/** A modal or sheet leaving: falls 4 px and fades, over half a beat. */
export function surfaceOut(node: HTMLElement): TransitionConfig {
  if (reducedMotion()) return leaving(node, { duration: 0 });
  return leaving(node, {
    duration: BEAT * 500,
    css: (t) => `transform: translateY(${Math.round(4 * (1 - stepped(t)))}px); opacity: ${t}`,
  });
}

/** An overlay leaving: fades out over `SCREEN_FADE_MS`. */
export function fadeOut(node: HTMLElement): TransitionConfig {
  return leaving(node, reducedMotion() ? { duration: 0 } : { duration: SCREEN_FADE_MS, css: (t) => `opacity: ${t}` });
}

/** An overlay arriving: fades in over `SCREEN_FADE_MS`. Its controls take input at once. */
export function fadeIn(_node: HTMLElement): TransitionConfig {
  return reducedMotion() ? { duration: 0 } : { duration: SCREEN_FADE_MS, css: (t) => `opacity: ${t}` };
}

/**
 * A select step arriving: it cross-fades in over `SCREEN_FADE_MS` while the
 * step it replaces fades out. `direction` (1 is from the right) says which way
 * the player is going, which a fade does not draw; callers still pass it so a
 * step that slides again is a change here, not at every call.
 */
export function pageIn(_node: HTMLElement, _options: { direction: 1 | -1 }): TransitionConfig {
  return reducedMotion() ? { duration: 0 } : { duration: SCREEN_FADE_MS, css: (t) => `opacity: ${t}` };
}

/** A select step leaving: the other half of `pageIn`'s cross-fade. */
export function pageOut(node: HTMLElement, _options: { direction: 1 | -1 }): TransitionConfig {
  return leaving(node, reducedMotion() ? { duration: 0 } : { duration: SCREEN_FADE_MS, css: (t) => `opacity: ${t}` });
}

/** How long a confirmation shows before the label returns (polish spec §5.1). */
export const CONFIRM_MS = 1_200;

/**
 * Swaps a control's label for its confirmation ("Copied" and a tick).
 *
 * A Svelte action over a control holding two `[data-confirm-label]` cells,
 * `idle` and `done`. Both sit in one grid cell, so the control is always as
 * wide as the longer label in whatever locale is showing, and the swap never
 * moves what is beside it. The caller owns how long `active` stays true.
 */
export function confirm(node: HTMLElement, options: { active: boolean }) {
  node.style.display = "inline-grid";
  const cells = (): HTMLElement[] => [...node.querySelectorAll<HTMLElement>("[data-confirm-label]")];
  for (const cell of cells()) cell.style.gridArea = "1 / 1";
  let shown: boolean | undefined;
  const show = ({ active }: { active: boolean }): void => {
    for (const cell of cells()) {
      const visible = (cell.dataset["confirmLabel"] === "done") === active;
      cell.style.visibility = visible ? "visible" : "hidden";
      // The confirmation steps in; the label it replaces does not need to.
      if (visible && active && shown === false && !reducedMotion()) {
        gsap.from(cell, { y: 4, duration: BEAT * 0.5, ease: STEP_EASE, roundProps: "y" });
      }
    }
    shown = active;
  };
  show(options);
  return { update: show };
}

/**
 * How long, in milliseconds, a place left by one screen is still the place
 * the next one's element glides from. Long enough to span the menu bundle's
 * (cached) load between two screens; short enough that coming back to a
 * screen later never glides from somewhere the player has forgotten.
 */
const CARRY_WINDOW_MS = 1000;

/** Where each carried element last stood, and when it left. */
const carried = new Map<string, { x: number; y: number; leftAt: number | undefined }>();

/**
 * Glides an element from where its counterpart on the last screen stood.
 *
 * A Svelte action: `<div use:carryOver={"menu-sheet"}>`. The title and the
 * lobby each mount their own menu sheet, and the two stand in different
 * places, so going from one to the other moved the side panel instantly --
 * it read as the menu jumping. With the same key on both, the one arriving
 * starts where the one leaving stood and steps to its own place.
 *
 * The place is kept current while the element is mounted rather than read
 * when it leaves: Svelte takes an element out of the document before its
 * action is torn down, and a detached element has no place to read.
 */
export function carryOver(node: HTMLElement, key: string) {
  const offset = (axis: "x" | "y"): number => Number(gsap.getProperty(node, axis)) || 0;
  const place = (): { x: number; y: number } => {
    const box = node.getBoundingClientRect();
    // Less any glide in progress, so the place is where it is going.
    return { x: box.left - offset("x"), y: box.top - offset("y") };
  };
  const record = (): void => {
    if (!node.isConnected) return;
    carried.set(key, { ...place(), leftAt: undefined });
  };

  const from = carried.get(key);
  let tween: gsap.core.Tween | undefined;
  if (from?.leftAt !== undefined && performance.now() - from.leftAt < CARRY_WINDOW_MS && !reducedMotion()) {
    const here = place();
    const dx = Math.round(from.x - here.x);
    const dy = Math.round(from.y - here.y);
    if (dx !== 0 || dy !== 0) {
      tween = gsap.from(node, {
        x: dx,
        y: dy,
        duration: BEAT * 1.5,
        ease: STEP_EASE,
        roundProps: "x,y",
        onComplete: () => gsap.set(node, { clearProps: "x,y,transform" }),
      });
    }
  }
  record();

  // What moves the element without a screen change: its own content, or the
  // window around it.
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(record);
  observer?.observe(node);
  globalThis.addEventListener?.("resize", record);

  return {
    destroy() {
      tween?.kill();
      observer?.disconnect();
      globalThis.removeEventListener?.("resize", record);
      const last = carried.get(key);
      if (last !== undefined) last.leftAt = performance.now();
    },
  };
}

/**
 * Grows an element from where the element `find` returns stands to its own
 * full box.
 *
 * A Svelte action: `<div use:growFrom={(node) => art}>`. The source is looked
 * up from the element once it is in the page, never before: an element that
 * arrives with the component around it is mounted before that component has
 * a handle on its own box. The box itself moves, whole
 * pixels at every frame, so a cover-fit image inside starts as the art the
 * player was looking at and widens with it, rather than a window opening on
 * a different crop. Eased smoothly, not stepped: a box this large crossing
 * the screen in eight jumps reads as a stutter, not a grow. Reduced motion
 * arrives at once. It lasts `GROW`, which the server's reveal leaves room
 * for (`REVEAL_RESULT_TICKS`) with a second to spare.
 */
/** How long `growFrom` takes, in seconds: two and a half beats. */
export const GROW = BEAT * 2.5;

export function growFrom(node: HTMLElement, find: (node: HTMLElement) => Element | null | undefined) {
  const source = find(node);
  if (source == null || reducedMotion()) return {};
  const outer = node.getBoundingClientRect();
  const inner = source.getBoundingClientRect();
  if (outer.width === 0 || outer.height === 0 || inner.width === 0 || inner.height === 0) return {};
  const tween = gsap.fromTo(
    node,
    {
      left: Math.round(inner.left - outer.left),
      top: Math.round(inner.top - outer.top),
      width: Math.round(inner.width),
      height: Math.round(inner.height),
    },
    {
      left: 0,
      top: 0,
      width: Math.round(outer.width),
      height: Math.round(outer.height),
      duration: GROW,
      ease: "power2.out",
      roundProps: "left,top,width,height",
      onComplete: () => gsap.set(node, { clearProps: "left,top,width,height" }),
    },
  );
  return { destroy: () => tween.kill() };
}
