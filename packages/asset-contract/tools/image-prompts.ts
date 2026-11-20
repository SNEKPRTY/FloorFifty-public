/**
 * The prompts behind every generated source for mockup parity (launch polish
 * spec §2.8).
 *
 * Committed rather than kept in someone's shell history, for the reason the
 * manifest's provenance gives: an asset nobody can regenerate is an asset
 * nobody can fix. Each result is a *source* -- reviewed, committed under
 * `assets/source/`, and converted onto the palette by the plate tools -- and
 * each converted asset is a placeholder the phase 6 artist replaces against
 * `docs/art/hand-authored-art-brief.md`.
 *
 * Every prompt but a full-frame scene ends on the same chroma key, because the
 * generator will not honour a transparent background and the converters key
 * magenta out.
 */

export const IMAGE_MODEL = "gpt-image-2.5-flare";

export type ImagePrompt = {
  /** What `pnpm assets:images <name>` regenerates. */
  readonly name: string;
  /** The file written under `assets/source/`. */
  readonly file: string;
  readonly size: "1536x1024" | "1024x1024" | "1024x1536";
  readonly prompt: string;
  /**
   * A scene that fills its whole frame, like the menu sky: there is nothing
   * to key out, so its prompt carries no chroma key.
   */
  readonly fullFrame?: true;
  /**
   * A committed source under `assets/source/` this prompt edits rather than
   * drawing from nothing, so a set of layers keeps one scene's look.
   */
  readonly reference?: string;
};

/**
 * The tutorial's dawn, as one reviewed picture (`assets/source/dawn-concept.png`).
 *
 * Made by editing a capture of the first-cut tutorial with this prompt, and
 * chosen from two. Its layers are cut from it by the `dawn-*` prompts below;
 * it is a reference, not a plate, so nothing converts it.
 */
export const DAWN_CONCEPT_PROMPT =
  "Reimagine this pixel-art platformer scene as a finished, beautiful game screenshot. Remove all UI: no HUD, no panels, no text, no buttons, no timer. " +
  "Keep the composition: a hazy dawn sky, a pale translucent teal pyramid centred in the distance with a pale peach sun sitting just above its apex, low fog banding across the lower third, " +
  "and in the foreground flat black silhouettes of old low rooftops with a domed building with pillars and a small flag on the left. " +
  "The sky fades from soft violet-grey at the top through pale grey-teal to deep teal haze at the horizon; the sun has a soft bright glow. " +
  "The player character (a small ninja) and a few floating horizontal floor slabs are pure black silhouettes against the haze. " +
  "Few shapes, strong atmosphere, calm and quiet. Crisp pixel art on a coarse pixel grid, limited palette, flat fills, gentle ordered dithering only in the sky, no text, no watermark, no border.";

const KEY = "The entire background is flat pure magenta #FF00FF with no texture, shadow or vignette.";

/** The look every source shares, so the placeholders read as one set. */
const STYLE =
  "Crisp pixel art on a coarse pixel grid, limited palette, flat fills, no anti-aliasing, no gradients, no text, no watermark, no border.";

/**
 * What each character after the ninja looks like, as its pose sheet was asked
 * for. `generate-racers.ts` sorts a pixel by luma and saturation, not by hue,
 * so what must become the seat colour is drawn in one saturated red with one
 * darker shade, and everything else in black, white or a pale tan.
 */
