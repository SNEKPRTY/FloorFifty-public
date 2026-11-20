/**
 * Save video and Share video in the replay window (unlockables spec §6.2–§6.4,
 * amended 2026-10-03), over the race's live recording.
 *
 * A save counts as a share at once (the file is in hand); a share counts only
 * when it happened, never on a cancel. A grant is said in the status line,
 * since the banner belongs to results.
 */

import type { SeatColour } from "@floor-fifty/shared/common/seats";
import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";
import type { RecordedVideo } from "../render/race-recorder";
import { countsAsShare, saveVideo, shareVideo, type ShareOutcome } from "./video-export";
import type { ProgressStore } from "../profile/store/progress.svelte";
import type { SettingsStore } from "../profile/store/settings.svelte";
import * as m from "../../paraglide/messages.js";
import { grantOf, grantAnnouncement } from "../net/unlock-grant";
import { isEmbedded } from "../platform/embedded-frame";

/** Resolved when it is said, so it follows a language switch. */
export const NAMES_NOTE = (): string => m.replay_names_note();

const STATUS: Partial<Record<ShareOutcome, () => string>> = {
  failed: m.replay_share_failed,
  unsupported: m.replay_share_unsupported,
};

/** The same refusals where there is no Save to fall back on. */
const STATUS_NO_SAVE: Partial<Record<ShareOutcome, () => string>> = {
  failed: m.replay_share_failed_framed,
  unsupported: m.replay_share_unsupported_framed,
};

export type ReplayShareOptions = {
  video: () => RecordedVideo | undefined;
  winner: string | undefined;
  /** Read when the share happens, so it is in the language of that moment. */
  stageName: () => string;
  /** The results' race key while the room still shows them; undefined once it has moved on. */
  round: string | undefined;
  progress: Pick<ProgressStore, "share"> | undefined;
  settings: SettingsStore;
  content: () => GameContentPayload | undefined;
  colour: SeatColour;
  /** Seams for tests; the page's own by default. */
  nav?: Partial<Pick<Navigator, "share" | "canShare">>;
  save?: (video: RecordedVideo) => void;
  /**
   * Whether the press that asked gave the page a user activation, which the
   * share sheet needs. A controller press never does; the page's own reading
   * by default, true where the browser cannot say.
   */
  activation?: () => boolean;
  /**
   * Whether the video can be saved as a file. Ruken's frame blocks downloads,
   * so there it cannot, and only Share is offered. The page's own frame by default.
   */
  canSave?: boolean;
};

const pageActivation = (): boolean => (globalThis.navigator as Navigator | undefined)?.userActivation?.isActive ?? true;

export class ReplayShare {
  // Held as the words' messages, not their text, so a language switch re-words them.
  #note = $state<(() => string) | undefined>(undefined);
  #status = $state<(() => string) | undefined>(undefined);
  /** Whether the status is a refusal (an alert) rather than good news. */
  #refused = $state(false);
  get note(): string | undefined {
    return this.#note?.();
  }
  get status(): string | undefined {
    return this.#status?.();
  }
  get refused(): boolean {
    return this.#refused;
  }
  /** One share sheet at a time: a second press while one is open does nothing. */
  private sharing = false;

  /** Whether Save is offered: not inside a frame, which blocks downloads. */
  readonly canSave: boolean;

  constructor(private readonly options: ReplayShareOptions) {
    this.canSave = options.canSave ?? (typeof window === "undefined" ? true : !isEmbedded(window));
  }

  /** Closes the notice that says either: the player has read it. */
  dismiss(): void {
    this.#note = undefined;
    this.#status = undefined;
    this.#refused = false;
  }

  save(): void {
    const video = this.options.video();
    if (video === undefined || !this.canSave) return;
    (this.options.save ?? saveVideo)(video);
    this.#status = undefined;
    this.counted();
  }

  /**
   * Asks for the share sheet in the tap's own task: nothing is awaited before it.
   * Says whether it went through: shared, or fell back to saving the file. A cancel, a refusal
   * and a second press while the sheet is open are all `false`.
   */
  async share(): Promise<boolean> {
    const video = this.options.video();
    if (video === undefined || this.sharing) return false;
    // From a controller the sheet can only refuse: the file is saved instead,
    // which counts as a share does. With no Save (a frame), it is a refusal.
    if (!(this.options.activation ?? pageActivation)()) {
      if (!this.canSave) {
        this.#status = STATUS_NO_SAVE.failed;
        this.#refused = true;
        return false;
      }
      this.save();
      return true;
    }
    const { settings, winner } = this.options;
    const stageName = this.options.stageName();
    this.sharing = true;
    const pending = shareVideo(video, {
      title: "Floor Fifty",
      text: winner === undefined ? m.replay_share_text({ stage: stageName }) : m.replay_share_text_winner({ winner, stage: stageName }),
      ...(this.options.nav === undefined ? {} : { nav: this.options.nav }),
    });
    if (!settings.value.seen.replayNames) {
      this.#note = NAMES_NOTE;
      settings.update({ seen: { replayNames: true } });
    }
    let outcome: ShareOutcome;
    try {
      outcome = await pending;
    } finally {
      this.sharing = false;
    }
    this.#status = (this.canSave ? STATUS : STATUS_NO_SAVE)[outcome];
    this.#refused = this.#status !== undefined;
    if (countsAsShare(outcome)) this.counted();
    return countsAsShare(outcome);
  }

  private counted(): void {
    const granted = this.options.progress?.share(this.options.round);
    if (granted === undefined) return;
    const content = this.options.content();
    const grant = content === undefined ? undefined : grantOf(content, granted, this.options.colour);
    if (grant === undefined) return;
    this.#status = () => grantAnnouncement(grant);
    this.#refused = false;
  }
}
