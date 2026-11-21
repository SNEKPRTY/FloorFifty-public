/**
 * Mounting the race HUD from imperative code.
 *
 * `features/race/gameplay.ts` owns this the way it owns everything else it creates,
 * so the seam is a class rather than a component in a tree. The view itself is
 * `features/race/RaceHud.svelte`.
 *
 * `.svelte.ts` because the model is a rune: `update` writes to it and the
 * mounted component patches the text in place. Remounting per snapshot would
 * rebuild four roster rows twenty times a second, which is the same defect the
 * ready room was written around -- a row replaced between a press and a release
 * never fires a click.
 */

import type { SpringTuning } from "@floor-fifty/shared/content/game-content";
import { classifyHeightTier } from "../platform/height-tier";
import { mount, unmount } from "svelte";
import { DEFAULT_CLOCK_SECONDS, DEFAULT_MODE_ID } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { StagePort, ViewportInfo } from "../render/stage-port";
import type { FormFactor } from "../platform/form-factor";
import { BOTTOM_BAND_FOR } from "../../lib/constants";
import { LapPulses, hudModel, type HudModel } from "./hud-model";
import RaceHud from "./RaceHud.svelte";
import Countdown from "./Countdown.svelte";
import type { CountLabel } from "./countdown-clock";
import type { SettingsStore } from "../profile/store/settings.svelte";
import type { RaceHintKind } from "./race-hints";
import { BARK_MS } from "./juice/cpu-barks";
import * as m from "../../paraglide/messages.js";

/**
 * Where the HUD may draw, per orientation.
 *
 * Derived once from the shared `ViewportInfo`, so the HUD and the letterbox
 * cannot disagree about where the play field is -- the failure that put the lap
 * indicator under a bar in the first place.
 */
/** Where the local racer and its nameplate are drawn, in window pixels. */
export type RacerBox = Readonly<{ left: number; top: number; right: number; bottom: number }>;

export type HudPlacement = Readonly<{
  portrait: boolean;
  /**
   * The form factor, which picks the portrait roster's markup: pips on a phone
   * held upright, the named roster band on a tablet (responsive parity §5.4).
   */
  formFactor: FormFactor;
  /**
   * Phone landscape, where four full rows would crowd the thumbs. Taken from
   * the form factor rather than a height of its own (responsive parity D-R2).
   */
  compact: boolean;
  /**
   * A landscape screen in the `compact` height tier (below 340 px, the height a
   * browser leaves a sideways phone): the roster collapses to one pill, so
   * the HUD stops covering where the next floors arrive (UI layout system spec §4.4).
   */
  collapsed: boolean;
  /** Viewport-space box the fixed HUD root occupies. */
  frame: ViewportInfo["canvasCss"];
  inset: Readonly<{ top: number; inline: number }>;
  /**
   * Portrait only: where the pip strip starts, in viewport pixels. It opens
   * the bottom band, directly above the thumbs, because the strip is the one
   * part of the HUD a finger touches and belongs with the other things a
   * finger touches (responsive parity spec §5.4).
   */
  stripTop?: number | undefined;
}>;

/**
 * A comfortable margin from the screen edge, in CSS pixels, per form factor.
 * Geometry rather than a CSS token: it is added to the letterbox's own
 * numbers here and handed to the HUD as inline properties. A phone held
 * sideways has the least room around the course, so its chips sit closer to
 * the edge (responsive parity spec §5.4, from the approved race board).
 */
const INSET: Readonly<Record<FormFactor, number>> = {
  "phone-portrait": 12,
  "phone-landscape": 8,
  desktop: 12,
  "tablet-portrait": 12,
};

/**
 * The bottom band each portrait form factor reserves (`lib/constants.ts`),
 * re-exported beside the placement that uses it. Phase 2's swipe surface
 * inherits the same band.
 */
export { BOTTOM_BAND_FOR };

