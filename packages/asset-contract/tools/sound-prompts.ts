/**
 * What `generate-sounds.ts` asks ElevenLabs for, declared once.
 *
 * **Why generated, when `generate-cues.ts` argues against it.** The drafted cues
 * are shapes -- a pitched thump, a click -- and they stay: they are in the
 * track's key, and a generator is not. What a shape cannot be is a material. A
 * blade meeting steel, air torn by a fall, a crowd, a voice: those are
 * recordings, and a recording is what this set is. The two layer: the drafted
 * cue carries the pitch, the generated one the body.
 *
 * **Dry, on purpose.** Every effect is asked for with no room in it. The echo is
 * the mixer's (`AudioEngine`'s hall send), one space every sound rings in. A
 * reverb baked into each file would be a different room per file, and a sound
 * that already rings cannot be made to ring less.
 *
 * **The announcer is one voice.** A premade ElevenLabs voice, named by ID, read
 * hot: low stability for a performance that varies, high style for the shout.
 */

/** Brian: deep, resonant, the one chosen at audition. */
export const ANNOUNCER_VOICE_ID = "nPczCjzI2devNBz1zQrb";
export const ANNOUNCER_MODEL = "eleven_multilingual_v2";
export const SOUND_MODEL = "eleven_text_to_sound_v2";

/** Delivery for every announcer line; see the module note. */
export const ANNOUNCER_SETTINGS = {
  stability: 0.3,
  similarity_boost: 0.75,
  style: 0.8,
  use_speaker_boost: true,
} as const;

/** Appended to every effect prompt: the mix's rules, not the sound's. */
const DRY = "dry, no reverb, no music, no voice";

export type SoundPrompt = {
  /** The manifest alias the runtime plays it by. */
  readonly alias: string;
  /** Under `assets/source/sounds/` as generated, `assets/production/` once processed. */
  readonly file: string;
} & (
  | {
      readonly kind: "effect";
      readonly prompt: string;
      readonly seconds: number;
      readonly influence: number;
      /** A bed the mixer repeats: generated seamless, kept stereo. */
      readonly loop?: true;
    }
  | {
      readonly kind: "line";
      readonly text: string;
      /**
       * Slows the read from `fromMs` on by `tempo` (below one is slower), pitch
       * kept: a held last vowel that a text-to-speech read will not hold.
       *
       * `fromMs` is measured on one take, after the leading silence is cut: a
       * regenerated take reads differently, so re-measure it then (ffmpeg's
       * `silencedetect` finds the gaps between words).
       */
      readonly stretchTail?: { readonly fromMs: number; readonly tempo: number };
    }
);

