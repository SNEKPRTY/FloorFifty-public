/**
 * The race's video leaving the device (unlockables spec §6.2–§6.3, amended):
 * Save downloads it; Share sends the file through the share sheet where the
 * browser can, and only a share that happened counts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordedVideo } from "../../../../apps/client/src/features/render/race-recorder";
import { countsAsShare, saveVideo, shareVideo, videoFileName } from "../../../../apps/client/src/features/replay/video-export";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const video: RecordedVideo = {
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }),
  type: "video/mp4",
  extension: "mp4",
  stageId: "rooftops",
  finishedAt: new Date(2026, 9, 3, 9, 5),
};
const text = { title: "Floor Fifty", text: "Kite won on Rooftops" };

describe("save", () => {
  it("names the file by stage, the finish's local time and the container", () => {
    expect(videoFileName("rooftops", new Date(2026, 9, 1, 9, 5), "mp4")).toBe("floor-fifty-rooftops-20261001-0905.mp4");
    expect(videoFileName("snow-shrine", new Date(2026, 11, 31, 23, 59), "webm")).toBe("floor-fifty-snow-shrine-20261231-2359.webm");
  });

  it("downloads the video's own Blob through an object URL and an anchor, and revokes the URL", () => {
    vi.useFakeTimers();
    // jsdom has no object URLs.
    const create = vi.fn((_blob: Blob) => "blob:x");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    let downloaded: string | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = this.download;
    });
    saveVideo(video);
    expect(create).toHaveBeenCalledWith(video.blob);
    expect(downloaded).toBe("floor-fifty-rooftops-20261003-0905.mp4");
    expect(document.querySelector("a[download]")).toBeNull();
    // Safari and Firefox read the URL after the click's task: revoking it in
    // that task cancels the download.
    vi.advanceTimersByTime(1_000);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
});

describe("share (§6.3)", () => {
  it("shares the file where the browser can, named and typed as the video", async () => {
    const share = vi.fn((_data: ShareData) => Promise.resolve());
    const canShare = vi.fn((_data: ShareData) => true);
    expect(await shareVideo(video, { ...text, nav: { share, canShare } })).toBe("shared");
    const sent = share.mock.calls[0]![0];
    expect(sent).toMatchObject(text);
    expect(sent.files).toHaveLength(1);
    expect(sent.files![0]!.name).toBe("floor-fifty-rooftops-20261003-0905.mp4");
    expect(sent.files![0]!.type).toBe("video/mp4");
    expect(canShare.mock.calls[0]![0].files![0]).toBe(sent.files![0]);
  });

  it("shares the bare type, without the recorder's codec list", async () => {
    const share = vi.fn((_data: ShareData) => Promise.resolve());
    await shareVideo({ ...video, type: "video/mp4;codecs=avc1,mp4a.40.2" }, { ...text, nav: { share, canShare: () => true } });
    expect(share.mock.calls[0]![0].files![0]!.type).toBe("video/mp4");
  });

  it("a cancel is cancelled, and another rejection failed", async () => {
    const abort = () => Promise.reject(Object.assign(new Error(), { name: "AbortError" }));
    expect(await shareVideo(video, { ...text, nav: { share: abort, canShare: () => true } })).toBe("cancelled");
    const refuse = () => Promise.reject(new Error("NotAllowed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await shareVideo(video, { ...text, nav: { share: refuse, canShare: () => true } })).toBe("failed");
  });

  it("is unsupported with no file share, and never calls share", async () => {
    const share = vi.fn(() => Promise.resolve());
    expect(await shareVideo(video, { ...text, nav: { share } })).toBe("unsupported");
    expect(await shareVideo(video, { ...text, nav: { share, canShare: () => false } })).toBe("unsupported");
    expect(await shareVideo(video, { ...text, nav: { canShare: () => true } })).toBe("unsupported");
    expect(share).not.toHaveBeenCalled();
  });

  it("only a share that happened counts", () => {
    expect(countsAsShare("shared")).toBe(true);
    expect((["cancelled", "failed", "unsupported"] as const).some(countsAsShare)).toBe(false);
  });
});
