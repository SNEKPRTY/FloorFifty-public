/**
 * Save video and Share video (unlockables spec §6.2–§6.4, amended): a save
 * counts at once; a share counts only when it happened; the first share on a
 * device says videos show names; a grant is said in the status line.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import type { RecordedVideo } from "../../../../apps/client/src/features/render/race-recorder";
import { NAMES_NOTE, ReplayShare, type ReplayShareOptions } from "../../../../apps/client/src/features/replay/replay-share.svelte";
import { fakeSettings } from "../../support/fakes/settings";
import { installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import * as m from "../../../../apps/client/src/paraglide/messages.js";

const content = parseGameContentArtifact(JSON.parse(readFileSync(resolve(process.cwd(), "content/generated/content.json"), "utf8"))).content;
const video: RecordedVideo = {
  blob: new Blob([new Uint8Array([1])], { type: "video/mp4" }),
  type: "video/mp4",
  extension: "mp4",
  stageId: "rooftops",
  finishedAt: new Date(2026, 9, 3, 22, 0),
};
const abort = () => Promise.reject(Object.assign(new Error(), { name: "AbortError" }));

// `fakeSettings` falls back to the page's storage, which a share's seen flag
// would carry from one test to the next.
beforeEach(() => localStorage.clear());

function make(overrides: Partial<ReplayShareOptions> = {}) {
  const saved: RecordedVideo[] = [];
  const share = vi.fn((_round: string | undefined): string | undefined => undefined);
  const sheet = vi.fn((_data: ShareData) => Promise.resolve());
  const replay = new ReplayShare({
    video: () => video,
    winner: "Kite",
    stageName: () => "Rooftops",
    round: "7:1",
    progress: { share },
    settings: fakeSettings(),
    content: () => content,
    colour: "scarlet",
    nav: { share: sheet, canShare: () => true },
    save: (value) => saved.push(value),
    ...overrides,
  });
  return { replay, saved, share, sheet };
}

describe("the replay window's Save video and Share video", () => {
  it("a save downloads the video and counts at once; a grant is said in the status line", () => {
    const { replay, saved, share } = make();
    share.mockReturnValue("share-replay");
    replay.save();
    expect(saved).toEqual([video]);
    expect(share).toHaveBeenCalledWith("7:1");
    expect(replay.status).toBe("New song unlocked: Unseen");
  });

  it("does nothing with no video", async () => {
    const { replay, saved, share, sheet } = make({ video: () => undefined });
    replay.save();
    await replay.share();
    expect(saved).toEqual([]);
    expect(sheet).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it("a share that happened counts, with the winner and the stage", async () => {
    const { replay, share, sheet } = make();
    await replay.share();
    expect(sheet).toHaveBeenCalledWith(expect.objectContaining({ title: "Floor Fifty", text: "Kite won on Rooftops" }));
    expect(share).toHaveBeenCalledWith("7:1");
  });

  it("says a race with no winner as a race on the stage", async () => {
    const { replay, sheet } = make({ winner: undefined });
    await replay.share();
    expect(sheet).toHaveBeenCalledWith(expect.objectContaining({ text: "A race on Rooftops" }));
  });

  it("asks for the share sheet in the tap's own task", () => {
    const { replay, sheet } = make();
    void replay.share();
    expect(sheet).toHaveBeenCalledOnce();
  });

  it("a cancel says and counts nothing", async () => {
    const { replay, share } = make({ nav: { share: abort, canShare: () => true } });
    await replay.share();
    expect(replay.status).toBeUndefined();
    expect(share).not.toHaveBeenCalled();
  });

  it("says whether the share went through: shared and the save fallback yes, a cancel, a refusal and a second press no", async () => {
    expect(await make().replay.share()).toBe(true);
    expect(await make({ nav: { share: abort, canShare: () => true } }).replay.share()).toBe(false);
    expect(await make({ nav: { share: () => Promise.reject(new Error("NotAllowed")), canShare: () => true } }).replay.share()).toBe(false);
    expect(await make({ nav: {} }).replay.share()).toBe(false);
    expect(await make({ video: () => undefined }).replay.share()).toBe(false);
    // From a controller the sheet cannot open, so the file is saved instead: that went through.
    const saving = make({ activation: () => false });
    expect(await saving.replay.share()).toBe(true);
    expect(saving.saved).toEqual([video]);
    // A second press while the sheet is open does nothing and shows no good news.
    const open = make();
    const first = open.replay.share();
    expect(await open.replay.share()).toBe(false);
    expect(await first).toBe(true);
  });

  it("a refused share, or a browser that cannot share files, says to use Save and counts nothing", async () => {
    const refused = make({ nav: { share: () => Promise.reject(new Error("NotAllowed")), canShare: () => true } });
    await refused.replay.share();
    expect(refused.replay.status).toBe("Could not share the video. Use Save instead.");
    expect(refused.share).not.toHaveBeenCalled();
    const unable = make({ nav: {} });
    await unable.replay.share();
    expect(unable.replay.status).toBe("This browser cannot share videos. Use Save instead.");
    expect(unable.share).not.toHaveBeenCalled();
  });

  describe("inside Ruken's frame, which blocks downloads", () => {
    it("has no Save: a save does nothing and counts nothing", () => {
      const { replay, saved, share } = make({ canSave: false });
      expect(replay.canSave).toBe(false);
      replay.save();
      expect(saved).toEqual([]);
      expect(share).not.toHaveBeenCalled();
    });

    it("never says to use Save, which is not there", async () => {
      const refused = make({ canSave: false, nav: { share: () => Promise.reject(new Error("NotAllowed")), canShare: () => true } });
      await refused.replay.share();
      expect(refused.replay.status).toBe("Could not share the video.");
      const unable = make({ canSave: false, nav: {} });
      await unable.replay.share();
      expect(unable.replay.status).toBe("This browser cannot share videos.");
    });

    it("a controller press, which cannot open the sheet, saves nothing and says the share did not go through", async () => {
      const pad = make({ canSave: false, activation: () => false });
      expect(await pad.replay.share()).toBe(false);
      expect(pad.saved).toEqual([]);
      expect(pad.share).not.toHaveBeenCalled();
      expect(pad.replay.status).toBe("Could not share the video.");
    });

    it("still shares through the sheet, and counts it", async () => {
      const { replay, share, sheet } = make({ canSave: false });
      expect(await replay.share()).toBe(true);
      expect(sheet).toHaveBeenCalledOnce();
      expect(share).toHaveBeenCalledWith("7:1");
    });
  });

  it("the names note shows on the first share only, once per device", async () => {
    const settings = fakeSettings();
    const first = make({ settings }).replay;
    expect(first.note).toBeUndefined();
    await first.share();
    expect(first.note).toBe(NAMES_NOTE());
    expect(NAMES_NOTE()).toBe("Videos show everyone's names");
    expect(settings.value.seen.replayNames).toBe(true);
    const later = make({ settings }).replay;
    await later.share();
    expect(later.note).toBeUndefined();
  });

  it("with no progress store, still saves and shares, counting nothing", async () => {
    const { replay, saved } = make({ progress: undefined });
    replay.save();
    await replay.share();
    expect(saved).toHaveLength(1);
    expect(replay.status).toBeUndefined();
  });
});

describe("from a controller", () => {
  it("saves instead of sharing when the press gave the page no user activation, which share needs", async () => {
    const { replay, saved, share, sheet } = make({ activation: () => false });
    share.mockReturnValue(undefined);
    await replay.share();
    expect(sheet).not.toHaveBeenCalled();
    expect(saved).toEqual([video]);
    expect(share).toHaveBeenCalledWith("7:1");
    expect(replay.status).toBeUndefined();
  });

  it("shares as usual after a tap", async () => {
    const { replay, saved, sheet } = make({ activation: () => true });
    await replay.share();
    expect(sheet).toHaveBeenCalledOnce();
    expect(saved).toEqual([]);
  });
});

describe("after a language switch", () => {
  it("re-words the status line and the names note", async () => {
    const settings = fakeSettings();
    const undo = installLocaleStrategy(settings, () => ["en-US"]);
    try {
      const { replay } = make({ settings, nav: { share: () => Promise.reject(new Error("no")), canShare: () => true } });
      await replay.share();
      expect(replay.status).toBe(m.replay_share_failed({}, { locale: "en" }));
      expect(replay.note).toBe(m.replay_names_note({}, { locale: "en" }));
      settings.update({ locale: "ja" });
      expect(replay.status).toBe(m.replay_share_failed({}, { locale: "ja" }));
      expect(replay.note).toBe(m.replay_names_note({}, { locale: "ja" }));
    } finally {
      settings.update({ locale: null });
      undo();
    }
  });

  it("names the stage as it is called when the share happens", async () => {
    let name = "Rooftops";
    const { replay, sheet } = make({ stageName: () => name });
    name = "屋上";
    await replay.share();
    expect(sheet.mock.calls[0]![0].text).toContain("屋上");
  });
});
