import { describe, expect, it, vi } from "vitest";
import { bridgeSettings, muteWhenUnfocused } from "../../../../apps/client/src/features/audio/settings-bridge";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";
import { FakeAudio } from "../../support/fakes/audio";

describe("the settings bridge", () => {
  it("applies the stored settings at once, then every change live", () => {
    const settings = new SettingsStore(undefined);
    const audio = new FakeAudio();
    const setMuted = vi.spyOn(audio, "setMuted");
    const setPlayerVolume = vi.spyOn(audio, "setPlayerVolume");
    const stage = { setPanel: vi.fn() };

    const release = bridgeSettings(settings, { audio, stage });
    expect(setMuted).toHaveBeenLastCalledWith(false);
    expect(stage.setPanel).toHaveBeenLastCalledWith(settings.value.display.lcdPanel);

    settings.update({ audio: { muted: true, music: 0.3 }, display: { lcdPanel: false } });
    expect(setMuted).toHaveBeenLastCalledWith(true);
    expect(setPlayerVolume).toHaveBeenCalledWith("music", 0.3);
    expect(stage.setPanel).toHaveBeenLastCalledWith(false);

    release();
    settings.update({ audio: { muted: false } });
    expect(setMuted).toHaveBeenLastCalledWith(true);
  });

  it("turns the announcer's own bus with the announcer volume", () => {
    const settings = new SettingsStore(undefined);
    const audio = new FakeAudio();
    bridgeSettings(settings, { audio, stage: {} });
    settings.update({ audio: { announcer: 0.35 } });
    expect(audio.calls).toContain("volume:voice:0.35");
  });

  it("turns the interface's sounds with the effects volume, so no click outlives the slider", () => {
    const settings = new SettingsStore(undefined);
    const audio = new FakeAudio();
    bridgeSettings(settings, { audio, stage: {} });
    settings.update({ audio: { sfx: 0.2 } });
    expect(audio.calls).toContain("volume:effects:0.2");
    expect(audio.calls).toContain("volume:ui:0.2");
  });

  it("does not re-apply the panel when only audio changed", () => {
    const settings = new SettingsStore(undefined);
    const stage = { setPanel: vi.fn() };
    bridgeSettings(settings, { audio: new FakeAudio(), stage });
    stage.setPanel.mockClear();
    settings.update({ audio: { sfx: 0.2 } });
    expect(stage.setPanel).not.toHaveBeenCalled();
  });
});

describe("muting while another window has focus", () => {
  const unfocused = (audio: FakeAudio): string[] => audio.calls.filter((call) => call.startsWith("unfocused:"));

  it("leaves the sound alone when the setting is off", () => {
    const settings = new SettingsStore(undefined);
    // The store falls back to the page's storage, which an earlier test may have left set.
    settings.update({ audio: { muteUnfocused: false } });
    const audio = new FakeAudio();
    const release = muteWhenUnfocused(settings, audio, window, () => true);
    window.dispatchEvent(new Event("blur"));
    expect(unfocused(audio).at(-1)).toBe("unfocused:false");
    release();
  });

  it("mutes on blur and unmutes on focus when the setting is on", () => {
    const settings = new SettingsStore(undefined);
    settings.update({ audio: { muteUnfocused: true } });
    const audio = new FakeAudio();
    const release = muteWhenUnfocused(settings, audio, window, () => true);
    window.dispatchEvent(new Event("blur"));
    expect(unfocused(audio).at(-1)).toBe("unfocused:true");
    window.dispatchEvent(new Event("focus"));
    expect(unfocused(audio).at(-1)).toBe("unfocused:false");
    release();
  });

  it("applies a change to the setting at once, while the window is away", () => {
    const settings = new SettingsStore(undefined);
    // The store falls back to the page's storage, which an earlier test may have left set.
    settings.update({ audio: { muteUnfocused: false } });
    const audio = new FakeAudio();
    const release = muteWhenUnfocused(settings, audio, window, () => false);
    expect(unfocused(audio).at(-1)).toBe("unfocused:false");
    settings.update({ audio: { muteUnfocused: true } });
    expect(unfocused(audio).at(-1)).toBe("unfocused:true");
    settings.update({ audio: { muteUnfocused: false } });
    expect(unfocused(audio).at(-1)).toBe("unfocused:false");
    release();
  });

  it("stops listening once released", () => {
    const settings = new SettingsStore(undefined);
    settings.update({ audio: { muteUnfocused: true } });
    const audio = new FakeAudio();
    muteWhenUnfocused(settings, audio, window, () => true)();
    const before = audio.calls.length;
    window.dispatchEvent(new Event("blur"));
    expect(audio.calls.length).toBe(before);
  });
});
