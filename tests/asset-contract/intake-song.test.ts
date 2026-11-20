import { describe, expect, it } from "vitest";
import {
  camelAlias,
  isHandEdited,
  parseIntakeArgs,
  previewGain,
  previewWindow,
  resultsWindow,
  songToml,
  upsertRow,
  windowOnBeat,
} from "../../packages/asset-contract/tools/intake-song";

const MEASURE = { bpm: 128, beatOffsetTicks: 15, durationMs: 180000, loudnessLufs: -15.8 };
const MOVING_ON = { id: "moving-on", title: "Moving On" };

describe("a preview's level (polish spec §8.1)", () => {
  it("brings a preview cut from a loud window down to the music band", () => {
    // -14.07 LUFS needs 1.93 dB down to reach -16.
    expect(20 * Math.log10(previewGain(-14.07, -3))).toBeCloseTo(-1.93, 2);
  });

  it("lifts a preview cut from a quiet window up to the music band", () => {
    // We Outside's opening: -17.49 LUFS with its peak at -3.2 dBFS.
    expect(20 * Math.log10(previewGain(-17.49, -3.2))).toBeCloseTo(1.49, 2);
    expect(previewGain(-16, -6)).toBe(1);
  });

  it("never lifts a peak past -1 dBFS, so nothing can clip", () => {
    // 3 dB short of the band, but only 1.5 dB of headroom.
    expect(20 * Math.log10(previewGain(-19, -2.5))).toBeCloseTo(1.5, 2);
    expect(previewGain(-18, -0.5)).toBe(1);
  });
});

describe("intake", () => {
  it("names aliases in camel case", () => {
    expect(camelAlias("music", "moving-on")).toBe("music.movingOn");
    expect(camelAlias("cover", "whats-next")).toBe("cover.whatsNext");
  });

  it("writes a TOML with whole-file loops and no results window", () => {
    const text = songToml(MOVING_ON, MEASURE);
    expect(text).toContain('id = "moving-on"');
    expect(text).toContain('displayName = "Moving On"');
    expect(text).toContain("bpm = 128.00");
    expect(text).toContain("beatOffsetTicks = 15");
    expect(text).toContain("loopStartMs = 0");
    expect(text).toContain("loopEndMs = 180000");
    expect(text).toContain('audioAlias = "music.movingOn"');
    expect(text).toContain('coverAlias = "cover.movingOn"');
    expect(text).not.toContain("resultsStartMs");
    expect(text).not.toContain("previewStartMs");
    expect(text).not.toContain("unlock");
  });

  it("writes a title with an apostrophe, and the unlock it is given", () => {
    const text = songToml({ id: "whats-next", title: "What's Next", unlock: "any-match" }, MEASURE);
    expect(text).toContain(`displayName = "What's Next"`);
    expect(text).toContain('unlock = "any-match"');
  });

  it("knows its own untouched output from a hand-edited file", () => {
    const text = songToml(MOVING_ON, MEASURE);
    expect(isHandEdited(text)).toBe(false);
    expect(isHandEdited(text.replace("bpm = 128.00", "bpm = 127.00"))).toBe(true);
    expect(isHandEdited(`${text}resultsStartMs = 80000\nresultsEndMs = 96000\n`)).toBe(true);
    expect(isHandEdited('id = "moving-on"\n')).toBe(true); // no intake hash: someone wrote it
  });

  it("reads a results window, trailing comment and all", () => {
    expect(resultsWindow("resultsStartMs = 135000 # provisional\nresultsEndMs = 151000\n")).toEqual({ startMs: 135000, endMs: 151000 });
    expect(resultsWindow('id = "moving-on"\n')).toBeUndefined();
  });

  it("reads a preview window apart from the results window", () => {
    const toml = "previewStartMs = 20000\npreviewEndMs = 36000 # by ear\nresultsStartMs = 135000\nresultsEndMs = 151000\n";
    expect(previewWindow(toml)).toEqual({ startMs: 20000, endMs: 36000 });
    expect(resultsWindow(toml)).toEqual({ startMs: 135000, endMs: 151000 });
    expect(previewWindow("resultsStartMs = 135000\nresultsEndMs = 151000\n")).toBeUndefined();
  });

  it("moves a proposed window onto the next beat, and back inside the song", () => {
    // 120 BPM from 250 ms: beats at 250, 750, 1250 ...
    expect(windowOnBeat(10_000, 250, 120, 60_000)).toEqual({ startMs: 10_250, endMs: 26_250 });
    expect(windowOnBeat(50_000, 250, 120, 60_000)).toEqual({ startMs: 43_750, endMs: 59_750 });
  });

  it("moves a row between bundles rather than duplicating it", () => {
    const manifest = { bundles: { audio: [{ alias: "music.tutorial", file: "a" }], shell: [] } };
    upsertRow(manifest, "song-dawn-tutorial", { alias: "music.tutorial", file: "b" });
    expect(manifest.bundles).toEqual({ audio: [], shell: [], "song-dawn-tutorial": [{ alias: "music.tutorial", file: "b" }] });
  });

  it("reads its arguments, and refuses a missing title or an unknown flag", () => {
    expect(parseIntakeArgs(["m.wav", "whats-next", "--title", "What's Next", "--unlock", "any-match", "--force"])).toEqual({
      master: "m.wav",
      id: "whats-next",
      title: "What's Next",
      unlock: "any-match",
      force: true,
      reencode: false,
      preview: false,
      propose: false,
    });
    expect(parseIntakeArgs(["m.wav", "whats-next", "--preview"]).preview).toBe(true);
    expect(parseIntakeArgs(["m.wav", "whats-next", "--propose"]).propose).toBe(true);
    expect(() => parseIntakeArgs(["m.wav", "whats-next", "--preview", "--propose"])).toThrow(/usage/);
    expect(() => parseIntakeArgs(["m.wav", "whats-next"])).toThrow(/--title is required/);
    expect(() => parseIntakeArgs(["m.wav", "whats-next", "--title", "X", "--frce"])).toThrow(/unknown flag --frce/);
    expect(() => parseIntakeArgs(["m.wav", "Whats Next", "--title", "X"])).toThrow(/usage/);
  });
});
