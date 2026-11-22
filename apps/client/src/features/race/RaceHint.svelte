<script lang="ts">
  /**
   * One one-time hint in the HUD's toast slot (first-race spec parts 4 and 5):
   * the lava line, or the floors and restart lessons. Words only, in the swipe coach's look but with no button: it goes
   * on its own, six seconds after her first input (`race-hints.ts`).
   *
   * The restart hint names the control in the player's hand: R, the pad's own
   * button picture, or the timer on touch.
   */
  import * as m from "../../paraglide/messages.js";
  import { GLYPHS } from "../i18n/glyphs";
  import { inputMethod } from "../platform/input-method.svelte";
  import { GLYPH_MARKER, promptWordsFromText, type PromptWords } from "./prompt-words";

  let { kind }: { kind: "edge" | "floors" | "restart" } = $props();

  const words = $derived.by((): PromptWords => {
    if (kind === "edge") return { before: m.race_hint_edge(), after: "" };
    if (kind === "floors") return { before: m.race_hint_floors(), after: "" };
    if (inputMethod.method === "touch") return { before: m.race_hint_restart_touch(), after: "" };
    if (inputMethod.method === "keyboard") return { before: m.race_hint_restart_keyboard(), after: "" };
    // The glyph goes where the translation put its marker, as in the control prompts.
    return promptWordsFromText(m.race_hint_restart_gamepad({ glyph: GLYPH_MARKER }), GLYPHS[inputMethod.family].restart());
  });
</script>

<span role="status" data-testid="race-hint" data-hint={kind} class="ff-race-hint"
  >{words.before}{#if words.glyph !== undefined}<kbd data-glyph class="ff-keycap">{words.glyph}</kbd
    >{/if}{words.after}</span
>

<style>
  .ff-race-hint {
    display: block;
    padding: 4px 14px;
    font-size: var(--ff-type-hint);
    line-height: 1.3;
    text-align: center;
  }
</style>
