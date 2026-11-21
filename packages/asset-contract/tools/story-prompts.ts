/**
 * The story's thirteen cutscene panels, as data for `generate-story-panels.ts`
 * (story mode v2 spec, "Art"). Each names the references the image model is
 * shown, so Frog and Oni keep their portraits' faces and each place keeps its
 * stage's look.
 */

/** A reference picture: a file under `assets/`, optionally one row of a portrait sheet. */
export type StoryReference =
  | { readonly kind: "file"; readonly file: string }
  /** Row `row` (0 scarlet, 1 cyan, 2 gold, 3 violet) of a 3-by-4 portrait sheet, keyed onto white. */
  | { readonly kind: "portraitRow"; readonly file: string; readonly row: number };

export type StoryPanelPrompt = {
  readonly alias: string;
  readonly file: string;
  readonly prompt: string;
  readonly references: readonly StoryReference[];
  /** What each reference is, said to the model in the order given. */
  readonly referenceNote: string;
};

export const STORY_STYLE =
  "16-bit pixel art cutscene illustration for a video game, wide 16:9. Chunky visible pixels, flat cel shading with hard-edged shadows, dark plum outlines, a small limited palette, no gradients, no anti-aliasing, no blur. Seen through the eyes of a small climber who is never in the picture. Keep the characters exactly as in the reference sheets. No text, no letters, no numbers, no logo, no watermark, no border, no black bars: the picture fills the whole frame. Keep the lower third simple and dark. Skies are flat horizontal bands of two to four solid colours with crisp edges, and clouds are flat shapes: no soft gradient anywhere.";

const FROG: StoryReference = { kind: "portraitRow", file: "source/portrait-sheet-frog.png", row: 1 };
const ONI: StoryReference = { kind: "portraitRow", file: "source/portrait-sheet-oni.png", row: 0 };
const FROG_BODY: StoryReference = { kind: "file", file: "production/frog-cyan.png" };
const ONI_BODY: StoryReference = { kind: "file", file: "production/oni-scarlet.png" };
const DAWN: StoryReference = { kind: "file", file: "source/dawn-concept.png" };
const ROOFTOPS: StoryReference = { kind: "file", file: "production/still-rooftops-preview.png" };
const DEEP: StoryReference = { kind: "file", file: "production/still-sunken-dome-preview.png" };
const SNOW: StoryReference = { kind: "file", file: "production/still-snow-shrine-preview.png" };

const FROG_NOTE = "Frog has no human face: his whole head is a round blue frog face with two big round white eyes on top and a wide white mouth, and he wears a blue hoodie. He is a small kid, the same size as Oni, and looks exactly like his face sheet and his little body sprite sheet (both given) in every picture.";
const ONI_NOTE = "Oni is a small red-skinned kid with two cream horns, short spiky black hair that always sticks up in sharp points (never curly, never bald), and a red jacket over a white shirt. He looks exactly like his face sheet and his little body sprite sheet (both given) in every picture.";

