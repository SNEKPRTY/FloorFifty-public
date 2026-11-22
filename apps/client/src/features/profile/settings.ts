/**
 * Settings (launch polish spec §3.1.2).
 *
 * One versioned key holds everything, including the one-time "seen" flags.
 * It lives in the browser's own storage, except inside Ruken, where all of it
 * but the sound follows the player's account (`keepAudioOnDevice`).
 * Every field carries its own `.catch`, so one bad value costs that value
 * and nothing beside it: a schema change must not wipe a player's volume.
 * Storage can be absent, blocked or full, and none of that may stop a screen
 * from rendering, so every read and write is wrapped.
 */

import { z } from "zod";
import { LCD_PANEL } from "../../lib/constants";
import { QUALITY_LEVEL } from "./quality";
import { SEAT_COLOURS, type SeatColour } from "@floor-fifty/shared/common/seats";
import { LOCALE_TAGS, type LocaleTag } from "../i18n/locales";

export const SETTINGS_KEY = "floor-fifty.settings.v1";
/**
 * Where a hosted device keeps its sound settings, in the game frame's own
 * browser storage. Never used outside Ruken, where the settings key holds the
 * sound with everything else.
 */
export const DEVICE_AUDIO_KEY = "floor-fifty.settings.audio.v1";
/** The pre-settings rotate-hint flag, migrated once and then removed. */
const LEGACY_ROTATE_HINT_KEY = "floor-fifty.rotate-hint-dismissed";

export type QualitySetting = "high" | "medium" | "low";
export type SettingsStorage = Pick<Storage, "getItem" | "setItem"> &
  Partial<Pick<Storage, "removeItem">>;

/** A player seen in a room, for the title's lineup: their seat's ID, body and colour. */
export type SeenRacer = { readonly id: string; readonly characterId: string; readonly colour: SeatColour };

export const DEFAULT_SETTINGS = {
  version: 2,
  audio: { muted: false, music: 1, sfx: 1, announcer: 1, muteUnfocused: false },
  display: { lcdPanel: LCD_PANEL.enabled, quality: QUALITY_LEVEL, characterEffects: true, stageEffects: true, trajectoryGuide: true },
  // Controller rumble and phone vibration: on unless the player turns them off.
  input: { touchMode: "swipe", rumble: true },
  seen: { rotateHint: false, swipeCoach: false, tutorial: false, replayNames: false, photosensitivity: false, edgeLine: false, climbHints: false },
  profile: { lastCharacter: "ninja", lastColour: "scarlet", lastSeen: [] as SeenRacer[] },
  // Phase 5: null is Automatic, detected from the browser on every boot.
  locale: null as LocaleTag | null,
} as const satisfies {
  version: 2;
  audio: { muted: boolean; music: number; sfx: number; announcer: number; muteUnfocused: boolean };
  display: { lcdPanel: boolean; quality: QualitySetting; characterEffects: boolean; stageEffects: boolean; trajectoryGuide: boolean };
  input: { touchMode: "swipe" | "buttons"; rumble: boolean };
  seen: { rotateHint: boolean; swipeCoach: boolean; tutorial: boolean; replayNames: boolean; photosensitivity: boolean; edgeLine: boolean; climbHints: boolean };
  profile: { lastCharacter: string; lastColour: SeatColour; lastSeen: readonly SeenRacer[] };
  locale: LocaleTag | null;
};

const clamped = (range: { min: number; max: number }, fallback: number) =>
  z
    .number()
    .transform((value) => Math.min(range.max, Math.max(range.min, value)))
    .catch(fallback);
const volume = (fallback: number) => clamped({ min: 0, max: 1 }, fallback);
const flag = (fallback: boolean) => z.boolean().catch(fallback);
const D = DEFAULT_SETTINGS;