export const SOUND_PROMPTS: readonly SoundPrompt[] = [
  // Movement and the race.
  {
    alias: "sfx.fastFall",
    file: "sfx/fast-fall",
    kind: "effect",
    prompt: `soft muffled downward air puff, gentle short breath of wind, quiet and rounded, no metal, no blade, no whoosh ring, ${DRY}`,
    seconds: 0.5,
    influence: 0.75,
  },
  ...(["Low", "Mid", "High"] as const).map(
    (pitch, index): SoundPrompt => ({
      alias: `sfx.clash${pitch}`,
      file: `sfx/clash-${pitch.toLowerCase()}`,
      kind: "effect",
      prompt: `tiny crisp blade tap on steel, ${["low dark", "mid", "high bright"][index]} metallic ting, very short sharp transient, fighting game footstep accent, ${DRY}`,
      seconds: 0.5,
      influence: 0.75,
    }),
  ),
  {
    alias: "sfx.fallOff",
    file: "sfx/fall-off",
    kind: "effect",
    prompt: `falling away into a void, descending air whoosh ending in a deep heavy boom, fighting game ring out, ${DRY}`,
    seconds: 1.4,
    influence: 0.65,
  },
  {
    alias: "sfx.rewind",
    file: "sfx/rewind",
    kind: "effect",
    prompt: `reverse sword swipe sucking back in, quick rewind swish with a metallic snap at the end, ${DRY}`,
    seconds: 0.7,
    influence: 0.7,
  },
  {
    alias: "sfx.lapClash",
    file: "sfx/lap-clash",
    kind: "effect",
    prompt: `two swords clashing hard, bright steel impact with a shimmering metallic ring, fighting game guard impact, ${DRY}`,
    seconds: 1.2,
    influence: 0.7,
  },
  {
    alias: "sfx.unsheath",
    file: "sfx/unsheath",
    kind: "effect",
    prompt: `sword drawn fast from a steel scabbard, bright crisp shing, fighting game round start, ${DRY}`,
    seconds: 0.9,
    influence: 0.75,
  },
  {
    alias: "sfx.crowdCheer",
    file: "sfx/crowd-cheer",
    kind: "effect",
    prompt: "large arena crowd erupting in a cheer and applause, short burst then settling, no music, no announcer",
    seconds: 3,
    influence: 0.55,
  },
  {
    alias: "ambience.rooftop",
    file: "ambience/rooftop",
    kind: "effect",
    prompt: "high rooftop at dawn above a city, steady gusting wind, distant traffic hum far below, occasional far bird, no music, no voice, seamless",
    seconds: 20,
    influence: 0.4,
    loop: true,
  },

  // Each stage's own air (stage ascent spec §6), on the rooftop bed's settings
  // so the three sit together when a room changes stage.
  {
    alias: "ambience.snowShrine",
    file: "ambience/snow-shrine",
    kind: "effect",
    prompt: "snowy mountain shrine at night, soft steady snowfall hush, low wind through cedars, a distant temple bell now and then, faint wooden wind chime, calm, no music, no voice, seamless",
    seconds: 20,
    influence: 0.4,
    loop: true,
  },
  {
    alias: "ambience.sunkenDome",
    file: "ambience/sunken-dome",
    kind: "effect",
    prompt: "inside a glass dome deep under the sea, muffled low water hum, slow rising bubbles, faint creak of the glass, distant whale-like groan rarely, calm, no music, no voice, seamless",
    seconds: 20,
    influence: 0.4,
    loop: true,
  },
  {
    alias: "ambience.menu",
    file: "ambience/menu",
    kind: "effect",
    prompt: "quiet night high above a city, soft distant wind, faint far city hum, low warm air tone, calm and still, no music, no voice, seamless",
    seconds: 20,
    influence: 0.4,
    loop: true,
  },

  // The interface.
  {
    alias: "ui.hover",
    file: "ui/hover",
    kind: "effect",
    prompt: `tiny soft metallic tick, menu cursor move in a fighting game, very short, ${DRY}`,
    seconds: 0.5,
    influence: 0.8,
  },
  {
    alias: "ui.confirm",
    file: "ui/confirm",
    kind: "effect",
    prompt: `crisp bright blade ting, menu select in a fighting game, short clean metallic chime, ${DRY}`,
    seconds: 0.5,
    influence: 0.8,
  },
  {
    alias: "ui.back",
    file: "ui/back",
    kind: "effect",
    prompt: `soft quick reverse swish, menu cancel in a fighting game, short airy, ${DRY}`,
    seconds: 0.5,
    influence: 0.8,
  },
  {
    alias: "ui.ready",
    file: "ui/ready",
    kind: "effect",
    prompt: `sword locked into a guard stance, sharp metallic clink with a short ring, character ready confirm in a fighting game, ${DRY}`,
    seconds: 0.7,
    influence: 0.75,
  },
  {
    alias: "ui.join",
    file: "ui/join",
    kind: "effect",
    prompt: `new fighter enters, quick blade flourish swipe ending in a bright steel clang, fighting game character select, ${DRY}`,
    seconds: 0.9,
    influence: 0.7,
  },
  {
    alias: "ui.error",
    file: "ui/error",
    kind: "effect",
    prompt: `dull blocked metal thud, denied action in a fighting game menu, short low muted clank, ${DRY}`,
    seconds: 0.5,
    influence: 0.8,
  },
  {
    alias: "ui.title",
    file: "ui/title",
    kind: "effect",
    prompt: `title card slam, heavy steel impact with a bright rising shimmer, fighting game logo reveal, ${DRY}`,
    seconds: 1.8,
    influence: 0.65,
  },

  // NEW CHALLENGER's banner on Results (unlockables spec §7.1). NEW SONG
  // plays its song's preview instead.
  {
    alias: "ui.unlock",
    file: "ui/unlock",
    kind: "effect",
    prompt: `short triumphant sting, bright brass stab with a shimmering cymbal swell and a sword ting, new challenger unlocked in a fighting game, ${DRY}`,
    seconds: 1.5,
    influence: 0.7,
  },

  // The announcer.
  ...(
    [
      ["vo.title", "title", "Floor Fifty!"],
      ["vo.three", "three", "Three!"],
      ["vo.two", "two", "Two!"],
      ["vo.one", "one", "One!"],
      ["vo.climb", "climb", "CLIMB!"],
      ["vo.finalAscent", "final-ascent", "Final ascent!"],
      ["vo.game", "game", "GAME!"],
      ["vo.winnerIs", "winner-is", "The winner is..."],
      // The colours as a player sees them, not the scarves' names.
      ["vo.red", "red", "Red!"],
      ["vo.blue", "blue", "Blue!"],
      // Gold is drawn orange (#fb6b1d), and the colour picker calls it Orange.
      ["vo.orange", "orange", "Orange!"],
      ["vo.purple", "purple", "Purple!"],
      // The pop-up words' big moments (Wonder spec §3.4).
      ["vo.lead", "lead", "Into the lead!"],
      ["vo.lastFloor", "last-floor", "Last floor!"],
      ["vo.first", "first", "First!"],
      ["vo.second", "second", "Second!"],
      ["vo.third", "third", "Third!"],
      ["vo.fourth", "fourth", "Fourth!"],
    ] as const
  ).map(([alias, file, text]): SoundPrompt => ({ alias, file: `announcer/${file}`, kind: "line", text })),
];