const CHARACTER_LOOKS = {
  frog:
    "a chibi ninja frog: a large round hood-head at about half the total height with a wide smiling frog mouth as one dark line and two big bulging round eyes sitting on top of the hood (white with a black pupil), " +
    "a white belly patch on the front of the body, and a short vest and hood in one saturated red with one darker shade of that red",
  diver:
    "a chibi deep-sea diver: a round diving helmet at about two fifths of the total height painted in one saturated red with one darker shade of that red, with a pale-silver rivet ring and a big round glass visor showing two small white eyes, " +
    "a big square air tank on the back and a short air hose, and a roomy diving suit with chunky boots, the tank, the hose, the suit and the boots all in the same saturated red with its darker shade, and pale tan gloves",
  robo:
    "a chibi boxy robot ninja: a square head at about two fifths of the total height painted in one saturated red with one darker shade of that red, with a pale-steel face plate holding a dark visor slit that shows two small white eyes, and one short antenna with a round tip, " +
    "a big chest plate, thick arms and legs, all in the same saturated red with its darker shade, and pale tan hands",
  kitsune:
    "a chibi fox-spirit ninja: a large round white hood-head at about two fifths of the total height with two pointed fox ears, a narrow eye slit showing two small white eyes, " +
    "a wide flowing scarf, a roomy body suit with pants, and one huge bushy tail, all in one saturated red with one darker shade of that red, and pale tan hands",
  // The After Hours pack (DLC): four silhouettes none of the first five share --
  // a round body, horns, a tall brim and a plume.
  penguin:
    "a chibi penguin ninja: a round egg-shaped body with no neck, the head and back in one saturated red with one darker shade of that red, a large white face and belly patch with two small black eyes, " +
    "a short pale tan beak, two short stubby flippers in the same red, a short red headband with two trailing tails, and two flat pale tan feet",
  oni:
    "a chibi oni: a big round head at about two fifths of the total height in one saturated red with one darker shade of that red, with two short curved white horns on top and a spiky tuft of dark hair between them, " +
    "two small white eyes and a wide friendly grin, a short happi coat and baggy pants in the same red with its darker shade, a white sash at the waist, and pale tan hands",
  witch:
    "a chibi witch: a tall pointed witch hat with a wide brim at about half the total height, bent at its tip, in one saturated red with one darker shade of that red, " +
    "under the brim a round pale tan face with two small white eyes in a dark shadow, a short flowing cape and a roomy robe in the same red with its darker shade, and pale tan hands",
  knight:
    "a chibi knight: a round bucket helmet at about two fifths of the total height in one saturated red with one darker shade of that red, its front one flat plain pale-steel plate with a single wide dark eye slit showing two small white eyes, no grille and no bars, and one tall plume on top in the same red, " +
    "a short plain tabard over a round body, short arms and legs, all in the same saturated red with its darker shade, and pale tan hands. Big simple shapes, no small details",
} as const;

/** The After Hours DLC characters, in catalog order. */
export const AFTER_HOURS = ["penguin", "oni", "witch", "knight"] as const;

/**
 * A character's wall and ceiling grips, drawn as an edit of its own pose sheet
 * so the climbs are the same character at the same scale.
 *
 * The ceiling row says right side up, hands to feet, at length. The first
 * prompt asked for "hanging upside down from a ceiling by its raised hands",
 * and the generator took "upside down" literally: every one of these came back
 * head-down with its feet in the air, which in a race reads as running along
 * the underside of a floor rather than holding on to it. The ninja's ceiling
 * grip, which these match, hangs head-up from its hands.
 */
function climbsPrompt(id: keyof typeof CHARACTER_LOOKS): ImagePrompt {
  return {
    name: `racer-climbs-${id}`,
    file: `racer-climbs-${id}.png`,
    size: "1024x1024",
    reference: `racer-sheet-${id}.png`,
    prompt:
      `Using the character drawn in this sprite sheet, ${CHARACTER_LOOKS[id]}, draw a new pixel-art sprite sheet of the same character at the same size. ` +
      "Keep it small and chunky like a game sprite: chibi proportions, a thick dark outline around the whole figure, one flat main tone with one darker shade, no weapons. " +
      "Two rows of poses in side view facing right, each row two poses side by side in columns 1 and 2, with a large empty gap between the rows. " +
      "Row 1: clinging to a wall on its right with one hand reaching forward and up, knees drawn in, two slightly different grip poses. " +
      "Row 2: hanging from a ceiling above it, right side up, like hanging from monkey bars: both hands at the very top of the pose gripping, arms raised straight up, the head just below the hands and the right way up with the face upright, the body below the head, the legs dangling at the bottom with the feet lowest. Not upside down, not inverted, the head never below the feet. Two slightly different hang poses. " +
      "Draw only the character: no wall, no pole, no ledge, no ceiling, no ground and no line of any kind, so the hands grip empty space. " +
      `Every other cell stays empty. ${STYLE} ${KEY}`,
  };
}

