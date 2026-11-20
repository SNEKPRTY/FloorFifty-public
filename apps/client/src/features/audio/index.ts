/**
 * The mixer.
 *
 * Web Audio rather than `HTMLAudioElement`, and the reason is the loop. The
 * stage track is authored with loop points measured to the millisecond against
 * its decoded timeline, and a media element can only be asked to repeat a whole
 * file; an `AudioBufferSourceNode` loops a region of a decoded buffer with
 * sample accuracy and no gap. Everything else here follows from having a graph
 * at all.
 *
 * **Four buses.** Music, effects, UI and the announcer's voice, each its own
 * gain into a master. A landing has to stay audible under a track, and a track
 * has to be able to duck without taking the landings with it, which one output
 * cannot express; the voice is its own so a player can turn the announcer down
 * and keep everything else.
 *
 * **One hall.** Every effect is authored dry, and each bus but the music sends
 * into one shared convolution reverb: the crisp transient is the file, the
 * ring-out is the room, and every sound rings in the same room. The music is
 * mastered with its own space and stays out of it.
 *
 * **One old speaker.** Those same three buses leave through one vintage stage
 * rather than straight to the master: the band an arcade cabinet or a CRT's
 * speaker could carry, a soft round-off of the loudest peaks, and a darkening
 * tape echo whose repeats come back through the same band. The recordings are
 * modern and clean; this is what makes them sound like one late-nineties
 * machine rather than thirty files. The hall rings into it too, so its tail
 * is as narrow as the sound it came from. The music, again, is left alone, and
 * so are the ambient beds -- wind that echoes is not wind.
 *
 * **Unlocked, not autoplayed.** Every browser refuses to start audio outside a
 * user gesture. The context is built lazily on the first `unlock`, so a player
 * who never interacts never has one, and `unlock` is idempotent so every screen
 * can ask without stacking resumes.
 *
 * **Asleep is silent, not queued.** A hidden page still takes snapshots, and
 * a cue asked for while the graph is suspended would wait on its frozen clock
 * and start with every other one the moment it resumed. Such a cue is
 * dropped, and the lines queued when the page went are silenced with it.
 *
 * **Nothing is cut dead.** A source stopped mid-waveform clicks, so whatever
 * the mixer ends early -- a track handed over, a bed, a stolen voice -- fades
 * over `CUT_SECONDS` first, and a level the player moves glides there.
 *
 * **Cues de-duplicate by authoritative event ID.** The same landing reaches the
 * client more than once -- a snapshot replay, a reconnect, two subscribers on
 * one event -- and the race is unharmed by that where the mix is not: two
 * identical transients a frame apart read as a flam rather than as one landing.
 * An event ID is the server's own, so "the same landing" is its judgement
 * rather than a guess made from timing here.
 *
 * **Nothing here can reach the simulation.** This module imports no state, no
 * step, and no tuning -- one pure math helper, nothing more. Muting the tab,
 * failing to unlock, or losing the whole context changes what a player hears
 * and nothing about where they land.
 *
 * The directory: `model` is the shared vocabulary (buses, mixes, options and
 * the `AudioPort` the screens speak), `engine` the mixer itself, `manager`
 * the browser wiring, `synth` the synthesized hall and rumble, `songs` the
 * song lookup over the content artifact.
 */

export {
  BUSES,
  DEFAULT_GAINS,
  MUSIC_CUTOFF_OPEN_HZ,
  SLOW_MUSIC_CUTOFF_HZ,
  playerGain,
  MIXES,
  FAR_CUE_HZ,
  DANGER_RUMBLE_GAIN,
  DANGER_MUSIC_HZ,
  DRONE_GAIN,
  PREVIEW_FADE_SECONDS,
  MUSIC_TAIL_SECONDS,
  VOICE_BUS_DUCK,
} from "./model";
export type {
  Bus,
  MixName,
  MixState,
  DecodedTrack,
  AudioContextLike,
  NowPlaying,
  MusicSpectrum,
  AudioEngineOptions,
  MusicDuck,
  CueOptions,
  AudioPort,
} from "./model";
export { songById, raceSong } from "./songs";
export type { SongLike } from "./songs";
export { AudioEngine } from "./engine";
export { AudioManager } from "./manager";
export { softClipCurve } from "./synth";
