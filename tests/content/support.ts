/**
 * Content test support.
 *
 * Every reusable builder and every exact fixture string lives here, and the
 * strings are read from `fixtures/valid/` rather than restated. That tree is a
 * real authored source tree, so a filesystem test and an in-memory parse test
 * disagree about nothing: one reads it through `readSources`, the other reads
 * the same bytes through these builders.
 *
 * Files are labelled `content/...` even though they live under `fixtures/`,
 * because that is what `readSources` labels them and what an author reads in a
 * diagnostic.
 */

import { readFileSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArtManifest } from "@floor-fifty/asset-contract/manifest-schema";
import { formatDiagnostic } from "@floor-fifty/content/diagnostics";
import { buildPayload } from "@floor-fifty/content/canonicalize";
import type { CompilerPaths } from "@floor-fifty/content/compiler";
import { parseSources } from "@floor-fifty/content/parse";
import { readSources } from "@floor-fifty/content/read-sources";
import { buildArtifact } from "@floor-fifty/content/revisions";
import type { Located, ParsedContent, RawSourceTree, SourceFile } from "@floor-fifty/content/types";
import {
  asContentId,
  type GameContent,
  type GameContentPayload,
} from "@floor-fifty/shared/content/game-content";
import type {
  FlowEvent,
  PresentationActionId,
  PresentationEventName,
  PresentationFlow,
  PresentationRoute,
  PresentationRouting,
  ScreenId,
} from "@floor-fifty/shared/content/presentation";

/** The on-disk valid authored tree, for tests that exercise real reads. */
export const VALID_SOURCE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/valid",
);

const read = (relative: string): string =>
  readFileSync(join(VALID_SOURCE_ROOT, relative), "utf8");

const sourceFile = (relative: string): SourceFile => ({
  file: `content/${relative}`,
  text: read(relative),
});

export const validTuning = read("tuning.toml");
export const validFlow = read("flow.toml");
export const validEvents = read("events.toml");
export const validCatalog = read("catalog.toml");
export const validStage = read("stages/rooftops.toml");
export const validSong = read("songs/dusk-run.toml");
export const validStory = read("story.toml");

/** Every authored file of the valid tree, exactly as `readSources` yields it. */
export function validTree(): RawSourceTree {
  return {
    tuning: sourceFile("tuning.toml"),
    flow: sourceFile("flow.toml"),
    eventRouting: sourceFile("events.toml"),
    catalog: sourceFile("catalog.toml"),
    story: sourceFile("story.toml"),
    unlocks: sourceFile("unlocks.toml"),
    blockedNames: sourceFile("blocked-names.toml"),
    juice: sourceFile("juice.toml"),
    characters: ["cyan", "draft-ghost", "gold", "ninja", "scarlet", "violet"].map((id) =>
      sourceFile(`characters/${id}.toml`),
    ),
    stages: [sourceFile("stages/dawn.toml"), sourceFile("stages/rooftops.toml")],
    songs: [sourceFile("songs/dawn-tutorial.toml"), sourceFile("songs/dusk-run.toml")],
    modes: [],
  };
}

/** The valid raw tree with `catalog.toml` replaced by this text. */
export function withCatalog(tree: RawSourceTree, text: string): RawSourceTree {
  return { ...tree, catalog: { file: tree.catalog.file, text } };
}

/** The valid tree with one file's text replaced, addressed the way authors do. */
export function validTreeWith(file: string, text: string): RawSourceTree {
  const tree = validTree();
  const swap = (source: SourceFile): SourceFile =>
    source.file === file ? { file, text } : source;
  const swapAll = (sources: readonly SourceFile[]): SourceFile[] => sources.map(swap);

  return {
    tuning: swap(tree.tuning),
    flow: swap(tree.flow),
    eventRouting: swap(tree.eventRouting),
    catalog: swap(tree.catalog),
    story: swap(tree.story),
    unlocks: swap(tree.unlocks),
    blockedNames: swap(tree.blockedNames),
    juice: swap(tree.juice),
    characters: swapAll(tree.characters),
    stages: swapAll(tree.stages),
    songs: swapAll(tree.songs),
    modes: swapAll(tree.modes),
  };
}

/** The valid tree carrying exactly one song, whose text the caller supplies. */
export function treeWithSong(text: string): RawSourceTree {
  return { ...validTree(), songs: [{ file: "content/songs/dusk-run.toml", text }] };
}