/** How each character after the ninja was asked for as a bust, on the archived select branch. */
const CHARACTER_BUSTS = {
  frog: "a chibi ninja frog bust: a round hood with a wide smiling mouth line and two big bulging eyes on top, a large vest in red",
  diver:
    "a chibi deep-sea diver bust: a round helmet painted red with a pale-silver rivet ring and a big round glass visor showing two white eyes, a red suit collar",
  robo:
    "a chibi boxy robot ninja bust: a square red head with a pale-steel face plate holding a dark visor slit that shows two white eyes and one short antenna, a red chest plate",
  kitsune:
    "a chibi fox-spirit ninja bust: a white hood with two pointed fox ears and a narrow eye slit showing two white eyes, a wide red scarf and a red suit collar",
  penguin:
    "a chibi penguin ninja bust: a round red head with a large white face patch, two small black eyes, a short pale tan beak and a red headband with two trailing tails, red stubby flippers",
  oni:
    "a chibi oni bust: a big round red head with two short curved white horns and a spiky tuft of dark hair, two white eyes and a wide friendly grin, a red happi coat collar",
  witch:
    "a chibi witch bust: a tall pointed red witch hat with a wide brim bent at its tip, under the brim a round pale tan face with two white eyes, a red cape collar",
  knight:
    "a chibi knight bust: a round red bucket helmet whose front is one flat plain pale-steel plate with a single wide dark eye slit showing two white eyes, no grille and no bars, one tall red plume, a plain red tabard",
} as const satisfies Record<keyof typeof CHARACTER_LOOKS, string>;

/**
 * The pose sheet and bust sheet one character after the ninja was cut from,
 * exactly as `archive/launch-program` asked for them.
 */
function keptPrompts(id: keyof typeof CHARACTER_LOOKS): readonly ImagePrompt[] {
  const same =
    "Keep it small and chunky like a game sprite: chibi proportions, a thick dark outline around the whole figure, one flat main tone with one darker shade, no weapons. ";
  return [
    {
      name: `racer-sheet-${id}`,
      file: `racer-sheet-${id}.png`,
      size: "1024x1024",
      prompt:
        `A pixel-art sprite sheet of one character, ${CHARACTER_LOOKS[id]}. ${same}` +
        "The sheet is an exact grid of 4 columns and 5 rows of equal cells with a wide empty gutter between them, every pose in side view facing right, the same character and the same size in every cell. " +
        "Row 1: two idle poses, in columns 1 and 2. Row 2: four run poses, in columns 1 to 4. Row 3: one jump pose with the limbs tucked, in column 1. Row 4: one fall pose with the limbs spread, in column 1. Row 5: two landing poses, crouched, in columns 1 and 2. " +
        `Every other cell stays empty. ${STYLE} ${KEY}`,
    },
    {
      name: `portrait-sheet-${id}`,
      file: `portrait-sheet-${id}.png`,
      size: "1536x1024",
      prompt:
        `A character sheet of pixel-art bust portraits of four small characters, ${CHARACTER_BUSTS[id]}, arranged in an exact grid of 3 columns and 4 rows, every cell the same size with a wide empty gutter between cells. ` +
        "The four characters are identical except for the colour of the parts that are red: row 1 is red, row 2 is blue, row 3 is orange, row 4 is violet. Only those parts change colour; every other part stays white, pale or black. " +
        "Column 1 is neutral: calm, eyes forward. Column 2 is win: eyes happily closed in upturned arcs, one fist raised beside the head. Column 3 is lose: eyes looking down, shoulders slumped, head tilted. " +
        `Head and shoulders only, facing the viewer, centred in each cell, a thick dark outline around every figure, no background detail. ${STYLE} ${KEY}`,
    },
  ];
}

