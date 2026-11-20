/**
 * The last race's video (unlockables spec §6.1, amended), held in memory
 * beside the room's replay bytes and with the same lifetime: the next race's
 * countdown and leaving the room retire it. Nothing is stored.
 */

import type { NetworkListeners } from "./network";
import type { RecordedVideo } from "../render/race-recorder";

export class RaceVideo {
  // Raw: a Blob is replaced whole, never proxied.
  current = $state.raw<RecordedVideo | undefined>(undefined);

  keep(video: RecordedVideo): void {
    this.current = video;
  }

  retire(): void {
    this.current = undefined;
  }
}

/**
 * Retires the video when the next race counts down or races, and when the
 * room is gone (the connection goes offline): the lifetime the room's replay
 * bytes have in `colyseus-network.ts`.
 */
export function retireVideoWithRace(
  network: { subscribe(listeners: Partial<NetworkListeners>): () => void },
  video: Pick<RaceVideo, "retire">,
): () => void {
  return network.subscribe({
    onSnapshot: (snapshot) => {
      if (snapshot.phase === "countdown" || snapshot.phase === "racing") video.retire();
    },
    onConnectionState: (state) => {
      if (state === "offline") video.retire();
    },
  });
}
