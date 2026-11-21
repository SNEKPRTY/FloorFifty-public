<script lang="ts">
  /**
   * The stage step's seed chip (stage seeds spec §4.1): the seat's choice,
   * Random, Classic or a code. A press on Random moves to Classic; a press on
   * Classic or a code asks for the editor, which the step draws outside the
   * glass panel (a `backdrop-filter` there would hold a fixed dialog inside
   * it). It shows the room's answer, never its own guess: a refusal leaves it
   * where the room has it.
   */
  import * as m from "../../paraglide/messages.js";
  import type { SeedChoice } from "@floor-fifty/shared/room/select";
  import Button from "../kit/Button.svelte";
  import { seedChoiceLabel } from "./select-model";

  let {
    choice,
    locked,
    onChoose,
    onEdit,
  }: {
    choice: SeedChoice;
    locked: boolean;
    onChoose: (choice: SeedChoice) => void;
    onEdit: () => void;
  } = $props();

  const label = $derived(seedChoiceLabel(choice));
</script>

<Button
  kind="ghost"
  class="ff-seed-chip"
  data-testid="seed-chip"
  data-choice={String(choice)}
  data-sfx="none"
  disabled={locked}
  aria-label={m.select_seed_chip_label({ choice: label })}
  onclick={() => {
    if (choice === "random") onChoose("classic");
    else onEdit();
  }}
>
  {#if choice === "random"}
    <!-- A die's face: Random is drawn, not typed. -->
    <svg class="ff-seed-chip__die" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="2" />
      <circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.6" fill="currentColor" />
    </svg>
  {:else}
    <!-- A hash: sideways, Classic and a code show this alone (see the styles). -->
    <svg class="ff-seed-chip__hash" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 4 7 20M17 4l-2 16M4.5 9h15M4 15h15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  {/if}
  <span class="ff-seed-chip__label">{label}</span>
</Button>

<style>
  :global(.ff-seed-chip) {
    flex: none;
    gap: 6px;
    min-height: 44px;
    padding-inline: 12px;
    font: 600 var(--ff-type-name) / 1 var(--ff-font-ui);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ff-seed-chip__die, .ff-seed-chip__hash { width: 18px; height: 18px; }
  /* The hash is for sideways only: elsewhere a code or Classic reads as text. */
  .ff-seed-chip__hash { display: none; }
  /* Sideways, the action line shares its row with the headline and the dots,
     and a 667-wide phone had no room for the label: Lock in ran off the
     screen. The chip is a target-sized square there, its choice in its
     label; the seat's own row shows a chosen seed's code. */
  :global(.ff-select[data-layout="sideways"] .ff-seed-chip) { width: var(--ff-aq-target); min-height: var(--ff-aq-target); padding: 0; justify-content: center; }
  :global(.ff-select[data-layout="sideways"]) .ff-seed-chip__hash { display: block; }
  :global(.ff-select[data-layout="sideways"]) .ff-seed-chip__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
