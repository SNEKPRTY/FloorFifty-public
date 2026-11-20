// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_DEBOUNCE_MS, PreviewDeck } from "../../../../apps/client/src/features/audio/preview-deck";

let calls: string[];
const audio = {
  playPreview: (alias: string) => void calls.push(`play:${alias}`),
  stopPreview: () => void calls.push("stop"),
  releaseTrack: (alias: string) => void calls.push(`release:${alias}`),
};

beforeEach(() => {
  calls = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("the preview deck", () => {
  it("plays the song on screen after the debounce", () => {
    const deck = new PreviewDeck(audio);
    deck.focus("music.movingOnPreview");
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    expect(calls).toEqual(["play:music.movingOnPreview"]);
  });

  it("fast paging plays one preview, the last", () => {
    const deck = new PreviewDeck(audio);
    for (const alias of ["music.aPreview", "music.bPreview", "music.cPreview", "music.dPreview"]) {
      deck.focus(alias);
      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS / 4);
    }
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    expect(calls.filter((call) => call.startsWith("play:"))).toEqual(["play:music.dPreview"]);
  });

  it("does not restart the preview already playing", () => {
    const deck = new PreviewDeck(audio);
    deck.focus("music.aPreview");
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    deck.focus("music.aPreview");
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    expect(calls).toEqual(["play:music.aPreview"]);
  });

  it("does not push the wait back when the same song is asked for again", () => {
    // The screen re-renders at the room's 20 Hz; a repeat must not hold the preview off for ever.
    const deck = new PreviewDeck(audio);
    deck.focus("music.aPreview");
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 50);
    deck.focus("music.aPreview");
    vi.advanceTimersByTime(50);
    expect(calls).toEqual(["play:music.aPreview"]);
  });

  it("changes nothing when paging comes back to the song playing before the wait ends", () => {
    const deck = new PreviewDeck(audio);
    deck.focus("music.aPreview");
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    deck.focus("music.bPreview");
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS / 2);
    deck.focus("music.aPreview");
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS * 2);
    expect(calls).toEqual(["play:music.aPreview"]);
  });

  it("releases the clip it moves away from", () => {
    const deck = new PreviewDeck(audio);
    deck.focus("music.aPreview");
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    deck.focus("music.bPreview");
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    expect(calls).toEqual(["play:music.aPreview", "play:music.bPreview", "release:music.aPreview"]);
  });

  it("fades the preview out on a slide with none: Random, or a locked song", () => {
    const deck = new PreviewDeck(audio);
    deck.focus("music.aPreview");
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    deck.focus(undefined);
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    expect(calls).toEqual(["play:music.aPreview", "stop", "release:music.aPreview"]);
  });

  it("stops, cancelling a pending preview", () => {
    const deck = new PreviewDeck(audio);
    deck.focus("music.aPreview");
    deck.stop();
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    expect(calls).toEqual(["stop"]);
  });

  it("does nothing when stopped with nothing asked for", () => {
    new PreviewDeck(audio).stop();
    expect(calls).toEqual([]);
  });
});
