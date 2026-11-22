<script lang="ts">
  /**
   * The create-and-join half of room formation.
   *
   * Nothing here reads a snapshot. That is deliberate and load-bearing: the
   * panel is never re-created by a broadcast, so a half-typed name survives a
   * reconnect. The imperative screen this replaces had to build its DOM once
   * and never rebuild it to get the same result; here it falls out of the
   * component tree, provided nothing above keys on snapshot data.
   *
   * It is the form alone: the card and the key legend. `LobbyRoot` sets it in
   * a `MenuSheet` beside or under the hero, in its `ScreenFrame` (UI layout
   * spec §6.2). Its spacing and its two-row shape on a short screen are the
   * `--ff-connect-*` tokens (aquarian-tokens.css); it names no form factor.
   */
  import * as m from "../../paraglide/messages.js";
  import { PLAYER_NAME_MAX_LENGTH, ROOM_CODE_LENGTH } from "@floor-fifty/shared/common/schemas";
  import type { NetworkPort } from "../net/network";
  import { defaultRacerName } from "../profile/default-name";
  import { cleanRoomCode } from "./room-code-input";
  import CodeEditor from "./CodeEditor.svelte";
  import Button from "../kit/Button.svelte";
  import Panel from "../kit/Panel.svelte";
  import Rise from "../kit/Rise.svelte";
  import { currentHosting } from "../ruken/current";
  import type { ControlPrompts } from "@floor-fifty/shared/content/game-content";
  import type { SettingsStore } from "../profile/store/settings.svelte";
  import Instructions from "./Instructions.svelte";
  import MatchGate from "./MatchGate.svelte";

  let {
    network,
    attempt: run,
    setStatus,
    touchMode = "swipe",
    settings,
    prompts,
    artSrc,
  }: {
    network: NetworkPort;
    /** Runs a room command, reporting a refusal in place. */
    attempt: (action: () => Promise<void>) => void;
    settings: SettingsStore;
    /** The control prompts, for the Instructions' captions. */
    prompts: ControlPrompts | undefined;
    artSrc: (alias: string) => string | undefined;
    setStatus: (message: () => string, tone?: "info" | "error") => void;
    /** Which touch controls a race will show, so the help names those. */
    touchMode?: "swipe" | "buttons";
  } = $props();

  /**
   * Where the last name used is kept, so a returning player skips retyping it.
   *
   * A convenience, not state: storage that is blocked, full or cleared just
   * means an empty field, so every access tolerates a throw. Inside Ruken it
   * is kept in the player's Ruken saves (P6 §4); outside, in this browser.
   */
  const NAME_KEY = "ff.playerName";

  function recalledName(): string {
    try {
      return (currentHosting().storage?.getItem(NAME_KEY) ?? "").slice(0, PLAYER_NAME_MAX_LENGTH);
    } catch {
      return "";
    }
  }

  function rememberName(value: string): void {
    try {
      currentHosting().storage?.setItem(NAME_KEY, value);
    } catch {
      // Nothing to do: the next visit starts with an empty field.
    }
  }

  let name = $state(recalledName());
  let code = $state("");
  /** The letter cells a pad types the code in (`CodeEditor`); a pad has no keys. */
  let editingCode = $state(false);

  /**
   * The racer name an empty field gets, drawn once and shown as the field's
   * placeholder, so the name it shows is the name the player races as. The
   * number is drawn once; the word follows a language switch.
   */
  const roll = Math.random();
  const fallbackName = $derived(defaultRacerName(() => roll));

  /**
   * The trimmed name, or the racer name when the field is empty -- a
   * controller cannot type one. Either is remembered, so the next visit keeps it.
   */
  function playerName(): string {
    const value = name.trim() || fallbackName;
    name = value;
    rememberName(value);
    return value;
  }

  /**
   * The one way into a match for all three buttons. A player never shown how
   * to climb is asked once first (`MatchGate`), and the press waits here until
   * they answer: Skip carries it on, Show me how drops it, since
   * the flag is then set and the next press goes straight in.
   */
  let gate = $state<"closed" | "ask" | "instructions">("closed");
  let held: (() => Promise<void>) | undefined;

  function attempt(action: () => Promise<void>): void {
    const shown = settings.value.seen.tutorial;
    if (shown) return run(action);
    held = action;
    gate = "ask";
  }

  function skipGate(): void {
    settings.update({ seen: { tutorial: true } });
    gate = "closed";
    const action = held;
    held = undefined;
    if (action !== undefined) run(action);
  }

  function create(): void {
    const value = playerName();
    attempt(() => network.createRoom(value));
  }

  function findRace(): void {
    const value = playerName();
    attempt(() => network.quickMatch(value));
  }

  /**
   * Typing a code is the sign that the player means to join, so the code row's
   * button changes with it rather than a toggle being added. Derived from the
   * field alone: nothing here reads a snapshot.
   */
  const hasCode = $derived(code.trim().length > 0);

  function codeAction(): void {
    if (hasCode) join();
    else create();
  }

  function join(): void {
    const room = code.trim().toUpperCase();
    if (room.length !== ROOM_CODE_LENGTH) {
      setStatus(() => m.lobby_room_code_length({ length: ROOM_CODE_LENGTH }), "error");
      return;
    }
    const value = playerName();
    attempt(() => network.joinRoom(room, value));
  }

  /**
   * Enter acts on the field it was pressed in: the name creates, the code joins.
   *
   * Handled per field rather than by wrapping them in forms. A form holding a
   * text field and a submit button reads as a sign-in to a password manager,
   * which then pops an AutoFill offer over the room code.
   */
  function onEnter(action: () => void): (event: KeyboardEvent) => void {
    return (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      action();
    };
  }
