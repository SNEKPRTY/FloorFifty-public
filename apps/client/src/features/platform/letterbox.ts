/**
 * The letterbox.
 *
 * The game is authored for exactly one viewport: `960 x 540` logical units. A
 * device is whatever shape it is, so the frame is scaled uniformly, centred,
 * and -- this is the part that is easy to miss -- *clipped*.
 *
 * Positioning alone is not letterboxing. A Pixi container does not bound its
 * children, so without a mask the platforms and the players draw straight
 * through the bars: a tall phone ends up seeing several times the course a 16:9
 * screen does, which in a four-player race is not a cosmetic difference.
 *
 * Only the play area needs that bound, though. Clipping the scenery as well
 * left a tall phone three quarters black, so there are two layers: `backdrop`
 * is unclipped and spans the whole canvas, and `root` is masked to the logical
 * viewport and holds everything a race is decided by. Both carry the same
 * transform, so a parallax layer and a platform at the same logical height line
 * up regardless of which side of the clip they are on.
 */

import { Container, Graphics } from "pixi.js";
import { roleTint } from "@floor-fifty/asset-contract/roles";
import { BOTTOM_BAND_FOR, LETTERBOX_CROP_FRACTION, LOGICAL_VIEWPORT } from "../../lib/constants";
import { classifyFormFactor } from "./form-factor";

/** Where the logical viewport lands on the canvas, in renderer pixels. */
export type LetterboxGeometry = {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * The part of the play field a player can actually see, in canvas pixels.
   *
   * The clip minus the bars, which is a different rectangle from either. The
   * HUD anchors to this: anchoring to the canvas would put a roster row under a
   * bar, and anchoring to the clip would ignore the crop. On a portrait canvas
   * the bars are hidden, so this is the whole clip.
   */
  gameplay: { x: number; y: number; width: number; height: number };
  /**
   * The scenery's extent, in logical units, covering the whole canvas.
   *
   * The backdrop spans the canvas rather than the field, because covering only
   * the field is what left a tall phone with black above and below. A bounded
   * scenery target is fitted to this rectangle, so it is stated here rather
   * than recomputed from the canvas by whoever needs it.
   */
  scenery: { x: number; y: number; width: number; height: number };
  /** Whether the canvas is taller than it is wide. */
  portrait: boolean;
  /**
   * The play field's height in logical units: 540 on the landscape form
   * factors, and on the portrait ones everything down to the bottom band
   * (D-R1, `portraitFieldHeight`). The composite is sized to it, and the
   * camera anchors the racer against it.
   */
  fieldHeight: number;
};

/** The colour of the logical field, which the parallax does not always cover. */
const FIELD_COLOR = roleTint("skyLow");

/**
 * Each bar's share of the field's height.
 *
 * Shared with the HUD, which has to keep out from under it. See
 * `LETTERBOX_CROP_FRACTION`.
 */
const BAR_FRACTION = LETTERBOX_CROP_FRACTION;
/**
 * Where a portrait field's top edge sits, in canvas (CSS) pixels: below the
 * HUD's metric row, which starts 12 px down and is about 40 px tall.
 */
export const PORTRAIT_FIELD_TOP = 60;

/**
 * A portrait field's height in logical units: all of the canvas between the
 * HUD's metric row and the bottom band, at the width-fitted `scale`
 * (responsive parity D-R1, spec §6.2a).
 *
 * Fitted to each screen rather than fixed per form factor, because a fixed
 * height left a tall phone with a third of its screen as empty scenery between
 * the course and the thumbs. Floored to a whole unit, so the field's bottom
 * edge never reaches into the band; and never shorter than the landscape
 * field, so a squat portrait canvas does not see less course than landscape.
 */
export function portraitFieldHeight(viewHeight: number, scale: number, band: number): number {
  return Math.max(LOGICAL_VIEWPORT.height, Math.floor((viewHeight - PORTRAIT_FIELD_TOP - band) / scale));
}

