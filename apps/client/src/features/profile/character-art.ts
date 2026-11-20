/**
 * Where a seat's character is drawn from: its sheet in the race, its bust in
 * the ready room and on results. The seat decides the colour; the character
 * only the body. Anything unknown, including a "?" not yet resolved, is drawn
 * as the ninja, which every seat has.
 */

import { DEFAULT_CHARACTER_ID } from "@floor-fifty/shared/common/constants";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import type { CharacterContent, GameContentPayload } from "@floor-fifty/shared/content/game-content";

export type PortraitMood = "neutral" | "win" | "lose";

export function characterById(content: GameContentPayload | undefined, id: string): CharacterContent | undefined {
  return content?.characters.find((character) => character.id === id);
}

function bodyOf(content: GameContentPayload | undefined, id: string): CharacterContent | undefined {
  return characterById(content, id) ?? characterById(content, DEFAULT_CHARACTER_ID);
}

export function sheetAliasFor(content: GameContentPayload | undefined, characterId: string, colour: SeatColour): string {
  return bodyOf(content, characterId)?.sheetAliases[colour] ?? `ninja.${colour}`;
}

export function portraitAliasFor(
  content: GameContentPayload | undefined,
  characterId: string,
  colour: SeatColour,
  mood: PortraitMood,
): string {
  const neutral = bodyOf(content, characterId)?.portraitAliases[colour] ?? `portrait.${colour}`;
  return mood === "neutral" ? neutral : `${neutral}${mood === "win" ? "Win" : "Lose"}`;
}
