/**
 * Story mode is on for every player (Owner, 2026-11-20: "I want it on for
 * every player"). It was hidden while it was redone ("pull it now, redo
 * later"); the ways in are the title's Story button and the match gate's
 * Play story.
 *
 * The switch stays, so hiding it again is one line: return the stored flag
 * (`?story=on` writes it on a device) instead of `true`.
 */
export const STORY_FLAG_KEY = "floor-fifty.dev.story";

export function storyModeOn(): boolean {
  return true;
}
