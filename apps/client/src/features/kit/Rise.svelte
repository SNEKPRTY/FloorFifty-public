<script lang="ts">
  /**
   * A thing that rises into place as it arrives and has no glass of its own: a wordmark, the racers
   * on their ledge. A glass surface is a `Panel`, which rises itself; this is the same rise
   * (`riseIn`, `PANEL_IN`, staggered by `delay` places) for the rest of a screen's furniture, so no
   * screen wires its own arrival (`one-look.test.ts`).
   *
   * `still` is for a thing the player already sees, such as the title's hero carried over to the
   * lobby: it is placed at once. `long` is the calmer 300 ms reveal the results screen keeps.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { riseIn } from "./motion";

  let {
    delay = 0,
    still = false,
    long = false,
    class: className = "",
    children,
    ...rest
  }: {
    delay?: number;
    still?: boolean;
    long?: boolean;
    class?: string;
    children?: Snippet;
  } & Omit<HTMLAttributes<HTMLDivElement>, "children" | "class"> = $props();
</script>

<div class={className} use:riseIn={{ delay, still, duration: long ? 0.3 : undefined }} {...rest}>{@render children?.()}</div>