/**
 * `ui.rs:42`: `Color::BLACK`, as Resurrect 64 has it. The palette's black is a
 * plum-tinted `#2e222f`, not `#000000`, and every black in the game is that one.
 */
const BAR_COLOR = roleTint("outline");
/** The line on the play field's cut, in canvas pixels. */
const EDGE_PX = 2;

export class LetterboxFrame {
  /**
   * Everything the panel shader covers: the scenery, the play field, and the
   * clip that bounds it.
   *
   * A layer rather than a convenience. The panel is one filter over the whole
   * picture, and a filter needs a single container to hang from; applying it to
   * `world` instead would put the mesh inside the camera transform and slide it
   * across the screen as the player moves. The bars are deliberately outside
   * it, so the crop reads as an opaque frame whatever the panel's brightness
   * and glow are tuned to.
   */
  readonly scene = new Container();

  /**
   * Scenery. Unclipped, and spans the whole canvas.
   *
   * Nothing here may decide a race: it is the field colour and whatever
   * parallax a screen puts in it, drawn past the letterbox on purpose.
   */
  readonly backdrop = new Container();
  /** The play area. Scaled, centred, and clipped to the logical viewport. */
  readonly root = new Container();
  /** Follows the camera. Platforms and players. */
  readonly world = new Container();
  /** Fixed in logical screen space; never a child of the camera. */
  readonly ui = new Container();
  /** Fills the whole canvas behind everything else. Redrawn on layout. */
  readonly field = new Graphics();
  /** The clip. A sibling of `root` in the caller's stage. */
  readonly mask = new Graphics();
  /** Unclipped effects: impact flash, fall lines. Carries the frame's transform without the mask. */
  readonly effects = new Container();
  /**
   * Over everything, the bars included: what must reach every edge of the
   * screen whatever covers it there -- the impact flash. Carries the frame's
   * transform, like `effects`,
   * but is a sibling of `bars` drawn after them, so on a phone the bars and
   * the skirt bar no longer cut a flash short. The caller adds it
   * to the stage after `bars`.
   */
  readonly front = new Container();

  /**
   * The reference's letterbox.
   *
   * `ui.rs:23-65` draws an opaque bar over the top and bottom tenths of the
   * window; Floor Fifty halves that (`LETTERBOX_CROP_FRACTION`). It crops the
   * play field on every device, deliberately.
   *
   * Landscape no longer draws the bars: the play layer's own mask does the
   * cropping, and the strips show the scenery instead of black, with a 2 px
   * line on the cut (`edges`). The bars are drawn in landscape only while the
   * splash asks for its true black (`setBarBlack`). The rest is how they are
   * placed.
   *
   * It is a sibling of `root` rather than a child of it, and it is drawn in
   * canvas pixels rather than logical units. That distinction is the whole of
   * this class's trickiest bug: the reference's window *is* its play field, so
   * there "a tenth of the window" and "a tenth of the field" are the same
   * measurement. Here they are not. Drawn logically, a bar was the field's
   * rect, which equals the canvas only at exactly 16:9 -- on a tall phone it
   * left a third of the screen of scenery above and below it, and the crop
   * read as two stripes floating in the middle of the display.
   *
   * So the bars are anchored to the field but extend to the canvas edge: they
   * crop exactly `LETTERBOX_CROP_FRACTION` of the play field, and black
   * out everything beyond it, so the result frames the field on any shape of
   * screen. `layout` redraws them, because only it knows the canvas.
   *
   * Portrait is the exception, and it is a presentation judgement rather than
   * a parity one. Held upright, a phone gives the field about a quarter of its
   * height; framing that band to the canvas edge left the screen more than
   * three quarters black, which reads as a fault rather than as a crop. So a
   * portrait canvas keeps the whole field and the scenery around it, and
   * (D-R1, candidate A) the field is taller there: it runs from under the
   * HUD's metric row down to the bottom band, about 1,490 logical units on a
   * 390 x 844 phone and 1,030 on an 820 x 1180 tablet, where landscape sees
   * 486 of 540. The camera keeps the racer 216 units above the bottom edge,
   * so the extra height is course ahead. The cost is real and recorded: spec §6.2a tabulates the
   * floor gaps ahead and below per form factor, and why the lead is accepted.
   */
  readonly bars = new Container();