/**
 * The prompts behind sources that are kept as files rather than regenerated:
 * the later characters' pose sheets and bust sheets. Frog, Diver, Robo and
 * Kitsune were generated on the archived select branch; the After Hours four
 * were generated for their pack. A record, not a queue -- `assets:images` sends
 * one only when it is named, because a regenerated pose sheet would redraw
 * what its climbs edit and every sheet, portrait and bust cut from it.
 */
export const KEPT_PROMPTS: readonly ImagePrompt[] = (["frog", "diver", "robo", "kitsune", ...AFTER_HOURS] as const).flatMap(keptPrompts);

export const IMAGE_PROMPTS: readonly ImagePrompt[] = [
  {
    name: "portraits",
    file: "portrait-sheet.png",
    size: "1536x1024",
    prompt:
      "A character sheet of pixel-art bust portraits of four small ninjas, arranged in an exact grid of 3 columns and 4 rows, every cell the same size with a wide empty gutter between cells. " +
      "Each ninja wears a full hood and face mask in one colour that leaves only a narrow eye slit with white eyes and a dark outline. Row 1 is red, row 2 is blue, row 3 is orange, row 4 is violet. " +
      "Column 1 is neutral: calm, eyes forward. Column 2 is win: eyes happily closed in upturned arcs, one fist raised beside the head. Column 3 is lose: eyes looking down, shoulders slumped, head tilted. " +
      "Head and shoulders only, facing the viewer, centred in each cell, a thick dark outline around every figure, one flat body colour with a single darker shade, no background detail. " +
      `${STYLE} ${KEY}`,
  },
  {
    // Redrawn for the stage ascent (Rooftops against extended-stage.png): the
    // board's long swept cirrus, in place of one repeated puffball.
    name: "clouds",
    file: "clouds-streaks.png",
    size: "1536x1024",
    reference: "rooftops-board.png",
    prompt:
      "From this board's dawn sky, draw only the clouds as one wide horizontal band across the middle of the image: long swept cirrus streaks and thin wisps of different lengths and shapes, a few low flat cloud banks, white tops with warm peach undersides. " +
      "No round puffballs and no two clouds the same shape. Four or five separate groups with clear empty gaps between them, and empty margins at both the left and right ends. Nothing above or below the band. No sky colour, no sun, no buildings, no HUD, no panel frames. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "sun",
    file: "sun-low.png",
    size: "1024x1024",
    prompt:
      "A single dawn sun, centred: a round disc of warm pale yellow-white, surrounded by two or three stepped concentric pixel bands of soft peach and pale orange glow, each band a flat solid colour. " +
      "Nothing else. No rays, no lens flare, no clouds, no horizon. " +
      `${STYLE} ${KEY}`,
  },
  // Rooftops' own sky plate and horizon (stage ascent spec §5.3): the board's
  // streaked blue-to-peach dawn, and the misted skyline and water at the foot
  // of its open-sky finish, which stays in frame to the last floor.
  {
    name: "rooftops-sky",
    file: "rooftops-sky.png",
    size: "1536x1024",
    fullFrame: true,
    reference: "rooftops-board.png",
    prompt:
      "From this board, paint only the dawn sky behind the city, as one picture filling the whole image: clear cyan-blue at the top, fading through soft pink to warm peach low down, crossed by long swept white cirrus streaks in soft ordered-dither bands. " +
      "The top tenth is one flat cyan-blue and the bottom tenth one flat pale peach. No sun, no puffy clouds, no buildings, no water, no characters, no platforms, no HUD, no captions, no panel frames, no text. " +
      STYLE,
  },
  {
    name: "rooftops-horizon",
    file: "rooftops-horizon.png",
    size: "1536x1024",
    reference: "rooftops-board.png",
    prompt:
      "From this board's open-sky finish panel, draw only the far horizon: a low line of distant misted towers and spires in pale blue-grey, standing on a calm strip of water with a few short bright glints, running the full width and rising from the bottom edge. " +
      "Very pale, low contrast, flat shapes, no lit windows. Only this one layer: no sky, no near buildings, no water towers, no characters, no platforms, no HUD, no panel frames. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "cityMid",
    file: "city-mid-spires.png",
    size: "1536x1024",
    prompt:
      "A side-on middle-distance city skyline standing on the bottom edge of the image and spanning its full width: tall slender office towers, stepped setbacks, two or three needle spires and one tall art-deco crown, " +
      "in hazy steel blue as if seen through morning air, flat silhouettes with only a few small lit windows. Varied heights, the tallest reaching two thirds of the way up the image. Every building runs straight down to the bottom edge. No foreground, no sky colour. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "cityNear",
    file: "city-near-dense.png",
    size: "1536x1024",
    prompt:
      "A side-on near rooftop skyline standing on the bottom edge of the image and spanning its full width: blocky apartment and warehouse buildings in deep slate-navy, with many warm amber lit windows grouped into neat rows and panes, " +
      "water towers on lattice legs, fire escapes, vents and antennas on the roofs. Varied roof heights, the tallest reaching halfway up the image. Every building runs straight down to the bottom edge. No sky colour, no characters, no platforms, no text. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "props",
    file: "rooftop-props.png",
    size: "1536x1024",
    prompt:
      "A single wide horizontal strip of foreground rooftop props in side elevation, for a 2D platformer's parallax layer: three water towers on lattice legs, two fire-escape stair frames, runs of pipes and vents, " +
      "rooftop planters with small leafy trees and shrubs. Every prop stands on one shared baseline along the bottom of the strip, widely spaced with empty gaps between them. " +
      "Flat dark silhouettes: very dark ink for structures, dark teal-green for foliage, no lighting, no windows. No buildings, no continuous ground line, no ledges, no characters, no text. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "menuSky",
    file: "menu-sky.png",
    size: "1536x1024",
    prompt:
      "A dawn sky only, filling the whole image: clear pale blue overhead fading to warm peach near the bottom, a low warm pale-yellow sun near the bottom centre-right, " +
      "and scattered wispy painterly clouds with peach-lit undersides across the upper and middle sky. No buildings, no ground, no horizon line, no characters. " +
      STYLE,
    fullFrame: true,
  },
  {
    // The menu's sky without clouds: the drifting cloud field supplies them
    // (launch polish spec §2.9).
    name: "menuSkyClear",
    file: "menu-sky-clear.png",
    size: "1536x1024",
    prompt:
      "A clear dawn sky only, filling the whole image: pale blue overhead fading smoothly to warm peach near the bottom, a low warm pale-yellow sun near the bottom centre-right. " +
      "No clouds at all, no buildings, no ground, no horizon line, no characters. " +
      STYLE,
    fullFrame: true,
  },
  {
    name: "menuCity",
    file: "menu-city.png",
    size: "1536x1024",
    prompt:
      "A side-on city skyline standing on the bottom edge of the image and spanning its full width, occupying the lower half: a hazy blue far layer of tall towers and needle spires behind, " +
      "and a crisp blue-slate near layer of office and apartment buildings in front with many warm amber lit windows in neat rows, water towers and antennas on the roofs. No sky colour, no sun, no clouds, no characters. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "menuLedge",
    file: "menu-ledge.png",
    size: "1024x1024",
    prompt:
      "One short rooftop ledge seen side-on, wide and low, in the middle of the image: a flat parapet top that four small characters could stand on, a brick-and-concrete face in deep slate, " +
      "a vent pipe at one end and two small potted plants with dark teal-green leaves at the other. Nothing else. " +
      `${STYLE} ${KEY}`,
  },
  {
    // The building the menu ledge is the parapet of, so the racers stand on a
    // roof rather than on a slab floating in the sky. Cut to one repeating
    // tile by `menuFacadeTile`, which is why it asks for a strict grid.
    name: "menuFacade",
    file: "menu-facade.png",
    size: "1024x1536",
    prompt:
      "A flat front-on elevation of the upper storeys of one tall city apartment building, filling the whole image edge to edge with no sky and no roof: " +
      "a deep slate-blue brick wall in a perfectly regular grid of identical tall narrow windows, four window columns and six storeys, every window the same size and evenly spaced, " +
      "each window a dark frame with a sill beneath, about a third of the windows lit warm amber and the rest dark navy glass, a thin horizontal brick ledge between storeys. " +
      "Orthographic, no perspective, no people, no signs. " +
      STYLE,
    fullFrame: true,
  },
  {
    // The concept's backdrop: sky, sun and pyramid, one soft plate, so the sun
    // stays on the apex whatever the camera does.
    name: "dawn-sky",
    file: "dawn-sky.png",
    size: "1536x1024",
    fullFrame: true,
    reference: "dawn-concept.png",
    prompt:
      "Keep this exact sky, sun and pyramid, and the same colours, glow and dithering. Remove everything black: the domed building, the rooftops, the character and the floating slabs. " +
      "Remove the misty hills on both sides too. Where anything was removed, continue the sky and the soft fog behind it, so the lower third is a calm teal fog band with the pyramid's base fading into it. " +
      STYLE,
  },
  {
    // The misty hills from the concept, as their own layer so they part from
    // the sky as the tutorial climbs.
    name: "dawn-mist",
    file: "dawn-mist.png",
    size: "1536x1024",
    reference: "dawn-concept.png",
    prompt:
      "Keep only the soft misty teal hills from this picture, in the same colours and pixel style, running across the full width and rising from the bottom edge, lower and paler in the middle. " +
      "Remove the sky, the sun, the pyramid, the black buildings, the character and the slabs. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "dawn-near",
    file: "dawn-near.png",
    size: "1536x1024",
    prompt:
      "A flat black silhouette of old low rooftops running across the full width, rising from the bottom edge, with one tall domed building on the right third: a round dome on a drum with small pillars, and a thin flagpole with a small flag on top. " +
      "Pure solid black shapes only, no windows, no light, no detail inside the shapes. " +
      `${STYLE} ${KEY}`,
  },
  // The two stages the select adds. Their moods follow covers 9 and 6: a snowy
  // night shrine, and a glass aquarium dome. Each is a set of layers cut by
  // `generate-city.ts`, and each is a placeholder the phase 6 art pass replaces.
  // Snow Shrine, redrawn against its approved ascent board
  // (docs/art/explorations/2026-10-01-stage-ascent/snow-shrine.png): every
  // layer edits the board, so the set keeps one scene's look, and each prompt
  // asks for its own layer and nothing in front of or behind it.
  {
    // No moon here: `world-moon.png` is drawn, because a generator paints a scene.
    name: "snow-shrine-sky",
    file: "snow-shrine-sky.png",
    size: "1536x1024",
    fullFrame: true,
    reference: "snow-shrine-board.png",
    prompt:
      "From this board, paint only the night sky behind the Snow Shrine scene, as one picture filling the whole image: deep navy at the top fading through indigo to blue-violet in soft ordered-dither bands, scattered small stars, " +
      "and along the bottom a low horizon of pale snowy mountain ridges. The top tenth is one flat navy and the bottom tenth one flat pale ridge-snow tone. " +
      "No moon, no trees, no buildings, no snowflakes, no characters, no platforms, no HUD, no captions, no panel frames, no text. " +
      STYLE,
  },
  {
    name: "snow-shrine-far",
    file: "snow-shrine-far.png",
    size: "1536x1024",
    reference: "snow-shrine-board.png",
    prompt:
      "From this board, draw only the distant layer: soft snowy mountain peaks and one small mountain pagoda on a ridge, running the full width and rising from the bottom edge, hazy pale blue-violet with white snow caps. " +
      "Only this one layer, nothing in front of it or behind it: no sky, no trees, no shrine, no snow falling, no characters, no platforms, no HUD, no panel frames. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "snow-shrine-mid",
    file: "snow-shrine-mid.png",
    size: "1536x1024",
    reference: "snow-shrine-board.png",
    prompt:
      "From this board, draw only the middle layer: a dense dark cedar forest dusted with snow, with a stone stair climbing between the trees to two small temple roofs, spanning the full width and rising from the bottom edge. " +
      "Dark navy and indigo, the stair broken up by trees and shadow with no bright continuous edge, no lit windows. Every tree runs straight down to the bottom edge. " +
      "Only this one layer: no sky, no mountains, no near shrine halls, no torii, no lanterns, no characters, no platforms, no HUD, no panel frames. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "snow-shrine-near",
    file: "snow-shrine-near.png",
    size: "1536x1024",
    reference: "snow-shrine-board.png",
    prompt:
      "From this board, draw only the near layer: snow-covered shrine halls in deep slate-navy with white snow on broken, stepped eaves, one red torii gate in the left third, and a few small warm amber lanterns, spanning the full width and rising from the bottom edge. " +
      "Rooflines step up and down so no long flat edge runs across; every building runs straight down to the bottom edge. " +
      "Only this one layer: no sky, no mountains, no forest, no stone lanterns or bells, no characters, no platforms, no HUD, no panel frames. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "snow-shrine-details",
    file: "snow-shrine-details.png",
    size: "1536x1024",
    reference: "snow-shrine-board.png",
    prompt:
      "From this board, draw only the sparse shrine details, small and standing on one shared baseline at the bottom edge with wide empty gaps between them across the full width: two stone lanterns, a wooden prayer-plaque rack, a bronze bell hung in a small frame, and a few pine boughs heavy with snow. " +
      "Dark stone and wood with white snow; no lit flames. No ground line, no sky, no buildings, no characters, no platforms, no HUD, no panel frames. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "snow-shrine-platform",
    file: "snow-shrine-platform.png",
    size: "1024x1024",
    reference: "snow-shrine-board.png",
    prompt:
      "From this board's floating platforms, draw one flat grey stone slab seen from the side, wide and short, centred in the image: a thick continuous cap of white snow along its whole top edge, grey stone blocks below, and a dark underside. Nothing else. " +
      `${STYLE} ${KEY}`,
  },
  // Sunken Dome, redrawn against its approved ascent board
  // (docs/art/explorations/2026-10-01-stage-ascent/sunken-dome.png). The far
  // city is kept: the board keeps it. The ribs leave the sky for a layer of
  // their own, so they move against the coral; fish and mantas split so they
  // drift at different speeds.
  {
    name: "sunken-dome-sky",
    file: "sunken-dome-sky.png",
    size: "1536x1024",
    fullFrame: true,
    reference: "sunken-dome-board.png",
    prompt:
      "From this board, paint only the open water inside the dome, as one picture filling the whole image: bright rippling surface light at the very top, deep teal water below it with soft pale light shafts falling through, fading to a calm darker teal, " +
      "and along the bottom a faint low silhouette of a distant spired city seen through the water. The top tenth is one flat band of surface ripple and the bottom tenth one flat deep teal. " +
      "No glass ribs, no dome frame, no creatures, no coral, no kelp, no characters, no platforms, no HUD, no captions, no panel frames, no text. " +
      STYLE,
  },
  {
    name: "sunken-dome-far",
    file: "sunken-dome-far.png",
    size: "1536x1024",
    prompt:
      "A distant spired city in pale teal silhouette standing on the sea floor, spanning the full width and rising from the bottom edge, seen through water haze. " +
      "Flat shapes, few lit windows, no sky colour, no foreground. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "sunken-dome-mid",
    file: "sunken-dome-mid.png",
    size: "1536x1024",
    reference: "sunken-dome-board.png",
    prompt:
      "From this board, draw only the middle layer: the dome's dark glass ribs rising from the bottom edge and curving up across the full width, two or three of them, with tall dark kelp fronds between them. " +
      "Deep slate-teal and dark green, at most two tiny warm lights on the ribs, no continuous lit rail. Everything rises from the bottom edge. " +
      "Only this one layer: no water, no city, no coral, no tubes, no creatures, no characters, no platforms, no HUD, no panel frames. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "sunken-dome-near",
    file: "sunken-dome-near.png",
    size: "1536x1024",
    reference: "sunken-dome-board.png",
    prompt:
      "From this board, draw only the near layer: coral clusters, dark unlit glass tubes and a few round portholes, in deep teal, slate and muted coral pinks, spanning the full width and rising from the bottom edge. " +
      "Only the small round portholes glow warm amber, four or five of them across the whole width; the tubes are dark teal glass with a thin pale rim, not lit. " +
      "Tops step up and down with no long flat ledge or walkway across; everything runs straight down to the bottom edge. " +
      "Only this one layer: no water, no ribs, no kelp, no city, no creatures, no characters, no platforms, no HUD, no panel frames. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "sunken-dome-details",
    file: "sunken-dome-details.png",
    size: "1536x1024",
    reference: "sunken-dome-board.png",
    prompt:
      "From this board, draw only the sparse details, small and standing on one shared baseline at the bottom edge with wide empty gaps between them spread evenly across the full width: two anemones, a thin column of rising bubbles, an old brass diving bell, and a small coral fan. " +
      "Muted colours, no lit windows. No ground line, no water, no buildings, no characters, no platforms, no HUD, no panel frames. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "sunken-dome-fish",
    file: "sunken-dome-fish.png",
    size: "1536x1024",
    prompt:
      "A thin horizontal band of small pixel fish in a few loose schools spread across the full width, in the middle of the image, with wide empty gaps between the schools. Small muted teal, blue and orange fish only. Nothing above or below the band, nothing else. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "sunken-dome-mantas",
    file: "sunken-dome-mantas.png",
    size: "1536x1024",
    prompt:
      "Two manta ray silhouettes gliding in a thin horizontal band across the middle of the image, far apart, one large and one smaller, in one dark slate-teal with a slightly lighter belly line. No fish, nothing above or below the band, nothing else. " +
      `${STYLE} ${KEY}`,
  },
  {
    name: "sunken-dome-platform",
    file: "sunken-dome-platform.png",
    size: "1024x1024",
    reference: "sunken-dome-board.png",
    prompt:
      "From this board's floating platforms, draw one thick flat slab of pale glass seen from the side, wide and short, centred in the image: a solid continuous bright glass top edge along its whole length, a deep teal glass body as tall as the top band is thick, a flat dark underside, and only two or three tiny low tufts of coral sitting on the top edge near its ends. Nothing else. " +
      `${STYLE} ${KEY}`,
  },
  // The characters after the ninja: their climbs only. Their pose sheets and
  // busts were generated on the archived select branch and are kept as files.
  climbsPrompt("frog"),
  climbsPrompt("diver"),
  climbsPrompt("robo"),
  climbsPrompt("kitsune"),
  ...AFTER_HOURS.map(climbsPrompt),
];

/** The request `generate-images.ts` sends for one prompt. */
export function requestBody(prompt: ImagePrompt): { model: string; prompt: string; size: string; n: 1 } {
  return { model: IMAGE_MODEL, prompt: prompt.prompt, size: prompt.size, n: 1 };
}

/**
 * The OpenAI key: the environment's first, then `.env.local`'s.
 *
 * Returned and nothing else -- the caller sends it to the API and nowhere
 * else, and nothing here logs or writes it.
 */
export function readApiKey(env: NodeJS.ProcessEnv, envFile: string | undefined): string | undefined {
  const fromEnv = env["OPENAI_API_KEY"];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  if (envFile === undefined) return undefined;
  for (const line of envFile.split(/\r?\n/)) {
    const match = /^\s*OPENAI_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (match === null) continue;
    const value = match[1]!.replace(/^["']|["']$/g, "");
    return value === "" ? undefined : value;
  }
  return undefined;
}