/** The phone's band, under the name the phone-portrait tests use. */
export const BOTTOM_BAND = BOTTOM_BAND_FOR["phone-portrait"];

export function placementFor(viewport: ViewportInfo): HudPlacement {
  const portrait = viewport.portrait;

  // Portrait crops nothing, so the scenery above the play rectangle is free and
  // the HUD belongs at the top of the screen. Landscape crops
  // `LETTERBOX_CROP_FRACTION` off the field with a bar, and a chip placed in
  // that strip is not dimmed, it is covered -- so it starts at the visible
  // field's top edge.
  const inset = INSET[viewport.formFactor];
  const top = portrait ? inset : Math.max(inset, viewport.gameplayCss.y + inset);

  const band = viewport.formFactor === "tablet-portrait" ? BOTTOM_BAND_FOR["tablet-portrait"] : BOTTOM_BAND;

  return {
    portrait,
    formFactor: viewport.formFactor,
    compact: viewport.formFactor === "phone-landscape",
    collapsed: !portrait && classifyHeightTier(viewport.canvasCss.height) === "compact",
    frame: viewport.canvasCss,
    inset: { top, inline: inset },
    stripTop: portrait ? viewport.canvasCss.height - band : undefined,
  };
}

export class RaceHudView {
  private model = $state<HudModel>(hudModel(EMPTY));
  private placement = $state<HudPlacement>(placementFor(DEFAULT_VIEWPORT));
  private count = $state<CountLabel | undefined>(undefined);
  private countRacer = $state.raw<{ top: number; bottom: number; height: number; frameTop: number } | undefined>(undefined);
  private racerRect: (() => RacerBox | undefined) | undefined;
  private racerBox = $state.raw<RacerBox | undefined>(undefined);
  private pops = $state(0);
  /** How far the Floors chip pops: `juice.toml`'s `collect.hudPop.scale`. */
  private popScale = $state(1.06);
  /** The pop's spring, `juice.toml`'s `springs.hudPop` (Wonder spec §4.2). */
  private popSpring = $state.raw<SpringTuning | undefined>(undefined);
  private readonly pulses = new LapPulses();
  private announcement = $state("");
  private recoveryHint = $state(false);
  /** The hint in the toast slot now; the screen changes it as the race runs (`race-hints.ts`). */
  private hint = $state<RaceHintKind | undefined>(undefined);
  /** The story's catch: "OUT!" laid over the model, since its snapshot never says the racer is out. */
  private showingOut = $state(false);
  /** The story's Floors reading: the tower's floor and the goal, over the model's count. */
  private floorReading = $state.raw<{ readonly floor: number; readonly goal: number } | undefined>(undefined);
  /** Each CPU's mood word while it lasts (CPU banding spec §4), by racer. */
  private barks = $state<Readonly<Record<string, string>>>({});
  private readonly barkUntil = new Map<string, number>();
  private readonly app: Record<string, unknown>;
  private readonly countdown: Record<string, unknown>;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly stage: StagePort,
    options: {
      onPause?: () => void;
      onRestart?: () => void;
      settings?: SettingsStore;
      hint?: RaceHintKind;
      onCoachDismiss?: () => void;
      /** One racer and one lap, as the story is: no Lap chip, no standings. */
      solo?: boolean;
      /** The goal floor the Floors chip counts to, where it is not the course's last (a story chapter). */
      floorGoal?: number;
      /** A replay, not a race: the timer carries a Replay chip (ui layout spec §4.5). */
      replay?: boolean;
    } = {},
  ) {
    const view = this;
    this.hint = options.hint;
    this.app = mount(RaceHud, {
      target: stage.overlay,
      props: {
        get model() {
          return view.showingOut ? { ...view.model, outBanner: m.race_out() } : view.model;
        },
        get placement() {
          return view.placement;
        },
        get recoveryHint() { return view.recoveryHint; },
        get racer() { return view.racerBox; },
        get announcement() {
          return view.announcement;
        },
        get floorsPop() {
          return view.pops;
        },
        get popScale() {
          return view.popScale;
        },
        get barks() {
          return view.barks;
        },
        get floorReading() {
          return view.floorReading;
        },
        get popSpring() {
          return view.popSpring;
        },
        ...(options.settings === undefined ? {} : { settings: options.settings }),
        get hint() { return view.hint; },
        ...(options.onCoachDismiss === undefined ? {} : { onCoachDismiss: options.onCoachDismiss }),
        ...(options.onPause === undefined ? {} : { onPause: options.onPause }),
        ...(options.onRestart === undefined ? {} : { onRestart: options.onRestart }),
        ...(options.solo === undefined ? {} : { solo: options.solo }),
        ...(options.floorGoal === undefined ? {} : { floorGoal: options.floorGoal }),
        ...(options.replay === undefined ? {} : { replay: options.replay }),
      },
    });

    // The count over the stage (race-flow spec §3.4), in the HUD's layer.
    this.countdown = mount(Countdown, {
      target: stage.overlay,
      props: {
        get label() {
          return view.count;
        },
        get racer() {
          return view.countRacer;
        },
      },
    });

    this.placement = placementFor(stage.viewport);
    // Re-derived rather than latched: a rotation or a device-pixel-ratio change
    // is a plain resize, and a HUD that kept the rectangle it was built with
    // would be laid out for the orientation before last.
    this.unsubscribe = stage.onViewportChange((next) => {
      this.placement = placementFor(next);
    });
  }

  /**
   * Reads one snapshot.
   *
   * Called with the same interpolated sample the world is drawn from, and never
   * with the local prediction: a HUD that counted a predicted floor would
   * report progress the server has not agreed to, and would have to take it
   * back a round trip later.
   */
  /** A CPU's mood word beside its standings row, for `BARK_MS` (CPU banding spec §4). */
  bark(id: PlayerId, text: string, nowMs: number): void {
    this.barkUntil.set(id, nowMs + BARK_MS);
    this.barks = { ...this.barks, [id]: text };
  }

  update(snapshot: RoomSnapshot, localId: PlayerId | undefined, nowMs: number, clockTick?: number): void {
    // A word goes when its moment does, on the scene's own clock.
    const expired = [...this.barkUntil].filter(([, until]) => nowMs >= until).map(([id]) => id);
    if (expired.length > 0) {
      for (const id of expired) this.barkUntil.delete(id);
      this.barks = Object.fromEntries(Object.entries(this.barks).filter(([id]) => !expired.includes(id)));
    }
    // Infinite's clock counts against the authority tick when the caller has
    // one (race-options spec §5.5); the sample's own tick otherwise.
    this.trackRacer();
    const model = hudModel(snapshot, localId, clockTick ?? snapshot.tick);
    const pulsing = this.pulses.observe(model.rows, nowMs);
    this.model = pulsing.size === 0 ? model : { ...model, rows: model.rows.map((row) => ({ ...row, pulse: pulsing.has(row.id) })) };
  }

  /**
   * Gives the race's polite region its next lines. An empty batch leaves it as
   * it is, so nothing is read twice.
   */
  setRecoveryHint(active: boolean): void { this.recoveryHint = active; }
  /**
   * Lays "OUT!" over the model while the story's edge has caught her. There
   * is no line under it: the story card says what happened.
   */
  showOut(on: boolean): void { this.showingOut = on; }
  /** The story's Floors reading, or undefined for the race's own count. A no-op when unchanged. */
  setFloorReading(reading: { readonly floor: number; readonly goal: number } | undefined): void {
    const last = this.floorReading;
    if (last?.floor === reading?.floor && last?.goal === reading?.goal) return;
    this.floorReading = reading;
  }
  /** The hint to show in the toast slot, or none. */
  setHint(kind: RaceHintKind | undefined): void { this.hint = kind; }

  announce(lines: readonly string[]): void {
    if (lines.length > 0) this.announcement = lines.join(". ");
  }

  /** Where the local racer is drawn, so the count can sit clear of it. */
  setRacerRect(read: () => RacerBox | undefined): void {
    this.racerRect = read;
  }

  /**
   * Follows the racer while something laid over the race has to keep clear of
   * it (the coach, the count), and only then: the rest of a race moves it all
   * the time.
   */
  private trackRacer(): void {
    if (this.racerRect === undefined) return;
    const wanted = this.count !== undefined || this.hint === "swipe";
    const next = wanted ? this.racerRect() : undefined;
    const last = this.racerBox;
    if (next === undefined || last === undefined) {
      if (next !== last) this.racerBox = next;
    } else if (["left", "top", "right", "bottom"].some((edge) => Math.abs(next[edge as keyof RacerBox] - last[edge as keyof RacerBox]) > 0.5)) {
      this.racerBox = next;
    }
    if (next === undefined && this.countRacer === undefined) return;
    const frame = this.stage.overlay.getBoundingClientRect();
    const countRacer =
      next === undefined || this.count === undefined ? undefined : { top: next.top - frame.top, bottom: next.bottom - frame.top, height: frame.height, frameTop: frame.top };
    if (
      countRacer?.top !== this.countRacer?.top ||
      countRacer?.bottom !== this.countRacer?.bottom ||
      countRacer?.height !== this.countRacer?.height ||
      countRacer?.frameTop !== this.countRacer?.frameTop
    ) {
      this.countRacer = countRacer;
    }
  }

  /** The countdown's label this frame, or nothing between counts. */
  setCount(label: CountLabel | undefined): void {
    this.count = label;
    this.trackRacer();
  }

  /**
   * Floors the juice has seen authority credit the local racer with. The
   * Floors chip pops each time it rises (polish spec §6). Kept apart from the
   * model, which is a pure reading of the snapshot.
   */
  setFloorsPop(count: number, scale = this.popScale, spring: SpringTuning | undefined = this.popSpring): void {
    if (scale !== this.popScale) this.popScale = scale;
    if (spring !== this.popSpring) this.popSpring = spring;
    if (count !== this.pops) this.pops = count;
  }

  /** The count the Floors chip last popped to. Exposed so a test can assert without the DOM. */
  get floorsPop(): number {
    return this.pops;
  }

  /** The frame currently shown. Exposed so a test can assert without the DOM. */
  current(): HudModel {
    return this.model;
  }

  /** Releases the component and the viewport subscription. Idempotent. */
  destroy(): void {
    this.unsubscribe();
    void unmount(this.app);
    void unmount(this.countdown);
    void this.stage;
  }
}

/** The snapshot shape the HUD shows before authority has said anything. */
const EMPTY: RoomSnapshot = {
  tick: 0,
  phase: "racing",
  access: "private",
  seed: 0,
  roomSeed: 0,
  round: 0,
  courseRevision: "",
  tuning: {} as RoomSnapshot["tuning"],
  contentRevision: "" as RoomSnapshot["contentRevision"],
  rulesetRevision: "" as RoomSnapshot["rulesetRevision"],
  floorCount: 0,
  lapCount: 1,
  modeId: DEFAULT_MODE_ID,
  clockSeconds: DEFAULT_CLOCK_SECONDS,
  hostId: "" as RoomSnapshot["hostId"],
  players: [],
  platforms: [],
  events: [],
  standings: [],
};

/** A stand-in layout for the frame before the first one arrives. */
const DEFAULT_VIEWPORT: ViewportInfo = {
  canvasCss: { x: 0, y: 0, width: 960, height: 540 },
  gameplayCss: { x: 0, y: 0, width: 960, height: 540 },
  sceneryLogical: { x: 0, y: 0, width: 960, height: 540 },
  portrait: false,
  formFactor: "desktop",
  fieldLogical: { width: 960, height: 540 },
  pixelRatio: 1,
};
