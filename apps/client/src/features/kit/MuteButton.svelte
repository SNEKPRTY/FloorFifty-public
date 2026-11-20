<script lang="ts">
  /**
   * The mute toggle for the lobby and the results (spec §3.1.1), the same
   * toggle as the title's quick action. `aria-pressed` and the word both
   * change, so the state is never colour alone. Unpositioned: each screen
   * gives it a place in its own layout, never a corner laid over one.
   * `compact` sets it as an icon over its word, to share a row with others.
   * In the corner (`CornerControls`) the word stays on every row; the ready
   * room's, which shares it with the room code, sets it small under the icon.
   */
  import * as m from "../../paraglide/messages.js";
  import type { SettingsStore } from "../profile/store/settings.svelte";
  import Button from "./Button.svelte";
  import SpeakerIcon from "./SpeakerIcon.svelte";

  let { settings, compact = false }: { settings: SettingsStore; compact?: boolean } = $props();
  const muted = $derived(settings.value.audio.muted);
</script>

<Button
  kind="ghost"
  data-testid="corner-mute"
  aria-pressed={muted}
  class="ff-mute {compact ? 'ff-aq-control--stacked' : 'flex items-center gap-8'}"
  onclick={() => settings.update({ audio: { muted: !muted } })}
>
  {#if compact}
    <span class="ff-aq-control__icon"><SpeakerIcon {muted} /></span>
    <span class="ff-aq-secondary">{muted ? m.shell_unmute() : m.shell_mute()}</span>
  {:else}
    <SpeakerIcon {muted} />
    <span class="ff-mute__word">{muted ? m.shell_unmute() : m.shell_mute()}</span>
  {/if}
</Button>

<style>
  /* One word on one line: a squeezed corner row wraps the button below the
     language's, never breaks the word ("Silenci / ar"). */
  .ff-mute__word {
    white-space: nowrap;
  }

  /* A row that also holds the room code and its Copy (the ready room) is
     narrow: Copy is as wide as "コピー済み ✓", and at 410 px the two met
     (visual audit, 2026-10-05). The word keeps its place, small, under the
     icon, rather than leaving a bare icon (review R11). */
  @container (max-width: 480px) {
    :global(.ff-corners:has(.ff-room-code) .ff-mute) {
      flex-direction: column;
      gap: 2px;
      padding-inline: 6px;
    }
    :global(.ff-corners:has(.ff-room-code)) .ff-mute__word {
      font-size: var(--ff-type-hint);
      line-height: 1;
    }
  }
</style>
