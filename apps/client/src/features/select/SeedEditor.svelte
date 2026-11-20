<script lang="ts">
  /**
   * The seed editor (stage seeds spec §4.2): six digit cells, a typed field
   * that mirrors them, and the way back to Random or Classic. A pad's up and
   * down change the focused digit and its left and right move between cells
   * (`ff-steer`, offered by FocusNavigator, which the arrow keys reach too);
   * digit keys type and move on; a touch on a cell's upper half raises it and
   * on its lower half lowers it. The rules are `seed-entry.ts`'s.
   */
  import * as m from "../../paraglide/messages.js";
  import { SEED_DIGITS, type SeedChoice } from "@floor-fifty/shared/room/select";
  import { entrySeed, moveCursor, nudge, parseSeedText, seedEntry, typeDigit, type SeedEntry } from "./seed-entry";
  import Button from "../kit/Button.svelte";
  import Modal from "../kit/Modal.svelte";
  import { focusControl } from "../platform/focus-nav";

  let {
    start,
    onChoose,
    onClose,
  }: {
    /** The seed the cells open on. */
    start: number;
    onChoose: (choice: SeedChoice) => void;
    onClose: () => void;
  } = $props();

  // Opens on `start`, then belongs to the player.
  let entry = $state<SeedEntry>(seedEntry((() => start)()));
  /** The typed field's own text, kept while it is not a seed so a half-typed value is not rewritten under the player. */
  let text = $state(String(entrySeed(entry)).padStart(SEED_DIGITS, "0"));
  const typed = $derived(parseSeedText(text));
  let cells: HTMLElement[] = $state([]);

  /** After every change from the cells, the field shows them. */
  function set(next: SeedEntry, focus = true): void {
    entry = next;
    text = String(entrySeed(next)).padStart(SEED_DIGITS, "0");
    if (focus) focusControl(cells[next.cursor], { within: false });
  }

  // The Modal puts focus on its Close as it mounts, after this does: the first digit takes it back.
  $effect(() => {
    queueMicrotask(() => focusControl(cells[0], { within: false }));
  });

  /**
   * Up and down change the digit; left and right move between cells. Off
   * either end, the direction is left untaken, so FocusNavigator walks focus
   * on to the field and the buttons (final review I1).
   */
  function steer(event: Event): void {
    const direction = (event as CustomEvent<{ direction: string }>).detail.direction;
    if (direction === "up") set(nudge(entry, 1));
    else if (direction === "down") set(nudge(entry, -1));
    else if (direction === "left" && entry.cursor > 0) set(moveCursor(entry, -1));
    else if (direction === "right" && entry.cursor < SEED_DIGITS - 1) set(moveCursor(entry, 1));
    else return;
    event.preventDefault();
  }

  function key(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      return choose(entrySeed(entry));
    }
    if (!/^[0-9]$/.test(event.key)) return;
    event.preventDefault();
    set(typeDigit(entry, Number(event.key)));
  }

  /** A pad's A is FocusNavigator's plain click (detail 0) on the focused cell: it uses the seed shown. A pointer's click is a tap, already handled. */
  function confirmFromCell(event: MouseEvent): void {
    if (event.detail === 0) choose(entrySeed(entry));
  }

  /** A touch on a cell: the upper half raises it, the lower half lowers it. A mouse only moves the cursor. */
  function press(event: PointerEvent, at: number): void {
    const here = { ...entry, cursor: at };
    if (event.pointerType === "mouse") return set(here);
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    set(nudge(here, event.clientY < box.top + box.height / 2 ? 1 : -1));
  }

  function input(event: Event): void {
    text = (event.currentTarget as HTMLInputElement).value;
    if (typed !== undefined) entry = { ...seedEntry(typed), cursor: entry.cursor };
  }

  function choose(choice: SeedChoice): void {
    onChoose(choice);
    onClose();
  }
</script>

<Modal title={m.select_seed_label()} testId="seed-editor" {onClose} onBackdrop={onClose}>
  <div class="ff-seed-editor">
    <div class="ff-seed-editor__cells" role="group" aria-label={m.select_seed_label()}>
      <span class="ff-seed-editor__hash" aria-hidden="true">#</span>
      {#each entry.digits as digit, at (at)}
        <div
          bind:this={cells[at]}
          class="ff-aq-field ff-seed-editor__cell"
          data-testid="seed-digit"
          data-cursor={String(at === entry.cursor)}
          role="spinbutton"
          tabindex="0"
          aria-label={m.select_seed_digit({ position: at + 1 })}
          aria-valuenow={digit}
          aria-valuemin={0}
          aria-valuemax={9}
          onfocus={() => (entry = { ...entry, cursor: at })}
          onff-steer={steer}
          onkeydown={key}
          onclick={confirmFromCell}
          onpointerdown={(event) => press(event, at)}
        >
          {digit}
        </div>
      {/each}
    </div>
    <input
      class="ff-aq-field ff-seed-editor__text"
      data-testid="seed-text"
      type="text"
      inputmode="numeric"
      maxlength="7"
      autocomplete="off"
      spellcheck="false"
      aria-label={m.select_seed_enter()}
      value={text}
      oninput={input}
    />
  </div>
  {#snippet actions()}
    <div class="ff-seed-editor__actions">
      <Button kind="ghost" data-testid="seed-random" onclick={() => choose("random")}>{m.select_seed_random()}</Button>
      <Button kind="ghost" data-testid="seed-classic" onclick={() => choose("classic")}>{m.select_seed_classic()}</Button>
      <Button
        kind="go"
        class="ff-seed-editor__confirm"
        data-testid="seed-confirm"
        disabled={typed === undefined}
        onclick={() => {
          if (typed !== undefined) choose(typed);
        }}
      >
        {m.select_seed_confirm()}
      </Button>
    </div>
  {/snippet}
</Modal>

<style>
  .ff-seed-editor { display: grid; gap: 14px; justify-items: center; }
  .ff-seed-editor__cells { display: flex; align-items: center; gap: 6px; }
  .ff-seed-editor__hash { font: 600 var(--ff-type-title) / 1 var(--ff-font-ui); color: var(--ff-text-2); margin-right: 2px; }
  .ff-seed-editor__cell {
    display: grid;
    place-items: center;
    width: 44px;
    height: 56px;
    border-radius: 12px;
    padding: 0;
    font: 600 var(--ff-type-title) / 1 var(--ff-font-ui);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
  }
  .ff-seed-editor__cell[data-cursor="true"] { box-shadow: 0 0 0 2px var(--ff-plain); }
  .ff-seed-editor__cell:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ff-text); }
  .ff-seed-editor__text {
    width: 100%;
    max-width: 18ch;
    min-height: var(--ff-aq-control-height);
    padding: 0 12px;
    border-radius: var(--ff-control-radius);
    font: 600 var(--ff-type-title) / 1 var(--ff-font-ui);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.12em;
    text-align: center;
  }
  .ff-seed-editor__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; width: 100%; }
  :global(.ff-seed-editor__confirm) { flex: 1 1 auto; }
  /* Narrow dialogs (a phone held upright): smaller cells, so six and the "#" fit one line. */
  @container ff-dialog (max-width: 360px) {
    .ff-seed-editor__cell { width: 36px; height: 48px; font-size: var(--ff-type-title); }
  }
</style>
