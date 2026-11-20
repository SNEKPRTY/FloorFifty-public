<script lang="ts">
  /**
   * The room code, for a player with only a pad: six letter cells, like the
   * seed editor's digits. Up and down step the focused cell through the code
   * alphabet, left and right move between cells (`ff-steer`, offered by
   * FocusNavigator), A on a cell or on Join room joins. A keyboard types into
   * the cells too; Backspace clears one. The rules are `code-entry.ts`'s.
   */
  import * as m from "../../paraglide/messages.js";
  import { ROOM_CODE_LENGTH } from "@floor-fifty/shared/common/schemas";
  import Button from "../kit/Button.svelte";
  import Modal from "../kit/Modal.svelte";
  import { focusControl } from "../platform/focus-nav";
  import { codeEntry, entryCode, eraseLetter, moveCodeCursor, stepLetter, typeLetter, type CodeEntry } from "./code-entry";

  let {
    start,
    onJoin,
    onClose,
  }: {
    /** The code typed so far. */
    start: string;
    onJoin: (code: string) => void;
    onClose: () => void;
  } = $props();

  // Opens on `start`, then belongs to the player.
  let entry = $state<CodeEntry>(codeEntry((() => start)()));
  const code = $derived(entryCode(entry));
  let cells: HTMLElement[] = $state([]);

  function set(next: CodeEntry): void {
    entry = next;
    focusControl(cells[next.cursor], { within: false });
  }

  // After the Modal's own landing: the cell the code goes on from takes focus.
  $effect(() => {
    queueMicrotask(() => focusControl(cells[entry.cursor], { within: false }));
  });

  /** Off either end, the direction is left untaken, so focus walks on to Join room. */
  function steer(event: Event): void {
    const direction = (event as CustomEvent<{ direction: string }>).detail.direction;
    if (direction === "up") set(stepLetter(entry, 1));
    else if (direction === "down") set(stepLetter(entry, -1));
    else if (direction === "left" && entry.cursor > 0) set(moveCodeCursor(entry, -1));
    else if (direction === "right" && entry.cursor < ROOM_CODE_LENGTH - 1) set(moveCodeCursor(entry, 1));
    else return;
    event.preventDefault();
  }

  function key(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      return join();
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      return set(eraseLetter(entry));
    }
    if (event.ctrlKey || event.metaKey || event.altKey || !/^[a-z0-9]$/i.test(event.key)) return;
    event.preventDefault();
    set(typeLetter(entry, event.key));
  }

  /** A pad's A is FocusNavigator's plain click (detail 0) on the focused cell; a pointer's click only moves the cursor. */
  function clickCell(event: MouseEvent, at: number): void {
    if (event.detail === 0) return join();
    set({ ...entry, cursor: at });
  }

  function join(): void {
    if (code === undefined) return;
    onJoin(code);
    onClose();
  }
</script>

<Modal title={m.lobby_have_code()} testId="code-editor" {onClose} onBackdrop={onClose}>
  <div class="ff-code-editor" role="group" aria-label={m.lobby_have_code()}>
    {#each entry.letters as letter, at (at)}
      <div
        bind:this={cells[at]}
        class="ff-aq-field ff-code-editor__cell"
        data-testid="code-letter"
        data-cursor={String(at === entry.cursor)}
        role="spinbutton"
        tabindex="0"
        aria-label={m.lobby_code_letter({ position: at + 1 })}
        aria-valuetext={letter === "" ? "–" : letter}
        onfocus={() => (entry = { ...entry, cursor: at })}
        onff-steer={steer}
        onkeydown={key}
        onclick={(event) => clickCell(event, at)}
      >
        {letter === "" ? "·" : letter}
      </div>
    {/each}
  </div>
  {#snippet actions()}
    <Button kind="go" split class="ff-code-editor__join" data-testid="code-join" disabled={code === undefined} onclick={join}>
      {m.lobby_join_room()} <span aria-hidden="true">→</span>
    </Button>
  {/snippet}
</Modal>

<style>
  .ff-code-editor { display: flex; justify-content: center; gap: 6px; }
  .ff-code-editor__cell {
    display: grid;
    place-items: center;
    width: 44px;
    height: 56px;
    border-radius: 12px;
    padding: 0;
    font: 600 var(--ff-type-title) / 1 var(--ff-font-ui);
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
  }
  .ff-code-editor__cell[data-cursor="true"] { box-shadow: 0 0 0 2px var(--ff-plain); }
  .ff-code-editor__cell:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ff-text); }
  :global(.ff-code-editor__join) { width: 100%; }
  /* Narrow dialogs (a phone held upright): smaller cells, so six fit one line. */
  @container ff-dialog (max-width: 360px) {
    .ff-code-editor__cell { width: 36px; height: 48px; }
  }
</style>
