import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  migrateSettings,
  saveSettings,
  type SettingsStorage,
} from "../../../../apps/client/src/features/profile/settings";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";

const memory = (seed: Record<string, string> = {}): SettingsStorage & { values: Map<string, string> } => {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
};
const broken: SettingsStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("settings storage", () => {
  it("remembers the last character, and defaults to the ninja", () => {
    const storage = memory();
    expect(loadSettings(storage).profile.lastCharacter).toBe("ninja");
    saveSettings(storage, { ...loadSettings(storage), profile: { lastCharacter: "frog", lastColour: "scarlet", lastSeen: [] } });
    expect(loadSettings(storage).profile.lastCharacter).toBe("frog");
  });

  it("remembers the last colour, and defaults to scarlet", () => {
    const storage = memory();
    expect(loadSettings(storage).profile.lastColour).toBe("scarlet");
    saveSettings(storage, { ...loadSettings(storage), profile: { lastCharacter: "ninja", lastColour: "violet", lastSeen: [] } });
    expect(loadSettings(storage).profile.lastColour).toBe("violet");
  });

  it("a stored colour that is no colour falls back to scarlet, and the rest of the profile survives", () => {
    const storage = memory();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, profile: { lastCharacter: "frog", lastColour: "teal" } }));
    expect(loadSettings(storage).profile).toEqual({ lastCharacter: "frog", lastColour: "scarlet", lastSeen: [] });
  });

  it("falls back to the ninja for a stored character that is not a string", () => {
    const storage = memory();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, profile: { lastCharacter: 42 } }));
    expect(loadSettings(storage).profile.lastCharacter).toBe("ninja");
  });

  it("gives the defaults when nothing is stored, storage is absent, or storage throws", () => {
    expect(loadSettings(memory())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
  });

  it("gives the defaults for unparseable JSON and for another version", () => {
    expect(loadSettings(memory({ [SETTINGS_KEY]: "{not json" }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify({ version: 9 }) }))).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back one field at a time, keeping every valid neighbour", () => {
    const stored = { ...DEFAULT_SETTINGS, audio: { muted: true, music: "loud", sfx: 0.25 } };
    const loaded = loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify(stored) }));
    expect(loaded.audio).toEqual({
      muted: true,
      music: DEFAULT_SETTINGS.audio.music,
      sfx: 0.25,
      announcer: DEFAULT_SETTINGS.audio.announcer,
      muteUnfocused: DEFAULT_SETTINGS.audio.muteUnfocused,
    });
  });

  it("plays on while another window has focus unless the player asks otherwise", () => {
    expect(DEFAULT_SETTINGS.audio.muteUnfocused).toBe(false);
    const stored = { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio, muteUnfocused: true } };
    expect(loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify(stored) })).audio.muteUnfocused).toBe(true);
  });

  it("gives settings saved before the announcer existed a full announcer volume", () => {
    const stored = { ...DEFAULT_SETTINGS, audio: { muted: false, music: 0.4, sfx: 0.6 } };
    const loaded = loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify(stored) }));
    expect(loaded.audio).toEqual({ muted: false, music: 0.4, sfx: 0.6, announcer: 1, muteUnfocused: false });
  });

  it("starts with character and stage effects on, and fills both in for settings saved before they existed", () => {
    expect(DEFAULT_SETTINGS.display.characterEffects).toBe(true);
    expect(DEFAULT_SETTINGS.display.stageEffects).toBe(true);
    const stored = { ...DEFAULT_SETTINGS, display: { lcdPanel: false, quality: "low" } };
    const loaded = loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify(stored) }));
    expect(loaded.display).toEqual({ lcdPanel: false, quality: "low", characterEffects: true, stageEffects: true, trajectoryGuide: true });
  });


  it("keeps the effects switched off, and a bad value falls back to on alone", () => {
    const off = { ...DEFAULT_SETTINGS, display: { ...DEFAULT_SETTINGS.display, characterEffects: false, stageEffects: false } };
    expect(loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify(off) })).display).toMatchObject({ characterEffects: false, stageEffects: false });
    const bad = { ...DEFAULT_SETTINGS, display: { ...DEFAULT_SETTINGS.display, characterEffects: "no", stageEffects: false } };
    expect(loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify(bad) })).display).toMatchObject({ characterEffects: true, stageEffects: false });
  });

  it("clamps volumes into [0, 1]", () => {
    const stored = { ...DEFAULT_SETTINGS, audio: { muted: false, music: 3, sfx: -1 } };
    const loaded = loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify(stored) }));
    expect(loaded.audio.music).toBe(1);
    expect(loaded.audio.sfx).toBe(0);
  });

  it("round-trips", () => {
    const storage = memory();
    const changed = { ...DEFAULT_SETTINGS, display: { lcdPanel: false, quality: "low" as const, characterEffects: false, stageEffects: true, trajectoryGuide: false } };
    saveSettings(storage, changed);
    expect(loadSettings(storage)).toEqual(changed);
  });


  it("starts with the replay names note unseen, keeps it seen, and fills it in for a store saved before it existed", () => {
    expect(DEFAULT_SETTINGS.seen.replayNames).toBe(false);
    const storage = memory();
    saveSettings(storage, { ...DEFAULT_SETTINGS, seen: { ...DEFAULT_SETTINGS.seen, replayNames: true } });
    expect(loadSettings(storage).seen.replayNames).toBe(true);
    const before = { ...DEFAULT_SETTINGS, seen: { rotateHint: true, swipeCoach: false, tutorial: true } };
    const old = memory({ [SETTINGS_KEY]: JSON.stringify(before) });
    expect(loadSettings(old).seen).toEqual({ rotateHint: true, swipeCoach: false, tutorial: true, replayNames: false, photosensitivity: false, edgeLine: false, climbHints: false });
  });

  it("starts with the photosensitivity warning unread, and keeps it read", () => {
    expect(DEFAULT_SETTINGS.seen.photosensitivity).toBe(false);
    const storage = memory();
    saveSettings(storage, { ...DEFAULT_SETTINGS, seen: { ...DEFAULT_SETTINGS.seen, photosensitivity: true } });
    expect(loadSettings(storage).seen.photosensitivity).toBe(true);
  });

  it("remembers the edge line and the climb hints as seen, default unseen, and fills them in for an older store", () => {
    expect(DEFAULT_SETTINGS.seen).toMatchObject({ edgeLine: false, climbHints: false });
    const storage = memory();
    saveSettings(storage, { ...DEFAULT_SETTINGS, seen: { ...DEFAULT_SETTINGS.seen, edgeLine: true } });
    expect(loadSettings(storage).seen).toMatchObject({ edgeLine: true, climbHints: false });
    const old = memory({ [SETTINGS_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, seen: { tutorial: true } }) });
    expect(loadSettings(old).seen).toMatchObject({ tutorial: true, edgeLine: false, climbHints: false });
  });

  it("carries the old rotate-hint dismissal over once and removes the old key", () => {
    const storage = memory({ "floor-fifty.rotate-hint-dismissed": "1" });
    expect(loadSettings(storage).seen.rotateHint).toBe(true);
    saveSettings(storage, loadSettings(storage));
    expect(storage.values.has("floor-fifty.rotate-hint-dismissed")).toBe(false);
    expect(loadSettings(storage).seen.rotateHint).toBe(true);
  });

  it("never throws from a save", () => {
    expect(() => saveSettings(broken, DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe("the settings store", () => {
  it("merges a patch, saves it and notifies subscribers", () => {
    const storage = memory();
    const store = new SettingsStore(storage);
    const seen: boolean[] = [];
    store.subscribe((value) => seen.push(value.audio.muted));

    store.update({ audio: { muted: true } });

    expect(store.value.audio).toEqual({ ...DEFAULT_SETTINGS.audio, muted: true });
    expect(seen).toEqual([true]);
    expect(loadSettings(storage).audio.muted).toBe(true);
  });

  it("survives a reload: a second store reads what the first wrote", () => {
    const storage = memory();
    new SettingsStore(storage).update({ input: { touchMode: "buttons" } });
    expect(new SettingsStore(storage).value.input.touchMode).toBe("buttons");
  });
});

describe("the cut touch-layout editor", () => {
  it("loads a stored value that still carries its layout, and drops the layout", () => {
    const stored = { ...DEFAULT_SETTINGS, audio: { muted: true, music: 1, sfx: 1 }, touch: { layout: { left: { dx: 12, dy: -30, scale: 1, opacity: 1 } } } };
    const loaded = loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify(stored) }));
    expect(loaded.audio.muted).toBe(true);
    expect("touch" in loaded).toBe(false);
  });
});

describe("settings version 2 (languages spec §3.3)", () => {
  it("starts on Automatic", () => {
    expect(loadSettings(undefined).locale).toBeNull();
    expect(loadSettings(undefined).version).toBe(2);
  });

  it("migrates a version 1 record by adding locale: null and keeps every field", () => {
    const v1 = {
      version: 1,
      audio: { muted: true, music: 0.4, sfx: 0.2, announcer: 0 },
      display: { lcdPanel: false, quality: "low" },
      input: { touchMode: "buttons" },
      // As phase 4b saves it, with its replayNames flag.
      seen: { rotateHint: true, swipeCoach: true, tutorial: true, replayNames: true },
      profile: { lastCharacter: "frog", lastColour: "gold", lastSeen: [] },
    };
    const storage = memory({ [SETTINGS_KEY]: JSON.stringify(v1) });
    // The effect switches, the photosensitivity warning and the first-race
    // hints came later; a version 1 record takes them on, each unseen.
    expect(loadSettings(storage)).toEqual({
      ...v1,
      audio: { ...v1.audio, muteUnfocused: false },
      input: { ...v1.input, rumble: true },
      version: 2,
      locale: null,
      display: { ...v1.display, characterEffects: true, stageEffects: true, trajectoryGuide: true },
      seen: { ...v1.seen, photosensitivity: false, edgeLine: false, climbHints: false },
      story: { chaptersDone: 0, chapters: {} },
    });
  });


  it("keeps a saved locale", () => {
    const storage = memory();
    saveSettings(storage, { ...loadSettings(undefined), locale: "ko" });
    expect(loadSettings(storage).locale).toBe("ko");
  });

  it("drops a bad locale to Automatic alone", () => {
    const record = { ...loadSettings(undefined), audio: { muted: true, music: 1, sfx: 1, announcer: 1 }, locale: "klingon" };
    const loaded = loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify(record) }));
    expect(loaded.locale).toBeNull();
    expect(loaded.audio.muted).toBe(true);
  });

  it("refuses an unknown future version by falling back to defaults", () => {
    const loaded = loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify({ version: 9 }) }));
    expect(loaded).toEqual(loadSettings(undefined));
  });

  it("migrateSettings leaves a version 2 record as it is", () => {
    const v2 = { ...loadSettings(undefined), locale: "ja" };
    expect(migrateSettings(v2)).toEqual(v2);
  });

  it("holds a choice for the session when storage throws, and detects again on the next boot", () => {
    const store = new SettingsStore(broken);
    store.update({ locale: "ja" });
    expect(store.value.locale).toBe("ja");
    store.update({ locale: null });
    expect(store.value.locale).toBeNull();
    store.update({ locale: "ko" });
    expect(new SettingsStore(broken).value.locale).toBeNull();
  });

  it("leaves the locale alone on a patch that does not name it", () => {
    const store = new SettingsStore(memory());
    store.update({ locale: "es-419" });
    store.update({ audio: { muted: true } });
    expect(store.value.locale).toBe("es-419");
  });
});

describe("held saves (the splash, until the tap)", () => {
  it("apply at once, are written once on release, and a second release does nothing", () => {
    const writes: string[] = [];
    const store = new SettingsStore({ getItem: () => null, setItem: (_key, value) => void writes.push(value) });
    const release = store.holdSaves();
    store.update({ seen: { photosensitivity: true } });
    store.update({ display: { stageEffects: false } });
    expect(store.value.seen.photosensitivity).toBe(true);
    expect(writes).toHaveLength(0);
    release();
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!)).toMatchObject({ seen: { photosensitivity: true }, display: { stageEffects: false } });
    release();
    store.update({ seen: { tutorial: true } });
    expect(writes).toHaveLength(2);
  });

  it("write nothing on release when nothing changed", () => {
    const writes: string[] = [];
    const store = new SettingsStore({ getItem: () => null, setItem: (_key, value) => void writes.push(value) });
    store.holdSaves()();
    expect(writes).toHaveLength(0);
  });
});
