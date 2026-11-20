/**
 * Infinite's closing hum held for one racer (race-cues `climbDrone`), from the
 * sample a screen draws, so it rises with the clock the player sees. A finite
 * race never asks for it.
 *
 * Asked for only once it has something to say, eased with the clock, and cut
 * dead the moment the race stops racing: its silence lands
 * inside the finish's own. The race and the replay each hold one, made on
 * enter, so nothing carries from one screen visit to the next.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { isEndless } from "@floor-fifty/shared/simulation/endless";
import type { AudioPort } from "../audio";
import { endlessTicksLeft } from "./hud-model";
import { CLIMB_DRONE, climbDrone } from "./race-cues";

export class DroneHold {
  private droning = false;

  constructor(private readonly audio: AudioPort) {}

  /** Holds the hum for `racerId` in `sample`, an endless race's clock read at `clockTick`. */
  update(sample: RoomSnapshot, racerId: PlayerId | undefined, clockTick: number): void {
    if (sample.phase !== "racing") {
      this.stop();
      return;
    }
    const endless = isEndless(sample.tuning) ? { ticksLeft: endlessTicksLeft(sample, clockTick) } : undefined;
    const { level, rate } = climbDrone(
      sample.players.find((player) => player.id === racerId),
      endless,
    );
    if (level === 0 && !this.droning) return;
    this.audio.setDrone?.(CLIMB_DRONE.alias, level, rate);
    this.droning = true;
  }

  /** Cuts the hum, if it is playing. */
  stop(): void {
    if (this.droning) this.audio.stopDrone?.();
    this.droning = false;
  }
}