  /** Public for assertions; nothing outside this class draws into them. */
  readonly topBar = new Graphics();
  readonly bottomBar = new Graphics();
  /**
   * A 2 px line on each cut of the play field, in canvas pixels, just outside
   * the field so the course a player sees is what it always was. Landscape
   * only, and only where a cut is on the canvas.
   */
  readonly edges = new Graphics();
  /** Clips `effects` to the play field in landscape, as `mask` clips `root`. */
  private readonly effectsMask = new Graphics();
  /** 0 to 1, how far the bars are toward true black (`setBarBlack`). */
  private blackness = 0;

  /**
   * Where the scenery starts stretching, in canvas pixels, as a race reports it
   * every frame (`GameplayView.skirtLine`); undefined when nothing does.
   *
   * Below the lowest skyline's foot the scenery is only its skirts -- each
   * strip's last row stretched down -- which a tall phone held upright shows
   * as stripes. There, and only there, the bottom bar covers from this line to
   * the canvas bottom, in the palette's black. Never above the field's foot:
   * the bar hides stretched scenery, not course.
   */
  private skirtLine: number | undefined = undefined;
  /** The last layout's canvas and field, so a new line can be drawn without one. */
  private last: { viewWidth: number; viewHeight: number; fieldFoot: number; phonePortrait: boolean; landscape: boolean } | undefined;

  /** The 2 px cut line belongs to the field (a race, a replay, the tutorial); menus fill the window and have none. */
  private cutLine = true;

  /** Takes effect at the next `layout`. */
  setCutLine(on: boolean): void {
    this.cutLine = on;
  }

  setSkirtLine(line: number | undefined): void {
    this.skirtLine = line;
    this.drawSkirtBar();
  }

  /** Redraws the bottom bar for the skirt line, on a phone held upright. */
  private drawSkirtBar(): void {
    const last = this.last;
    if (last === undefined || last.landscape || !last.phonePortrait) return;
    const line = this.skirtLine;
    const top = line === undefined ? last.viewHeight : Math.max(Math.round(line), last.fieldFoot);
    const covering = top < last.viewHeight;
    this.bars.visible = covering;
    if (!covering) return;
    this.bottomBar.clear().rect(0, top, last.viewWidth, last.viewHeight - top).fill(BAR_COLOR);
  }

  constructor() {
    this.backdrop.label = "backdrop";
    this.root.label = "letterbox";
    this.world.label = "world";
    this.ui.label = "ui";
    this.field.label = "field";
    this.mask.label = "letterbox-mask";

    this.backdrop.addChild(this.field);

    // World, then HUD: the HUD is a sibling of the world rather than a child of
    // it, so the camera transform never reaches it.
    this.root.addChild(this.world, this.ui);

    // `mask` is parented here too: a mask has to be in the same rendered
    // subtree as what it clips.
    this.scene.label = "scene";
    this.effects.label = "effects";
    this.effectsMask.label = "effects-mask";
    this.edges.label = "letterbox-edges";
    this.scene.addChild(this.backdrop, this.root, this.mask, this.effects, this.effectsMask, this.edges);

    this.front.label = "front";
    this.bars.label = "bars";
    this.bars.addChild(this.topBar, this.bottomBar);

    this.root.mask = this.mask;
  }

