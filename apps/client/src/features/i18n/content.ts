/**
 * Authored words in the active locale (languages spec §4.2).
 *
 * Content IDs come from the artifact at run time, so the lookup is by key,
 * built the way `packages/content/src/messages.ts` builds it. A key with no
 * message (an item added to TOML before a build) renders the authored English
 * and warns once in development. Song names are titles and are never looked
 * up (D-L4).
 */

import * as m from "../../paraglide/messages.js";

type Message = (inputs?: Record<string, unknown>) => string;
const messages = m as unknown as Readonly<Record<string, Message | undefined>>;
const warned = new Set<string>();

const snake = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll("-", "_")
    .toLowerCase();

function lookup(key: string, authored: string, inputs?: Record<string, unknown>): string {
  const message = messages[key];
  if (message !== undefined) return message(inputs);
  if (import.meta.env.DEV && !warned.has(key)) {
    warned.add(key);
    console.warn(`[i18n] no message ${key}; showing the authored text`);
  }
  return authored;
}

export const stageName = (stage: { readonly id: string; readonly displayName: string }): string =>
  lookup(`content_stage_${snake(stage.id)}_name`, stage.displayName);

export const characterName = (character: { readonly id: string; readonly displayName: string }): string =>
  lookup(`content_character_${snake(character.id)}_name`, character.displayName);

/** A race option's name: 20 floors, 50 floors, Infinite. */
export const modeName = (mode: { readonly id: string; readonly displayName: string }): string =>
  lookup(`content_mode_${snake(mode.id)}_name`, mode.displayName);

export const packTitle = (pack: { readonly id: string; readonly title: string }): string =>
  lookup(`content_pack_${snake(pack.id)}_title`, pack.title);

export const unlockHint = (unlock: { readonly id: string; readonly hint: string }): string =>
  lookup(`content_unlock_${snake(unlock.id)}_hint`, unlock.hint);

/** A tutorial prompt with its `{glyph}` slot filled by `marker`, for the card to split on. */
export const tutorialPrompt = (kind: string, method: string, authored: string, marker: string): string =>
  lookup(`content_tutorial_${snake(kind)}_${method}`, authored.replaceAll("{glyph}", marker), { glyph: marker });
