/**
 * The world moving with the music.
 *
 * Every layer breathes from one number. Where the race song is audibly
 * playing, that number is the song's own beat as it sounds, so the world
 * moves to the music the player hears; a song that started late, after the
 * browser's tap, is kept time to rather than contradicted. Where nothing
 * audible says -- before the tap, through a finish's slow motion -- it is the
 * authored grid off the authoritative tick, which pulses the same on every
 * client and in every replay. A muted tab still plays the song, silently, so
 * it pulses exactly like an unmuted one.
 *
 * **It is presentation, and it has to stay presentation.** A landing on the
 * beat and a landing off it do exactly the same thing. Nothing here is read by
 * the simulation, nothing here reaches `RaceState`, and the values below sit
 * outside `rulesetRevision` so tuning them is not a rules change. The design
 * permits the world to react to the music; it forbids the music deciding
 * anything, and the distance between those is this file staying on the
 * drawing side of the line.
 *
 * **Visible, without the landing edge moving.** The direction's first priority
 * is that a player finds the next landing edge in a brief glance, and an edge
 * that moves is harder to find than one that does not. The first attempt at
 * this protected that by making everything too small to see -- eight tenths of
 * a pixel on the platforms -- which is not restraint, it is absence.
 *
 * What resolves the tension is where the swell goes rather than how big it is.
 * A slab thickens *downward*, so its top face stays exactly where collision
 * puts it and the body below does the moving. That buys room for a pulse a
 * player can actually feel while the surface they aim at never lies about
 * where it is.
 */

import { beatPhaseAt, beatPhaseOf, pulseOf, type SongTiming } from "../../lib/beat-clock";

/**
 * What one tick of the music asks each layer to do.
 *
 * Multipliers and offsets rather than absolute values, so a caller applies them
 * to whatever it already had and nothing here has to know how big a platform is
 * or where the camera was.
 */
export type WorldPulse = {
  /** Vertical scale for a platform's slab. Around one. */
  readonly platformScale: number;
  /** Bloom strength for the city's lit windows. Around one. */
  readonly windowGlow: number;
  /** Camera offset in logical units. Small, and centred on zero. */
  readonly cameraBreath: number;
  /** Whether this tick begins a bar, for anything that fires rather than eases. */
  readonly onDownbeat: boolean;
};

/**
 * How far each layer may move.
 *
 * Named and bounded because the design permits tuning the visual lead-in, the
 * pulse strength and the phrasing, and requires every accepted change to be
 * recorded. They live here rather than in authored content on purpose: they are
 * not race inputs, and putting them in a stage file would drag them into
 * `contentRevision` and invite them to look like rules.
 */
export const PULSE_DEPTH = {
  /**
   * Platform swell, as a fraction of its own height.
   *
   * Forty-five percent of a twenty-unit slab.
   *
   * Set against a measurement rather than by eye. Frames captured mid-race put
   * the earlier settings at 1.3 px of swell at the start of a climb and 2.9 px
   * at the top of one, which is why the pulse was running and invisible: a slab
   * at that scale is 27 px tall, and two pixels of it is inside the dither.
   * This is 3.2 px at the start and 7.2 at the top, which is a slab visibly
   * breathing rather than one that measures as breathing.
   *
   * What makes a swell this size affordable is that it goes *downward*: the top
   * face stays exactly where collision puts it, so the landing edge a player
   * aims at never moves however hard the world breathes. Height is spent on the
   * body, which nobody aims at.
   */
  platform: 0.45,
  /**
   * Window bloom added on the beat, above a resting level.
   *
   * Upward from rest rather than a swing around it. Swinging dipped the city
   * below its own resting brightness between beats, which reads as the lights
   * failing rather than as a rhythm; a city that only ever brightens reads as
   * one answering the music.
   */
  window: 1.1,
  /** Resting bloom, which the beat adds to and never subtracts from. */
  windowRest: 0.8,
  /**
   * Camera breath, in logical units.
   *
   * Five, which is under a tenth of a racer's height and still clearly a
   * movement rather than a measurement.
   */
  camera: 5,
} as const;

/**
 * The pulse at one tick, or at `heardBeat` where the song is playing.
 *
 * `heardBeat` is the race song's own beat as it sounds (`playingSongBeat`):
 * where the player can hear the music, the world keeps time to what they
 * hear. Where they cannot -- before the browser lets sound start, through a
 * finish's slow motion, in a replay with no song in the slot -- it keeps the
 * authored grid off the tick, so the world still breathes.
 *
 * `undefined` where the race has no song, which is a still world rather than
 * a broken one: the absence of a song is the absence of a reason to pulse,
 * not a failure to pulse.
 */
export function worldPulseAt(tick: number, song: SongTiming | undefined, heardBeat?: number): WorldPulse | undefined {
  if (song === undefined) return undefined;

  const phase = heardBeat === undefined ? beatPhaseAt(tick, song) : beatPhaseOf(heardBeat);
  const strength = pulseOf(phase);

  return {
    platformScale: 1 + strength * PULSE_DEPTH.platform,
    windowGlow: PULSE_DEPTH.windowRest + strength * PULSE_DEPTH.window,
    // Downward on the beat, which is the direction a struck surface goes. Up
    // would read as the camera being lifted by the music rather than the world
    // being hit by it.
    cameraBreath: -strength * PULSE_DEPTH.camera,
    onDownbeat: phase.beatInBar === 0,
  };
}
