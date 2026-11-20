import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  DEVICE_AUDIO_KEY,
  SETTINGS_KEY,
  keepAudioOnDevice,
  loadSettings,
  saveSettings,
  type SettingsStorage,
} from "../../../../apps/client/src/features/profile/settings";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";

/**
 * Inside Ruken the settings key is saved to the player's account, but sound is
 * the one part that stays on the device (Owner, 2026-10-10): muting a Mac must
 * not mute the same player's iPad. `keepAudioOnDevice` is the storage the
 * hosted game hands to the settings store. These tests stand it between two
 * memory backends, "account" (what Ruken saves) and "device" (the frame's own
 * browser storage), and look at what lands in each.
 */

const memory = (seed: Record<string, string> = {}): SettingsStorage & { values: Map<string, string> } => {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
};
const blocked: SettingsStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const recordIn = (storage: { values: Map<string, string> }, key: string): Record<string, unknown> =>
  JSON.parse(storage.values.get(key) ?? "null") as Record<string, unknown>;

describe("sound stays on the device when settings are saved to an account", () => {
  it("writes the audio settings to the device, and none of them to the account", () => {
    const account = memory();
    const device = memory();
    new SettingsStore(keepAudioOnDevice(account, device)).update({ audio: { muted: true, music: 0.25 } });

    expect(recordIn(device, DEVICE_AUDIO_KEY)).toMatchObject({ muted: true, music: 0.25 });
    expect(recordIn(account, SETTINGS_KEY)).not.toHaveProperty("audio");
    // Nothing of the sound reaches the account under any key.
    expect([...account.values.values()].join("")).not.toContain("0.25");
    // The device holds the sound alone: no copy of the account's part.
    expect([...device.values.keys()]).toEqual([DEVICE_AUDIO_KEY]);
  });

  it("writes everything else to the account, as before", () => {
    const account = memory();
    const device = memory();
    new SettingsStore(keepAudioOnDevice(account, device)).update({
      audio: { muted: true },
      profile: { lastCharacter: "frog", lastColour: "violet" },
      display: { quality: "low" },
      locale: "ja",
    });

    expect(recordIn(account, SETTINGS_KEY)).toMatchObject({
      version: 2,
      profile: { lastCharacter: "frog", lastColour: "violet" },
      display: { quality: "low" },
      locale: "ja",
    });
    expect(device.values.has(SETTINGS_KEY)).toBe(false);
  });

  it("reads the two back as one record", () => {
    const account = memory();
    const device = memory();
    new SettingsStore(keepAudioOnDevice(account, device)).update({
      audio: { muted: true, sfx: 0.5 },
      profile: { lastCharacter: "frog" },
    });

    expect(device.values.has(DEVICE_AUDIO_KEY)).toBe(true);
    const reloaded = loadSettings(keepAudioOnDevice(account, device));
    expect(reloaded.audio).toMatchObject({ muted: true, sfx: 0.5 });
    expect(reloaded.profile.lastCharacter).toBe("frog");
    // A new store is built from that record just the same.
    expect(new SettingsStore(keepAudioOnDevice(account, device)).value.audio.muted).toBe(true);
  });

  it("starts a device with no sound settings of its own on the defaults, whatever the account holds", () => {
    // What the account saved before this change: a mute, and a character.
    const before = { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio, muted: true, music: 0.1 }, profile: { ...DEFAULT_SETTINGS.profile, lastCharacter: "frog" } };
    const account = memory({ [SETTINGS_KEY]: JSON.stringify(before) });
    const device = memory();

    const loaded = loadSettings(keepAudioOnDevice(account, device));
    expect(loaded.audio).toEqual(DEFAULT_SETTINGS.audio);
    expect(loaded.audio.muted).toBe(false);
    // Only the sound is left behind: the rest of the account's record carries over.
    expect(loaded.profile.lastCharacter).toBe("frog");
  });

  it("leaves the device's own sound alone when the account holds another", () => {
    const account = memory({
      [SETTINGS_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio, muted: true } }),
    });
    const device = memory({ [DEVICE_AUDIO_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS.audio, muted: false, sfx: 0.5 }) });
    expect(loadSettings(keepAudioOnDevice(account, device)).audio).toMatchObject({ muted: false, sfx: 0.5 });
  });

  it("drops the old synced sound from the account on the next save", () => {
    const before = { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio, muted: true } };
    const account = memory({ [SETTINGS_KEY]: JSON.stringify(before) });
    const store = new SettingsStore(keepAudioOnDevice(account, memory()));
    expect(store.value.audio.muted).toBe(false);

    store.update({ profile: { lastCharacter: "frog" } });
    expect(recordIn(account, SETTINGS_KEY)).not.toHaveProperty("audio");
  });

  it("still brings an account record from an older version up to date", () => {
    const v1 = { version: 1, display: { lcdPanel: false, quality: "low" }, profile: { lastCharacter: "frog", lastColour: "gold" } };
    const account = memory({ [SETTINGS_KEY]: JSON.stringify(v1) });
    const device = memory({ [DEVICE_AUDIO_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS.audio, muted: true }) });

    const loaded = loadSettings(keepAudioOnDevice(account, device));
    expect(loaded).toMatchObject({ version: 2, locale: null, display: { quality: "low" }, audio: { muted: true } });
  });

  it("keeps a device's sound when the account has no settings yet", () => {
    const device = memory({ [DEVICE_AUDIO_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS.audio, muted: true }) });
    const loaded = loadSettings(keepAudioOnDevice(memory(), device));
    expect(loaded.audio.muted).toBe(true);
    expect(loaded.profile).toEqual(DEFAULT_SETTINGS.profile);
  });

  it("gives the defaults, as ever, when neither side holds anything", () => {
    expect(loadSettings(keepAudioOnDevice(memory(), memory()))).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back one field at a time from a corrupt device record, and ignores one that is not a record", () => {
    const account = memory();
    const corrupt = memory({ [DEVICE_AUDIO_KEY]: JSON.stringify({ muted: "loud", music: 0.25 }) });
    expect(loadSettings(keepAudioOnDevice(account, corrupt)).audio).toMatchObject({ muted: false, music: 0.25 });
    for (const raw of ["{not json", "7", "null", "[]"]) {
      const device = memory({ [DEVICE_AUDIO_KEY]: raw });
      expect(loadSettings(keepAudioOnDevice(account, device)).audio, raw).toEqual(DEFAULT_SETTINGS.audio);
    }
  });

  it("passes every other key straight through to the account", () => {
    const account = memory({ "ff.playerName": "Kite" });
    const device = memory();
    const storage = keepAudioOnDevice(account, device);
    expect(storage.getItem("ff.playerName")).toBe("Kite");
    storage.setItem("ff.playerName", "Wren");
    storage.setItem("ff.progress", "{}");
    expect(account.values.get("ff.playerName")).toBe("Wren");
    expect(account.values.get("ff.progress")).toBe("{}");
    expect(device.values.size).toBe(0);
    storage.removeItem?.("ff.progress");
    expect(account.values.has("ff.progress")).toBe(false);
  });

  it("clears the old rotate-hint flag from the account when settings are saved", () => {
    const account = memory({ "floor-fifty.rotate-hint-dismissed": "1" });
    saveSettings(keepAudioOnDevice(account, memory()), loadSettings(undefined));
    expect(account.values.has("floor-fifty.rotate-hint-dismissed")).toBe(false);
  });

  it("removes both halves when the settings key is removed", () => {
    const account = memory();
    const device = memory();
    const storage = keepAudioOnDevice(account, device);
    new SettingsStore(storage).update({ audio: { muted: true }, profile: { lastCharacter: "frog" } });
    expect([account.values.size, device.values.size]).toEqual([1, 1]);
    storage.removeItem?.(SETTINGS_KEY);
    expect(account.values.size).toBe(0);
    expect(device.values.size).toBe(0);
  });
});