export const STORY_PANELS: readonly StoryPanelPrompt[] = [
  {
    alias: "story.lowtown",
    file: "story-lowtown.png",
    references: [DAWN],
    referenceNote: "The reference picture is the stage's look: copy its colours and pixel style.",
    prompt:
      // Round 3: the round-2 tower read as a flat teal block of noise (review 2, R4).
      "A tiny cosy town of crooked houses with warm lanterns at the foot of an impossibly tall stone tower. The tower stands in the middle of the picture, solid dark plum stone, drawn clearly: stacked stone blocks, many narrow ledges sticking out on both sides, small square windows lit warm yellow up its whole height, and it rises straight up out of the top of the frame. Its edges are crisp against a bright dawn sky in flat bands of peach, mauve and teal. A little low mist between the houses only, never over the tower. Thin glowing orange cracks in the street. Quiet, a little worrying.",
  },
  {
    alias: "story.frogWarning",
    file: "story-frog-warning.png",
    references: [FROG, FROG_BODY, DAWN],
    referenceNote: `${FROG_NOTE} The last picture is the place's look.`,
    prompt:
      "Frog, close to the viewer, shouting a warning: mouth wide open in a yell, brows up and worried, not smiling. He points down at a glowing orange crack splitting the cobbles between us. Dawn light from behind him, orange light from below on his face.",
  },
  {
    alias: "story.oniAbove",
    file: "story-oni-above.png",
    references: [ONI, ONI_BODY, DAWN],
    referenceNote: `${ONI_NOTE} The last picture is the place's look.`,
    prompt:
      "Looking steeply up a tall stone tower wall at dawn. High above, Oni stands on a narrow ledge with his back to us, looking higher still, a red scarf blowing. He is small in the frame; the height is the subject.",
  },
  {
    alias: "story.cityLamps",
    file: "story-city-lamps.png",
    references: [ROOFTOPS],
    referenceNote: "The reference picture is the stage's look: copy its rooftops, colours and pixel style.",
    prompt:
      // Round 2: the first round's lanterns were too small to read at 480 by 270.
      "Night rooftops of an empty city under a starry sky: water tanks, vents, dark windows. Three squat iron street lanterns with glass panes, each a different size, on different roofs at different distances (one big and near on the left, one middle-sized on a far roof, one small and leaning on a chimney): no two alike, never in a row. Each has a round glowing yellow firefly shut inside, bright and clearly visible. The lanterns are the only warm lights in the picture.",
  },
  {
    alias: "story.oniLeaps",
    file: "story-oni-leaps.png",
    references: [ONI, ONI_BODY, ROOFTOPS],
    referenceNote: `${ONI_NOTE} The last picture is the place's look.`,
    prompt:
      "From a rooftop, looking up: Oni in mid-leap across a gap between two buildings against a big moon, his spiky black hair and cream horns clear against it, eyes fixed upward, not looking at the small glowing lanterns on the roofs below him. Fast, proud.",
  },
  {
    alias: "story.theDeep",
    file: "story-the-deep.png",
    references: [FROG, FROG_BODY, DEEP],
    referenceNote: `${FROG_NOTE} The last picture is the place's look.`,
    prompt:
      "Inside a flooded hall under a huge cracked glass dome: teal water light, drifting stone slabs like rafts at different heights, fish shadows. Very high up, one tiny red figure climbing. Frog stands at the right edge, seen from the side, looking up, his blue frog face and white eyes clear.",
  },
  {
    alias: "story.theHand",
    file: "story-the-hand.png",
    references: [FROG, FROG_BODY, DEEP],
    referenceNote: `${FROG_NOTE} The last picture is the place's look.`,
    prompt:
      // Round 3: the round-2 hand was a giant brown fist on Frog's head (review 2, R4).
      "Seen from the side, at Frog's height: a child's arm in a purple sleeve reaches down from the top edge of the frame, and its small hand, the same size as Frog's, clasps Frog's raised blue hand, wrist to wrist, in the upper middle of the picture. Frog hangs from that one hand below it, his whole small body in view, his other arm reaching up, his blue frog face turned up toward the hand, white eyes wide, surprised and grateful. The two hands are clearly a handshake grip, not a grab: nothing touches Frog's head. Far below him, a dim red glow in dark teal water.",
  },
  {
    alias: "story.lookingUp",
    file: "story-looking-up.png",
    references: [FROG, FROG_BODY, SNOW],
    referenceNote: `${FROG_NOTE} The last picture is the place's look.`,
    prompt:
      "Looking up a tall snowy shaft of shrine gates and icicles to a pale full moon. Snow falling. Frog stands beside us at the left edge, also looking up, fists ready. Red glow on the snow from below.",
  },
  {
    alias: "story.theLedge",
    file: "story-the-ledge.png",
    references: [ONI, ONI_BODY, DAWN],
    referenceNote: `${ONI_NOTE} The last picture is the place's look.`,
    prompt:
      // Round 3: the round-2 Oni floated in the air beside the ledge (review 2, R4).
      "Seen from the side, close: the stone wall of a tower at sunrise fills the left of the picture. A short broken stone ledge sticks out of the wall near the top of the frame, cracked, with a chunk falling away. Oni hangs from the ledge's front edge with both hands, his fingers curled over the stone, both arms stretched straight up above his head, his body hanging straight down under the ledge against the wall, legs dangling, nothing under his feet. His face is turned up, scared. Far below him, orange lava light and smoke. Dizzying height.",
  },
  {
    alias: "story.oniAfraid",
    file: "story-oni-afraid.png",
    references: [ONI, ONI_BODY],
    referenceNote: ONI_NOTE,
    prompt:
      "Close on Oni's face, looking up at the viewer, afraid for the first time: his spiky black hair and two cream horns as in his face sheet, one hand gripping cracked stone. Orange light from below, cool dawn light from above.",
  },
  {
    alias: "story.floorFifty",
    file: "story-floor-fifty.png",
    references: [FROG, ONI, DAWN],
    referenceNote: `${FROG_NOTE} ${ONI_NOTE} The last picture is the place's look.`,
    prompt:
      "The flat top of the tower above a sea of clouds at sunrise, gold and peach. Frog and Oni sit side by side at the edge, out of breath, smiling at the viewer. Wide, calm, open sky.",
  },
  {
    alias: "story.lookingDown",
    file: "story-looking-down.png",
    references: [DAWN],
    referenceNote: "The reference picture is the summit's look: copy its colours and pixel style.",
    prompt:
      // Round 3: the round-2 view down tore into horizontal strips (review 2, R4).
      "Looking down from the very top of the tower over its stone edge, which fills the bottom of the frame: the whole morning world lies far below as one continuous calm landscape seen from high above at a steep angle, in soft gold dawn light: a small town of tiny roofs ringed by cooled black rock at the tower's foot, little city rooftops, a round glass dome glinting, snowy hills. One whole picture with gentle curving shapes, no straight horizontal stripes, no bands, no seams, no road cutting through it. A few small glowing yellow fireflies drift up toward the viewer. A thin line of pale sky only at the very top edge. Peaceful and wide.",
  },
  {
    alias: "story.oniReaches",
    file: "story-oni-reaches.png",
    references: [ONI, FROG, DAWN],
    referenceNote: `${ONI_NOTE} ${FROG_NOTE} The last picture is the place's look.`,
    prompt:
      "At the tower's top edge at sunrise, Oni kneels and reaches a hand down, smiling, to small climbers of several shapes coming up the last ledge (seen from behind, dark silhouettes). Frog cheers beside him.",
  },
];
