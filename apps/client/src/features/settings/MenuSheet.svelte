<script lang="ts">
  /**
   * The menu's form column (responsive parity spec §3.4): a sheet rising from
   * the bottom edge on a phone held upright, a side column held sideways and
   * on desktop, a centred card on a tablet held upright. It is a slot, so
   * phase 2's Lobby and title actions sit in the same place.
   *
   * It scrolls inside itself, never the page. It clears the keyboard because
   * the screen it sits in ends above it (`.ff-screen`, which reads
   * `--ff-visual-inset-bottom`): the layout viewport is never resized for the
   * keyboard (see the viewport meta), so that inset is the one signal on iOS
   * and Android alike.
   *
   * The title and the lobby each mount their own, and the two stand in
   * different places, so the one arriving glides from where the one leaving
   * stood (`carryOver`) rather than appearing in its own place.
   */
  import type { Snippet } from "svelte";
  import { lockOverscroll } from "../platform/lock-overscroll";
  import { carryOver } from "../kit/motion";

  let { children }: { children: Snippet } = $props();
</script>

<!-- `relative z-1`: the sheet paints over the hero. They overlap only when
     the keyboard shrinks the screen, and there the racers (positioned, so
     otherwise painted above a static sheet) covered "Create room". -->
<div
  use:lockOverscroll
  use:carryOver={"menu-sheet"}
  data-testid="menu-sheet"
  data-scroll-region
  class="ff-sheet relative z-1 max-h-full overflow-y-auto"
>
  {@render children()}
</div>

<style>
  /* Where it stands comes from the frame's arrangement, not the form factor:
     in a stack, where the stack's token puts it (a phone's foot, under a
     tablet's hero); centred beside the hero in a split. Its width is a token
     per form factor. */
  .ff-sheet {
    width: var(--ff-sheet-width);
    justify-self: center;
  }
  :global([data-arrangement="stack"]) .ff-sheet {
    align-self: var(--ff-stack-sheet-align);
  }
  :global([data-arrangement="split"]) .ff-sheet {
    align-self: center;
  }
</style>
