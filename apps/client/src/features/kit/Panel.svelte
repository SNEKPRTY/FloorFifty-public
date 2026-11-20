<script lang="ts">
  /**
   * The one glass panel (Owner, 2026-11-19: "we should never use a non-glossy
   * panel"). It wears the shared rule `.ff-aquarian-panel` (`.ff-aq-hud` for
   * the HUD's tone) and carries the house arrive and leave, so a screen that
   * wants a panel asks for this and styles nothing of its own. It is the only
   * component allowed to write those two classes (`one-look.test.ts`).
   *
   * It rises in by `PANEL_IN` (8 px, 150 ms, stepped), staggered by `order`,
   * and falls out over half a beat, `inert` from its first exit frame. Both
   * land at once under reduced motion (`motion.ts`).
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import type { TransitionConfig } from "svelte/transition";
  import { surfaceOut } from "./motion";

  let {
    as = "div",
    tone = "menu",
    arrive = "rise",
    leave = "fall",
    order = 0,
    class: className = "",
    style = "",
    type,
    ref = $bindable(),
    children,
    ...rest
  }: {
    /** `span`, `p` and `button` are for the race HUD's chips, its standings line and its on-screen buttons. */
    as?: "div" | "section" | "aside" | "header" | "footer" | "span" | "p" | "button";
    tone?: "menu" | "hud";
    /** `rise-long` is the 300 ms rise results keeps; `none` where the caller's CSS already rises it. */
    arrive?: "rise" | "rise-long" | "none";
    leave?: "fall" | "none";
    /** Its slot in a staggered entrance. */
    order?: number;
    class?: string;
    style?: string;
    /** For `as="button"`: a panel that is pressed. */
    type?: "button";
    /** The root, for a caller that measures or shakes it. */
    ref?: HTMLElement | undefined;
    children?: Snippet;
  } & Omit<HTMLAttributes<HTMLElement>, "children" | "class" | "style"> = $props();

  /**
   * The rise is the stylesheet's keyframe (`.ff-panel-arrive`), not a GSAP
   * tween: the panel takes input from its first frame, and a GSAP tween left
   * inline styles on the element that stopped Svelte's exit from ever
   * finishing. The stagger slot reaches the keyframe as a custom property.
   */
  const riseClass = $derived(arrive === "none" ? "" : arrive === "rise-long" ? "ff-panel-arrive ff-panel-arrive--long" : "ff-panel-arrive");
  const rootStyle = $derived(`--ff-panel-order: ${order}; ${style}`);

  /** A panel that stays (`leave="none"`) is not marked leaving; it just goes. */
  function exit(node: HTMLElement): TransitionConfig {
    return leave === "none" ? { duration: 0 } : surfaceOut(node);
  }
</script>

<!-- `global`: the panel is almost always inside a caller's `{#if}`, not in a block of its own. -->
<svelte:element
  this={as}
  bind:this={ref}
  out:exit|global
  class="{tone === 'hud' ? 'ff-aq-hud' : 'ff-aquarian-panel'} {riseClass} {className}"
  style={rootStyle}
  {type}
  {...rest}
>
  {@render children?.()}
</svelte:element>
