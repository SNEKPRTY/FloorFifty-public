/**
 * Presentation constants.
 *
 * Everything here is feel, not rules. None of it may influence a position, a
 * landing, a lap, or a winner: the server owns those, and a camera that changed
 * game coordinates would put the two out of step.
 *
 * Gameplay numbers live in `@floor-fifty/shared/common/tuning` instead.
 */

import * as m from "../paraglide/messages.js";
import { SNAPSHOT_HZ, TICK_HZ, VIEWPORT } from "@floor-fifty/shared/common/constants";
import { SEAT_COLOURS, type SeatColour } from "@floor-fifty/shared/common/seats";

export const LOGICAL_VIEWPORT = VIEWPORT;

/**
 * The bottom band each portrait form factor reserves, in CSS pixels: the
 * roster (pips on a phone, the named band on a tablet) and the touch buttons
 * below it (responsive parity spec §5.4). The HUD places the roster at its
 * top, and the letterbox keeps the field above it.
 */
export const BOTTOM_BAND_FOR: Readonly<Record<"phone-portrait" | "tablet-portrait", number>> = {
  "phone-portrait": 180,
  // The named roster band and 88 px thumbs.
  "tablet-portrait": 240,
};

/**
 * How much of the play field each letterbox bar crops.
 *
 * `ui.rs:39,55`: the reference draws an opaque bar over the top and the bottom
 * tenth of its window. Floor Fifty keeps the bars as its frame but halves them
 * (UI layout system spec §1.2, owner's decision of 2026-10-02): at 1280 x 720
 * a tenth cost 144 px of a 720 px screen, and the HUD, the replay bar and the
 * menus crowded into what was left. `LetterboxFrame` draws the bars and
 * everything laid over the game keeps out from under them (`features/platform/band.ts`), so
 * the number lives here rather than in either: two copies would let the bars
 * grow without the HUD moving, which is how the lap indicator and the first
 * roster row came to ship hidden.
 */
export const LETTERBOX_CROP_FRACTION = 0.05;

/**
 * The band of the logical viewport the bars leave visible.
 *
 * Anything fixed to the screen -- the count, the lap indicator, the roster --
 * belongs inside it. `top` is also the origin those elements measure their own
 * insets from, so the HUD reads as anchored to the play field rather than to
 * the cropped frame around it.
 */
export const VISIBLE_FIELD = {
  top: LOGICAL_VIEWPORT.height * LETTERBOX_CROP_FRACTION,
  height: LOGICAL_VIEWPORT.height * (1 - 2 * LETTERBOX_CROP_FRACTION),
} as const;

/**
 * The reference lerps an orthographic projection scale between a stationary
 * and a motion value (`game_camera.rs:48-64`). These are those numbers, kept in
 * projection space: a smaller value shows less of the world. `WorldCamera`
 * inverts them once when it builds the container transform.
 *
 * `motionZoom` is the one departure, and it is forced by the wrap. See below.
 */
export const CAMERA = {
  /** `stationary_zoom_amt` */
  stationaryZoom: 0.8,
  /**
   * `motion_zoom_amt`, held at 1.0 where the reference uses 1.1.
   *
   * The course wraps every `VIEWPORT.width`, and the letterbox mask crops at
   * the logical viewport, which is that same width. At a zoom of 1.0 those two
   * coincide: the crop lands exactly on the seam, so a player crossing it is
   * cut by the screen edge and continues out of the opposite one. Past 1.0 the
   * frame is wider than the course is long, and the far side of the course
   * shows beside the near side -- the same ninja drawn twice, a few units
   * apart, which is worse than the pop it replaced.
   *
   * The reference can afford 1.1 because it never draws the crossing: it teleports
   * the player and lets the discontinuity fall wherever it falls. A wrap drawn
   * continuously cannot show past the seam at all, so the zoom is what gives.
   * `tests/client/features/race/player-view.test.ts` pins the relationship rather than the
   * number, so raising this without widening the wrap fails there.
   */
  motionZoom: 1.0,
  /** `zoom_speed`, in units per second */
  zoomSpeed: 1.5,
  /** `follow_speed`, in units per second */
  followSpeed: 5.0,
  /** Horizontal speed under which the local player counts as stationary. */
  stationarySpeed: 10,
  /** How long the player must be still before the camera settles in. */
  stationaryDelaySeconds: 0.45,
} as const;

/** Room ticks between authority broadcasts, mirroring the server's cadence. */
export const SNAPSHOT_INTERVAL_TICKS = TICK_HZ / SNAPSHOT_HZ;

/**
 * How far behind authority remote players are rendered.
 *
 * One snapshot arrives every `SNAPSHOT_INTERVAL_TICKS`, so holding half an
 * interval more than that means interpolation almost always has a pair to work
 * between rather than extrapolating past the newest one, and the remaining half
 * is the jitter a late packet may spend without the picture stalling.
 *
 * The half matters for a second reason: a whole multiple of the broadcast
 * interval would put every render tick exactly on a snapshot boundary, where
 * the blend factor is always zero and interpolation never actually runs.
 */