  /**
   * Recomputes the letterbox for a canvas of `viewWidth x viewHeight` pixels.
   *
   * Returns the geometry so the caller can line the HTML overlay up with it
   * rather than deriving the same numbers a second time.
   */
  layout(viewWidth: number, viewHeight: number): LetterboxGeometry {
    // Fitted to the width, not inside the canvas.
    //
    // Clipping the play area horizontally buys nothing: the course wraps every
    // `LOGICAL_VIEWPORT.width`, so a frame wider than one wrap shows the same
    // course again rather than more of it, and there is no extra course to be
    // unfair with. A frame *narrower* than the canvas is what costs. It puts
    // the wrap seam inside the picture, so a crossing player is cut short of
    // the screen edge while the unclipped scenery carries on past them, and
    // the seam reads as a fault rather than as an edge. The reference has no
    // such gap because its window is its play field; this is that, on a canvas
    // that is whatever shape the device makes it.
    //
    // Vertically the clip still matters and still applies: how much course is
    // above and below a player is how much warning they get.
    const scale = viewWidth / LOGICAL_VIEWPORT.width;
    const width = viewWidth;
    // Taller on the portrait form factors (D-R1). Classified here from the
    // same function the document is tagged with, so the field and the layout
    // around it agree on the form factor.
    const formFactor = classifyFormFactor(viewWidth, viewHeight);
    const fieldHeight =
      formFactor === "phone-portrait" || formFactor === "tablet-portrait"
        ? portraitFieldHeight(viewHeight, scale, BOTTOM_BAND_FOR[formFactor])
        : LOGICAL_VIEWPORT.height;
    const height = fieldHeight * scale;
    const x = 0;
    // Negative on a canvas wider than 16:9, where the field is taller than the
    // canvas and overflows it. The mask below is what bounds that.
    const centred = Math.round((viewHeight - height) / 2);
    const portrait = viewHeight > viewWidth;
    // Portrait lifts the field to just under the HUD's metric row, into the
    // upper half, so a thumb on the swipe surface below never covers it
    // (launch polish spec 2.5). A canvas too short to lift it stays centred.
    const y = portrait ? Math.min(PORTRAIT_FIELD_TOP, centred) : centred;

    this.root.scale.set(scale);
    this.root.position.set(x, y);
    this.backdrop.scale.set(scale);
    this.backdrop.position.set(x, y);
    this.effects.scale.set(scale);
    this.effects.position.set(x, y);
    this.front.scale.set(scale);
    this.front.position.set(x, y);

    // Where the bars used to hide the crop, the play layer's own mask cuts
    // it, so the strips can show the scenery. Landscape clips to the gameplay
    // rect (the field less its crop, inside the canvas); portrait has no crop
    // and clips to the whole overlap. Full width always, because the field is
    // the canvas's width by construction.
    const clipTop = Math.max(0, y);
    const clipBottom = Math.min(viewHeight, y + height);
    const landscape = !portrait;
    const cropped = height * BAR_FRACTION;
    const gameplayTop = landscape ? Math.max(clipTop, y + cropped) : clipTop;
    const gameplayBottom = landscape ? Math.min(clipBottom, y + height - cropped) : clipBottom;
    const gameplay = { x: 0, y: gameplayTop, width: viewWidth, height: Math.max(0, gameplayBottom - gameplayTop) };

    // Redrawn rather than transformed: a scaled mask would be a scaled
    // rectangle whose edge lands on a fraction of a pixel.
    this.mask.clear().rect(0, gameplay.y, viewWidth, gameplay.height).fill(0xffffff);
    // The fall lines stay inside the field in landscape; held upright they run on, as they always did.
    // Held upright the mask is left empty: a mask graphic nothing uses draws as a plain white
    // shape, and this one is the size of the field.
    this.effectsMask.clear();
    if (landscape) this.effectsMask.rect(0, gameplay.y, viewWidth, gameplay.height).fill(0xffffff);
    this.effects.mask = landscape ? this.effectsMask : null;

    // The canvas, measured in logical units and expressed relative to the
    // backdrop's own origin, so the field covers the bars as well as the frame.
    this.field
      .clear()
      .rect(-x / scale, -y / scale, viewWidth / scale, viewHeight / scale)
      .fill(FIELD_COLOR);

    // The bars, for the splash's black in landscape and the skirt on a phone
    // held upright: anchored to the crop, then run out to the canvas edge.
    //
    // Recomputed on every layout rather than latched, so rotating a phone
    // restores them.
    this.topBar.visible = landscape;

    // Clamped to the canvas: a canvas wider than about 1.98:1 runs the field
    // off its top and bottom further than the crop reaches, and there the
    // bars are empty rather than drawn inside out past the edge.
    const bottomEdge = Math.min(viewHeight, y + height - cropped);
    this.topBar.clear().rect(0, 0, viewWidth, Math.max(0, y + cropped)).fill(BAR_COLOR);
    this.bottomBar
      .clear()
      .rect(0, bottomEdge, viewWidth, viewHeight - bottomEdge)
      .fill(BAR_COLOR);

    // The line on each cut, where a cut is on the canvas.
    const cutAbove = landscape && gameplay.y > 0;
    const cutBelow = landscape && gameplay.y + gameplay.height < viewHeight;
    this.edges.clear();
    if (cutAbove) this.edges.rect(0, gameplay.y - EDGE_PX, viewWidth, EDGE_PX).fill(BAR_COLOR);
    if (cutBelow) this.edges.rect(0, gameplay.y + gameplay.height, viewWidth, EDGE_PX).fill(BAR_COLOR);
    this.edges.visible = this.cutLine && (cutAbove || cutBelow);

    // A phone held upright covers its stretched scenery instead (see
    // `skirtLine`); every other portrait canvas keeps the scenery to the edge.
    this.last = {
      viewWidth,
      viewHeight,
      fieldFoot: Math.min(viewHeight, y + height),
      phonePortrait: formFactor === "phone-portrait",
      landscape,
    };
    this.applyBarLook();

    // `gameplay`, above, is what the player can actually see: the clip, less
    // the crop in landscape. Portrait has no crop, so there it is the whole
    // clip, stated once here instead of re-derived by every screen that needs
    // to keep out from under the crop.
    // The canvas measured in logical units. The same rectangle the field is
    // drawn with, named here because a bounded scenery target is fitted to it.
    const scenery = {
      x: -x / scale,
      y: -y / scale,
      width: viewWidth / scale,
      height: viewHeight / scale,
    };

    return { scale, x, y, width, height, gameplay, scenery, portrait, fieldHeight };
  }