export const settingsSchema = z.object({
  version: z.literal(2),
  audio: z
    .object({
      muted: flag(D.audio.muted),
      music: volume(D.audio.music),
      sfx: volume(D.audio.sfx),
      // Added after the first release: a stored object without it takes the default.
      announcer: volume(D.audio.announcer),
      // Added after the first release, as the announcer was.
      muteUnfocused: flag(D.audio.muteUnfocused),
    })
    .catch({ ...D.audio }),
  display: z
    .object({
      lcdPanel: flag(D.display.lcdPanel),
      quality: z.enum(["high", "medium", "low"]).catch(D.display.quality),
      // Added after phase 6: the racer juice and Wonder words, and the stage
      // answering the race. Presentation only; off draws none of it.
      characterEffects: flag(D.display.characterEffects),
      stageEffects: flag(D.display.stageEffects),
      trajectoryGuide: flag(D.display.trajectoryGuide),
    })
    .catch({ ...D.display }),

  input: z
    .object({ touchMode: z.enum(["swipe", "buttons"]).catch(D.input.touchMode), rumble: flag(D.input.rumble) })
    .catch({ ...D.input }),
  seen: z
    .object({
      rotateHint: flag(D.seen.rotateHint),
      swipeCoach: flag(D.seen.swipeCoach),
      tutorial: flag(D.seen.tutorial),
      // Added in phase 4b: the first replay share says replays carry names.
      replayNames: flag(D.seen.replayNames),
      // The photosensitivity warning before the first splash, once read.
      photosensitivity: flag(D.seen.photosensitivity),
      // A first race's one-time hints (first-race spec parts 4 and 5): the
      // lava named once for every input method, and the floors-and-restart
      // lessons, each shown once and then not.
      edgeLine: flag(D.seen.edgeLine),
      climbHints: flag(D.seen.climbHints),
    })
    .catch({ ...D.seen }),
  // Added in phase 2b: the device remembers the last body and colour it picked.
  profile: z
    .object({
      lastCharacter: z.string().min(1).max(64).catch(D.profile.lastCharacter),
      lastColour: z.enum(SEAT_COLOURS).catch(D.profile.lastColour),
      // The last players seen in a room, most recent first: the title's
      // lineup stands them behind you (select spec §6.7).
      lastSeen: z
        .array(z.object({ id: z.string().max(128), characterId: z.string().min(1).max(64), colour: z.enum(SEAT_COLOURS) }))
        .max(3)
        .catch([]),
    })
    .catch({ ...D.profile }),
  // Added in phase 5 (languages spec §3.3). A bad value is Automatic, alone.
  locale: z.enum(LOCALE_TAGS).nullable().catch(null),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsPatch = { [K in keyof Omit<Settings, "version">]?: Partial<Settings[K]> };

const fresh = (): Settings => structuredClone(DEFAULT_SETTINGS) as Settings;

/** The browser's local storage, or undefined where touching it throws. */
export function deviceStorage(): SettingsStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The JSON object in `raw`, or undefined when it is missing, not JSON, or not an object. */
function parseRecord(raw: string | null): Record<string, unknown> | undefined {
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The storage a game inside Ruken hands to the settings store: the one
 * settings record, split in two so that the sound stays on this device.
 *
 * Ruken saves everything the game writes to `account` for the player, and
 * every device the player signs in on reads it back. That is right for the
 * colour, the language and the "seen" flags, and wrong for the sound: muting
 * a Mac must not mute the same player's iPad (Owner, 2026-10-10). So the
 * `audio` part of the settings record is kept in `device` (the game frame's
 * own storage, which never leaves this browser) and everything else goes to
 * `account`. The settings store and `loadSettings` see one ordinary record
 * and know nothing of the split.
 *
 * Every other key (the racer's name, progress, the old rotate-hint flag)
 * passes straight through to `account`, as it did before.
 *
 * - The account's own `audio` is never read. Before this change it held every
 *   player's sound, and a mute saved then must not follow them to a device
 *   that has none of its own, so a device with nothing saved starts on the
 *   defaults. The next write to the account leaves the old `audio` out.
 * - `device` can be missing (reading `localStorage` threw) or can throw when
 *   used (blocked, full). The sound is then remembered for this visit only,
 *   in the settings store, exactly as a failed save is elsewhere in this file.
 *   It is never written to `account` instead: that would sync it after all.
 *
 * A two-backend storage like this one keeps `SettingsStore`, `loadSettings`
 * and `saveSettings` as they were, and standalone nothing changes at all:
 * `localHosting()` hands over the browser's storage and never calls this.
 */
export function keepAudioOnDevice(account: SettingsStorage, device: SettingsStorage | undefined): SettingsStorage {
  const readDeviceAudio = (): Record<string, unknown> | undefined => {
    try {
      return parseRecord(device?.getItem(DEVICE_AUDIO_KEY) ?? null);
    } catch {
      return undefined; // Blocked: this device has no saved sound, so the defaults stand.
    }
  };

  return {
    getItem(key) {
      const stored = account.getItem(key);
      if (key !== SETTINGS_KEY) return stored;

      const accountRecord = parseRecord(stored);
      const audio = readDeviceAudio();
      // Nothing to merge in (or nothing usable to merge into): loadSettings copes with the raw value.
      if (audio === undefined && accountRecord === undefined) return stored;

      // With no account record yet, the device's sound still needs a version to load under.
      const merged: Record<string, unknown> = { ...(accountRecord ?? { version: DEFAULT_SETTINGS.version }) };
      delete merged["audio"]; // The account's copy is never read (see above).
      if (audio !== undefined) merged["audio"] = audio;
      return JSON.stringify(merged);
    },

    setItem(key, value) {
      const record = key === SETTINGS_KEY ? parseRecord(value) : undefined;
      if (record === undefined) {
        account.setItem(key, value);
        return;
      }

      // The device first, so a sound change is kept even when the account's
      // save is refused (over quota, say); its own failure must not stop the account's.
      if (record["audio"] !== undefined) {
        try {
          device?.setItem(DEVICE_AUDIO_KEY, JSON.stringify(record["audio"]));
        } catch {
          // Remembered for this visit only.
        }
      }
      const shared = { ...record };
      delete shared["audio"];
      account.setItem(key, JSON.stringify(shared));
    },

    removeItem(key) {
      account.removeItem?.(key);
      if (key !== SETTINGS_KEY) return;
      try {
        device?.removeItem?.(DEVICE_AUDIO_KEY);
      } catch {
        // Nothing more can be done for a blocked device.
      }
    },
  };
}

/**
 * Brings an older stored record up to the current version, one step at a
 * time. Each step only adds what its version introduced; the schema's own
 * per-field `.catch` repairs anything else. A record from a version this
 * build does not know is returned as it is and refused by the schema.
 */
const MIGRATIONS: Readonly<Record<number, (record: Record<string, unknown>) => Record<string, unknown>>> = {
  // Phase 5: the language choice, Automatic until the player picks one.
  1: (record) => ({ ...record, version: 2, locale: null }),
};

export function migrateSettings(raw: unknown): unknown {
  let record = raw;
  while (typeof record === "object" && record !== null) {
    const version = (record as { version?: unknown }).version;
    const step = typeof version === "number" ? MIGRATIONS[version] : undefined;
    if (step === undefined) break;
    record = step(record as Record<string, unknown>);
  }
  return record;
}

export function loadSettings(storage: SettingsStorage | undefined): Settings {
  let raw: string | null = null;
  let legacyHint = false;
  try {
    raw = storage?.getItem(SETTINGS_KEY) ?? null;
    legacyHint = storage?.getItem(LEGACY_ROTATE_HINT_KEY) === "1";
  } catch {
    return fresh();
  }

  let settings = fresh();
  if (raw !== null) {
    try {
      const parsed = settingsSchema.safeParse(migrateSettings(JSON.parse(raw)));
      if (parsed.success) settings = parsed.data;
    } catch {
      // Unparseable: the defaults stand.
    }
  }
  if (legacyHint) settings.seen.rotateHint = true;
  return settings;
}

export function saveSettings(storage: SettingsStorage | undefined, settings: Settings): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
    storage?.removeItem?.(LEGACY_ROTATE_HINT_KEY);
  } catch {
    // Remembered for this visit only.
  }
}