/**
 * The parsed valid tree.
 *
 * Every builder below mutates a copy of this rather than restating the shipped
 * graph, so a fixture edit cannot leave the validators being tested against a
 * graph nobody ships.
 */
export function validParsed(): ParsedContent {
  const result = parseSources(validTree());
  if (result.ok) return raceFirst(result.parsed);
  throw new Error(
    `the valid fixture tree does not parse: ${result.diagnostics.map(formatDiagnostic).join("; ")}`,
  );
}

/**
 * The race's stage and song ahead of the story's.
 *
 * The builders here edit `stages[0]` and `songs[0]` and mean the race's. The
 * read order is alphabetical, which puts `dawn` first; parsed order carries no
 * meaning (`buildPayload` follows the catalog), so reordering changes nothing.
 */
function raceFirst(parsed: ParsedContent): ParsedContent {
  const storyStages = new Set(parsed.story.value.chapters.map((chapter) => chapter.stageId));
  const storySongs = new Set(parsed.story.value.chapters.map((chapter) => chapter.songId));
  const race = <T,>(isStory: (item: T) => boolean, items: readonly T[]): T[] => [
    ...items.filter((item) => !isStory(item)),
    ...items.filter(isStory),
  ];
  return {
    ...parsed,
    stages: race((stage) => storyStages.has(stage.value.id), parsed.stages),
    songs: race((song) => storySongs.has(song.value.id), parsed.songs),
  };
}

export const located = <T,>(file: string, value: T): Located<T> => ({ file, value });

export const shippedFlow = (): PresentationFlow => validParsed().flow.value;
export const shippedRouting = (): PresentationRouting => validParsed().eventRouting.value;

// ------------------------------------------------------------ flow builders

export const flowWith = (overrides: Partial<PresentationFlow>): PresentationFlow => ({
  ...shippedFlow(),
  ...overrides,
});

/** The shipped graph with one declared source/event pair removed. */
export const flowWithout = (from: ScreenId, event: FlowEvent): PresentationFlow =>
  flowWith({
    transitions: shippedFlow().transitions.filter(
      (transition) => !(transition.from === from && transition.event === event),
    ),
  });

/** The shipped graph with one pair pointed somewhere else. */
export const flowWithTransition = (
  from: ScreenId,
  event: FlowEvent,
  to: ScreenId,
): PresentationFlow =>
  flowWith({
    transitions: shippedFlow().transitions.map((transition) =>
      transition.from === from && transition.event === event ? { from, event, to } : transition,
    ),
  });

/** A graph that can re-enter the entry screen, which no graph may. */
export const flowWithIncomingEntry = (): PresentationFlow =>
  flowWithTransition("GameEnd", "returnToMenu", "Splash");

/** A graph in which `screen` has no incoming edge at all. */
export const flowWithUnreachable = (screen: ScreenId): PresentationFlow =>
  flowWith({
    transitions: shippedFlow().transitions.filter((transition) => transition.to !== screen),
  });

// --------------------------------------------------------- routing builders

const routesWithout = (
  source: PresentationEventName,
  action: PresentationActionId,
): readonly PresentationRoute[] =>
  shippedRouting().routes.filter(
    (route) => !(route.source === source && route.action === action),
  );

export const routingWithout = (
  source: PresentationEventName,
  action: PresentationActionId,
): PresentationRouting => ({ routes: routesWithout(source, action) });

/** The shipped routing plus one extra route, however illegal. */
export const routingWith = (
  source: PresentationEventName,
  order: number,
  action: PresentationActionId,
): PresentationRouting => ({ routes: [...shippedRouting().routes, { source, order, action }] });

export const routingWithDuplicatePair = (): PresentationRouting => ({
  routes: [
    ...shippedRouting().routes,
    { source: "room.finished", order: 20, action: "flow.race-finished" },
  ],
});

/** Two routes for one source that claim the same execution slot. */
export const routingWithDuplicateOrder = (source: PresentationEventName): PresentationRouting => {
  const existing = shippedRouting().routes.find((route) => route.source === source);
  if (existing === undefined) throw new Error(`no shipped route for ${source}`);
  return { routes: [...shippedRouting().routes, existing] };
};

