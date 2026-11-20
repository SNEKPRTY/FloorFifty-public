<script lang="ts">
  /**
   * A racer's name, the same everywhere it appears (UI layout system spec
   * §5): the player's colour as a dot, then the name. The name is the one
   * thing in the interface allowed to be cut (`data-truncatable`), with the
   * whole of it in `title` and in the DOM. An open seat has no colour and no
   * dot. `whole` is for a seat, where the name is never cut: it wraps at a
   * hyphen or space and the row grows. `self` edges the local racer's pill in ink. The race's canvas tags
   * mirror this (`features/race/name-tag.ts`).
   */
  import type { SeatColour } from "@floor-fifty/shared/common/seats";

  let {
    name,
    colour,
    self = false,
    whole = false,
    testId,
  }: { name: string; colour?: SeatColour; self?: boolean; whole?: boolean; testId?: string } = $props();
</script>

<span class="ff-namepill" data-self={self ? "true" : undefined} data-whole={whole ? "true" : undefined} data-testid={testId}>
  <!-- No whitespace between the dot and the name: the pill's text is the name alone. -->
  {#if colour !== undefined}<span aria-hidden="true" class="ff-namepill__dot ff-colour-{colour}"></span>{/if}<span
    data-truncatable={whole ? undefined : ""} class="ff-namepill__name" title={name}>{name}</span>
</span>