</script>

<div class="ff-connect ff-connect__side flex flex-wrap items-end gap-16">
  <div class="ff-connect__panel">
    <!-- The card's spacing is the cards' tokens (12 / 16 on a phone held
         upright, 8 / 12 on a short screen, 20 / 24 otherwise), and on a short
         screen it lays out as one two-column grid its rows share (subgrid):
         both fields one width, both buttons another (`--ff-connect-*`,
         aquarian-tokens.css, tightened by the height tier). -->
    <Panel order={1} class="ff-connect__card grid">
      <!-- No form elements, and each field carries the password managers'
           opt-outs: none of this is a login, and a manager that thinks it is
           pops its AutoFill offer over the code.
           A short screen sets each field beside its button, so the form is
           two rows high (spec §5.7). -->
      <div class="ff-connect__group grid">
        <div class="grid">
          <label class="ff-aq-label" for="ff-name">{m.lobby_your_name()}</label>
          <input
            id="ff-name"
            data-testid="name-input"
            type="text"
            bind:value={name}
            maxlength={PLAYER_NAME_MAX_LENGTH}
            placeholder={fallbackName}
            autocomplete="nickname"
            enterkeyhint="go"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
            onkeydown={onEnter(findRace)}
            class="ff-aq-field"
          />
        </div>

        <Button kind="go" split data-testid="find-race" onclick={findRace}>
          {m.lobby_find_race()} <span aria-hidden="true">→</span>
        </Button>
      </div>

      <div class="ff-connect__group grid">
        <div class="grid">
          <!-- Nothing in the id or name says "code": Apple's Passwords also
               fills one-time codes, and it read this field as one. -->
          <label class="ff-aq-label" for="ff-room">{m.lobby_have_code()}</label>
          <input
            id="ff-room"
            name="room"
            data-testid="code-input"
            type="text"
            value={code}
            oninput={(event) => {
              code = cleanRoomCode(event.currentTarget.value);
              event.currentTarget.value = code;
            }}
            placeholder="ABC123"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
            enterkeyhint="go"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
            onkeydown={onEnter(() => {
              if (hasCode) join();
            })}
            onclick={(event) => {
              // A pad's A is FocusNavigator's plain click (detail 0); a tap or a mouse sets the caret.
              if (event.detail === 0) editingCode = true;
            }}
            class="ff-aq-field tracking-[0.08em] uppercase"
          />
        </div>

        <!-- One button for both: Create room while the code is empty, Join
             room once one is typed. Attributes and text change in place, so
             a press held across the swap still lands. -->
        <Button kind="ghost" split data-testid={hasCode ? "join-room" : "create-room"} onclick={codeAction}>
          {hasCode ? m.lobby_join_room() : m.lobby_create_room()} <span aria-hidden="true">→</span>
        </Button>
      </div>

      <!-- Dropped on a short screen (`--ff-connect-friends`), where there is no
           line to spare and the room's four seats say the same thing. Set
           against the panel's right edge, with the on-screen help under it. -->
      <p class="ff-aq-secondary m-0 justify-self-end text-right text-aq-muted" data-testid="menu-friends">{m.lobby_up_to_four()}</p>

      <!-- On-screen help for a coarse pointer, at the card's foot as the
           phone boards set it. The keyboard legend is the next row; the two
           are swapped by media query rather than by script, so the help that
           matches the player's input is the only one laid out. -->
      <Panel arrive="none" leave="none" class="ff-aq-secondary ff-help-touch m-0 text-aq-ink">
        {#if touchMode === "buttons"}
          {m.lobby_touch_help_buttons()}
        {:else}
          {m.lobby_touch_help_swipe()}
        {/if}
      </Panel>

      <!-- Keycaps as the panel's footer row, on its glass (UI layout spec §6.2). -->
      <Rise delay={3} class="ff-help">
      <dl class="m-0 flex flex-wrap gap-x-16 gap-y-8">
        <div class="flex items-center gap-8">
          <dt class="m-0 flex gap-4"><kbd class="ff-keycap">A</kbd><kbd class="ff-keycap">D</kbd></dt>
          <dd class="ff-help__label m-0">{m.settings_action_move()}</dd>
        </div>
        <div class="flex items-center gap-8">
          <dt class="m-0"><kbd class="ff-keycap">S</kbd></dt>
          <dd class="ff-help__label m-0">{m.settings_action_fast_fall()}</dd>
        </div>
      </dl>
      </Rise>
    </Panel>
  </div>
</div>

{#if editingCode}
  <CodeEditor
    start={code}
    onJoin={(typed) => {
      code = typed;
      join();
    }}
    onClose={() => (editingCode = false)}
  />
{/if}

<style>
  .ff-connect__panel {
    width: 100%;
  }

  /* The card's shape is the tokens' (aquarian-tokens.css, `--ff-connect-*`):
     one column by default; on a short screen each field sits beside its
     button in one grid the rows share (`subgrid`), so the form is two rows
     high (spec §5.7); on a compact one the two field labels go to screen
     readers and the touch help goes. The card names no form factor and no
     tier (UI layout spec §2, layer 3). */
  :global(.ff-connect__card) {
    grid-template-columns: var(--ff-connect-cols);
    column-gap: var(--ff-connect-gap-x);
    row-gap: var(--ff-connect-gap-y);
    padding: var(--ff-panel-pad);
  }

  .ff-connect__group {
    grid-column: var(--ff-connect-span);
    grid-template-columns: var(--ff-connect-group-cols);
    align-items: var(--ff-connect-group-align);
    gap: var(--ff-connect-group-gap);
  }

  .ff-connect__group {
    grid-template-rows: var(--ff-connect-group-rows);
  }

  .ff-connect__group > div {
    grid-column: var(--ff-connect-field-span);
    grid-row: var(--ff-connect-field-rows);
    grid-template-columns: var(--ff-connect-field-grid);
    grid-template-rows: var(--ff-connect-field-grid);
  }

  .ff-connect__group > div > input {
    grid-column: 1;
  }

  .ff-connect__group > :global(button) {
    grid-area: var(--ff-connect-button-cell) / var(--ff-connect-button-cell);
  }

  .ff-connect__group label {
    grid-column: var(--ff-connect-label-span);
    margin-bottom: calc(var(--ff-aq-field-gap) + var(--ff-connect-label-pull));
  }

  .ff-connect :global(.ff-help),
  :global(.ff-help-touch) {
    grid-column: var(--ff-connect-span);
  }

  [data-testid="menu-friends"] {
    display: var(--ff-connect-friends);
  }

  /* Fields and buttons at the 44 px floor on a short screen, rather than
     48 / 52, and labels closer to their fields. The tokens are resolved on
     the root, so these local overrides cannot loop. */
  .ff-connect {
    --ff-aq-control-height: var(--ff-connect-control-height);
    --ff-aq-field-gap: var(--ff-connect-field-gap);
  }

  .ff-connect :global(.ff-aq-control--split) {
    min-height: var(--ff-connect-split-height);
  }

  /* Beside its field in a narrow sheet, the button gives up its arrow and its
     side room, so the field keeps room for its whole default ("Piloto 12"). */
  @container ff-screen (max-width: 340px) {
    .ff-connect__group > :global(button) {
      justify-content: center;
      padding: 0 12px;
      /* A long label wraps at its space, never inside a word. */
      hyphens: manual;
      overflow-wrap: normal;
    }
    .ff-connect__group > :global(button > span[aria-hidden="true"]) {
      display: none;
    }
  }

  /* Visually hidden on a compact screen, still the fields' names. Clipped by
     `clip-path` alone, never `overflow: hidden`, so the screen contract does
     not read the label as hidden clipping. */
  .ff-connect label[for="ff-name"],
  .ff-connect label[for="ff-room"] {
    position: var(--ff-connect-label-position);
    width: var(--ff-connect-label-size);
    height: var(--ff-connect-label-size);
    clip-path: var(--ff-connect-label-clip);
    white-space: var(--ff-connect-label-wrap);
  }

  /* Ink on the panel's glass, now that the legend is its footer row. */
  .ff-help__label {
    font: 600 var(--ff-type-hint) / 1 var(--ff-font-ui);
    color: var(--ff-text);
    text-shadow: none;
    white-space: nowrap;
  }

  /* Keyboard help on a fine pointer, on-screen help on a coarse one. Done in
     CSS rather than by script so the help that matches the player's input is
     the only one ever laid out -- and so a pointer that changes mid-session
     (a tablet gaining a keyboard) swaps without a reload. The on-screen half
     is in `MenuHero`.

     These rules are deliberately unlayered: they must outrank the `grid`
     utility the keyboard list carries, which a components-layer rule would
     not. */
  /* On the glass panel, so it reads the same wherever it sits. */
  :global(.ff-help-touch) {
    display: none;
    justify-self: end;
    max-width: 34ch;
    text-align: right;
    padding: 4px 8px;
    border-radius: 6px;
  }

  @media (pointer: coarse) {
    :global(.ff-help) {
      display: none;
    }

    :global(.ff-help-touch) {
      display: var(--ff-connect-help-touch);
    }
  }
</style>

{#if gate === "ask"}
  <MatchGate
    onShow={() => {
      held = undefined;
      gate = "instructions";
    }}
    onSkip={skipGate}
  />
{:else if gate === "instructions"}
  <Instructions {settings} {prompts} {artSrc} onClose={() => (gate = "closed")} />
{/if}