export const routingWithOrder = (
  source: PresentationEventName,
  order: number,
): PresentationRouting => ({
  routes: shippedRouting().routes.map((route) =>
    route.source === source ? { ...route, order } : route,
  ),
});

/** The on-disk tree whose every failure is semantic rather than syntactic. */
export const INVALID_SOURCE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/invalid",
);

// ----------------------------------------------------- parsed-tree builders

/** The valid tree with its base tuning replaced wholesale. */
export const parsedWithBase = (tuning: Readonly<Record<string, number>>): ParsedContent => ({
  ...validParsed(),
  tuning: located("content/tuning.toml", tuning),
});

/** The valid tree plus one mode carrying the given override layer. */
export const parsedWithMode = (tuning: Readonly<Record<string, number>>): ParsedContent => ({
  ...validParsed(),
  modes: [
    located("content/modes/test-mode.toml", {
      id: asContentId("test-mode"),
      displayName: "Test Mode",
      course: "finite",
      laps: [1, 3],
      tuning,
    }),
  ],
});

/** The valid tree with one character's portrait pointed at `alias`. */
export const parsedWithPortrait = (alias: string): ParsedContent => {
  const parsed = validParsed();
  return {
    ...parsed,
    characters: parsed.characters.map((character) =>
      character.value.id === "scarlet"
        ? located(character.file, {
            ...character.value,
            portraitAliases: { ...character.value.portraitAliases, scarlet: alias },
          })
        : character,
    ),
  };
};

/** Two item files claiming the same ID, which no two files may. */
export const parsedWithDuplicateIds = (): ParsedContent => {
  const parsed = validParsed();
  const first = parsed.characters[0];
  if (first === undefined) throw new Error("the valid fixture tree has no characters");
  return {
    ...parsed,
    characters: [
      ...parsed.characters,
      located("content/characters/clone.toml", { ...first.value, displayName: "Clone" }),
    ],
  };
};

/** The valid tree with the catalog's stage list replaced. */
export const parsedWithCatalogStages = (stages: readonly string[]): ParsedContent => {
  const parsed = validParsed();
  return {
    ...parsed,
    catalog: located(parsed.catalog.file, {
      ...parsed.catalog.value,
      stages,
      packs: [{ ...parsed.catalog.value.packs[0]!, stages }],
    }),
  };
};

/** A manifest carrying exactly the aliases named, and nothing else. */
export function manifestWithAliases(aliases: readonly string[]): ArtManifest {
  return {
    version: 1,
    brief: "test manifest",
    bundles: {
      splash: [],
      menu: [],
      shell: [],
      gameplay: aliases.map((alias) => ({
        role: "image",
        alias,
        file: `${alias}.png`,
        width: 16,
        height: 16,
        requiresAlpha: true,
        paletteRoles: ["uiText"],
        provenance: { tool: "test", prompt: "test", source: "test", license: "test" },
      })),
      audio: [],
      reveal: [],
      demos: [],
      story: [],
    },
  };
}

// -------------------------------------------------------- payload builders

const fixtureRoot = (name: string): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", name);

/** Reads, parses, and assembles a whole fixture tree into an artifact. */
export async function artifactFrom(fixture: string): Promise<GameContent> {
  const result = parseSources(await readSources(fixtureRoot(fixture)));
  if (!result.ok)
    throw new Error(
      `fixture ${fixture} does not parse: ${result.diagnostics.map(formatDiagnostic).join("; ")}`,
    );
  return buildArtifact(buildPayload(result.parsed));
}

/** One authored edit, named by which revisions it is expected to move. */
export type PayloadChange =
  | "base"
  | "course"
  | "mode"
  | "beat"
  | "flow"
  | "eventRoute"
  // One song field each. `beat` moves the tempo; a partition that held for the
  // tempo while leaking through a loop point would be no partition at all.
  | "songBpm"
  | "songBeatOffset"
  | "songLoopStart"
  | "songLoopEnd"
  | "songAlias"
  // The two halves of an authored course, which fall on opposite sides.
  | "courseSeed"
  | "coursePhrase"
  // Teaching the game changes nothing about how a race is decided.
  | "story"
  // The story's own stage is cosmetic too: no room races it.
  | "storyStage"
  // Racer juice is presentation only (polish spec §4.1).
  | "juice";