export const INTERPOLATION_DELAY_TICKS = SNAPSHOT_INTERVAL_TICKS * 1.5;

/** Minimum touch target, in CSS pixels, per platform accessibility guidance. */
export const MIN_TOUCH_TARGET_PX = 44;

/**
 * `player.rs:10`: `PLAYER_SIZE = 32.0 * 1.56`, drawn square by
 * `player.rs:48`'s `custom_size`.
 *
 * The size a racer is *drawn*, which is not the size it collides at: the
 * reference's collider is `Collider::ball(PLAYER_SIZE / 1.7)`, and that
 * diameter is what `PLAYER_WIDTH` and `PLAYER_HEIGHT` carry in the shared
 * tuning. Drawing at the collider's size would put a racer half again too big.
 *
 * The art is authored at 32 pixels, so this is a scale of 1.56 -- not a whole
 * number, and deliberately so. The reference squashed a 59 x 53 texture into
 * the same square, so matching its footprint is what parity means here, and an
 * integer scale would be a different size than the game being ported.
 */
export const PLAYER_SPRITE_SIZE = 32 * 1.56;

/** Scarf colour per seat, in join order: the shared seat colours. */
export const SEAT_SCARVES = SEAT_COLOURS;
export type SeatScarf = SeatColour;

/**
 * The announcer's call for each seat: the colour a player sees on screen, not
 * the scarf's name. "Scarlet" over a racer anyone would call red is a word the
 * player has to translate before it tells them which one is theirs.
 */
export const SEAT_CALLS: Record<SeatScarf, string> = {
  scarlet: "vo.red",
  cyan: "vo.blue",
  // Gold is drawn orange (#fb6b1d) and named Orange on the colour picker, so
  // the announcer says so too; "Yellow!" contradicted the screen.
  gold: "vo.orange",
  violet: "vo.purple",
};

/**
 * A colour's name as a player reads it, in their language. In English it is
 * the same name the announcer calls (`SEAT_CALLS`); the recorded call stays
 * English in every locale (languages spec D-L2).
 */
export const SEAT_COLOUR_NAMES: Record<SeatScarf, () => string> = {
  scarlet: m.ready_colour_scarlet,
  cyan: m.ready_colour_cyan,
  gold: m.ready_colour_gold,
  violet: m.ready_colour_violet,
};

/**
 * The gameplay LCD panel.
 *
 * The mesh, the stripes and the band-limiting are ported from `lcd-perfect v10`
 * by sinedied (MIT); `scanlines`, `aberration`, `glow` and `glowThreshold` have
 * no upstream counterpart and were tuned by eye against this game's art.
 *
 * `enabled` is this module's switch: a full-screen filter is the most likely
 * thing to cost frames on a low-end phone, and a per-player graphics setting
 * belongs to the launch polish settings panel (phase 2.2). The world's own
 * passes degrade through `features/profile/quality.ts` instead; the panel is downstream of them and is
 * deliberately not on that ladder.
 *
 * On by default, which is the project owner's decision against the brief's
 * written default of a clean composite. The panel is part of the look being
 * aimed at rather than a treatment laid over it, so the art is drawn and
 * judged with it on. What the brief's rule survives as is the constraint the
 * panel has to satisfy: it may not erase a landing edge or a line of text, and
 * that is checked with it enabled rather than by turning it off.
 */
export const LCD_PANEL = {
  enabled: true,
  /**
   * Mesh visibility. 0 disables the mesh but not the stripes.
   *
   * 0.15 rather than 0.3. At the heavier setting the mesh was punching visible
   * dark holes through anything small and bright -- a lit window is four to six
   * pixels tall, and a three-pixel mesh pitch lands inside it -- so the city's
   * windows read as speckled rather than lit. Halving it keeps the panel's
   * texture across broad areas and stops it eating the details it is drawn over,
   * which is the constraint the art direction puts on the effect.
   */
  grid: 0.15,
  /** Share of the mesh given to rows. 1 is horizontal lines only. */
  balance: 0.6,
  /**
   * Shortest period, in CSS pixels -- so the mesh keeps its apparent size on a
   * dense display rather than shrinking. Below ~2.94 it fades out, which on a
   * `devicePixelRatio` of 1 is the point the display stops resolving it.
   */
  minPitch: 3.0,
  /** RGB stripe visibility. 0 disables them. */
  subpixels: 0.2,
  /** 0 = RGB, 1 = BGR. */
  layout: 0,
  /** Added to the row axis of the mesh, so it shares the mesh's pitch. */
  scanlines: 0.3,
  /** Channel split, in logical units. */
  aberration: 0.3,
  /** Halation strength. */
  glow: 0.25,
  /** Luma above which halation is emitted. */
  glowThreshold: 0.6,
  /** Halation tap radius, in logical units. */
  glowRadius: 1.5,
  /** Output gain. 1 disables it. */
  brightness: 1.25,
  /** Output gamma. 1 disables it. */
  gamma: 1.0,
} as const;
