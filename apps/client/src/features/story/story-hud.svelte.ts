/**
 * The story's HUD over the climb (story mode v2 spec, "In the climb"), mounted
 * once and updated in place, as the race HUD is: the glim counter under the
 * floor counter, the objective chip, the pointer, the wind chip and its
 * streaks, the bark line with its portrait, the control chip, the "Safe spot"
 * word and the lava's glow.
 *
 * The screen is plain TypeScript, so the state lives here in runes and the
 * component reads it through getters. Every setter is a no-op when nothing
 * changed, so the screen may call each one every frame.
 */

import { mount, unmount } from "svelte";
import type { ChipKind } from "@floor-fifty/shared/level/tutorial";
import type { StoryContent } from "@floor-fifty/shared/content/game-content";
import type { SettingsStore } from "../profile/store/settings.svelte";
import StoryHud from "./StoryHud.svelte";

/** A line of talk on screen, in the player's language. */
export type HudLine = {
  readonly speaker: string | undefined;
  /** The speaker's portrait, or undefined for the narrator and while it loads. */
  readonly portrait: string | undefined;
  readonly text: string;
};

/** The pointer at the screen's edge: up or down, how many floors, and where across. */
export type HudPointer = { readonly direction: "up" | "down"; readonly floors: number; readonly left: number };

/** A glim on its way to the counter, from where it was picked up (viewport pixels). */
export type HudFlight = { readonly id: number; readonly left: number; readonly top: number };

export type StoryHudModel = {
  readonly glims: { readonly carried: number; readonly total: number };
  /** Bumps on each pick-up, for the counter's pop. */
  readonly glimPops: number;
  readonly objective: string | undefined;
  readonly pointer: HudPointer | undefined;
  readonly wind: { readonly direction: 1 | -1; readonly blowing: boolean } | undefined;
  readonly line: HudLine | undefined;
  readonly chip: ChipKind | undefined;
  /** Bumps on each "lava close", for the glow's pulse. */
  readonly lavaPulses: number;
  /** Bumps on each safe spot, for the word. */
  readonly safeSpots: number;
  readonly flights: readonly HudFlight[];
  /** Under the HUD's top band, in overlay pixels: where the story's chips start. */
  readonly top: number;
  /** The floor counter's left edge, in overlay pixels: the glim counter sits under it. */
  readonly left: number;
  readonly paused: boolean;
  readonly hidden: boolean;
  /** The weather the wind's streaks are: snow on the Snow Shrine, dust elsewhere. */
  readonly snow: boolean;
};

export type StoryHudOptions = {
  readonly prompts: StoryContent["prompts"];
  readonly settings: SettingsStore;
};

const FLIGHT_MS = 350;

export class StoryHudView {
  private model = $state.raw<StoryHudModel>({
    glims: { carried: 0, total: 0 },
    glimPops: 0,
    objective: undefined,
    pointer: undefined,
    wind: undefined,
    line: undefined,
    chip: undefined,
    lavaPulses: 0,
    safeSpots: 0,
    flights: [],
    top: 72,
    left: 12,
    paused: false,
    hidden: false,
    snow: false,
  });
  private readonly app: Record<string, unknown>;
  private flightId = 0;

  constructor(target: HTMLElement, options: StoryHudOptions) {
    const view = this;
    this.app = mount(StoryHud, {
      target,
      props: {
        get model() {
          return view.model;
        },
        ...options,
        onLanded: (id: number) => view.land(id),
      },
    });
  }

  private set(patch: Partial<StoryHudModel>): void {
    const model = this.model;
    const changed = (Object.keys(patch) as (keyof StoryHudModel)[]).some((key) => patch[key] !== model[key]);
    if (changed) this.model = { ...model, ...patch };
  }

  setGlims(carried: number, total: number): void {
    const { glims } = this.model;
    if (glims.carried !== carried || glims.total !== total) this.set({ glims: { carried, total } });
  }

  /** A glim picked up at a viewport point: it flies to the counter, which pops when it lands. */
  flyGlim(from: { readonly left: number; readonly top: number }, reduced: boolean): void {
    if (reduced) {
      this.set({ glimPops: this.model.glimPops + 1 });
      return;
    }
    const flight = { id: (this.flightId += 1), left: from.left, top: from.top };
    this.set({ flights: [...this.model.flights, flight] });
  }

  private land(id: number): void {
    this.set({ flights: this.model.flights.filter((flight) => flight.id !== id), glimPops: this.model.glimPops + 1 });
  }

  setObjective(text: string | undefined): void {
    this.set({ objective: text });
  }

  setPointer(pointer: HudPointer | undefined): void {
    const last = this.model.pointer;
    if (last === pointer) return;
    if (last !== undefined && pointer !== undefined && last.direction === pointer.direction && last.floors === pointer.floors && Math.abs(last.left - pointer.left) < 1) return;
    this.set({ pointer });
  }

  setWind(wind: StoryHudModel["wind"]): void {
    const last = this.model.wind;
    if (last?.direction === wind?.direction && last?.blowing === wind?.blowing) return;
    this.set({ wind });
  }

  setLine(line: HudLine | undefined): void {
    this.set({ line });
  }

  setChip(chip: ChipKind | undefined): void {
    this.set({ chip });
  }

  lavaClose(): void {
    this.set({ lavaPulses: this.model.lavaPulses + 1 });
  }

  safeSpot(): void {
    this.set({ safeSpots: this.model.safeSpots + 1 });
  }

  /** Where the race HUD's top band ends and its floor counter starts, in overlay pixels. */
  setAnchor(top: number, left: number): void {
    if (Math.abs(top - this.model.top) >= 1 || Math.abs(left - this.model.left) >= 1) this.set({ top, left });
  }

  setPaused(paused: boolean): void {
    this.set({ paused });
  }

  setHidden(hidden: boolean): void {
    this.set({ hidden });
  }

  setSnow(snow: boolean): void {
    this.set({ snow });
  }

  /** The model as shown, for tests. */
  current(): StoryHudModel {
    return this.model;
  }

  destroy(): void {
    void unmount(this.app);
  }
}

export { FLIGHT_MS };