export type PayloadOptions = {
  /** Reorders the public character menu, which is cosmetic by construction. */
  readonly characterOrder?: readonly string[];
  readonly change?: PayloadChange;
  /** Replaces the stage's cosmetic backdrop alias. */
  readonly theme?: string;
};

const withChange = (parsed: ParsedContent, change: PayloadChange): ParsedContent => {
  const stage = parsed.stages[0];
  const song = parsed.songs[0];
  if (stage === undefined || song === undefined)
    throw new Error("the valid fixture tree is missing a stage or a song");

  switch (change) {
    case "base":
      return { ...parsed, tuning: located(parsed.tuning.file, { ...parsed.tuning.value, GRAVITY: -300 }) };
    case "course":
      return {
        ...parsed,
        stages: [located(stage.file, { ...stage.value, courseTuning: { COURSE_FLOOR_COUNT: 30 } })],
      };
    case "mode": {
      const moded = parsedWithMode({ GRAVITY: -300 });
      return {
        ...moded,
        catalog: located(moded.catalog.file, { ...moded.catalog.value, modes: ["test-mode"] }),
      };
    }
    case "beat":
      return { ...parsed, songs: [located(song.file, { ...song.value, bpm: 140 })] };
    case "songBpm":
      return { ...parsed, songs: [located(song.file, { ...song.value, bpm: 137.5 })] };
    case "songBeatOffset":
      return { ...parsed, songs: [located(song.file, { ...song.value, beatOffsetTicks: 31 })] };
    case "songLoopStart":
      return { ...parsed, songs: [located(song.file, { ...song.value, loopStartMs: 1_200 })] };
    case "songLoopEnd":
      return { ...parsed, songs: [located(song.file, { ...song.value, loopEndMs: 90_000 })] };
    case "songAlias":
      return {
        ...parsed,
        songs: [located(song.file, { ...song.value, audioAlias: "music.somethingElse" })],
      };
    case "courseSeed": {
      if (stage.value.course === undefined)
        throw new Error("the valid fixture stage authors no course");
      return {
        ...parsed,
        stages: [
          located(stage.file, {
            ...stage.value,
            course: { ...stage.value.course, seed: stage.value.course.seed + 1 },
          }),
        ],
      };
    }
    case "coursePhrase": {
      const course = stage.value.course;
      if (course === undefined) throw new Error("the valid fixture stage authors no course");
      const [first, ...rest] = course.phrases;
      if (first === undefined) throw new Error("the valid fixture course has no phrases");
      return {
        ...parsed,
        stages: [
          located(stage.file, {
            ...stage.value,
            // The bounds are left alone: moving one would be a second edit, and
            // the point is that rewriting what a phrase *means* is cosmetic.
            course: { ...course, phrases: [{ ...first, purpose: "Reworded after a playtest." }, ...rest] },
          }),
        ],
      };
    }
    case "juice":
      return {
        ...parsed,
        juice: located(parsed.juice.file, {
          ...parsed.juice.value,
          slam: { ...parsed.juice.value.slam, hitStopMs: parsed.juice.value.slam.hitStopMs + 10 },
        }),
      };
    case "flow":
      // A transition dropped rather than repointed: every shipped pair has
      // exactly one legal destination today, so there is no other
      // presentation-only flow edit to make. Hashing runs after validation in
      // the real pipeline, so a graph the validator would refuse is still a
      // fair subject for a partition test.
      return {
        ...parsed,
        flow: located(parsed.flow.file, {
          ...parsed.flow.value,
          transitions: parsed.flow.value.transitions.slice(0, -1),
        }),
      };
    case "story":
      return {
        ...parsed,
        story: located(parsed.story.file, {
          ...parsed.story.value,
          chapters: parsed.story.value.chapters.map((chapter) => ({ ...chapter, parSeconds: chapter.parSeconds + 1 })),
        }),
      };
    case "storyStage":
      return {
        ...parsed,
        stages: parsed.stages.map((located_) =>
          parsed.story.value.chapters.some((chapter) => chapter.stageId === located_.value.id)
            ? located(located_.file, {
                ...located_.value,
                theme: {
                  ...located_.value.theme,
                  presentation: { ...located_.value.theme.presentation!, refractionIntensity: 0.2 },
                },
              })
            : located_,
        ),
      };
    case "eventRoute":
      return {
        ...parsed,
        eventRouting: located(parsed.eventRouting.file, {
          routes: parsed.eventRouting.value.routes.map((route) =>
            route.source === "room.finished" ? { ...route, order: 20 } : route,
          ),
        }),
      };
  }
};

