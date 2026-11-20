import { afterEach, describe, expect, it } from "vitest";
import { installShellHotkeys } from "../../../../apps/client/src/features/audio/settings-bridge";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";

afterEach(() => {
  document.body.innerHTML = "";
});

const press = (target: EventTarget, code: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { code, key: code.replace("Key", "").toLowerCase(), bubbles: true }));

describe("shell hotkeys", () => {
  it("toggles mute on M", () => {
    const settings = new SettingsStore(undefined);
    const release = installShellHotkeys(settings, document);
    press(document.body, "KeyM");
    expect(settings.value.audio.muted).toBe(true);
    press(document.body, "KeyM");
    expect(settings.value.audio.muted).toBe(false);
    release();
  });

  it("never fires while typing a name or a room code (review focus 1)", () => {
    const settings = new SettingsStore(undefined);
    const release = installShellHotkeys(settings, document);
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    press(field, "KeyM");
    expect(settings.value.audio.muted).toBe(false);
    release();
  });

  it("ignores a held key's repeats and modified presses", () => {
    const settings = new SettingsStore(undefined);
    const release = installShellHotkeys(settings, document);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM", repeat: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM", metaKey: true, bubbles: true }));
    expect(settings.value.audio.muted).toBe(false);
    release();
  });
});
