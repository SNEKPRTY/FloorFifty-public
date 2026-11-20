// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SongLike } from "../../../../apps/client/src/features/audio";
import { UnlockPreview } from "../../../../apps/client/src/features/audio/unlock-preview";

const song: SongLike = {
  id: "crash-mode",
  audioAlias: "song.crash-mode",
  bpm: 120,
  beatOffsetTicks: 0,
  previewStartMs: 20_000,
  previewEndMs: 36_000,
  resultsStartMs: 40_000,
  resultsEndMs: 52_000,
};
const fakeAudio = (loads: "ok" | "fail" = "ok") => ({
  load: vi.fn((_bundle?: string) => (loads === "ok" ? Promise.resolve() : Promise.reject(new Error("404")))),
  playSection: vi.fn(),
  stop: vi.fn(),
});

describe("the unlock preview", () => {
  it("plays the new song's preview window in the slot, then resumes the race song's section where it would be", async () => {
    let t = 1_000;
    const audio = fakeAudio();
    const preview = new UnlockPreview(audio, () => t);
    preview.resultsSection({ alias: "song.rooftops", startMs: 10_000, endMs: 30_000 });
    t = 3_000;
    await preview.start(song);
    expect(audio.load).toHaveBeenCalledWith("song-crash-mode");
    expect(audio.playSection).toHaveBeenLastCalledWith("song.crash-mode", 20_000, 36_000);
    t = 9_000;
    preview.end();
    expect(audio.playSection).toHaveBeenLastCalledWith("song.rooftops", 18_000, 30_000);
  });

  it("leaves the results quiet if the race song's section has already run out", async () => {
    let t = 0;
    const audio = fakeAudio();
    const preview = new UnlockPreview(audio, () => t);
    preview.resultsSection({ alias: "song.rooftops", startMs: 0, endMs: 5_000 });
    await preview.start(song);
    t = 6_000;
    preview.end();
    expect(audio.stop).toHaveBeenCalled();
    expect(audio.playSection).toHaveBeenCalledTimes(1);
  });

  it("plays nothing, and changes nothing, if the song's group fails to load", async () => {
    const audio = fakeAudio("fail");
    const preview = new UnlockPreview(audio, () => 0);
    preview.resultsSection({ alias: "song.rooftops", startMs: 0, endMs: 20_000 });
    await preview.start(song);
    preview.end();
    expect(audio.playSection).not.toHaveBeenCalled();
    expect(audio.stop).not.toHaveBeenCalled();
  });

  it("plays nothing for a song with no preview window, even one with a results window", async () => {
    const audio = fakeAudio();
    const preview = new UnlockPreview(audio, () => 0);
    const { previewStartMs: _s, previewEndMs: _e, ...bare } = song;
    await preview.start(bare);
    expect(audio.load).not.toHaveBeenCalled();
    expect(audio.playSection).not.toHaveBeenCalled();
  });

  it("a banner gone before the group arrives never starts the preview", async () => {
    const audio = fakeAudio();
    const preview = new UnlockPreview(audio, () => 0);
    preview.resultsSection({ alias: "song.rooftops", startMs: 0, endMs: 20_000 });
    const started = preview.start(song);
    preview.end();
    await started;
    expect(audio.playSection).not.toHaveBeenCalled();
    expect(audio.stop).not.toHaveBeenCalled();
  });

  it("a banner gone before the results music is ready never starts the preview", async () => {
    const audio = fakeAudio();
    const preview = new UnlockPreview(audio, () => 0);
    let ready: () => void = () => {};
    const started = preview.start(song, new Promise<void>((resolve) => (ready = resolve)));
    preview.end();
    ready();
    await started;
    expect(audio.load).not.toHaveBeenCalled();
    expect(audio.playSection).not.toHaveBeenCalled();
  });

  it("disposed before the group arrives, it never starts", async () => {
    const audio = fakeAudio();
    const preview = new UnlockPreview(audio, () => 0);
    const started = preview.start(song);
    preview.dispose();
    await started;
    expect(audio.playSection).not.toHaveBeenCalled();
  });

  it("Race again under the banner leaves, and the preview stops", async () => {
    const audio = fakeAudio();
    const preview = new UnlockPreview(audio, () => 0);
    preview.resultsSection({ alias: "song.rooftops", startMs: 0, endMs: 20_000 });
    await preview.start(song);
    preview.dispose();
    expect(audio.stop).toHaveBeenCalledWith("song.crash-mode");
    expect(audio.playSection).toHaveBeenCalledTimes(1);
  });
});