/**
 * The ElevenLabs key: the environment's first, then `.env.local`'s.
 *
 * Either spelling, `ELEVENLABS_API_KEY` or `ELEVENLAB_API_KEY`: the second is
 * what `.env.local` was written with. Returned and nothing else -- the caller
 * sends it to the API and nowhere else, and nothing here logs or writes it.
 */
export function readElevenLabsKey(env: NodeJS.ProcessEnv, envFile: string | undefined): string | undefined {
  const names = ["ELEVENLABS_API_KEY", "ELEVENLAB_API_KEY"];
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== "") return value;
  }
  if (envFile === undefined) return undefined;
  for (const line of envFile.split(/\r?\n/)) {
    const match = /^\s*(ELEVENLABS?_API_KEY)\s*=\s*(.*)\s*$/.exec(line);
    if (match === null) continue;
    const value = match[2]!.replace(/^["']|["']$/g, "");
    if (value !== "") return value;
  }
  return undefined;
}

/** The request one prompt sends: its path under `/v1` and its JSON body. */
export function soundRequest(prompt: SoundPrompt): { path: string; body: Record<string, unknown> } {
  if (prompt.kind === "line") {
    return {
      path: `/text-to-speech/${ANNOUNCER_VOICE_ID}`,
      body: { text: prompt.text, model_id: ANNOUNCER_MODEL, voice_settings: ANNOUNCER_SETTINGS },
    };
  }
  return {
    path: "/sound-generation",
    body: {
      text: prompt.prompt,
      model_id: SOUND_MODEL,
      duration_seconds: prompt.seconds,
      prompt_influence: prompt.influence,
      loop: prompt.loop === true,
    },
  };
}