  /**
   * How far the bars are toward true black, 0 to 1.
   *
   * The splash frames its art in true black, the black of a screen that is
   * off, and the menus take it back. Landscape draws the bars only for this,
   * black faded in over the scenery strips; a phone held upright takes its
   * skirt bar from the palette's plum-tinted black to true black.
   */
  setBarBlack(amount: number): void {
    this.blackness = Math.min(1, Math.max(0, amount));
    this.applyBarLook();
  }

  private applyBarLook(): void {
    const landscape = this.last?.landscape ?? false;
    const keep = Math.round(255 * (1 - this.blackness));
    const tint = landscape ? 0x000000 : (keep << 16) | (keep << 8) | keep;
    const alpha = landscape ? this.blackness : 1;
    for (const bar of [this.topBar, this.bottomBar]) {
      bar.tint = tint;
      bar.alpha = alpha;
    }
    if (landscape) {
      this.bars.visible = this.blackness > 0;
    } else if (this.last !== undefined) {
      this.bars.visible = false;
      this.drawSkirtBar();
    }
  }

  destroy(): void {
    this.root.mask = null;
    // `mask`, `root` and `backdrop` are all children of `scene` now, so one
    // teardown reaches them.
    this.scene.destroy({ children: true });
    // `bars` and `front` are siblings of `scene`, so they are not taken down with it.
    this.bars.destroy({ children: true });
    this.front.destroy({ children: true });
  }
}