describe("when the device's storage is unavailable", () => {
  it.each([
    ["throws", blocked],
    ["is absent", undefined],
  ] as const)("remembers the sound for the visit when device storage %s, and never sends it to the account", (_name, device) => {
    const account = memory();
    const store = new SettingsStore(keepAudioOnDevice(account, device));
    expect(store.value.audio.muted).toBe(false);

    expect(() => store.update({ audio: { muted: true }, profile: { lastCharacter: "frog" } })).not.toThrow();
    // Remembered for this visit...
    expect(store.value.audio.muted).toBe(true);
    // ...the rest still reaches the account...
    expect(recordIn(account, SETTINGS_KEY)).toMatchObject({ profile: { lastCharacter: "frog" } });
    // ...and the mute does not take the account's road instead.
    expect(recordIn(account, SETTINGS_KEY)).not.toHaveProperty("audio");
  });

  it("reads the defaults for the sound, and the account's record for the rest", () => {
    const before = { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio, muted: true }, profile: { ...DEFAULT_SETTINGS.profile, lastCharacter: "frog" } };
    for (const device of [blocked, undefined]) {
      const loaded = loadSettings(keepAudioOnDevice(memory({ [SETTINGS_KEY]: JSON.stringify(before) }), device));
      expect(loaded.audio.muted).toBe(false);
      expect(loaded.profile.lastCharacter).toBe("frog");
    }
  });

  it("does not let a failing device write stop the account's write", () => {
    const account = memory();
    keepAudioOnDevice(account, blocked).setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, profile: { ...DEFAULT_SETTINGS.profile, lastCharacter: "frog" } }));
    expect(recordIn(account, SETTINGS_KEY)).toMatchObject({ profile: { lastCharacter: "frog" } });
  });

  it("still writes the sound to the device when the account refuses its write", () => {
    const device = memory();
    const full: SettingsStorage = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
    const store = new SettingsStore(keepAudioOnDevice(full, device));
    expect(() => store.update({ audio: { muted: true } })).not.toThrow();
    expect(recordIn(device, DEVICE_AUDIO_KEY)).toMatchObject({ muted: true });
  });
});
