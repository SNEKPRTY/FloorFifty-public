<script lang="ts">
  /**
   * A panel in the Aquarian material.
   *
   * This used to slice a 24x24 PNG with `border-image`, on the theory that a
   * DOM panel and a drawn HUD chip should be the same object cut from one
   * asset. The smooth interface retires that: its material is a flat pearl
   * face, a hairline edge and a soft shadow, which is a CSS surface rather
   * than a bitmap, so there is no frame to slice and no `--ff-scale` to keep
   * the pixels square. The public props are unchanged, so a caller moves to the
   * new look by doing nothing.
   *
   * Every Chip is the one glass `Panel` (Owner, 2026-11-19:
   * "we should never use a non-glossy panel"). `frame` names the caller's use
   * and no longer changes the look.
   */
  import type { Snippet } from "svelte";
  import Panel from "./Panel.svelte";

  let {
    children,
    tone = "default",
    frame = "chip",
    class: className = "",
  }: {
    children: Snippet;
    /** `danger` tints the text, for a panel reporting a refusal. */
    tone?: "default" | "danger";
    /** `chip` is the opaque compact tier; `title` is the wide pearl plate. */
    frame?: "chip" | "title";
    class?: string;
  } = $props();
</script>

<!-- Already on screen with the rest of its panel: a chip neither rises nor falls. -->
<Panel class="chip {className}" data-tone={tone} data-frame={frame} arrive="none" leave="none">{@render children()}</Panel>

<style>
  :global(.chip) {
    color: var(--ff-text);
    font-family: var(--ff-font-ui);
  }

  /* Both tiers are the one glass panel (the kit's `Panel`, the shared rule in aquarian.css):
     the Owner's "never a non-glass panel" (2026-11-19). `frame` is kept for its callers. */

  /* A refusal marks its edge, not its words: the world's red on the panel is
     too faint to read (about 2.2:1), while the danger colour is a mark held
     to 3:1 and the words stay the panel's white. */
  :global(.chip[data-tone="danger"]) {
    border-color: var(--ff-danger);
  }
</style>
