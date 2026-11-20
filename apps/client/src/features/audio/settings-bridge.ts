/**
 * Applies settings to the app-level systems, now and on every change.
 *
 * Screens own their backdrops and so apply quality themselves
 * (`rebuildOnQuality`). Everything the app owns for the life of the tab --
 * the audio graph and the LCD panel -- is applied here, once.
 */

import type { Settings } from "../profile/settings";
import type { SettingsStore } from "../profile/store/settings.svelte";
import type { AudioPort } from "./";
import type { Hosting } from "../ruken/host";

export function bridgeSettings(
  settings: SettingsStore,
  targets: { audio: AudioPort; stage: { setPanel?(enabled: boolean): void } },
): () => void {
  // Only what changed is re-applied: a volume drag must not rebuild the panel.
  let applied: Settings | undefined;
  const apply = (next: Settings): void => {
    if (applied?.audio.muted !== next.audio.muted) targets.audio.setMuted(next.audio.muted);
    if (applied?.audio.music !== next.audio.music) targets.audio.setPlayerVolume("music", next.audio.music);
    if (applied?.audio.sfx !== next.audio.sfx) {
      // The interface's sounds ride the effects slider: they have none of
      // their own, and a menu click that outlived the slider at zero was one
      // nobody could turn down.
      targets.audio.setPlayerVolume("effects", next.audio.sfx);
      targets.audio.setPlayerVolume("ui", next.audio.sfx);
    }
    if (applied?.audio.announcer !== next.audio.announcer) targets.audio.setPlayerVolume("voice", next.audio.announcer);
    if (applied?.display.lcdPanel !== next.display.lcdPanel) targets.stage.setPanel?.(next.display.lcdPanel);
    applied = next;
  };
  apply(settings.value);
  return settings.subscribe(apply);
}

/**
 * Mutes while another window has focus, for a player who turned that on.
 *
 * Off by default: the page is still in view behind the other window and an
 * online race goes on, so by default its sound does too. A hidden page goes
 * quiet either way (`sleep-when-hidden.ts`).
 */
export function muteWhenUnfocused(
  settings: SettingsStore,
  audio: Pick<AudioPort, "setUnfocused">,
  win: Window = window,
  hasFocus: () => boolean = () => win.document.hasFocus(),
): () => void {
  let focused = hasFocus();
  const apply = (): void => audio.setUnfocused?.(settings.value.audio.muteUnfocused && !focused);
  const onBlur = (): void => {
    focused = false;
    apply();
  };
  const onFocus = (): void => {
    focused = true;
    apply();
  };
  win.addEventListener("blur", onBlur);
  win.addEventListener("focus", onFocus);
  apply();
  const unsubscribe = settings.subscribe(apply);
  return () => {
    win.removeEventListener("blur", onBlur);
    win.removeEventListener("focus", onFocus);
    unsubscribe();
  };
}

const TYPING = "input, textarea, select, [contenteditable='true']";

/**
 * App-wide keys: M mutes (spec §3.1.1). Never while a text field has focus --
 * a player named "Mika" must be able to type their name.
 */
export function installShellHotkeys(settings: SettingsStore, target: EventTarget = window): () => void {
  const onKey = (event: Event): void => {
    const key = event as KeyboardEvent;
    if (key.code !== "KeyM" || key.repeat || key.metaKey || key.ctrlKey || key.altKey) return;
    const focused = document.activeElement;
    if (focused instanceof Element && focused.matches(TYPING)) return;
    settings.update({ audio: { muted: !settings.value.audio.muted } });
  };
  target.addEventListener("keydown", onKey);
  return () => target.removeEventListener("keydown", onKey);
}

/**
 * Inside Ruken, the game's master follows the host's volume: its master
 * slider and mute, and the ducking under an ad or the host's own overlays
 * (P6 §4). Applied at once, then on every change. Standalone the gain is 1.
 */
export function followHostGain(
  hosting: Pick<Hosting, "hostGain" | "onHostGain">,
  audio: { setHostGain(gain: number): void },
): () => void {
  audio.setHostGain(hosting.hostGain());
  return hosting.onHostGain((gain) => audio.setHostGain(gain));
}