/**
 * Carries forward every stage and song an edit left out.
 *
 * The builders above replace `stages` and `songs` with the one item they edit,
 * which would drop the story's stages and songs; the payload cannot be built
 * without them.
 */
const withUntouchedItems = (edited: ParsedContent, original: ParsedContent): ParsedContent => {
  const missing = <T extends { readonly id: string }>(
    kept: readonly Located<T>[],
    all: readonly Located<T>[],
  ): Located<T>[] => all.filter((item) => !kept.some((each) => each.value.id === item.value.id));
  return {
    ...edited,
    stages: [...edited.stages, ...missing(edited.stages, original.stages)],
    songs: [...edited.songs, ...missing(edited.songs, original.songs)],
  };
};

/** The valid tree with its one chapter naming this stage and song (by default its own). */
export const parsedWithStory = (names: { stageId?: string; songId?: string }): ParsedContent => {
  const parsed = validParsed();
  return {
    ...parsed,
    story: located(parsed.story.file, {
      ...parsed.story.value,
      chapters: parsed.story.value.chapters.map((chapter) => ({ ...chapter, ...names })),
    }),
  };
};

/** The valid tree's payload, optionally carrying exactly one authored edit. */
export function payload(options: PayloadOptions = {}): GameContentPayload {
  let parsed = validParsed();

  if (options.characterOrder !== undefined)
    parsed = {
      ...parsed,
      catalog: located(parsed.catalog.file, {
        ...parsed.catalog.value,
        characters: options.characterOrder,
        packs: [{ ...parsed.catalog.value.packs[0]!, characters: options.characterOrder }],
      }),
    };

  if (options.theme !== undefined) {
    const stage = parsed.stages[0];
    if (stage === undefined) throw new Error("the valid fixture tree has no stage");
    parsed = {
      ...parsed,
      stages: [
        located(stage.file, {
          ...stage.value,
          theme: { ...stage.value.theme, backdropAlias: options.theme },
        }),
      ],
    };
  }

  if (options.change !== undefined) parsed = withChange(parsed, options.change);

  return buildPayload(withUntouchedItems(parsed, validParsed()));
}

/** The valid tree with a draft item edited. Drafts reach no payload. */
export const changedDraftParsed = (): ParsedContent => {
  const parsed = validParsed();
  return {
    ...parsed,
    characters: parsed.characters.map((character) =>
      character.value.id === "draft-ghost"
        ? located(character.file, { ...character.value, displayName: "Edited Ghost" })
        : character,
    ),
  };
};

/** Fixed actions with fixed orders, declared in whatever sequence is asked. */
const ROUTE_ACTION_BY_ORDER: Readonly<Record<number, PresentationActionId>> = {
  10: "flow.race-finished",
  20: "flow.recover-to-menu",
};

export const parsedWithRouteDeclarationOrder = (orders: readonly number[]): ParsedContent => {
  const parsed = validParsed();
  return {
    ...parsed,
    eventRouting: located(parsed.eventRouting.file, {
      routes: orders.map((order) => {
        const action = ROUTE_ACTION_BY_ORDER[order];
        if (action === undefined) throw new Error(`no builder route for order ${order}`);
        return { source: "room.finished" as const, order, action };
      }),
    }),
  };
};

// ------------------------------------------------------- compiler fixtures

/** The repository root, four levels up from this file. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * A throwaway copy of the real authored tree.
 *
 * Compiler tests invalidate sources and overwrite generated output, so they
 * run against a copy. The manifest is the real one: alias validation is only
 * meaningful against the assets the game actually ships.
 */
export async function temporaryContentPaths(): Promise<CompilerPaths> {
  const root = await mkdtemp(join(tmpdir(), "floor-fifty-content-"));
  await cp(join(REPO_ROOT, "content"), join(root, "content"), { recursive: true });
  return {
    sourceRoot: join(root, "content"),
    manifestPath: join(REPO_ROOT, "packages/asset-contract/assets/art-manifest.json"),
    artifactPath: join(root, "content/generated/content.json"),
    messagesPath: join(root, "apps/client/messages/content/en.json"),
  };
}
