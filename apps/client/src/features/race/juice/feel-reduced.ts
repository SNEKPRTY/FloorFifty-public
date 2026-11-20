/**
 * When the feel director holds still (audit S8).
 *
 * The director owns camera shake, the punch, the white impact flash and the
 * lens aberration. It was told to hold still only by the device's
 * reduced-motion setting, so the photosensitivity warning's "Character
 * effects" switch, which Settings explains as covering camera shake, stopped
 * the squash and the pop-up words and left the shake and the flash on every
 * slam and at the finish. A player who unticks it now gets neither.
 *
 * Both are read at the moment of use, so unticking the box takes hold mid-race.
 */

export function feelIsReduced(deps: {
  /** The device's reduced-motion setting. */
  reducedMotion: () => boolean;
  /** The "Character effects" checkbox. */
  characterEffects: () => boolean;
}): () => boolean {
  return () => deps.reducedMotion() || !deps.characterEffects();
}
