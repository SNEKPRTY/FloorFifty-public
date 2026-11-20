/**
 * The race's video leaving the device (unlockables spec §6.2–§6.3, amended
 * 2026-10-03). Save downloads it. Share sends the file through the share
 * sheet where the browser can share files, which most desktop browsers and
 * any plain-`http://` build cannot. Only a share that happened counts toward
 * Unseen.
 */

import type { RecordedVideo } from "../render/race-recorder";

const pad = (n: number): string => String(n).padStart(2, "0");

/** `floor-fifty-<stage>-<yyyymmdd>-<hhmm>.<ext>`, in the finish's local time. */
export function videoFileName(stageId: string, finishedAt: Date, extension: RecordedVideo["extension"]): string {
  const d = finishedAt;
  return `floor-fifty-${stageId}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${extension}`;
}

const fileNameOf = (video: RecordedVideo): string => videoFileName(video.stageId, video.finishedAt, video.extension);

/** How long a saved video's object URL outlives the click. */
const REVOKE_AFTER_MS = 40_000;

export function saveVideo(video: RecordedVideo, doc: Document = document): void {
  const url = URL.createObjectURL(video.blob);
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = fileNameOf(video);
  anchor.rel = "noopener";
  doc.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Safari and Firefox read the URL after the click's task, so revoking it
    // there cancels the download; FileSaver.js waits as long.
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}

export type ShareOutcome = "shared" | "cancelled" | "failed" | "unsupported";

export const countsAsShare = (outcome: ShareOutcome): boolean => outcome === "shared";

/**
 * Calls `share` before any `await`, so the browser still counts the tap that
 * asked for it (a share sheet opens only from a user gesture).
 */
export async function shareVideo(
  video: RecordedVideo,
  options: { title: string; text: string; nav?: Partial<Pick<Navigator, "share" | "canShare">> },
): Promise<ShareOutcome> {
  const { title, text, nav = navigator } = options;
  // The bare type: share targets match `video/mp4`, not the recorder's codec list.
  const file = new File([video.blob], fileNameOf(video), { type: video.type.split(";")[0]!.trim() });
  if (typeof nav.canShare !== "function" || typeof nav.share !== "function" || !nav.canShare({ files: [file] })) return "unsupported";
  try {
    await nav.share({ title, text, files: [file] });
    return "shared";
  } catch (error) {
    if ((error as Error | undefined)?.name === "AbortError") return "cancelled";
    // The player sees only "Use Save instead"; the browser's reason is kept for whoever debugs it.
    console.warn("[replay-share] share refused:", (error as Error | undefined)?.name, (error as Error | undefined)?.message, {
      bytes: video.blob.size,
      type: video.type,
    });
    return "failed";
  }
}
