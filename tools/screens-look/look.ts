// The look list a draft pull request commits to ask for screenshots, and the
// run that photographs it on the gate's GPU pod (spec 5.1 and 5.4). The walk
// itself is tests/e2e/screens-walk.spec.ts; this reads the list, runs it once
// per language, and says what is missing.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  VIEWS,
  expectedScreens,
  missingOf,
  parseScreens,
  readNotes,
  screenNumber,
  screensTaken,
  type View,
} from "../../tests/e2e/support/screens-walk";

export const LOOK_FILE = "tests/e2e/look.json";
export const LOOK_LANGUAGES = ["es-419", "zh-Hans"];
/** The walk stops itself here, under the job step's 30 minutes, so what it took is still reported. */
export const DEADLINE_MS = 25 * 60_000;
/** After the abort, how long the walk has to end before the reports are written anyway. */
export const GRACE_MS = 60_000;
export const MAX_BYTES = 400 * 1024 * 1024;
/** The shots' format: WebP at quality 80 is 56% of the JPEG's size (30 game shots, 2026-11-19). */
export const SHOT_FORMAT = "webp";
const SHOT_FILE = /^(\d{2})-(.+)\.(?:jpg|webp)$/;

/**
 * This pod's share of a look (`FF_WALK_PIECE=<n>/<of>`, set by the gate's screens job):
 * the look's language-and-view pairs, dealt round in turn so each piece gets a mix of
 * phones and desktops. Every pair is in exactly one piece.
 */
export function pieceOf(look: Look, piece: string | undefined): Look {
  if (piece === undefined || piece === "") return look;
  const match = /^(\d+)\/(\d+)$/.exec(piece);
  const n = Number(match?.[1]);
  const of = Number(match?.[2]);
  if (match === null || n < 1 || n > of) throw new Error(`FF_WALK_PIECE is "${piece}", not <n>/<of>`);
  let index = 0;
  const languages = look.languages
    .map(({ locale, views }) => ({ locale, views: views.filter(() => index++ % of === n - 1) }))
    .filter((language) => language.views.length > 0);
  return { ...look, languages, piece: `${n}/${of}` };
}

/** The piece a downloaded folder holds (`_piece.json`), so it is checked against its own share. */
const PIECE_FILE = "_piece.json";

/**
 * The screens and sizes the gate picked from the pull request's changed files (`FF_LOOK_PICK`,
 * from tools/ci/screen-map.ts): what the walk shoots where the look list names none.
 */
export interface LookPick {
  screens: string[];
  views: Record<string, string[]>;
}

/** The pick the gate's screens job hands the walk, or undefined when there is none. */
export function pickFromEnv(text: string | undefined): LookPick | undefined {
  if (text === undefined || text.trim() === "") return undefined;
  const raw = JSON.parse(text) as Partial<LookPick>;
  if (!Array.isArray(raw.screens) || typeof raw.views !== "object" || raw.views === null) throw new Error(`FF_LOOK_PICK is not a pick: ${text.slice(0, 200)}`);
  return { screens: raw.screens, views: raw.views };
}

export interface Look {
  for: string;
  languages: { locale: string; views: View[] }[];
  /** The wanted screens, in the catalogue's order. */
  screens: string[];
  /** `<n>/<of>` when this is one piece of a split walk (pieceOf). */
  piece?: string;
  /** The gate's pick, when the list left its screens or views to it; kept beside the shots for --verify. */
  pick?: LookPick;
}

const STANDALONE = VIEWS.filter((view) => view.host === "standalone");

/**
 * A look list: a `for` line, and optionally its own `views` and `screens`. Left out, they come
 * from the gate's pick (the screens the diff reaches, at the sizes it affects). Never "all": a
 * walk shoots what the change touches, not every screen at every size (Owner, 2026-11-19).
 */
export function parseLook(text: string, path: string, pick?: LookPick): Look {
  let raw: { for?: unknown; views?: unknown; screens?: unknown };
  try {
    raw = JSON.parse(text) as typeof raw;
  } catch (error) {
    throw new Error(`${path} is not JSON: ${String(error)}`);
  }
  if (typeof raw.for !== "string" || raw.for.trim() === "") throw new Error(`${path} needs a "for" line a person can read`);
  const usesPick = raw.views === undefined || raw.screens === undefined;
  if (usesPick && (pick === undefined || pick.screens.length === 0 || Object.keys(pick.views).length === 0)) {
    throw new Error(`${path} leaves its ${raw.views === undefined ? "views" : "screens"} to the gate's pick, and the diff picked none: name them in the list`);
  }
  const wantedViews = raw.views === undefined ? pick!.views : raw.views;
  if (typeof wantedViews !== "object" || wantedViews === null || Object.keys(wantedViews).length === 0) {
    throw new Error(`${path}: "views" is a language and its views, or left out for the gate's pick`);
  }
  const languages = Object.entries(wantedViews as Record<string, unknown>).map(([locale, wanted]) => {
    if (!LOOK_LANGUAGES.includes(locale)) throw new Error(`${path}: "${locale}" is not a language the look takes (${LOOK_LANGUAGES.join(", ")})`);
    if (wanted === "all") throw new Error(`${path}: the views for ${locale} are "all"; name the sizes the change affects, or leave "views" out for the gate's pick`);
    if (!Array.isArray(wanted) || wanted.length === 0) throw new Error(`${path}: the views for ${locale} are a list of view names`);
    const views = (wanted as unknown[]).map((key) => {
      const view = STANDALONE.find((candidate) => candidate.key === key);
      if (view === undefined) throw new Error(`${path}: "${String(key)}" is not a standalone view`);
      return view;
    });
    return { locale, views };
  });
  let screens: string[];
  if (raw.screens === undefined) {
    const named = new Set(pick!.screens);
    for (const name of named) screenNumber(name);
    screens = parseScreens("all").filter((screen) => named.has(screen));
  } else {
    const asked = raw.screens;
    if (asked === "all" || (Array.isArray(asked) && asked.includes("all"))) {
      throw new Error(`${path}: "screens" is "all"; name the screens the change touches, or leave "screens" out for the gate's pick`);
    }
    if (typeof asked !== "string" && !Array.isArray(asked)) throw new Error(`${path}: "screens" is numbers or ranges, or left out for the gate's pick`);
    try {
      screens = parseScreens(asked as string | string[]);
    } catch (error) {
      throw new Error(`${path}: ${(error as Error).message}`);
    }
  }
  if (screens.length === 0) throw new Error(`${path} asks for no screen`);
  return { for: raw.for, languages, screens, ...(usesPick ? { pick: pick! } : {}) };
}

export function loadLook(path: string, pick?: LookPick): Look {
  if (!existsSync(path)) throw new Error(`the look list ${path} does not exist`);
  return parseLook(readFileSync(path, "utf8"), path, pick);
}

/** Where a walk keeps the gate's pick beside its shots, so --verify reads the same look. */
export const PICK_FILE = "_pick.json";

/** Every gap in a language's folder: a wanted screen not taken, a blank canvas, a part that never finished. */
export const missingIn = (look: Look, root: string, locale: string): string[] =>
  look.languages.find((language) => language.locale === locale)!.views.flatMap((view) => missingOf(view, resolve(root, locale), look.screens));

const bytesIn = (dir: string): number =>
  !existsSync(dir)
    ? 0
    : readdirSync(dir, { withFileTypes: true }).reduce(
        (sum, entry) => sum + (entry.isDirectory() ? bytesIn(resolve(dir, entry.name)) : statSync(resolve(dir, entry.name)).size),
        0,
      );

const shotsIn = (dir: string): number =>
  !existsSync(dir)
    ? 0
    : readdirSync(dir, { withFileTypes: true }).reduce(
        (sum, entry) => sum + (entry.isDirectory() ? shotsIn(resolve(dir, entry.name)) : SHOT_FILE.test(entry.name) ? 1 : 0),
        0,
      );

export interface Walk {
  locale: string;
  env: Record<string, string>;
  signal: AbortSignal;
}

export interface RunOptions {
  look: Look;
  root: string;
  commit: string;
  now: () => number;
  /** Resolves after `ms`; the run's deadline. */
  wait: (ms: number) => Promise<void>;
  /** One language's walk: its exit code. It must end soon after `signal` aborts. */
  walk: (job: Walk) => Promise<number>;
  log: (line: string) => void;
  summaryFile?: string | undefined;
  deadlineMs?: number;
  maxBytes?: number;
}

const index = (options: RunOptions, missing: Record<string, string[]>, minutes: number, stopped: boolean): string => {
  const { look, root } = options;
  const lines = [
    "# Screens look",
    "",
    `Commit: ${options.commit}`,
    `For: ${look.for}`,
    ...(look.pick ? ["Picked by the gate from the pull request's changed files (tools/ci/screen-map.ts)"] : []),
    `Screens asked for: ${look.screens.map((screen) => `${screenNumber(screen)}-${screen}`).join(", ")}`,
    ...(look.piece ? [`Piece: ${look.piece} (the other pieces are in their own folders)`] : []),
    `Walk: ${minutes.toFixed(1)} minutes${stopped ? " (stopped at the deadline)" : ""}`,
    "",
  ];
  for (const { locale, views } of look.languages) {
    lines.push(`## ${locale}`, "", "| view | taken | missing |", "| --- | --- | --- |");
    const notes: string[] = [];
    for (const view of views) {
      const dir = resolve(root, locale);
      const wanted = expectedScreens(view, look.screens);
      const have = screensTaken(view, dir);
      const taken = [...wanted.required, ...wanted.optional].filter((screen) => have.has(screen)).map(screenNumber);
      const gaps = missing[locale]!.filter((entry) => entry.startsWith(`${view.key}/`) || entry.startsWith(`${view.key}:`));
      lines.push(`| ${view.key} | ${taken.join(", ") || "none"} | ${gaps.join("; ") || "none"} |`);
      for (const [part, said] of Object.entries(readNotes(view, dir))) for (const note of said) notes.push(`- ${view.key} / ${part}: ${note}`);
    }
    lines.push("", ...(notes.length > 0 ? ["Notes from the walk:", "", ...notes, ""] : []));
  }
  return `${lines.join("\n")}\n`;
};

/** Walks each language, then writes `_missing.json` and `index.md`, prints the errors, and returns the exit code. */
export async function runLook(options: RunOptions): Promise<number> {
  const { look, root, now, log } = options;
  const deadline = options.deadlineMs ?? DEADLINE_MS;
  const start = now();
  let failed = false;
  let stopped = false;
  for (const { locale, views } of look.languages) {
    const remaining = deadline - (now() - start);
    if (remaining <= 0) {
      stopped = true;
      break;
    }
    const control = new AbortController();
    const walking = options.walk({
      locale,
      signal: control.signal,
      env: {
        SCREENS_LOCALE: locale,
        SCREENS_VIEWS: views.map((view) => view.key).join(","),
        SCREENS_HOSTS: "standalone",
        SCREENS_ONLY: look.screens.map(screenNumber).join(","),
        SCREENS_FORMAT: SHOT_FORMAT,
      },
    });
    const outcome = await Promise.race([walking.then((code) => ({ code })), options.wait(remaining).then(() => null)]);
    if (outcome === null) {
      control.abort();
      // A walk that ignores the abort must not hold the reports back.
      await Promise.race([walking.catch(() => undefined), options.wait(GRACE_MS)]);
      stopped = true;
      break;
    }
    // Both languages are walked even if the first fails.
    if (outcome.code !== 0) failed = true;
  }
  const minutes = (now() - start) / 60_000;

  const missing: Record<string, string[]> = {};
  for (const { locale } of look.languages) {
    missing[locale] = missingIn(look, root, locale);
    mkdirSync(resolve(root, locale), { recursive: true });
    writeFileSync(resolve(root, locale, "_missing.json"), `${JSON.stringify(missing[locale], null, 2)}\n`);
    for (const entry of missing[locale]!) log(`::error::screens walk ${locale}: missing ${entry}`);
  }
  if (stopped) log(`::error::screens walk: stopped at ${deadline / 60_000} minutes`);
  writeFileSync(resolve(root, "index.md"), index(options, missing, minutes, stopped));
  if (look.piece) writeFileSync(resolve(root, PIECE_FILE), `${JSON.stringify({ piece: look.piece })}\n`);
  if (look.pick) writeFileSync(resolve(root, PICK_FILE), `${JSON.stringify(look.pick)}\n`);

  const size = bytesIn(root);
  const limit = options.maxBytes ?? MAX_BYTES;
  const oversize = size > limit;
  if (oversize) log(`::error::screens: the shots are ${(size / 1024 / 1024).toFixed(0)} MB, over ${limit / 1024 / 1024} MB`);
  const summary = `Screens look${look.piece ? ` piece ${look.piece}` : ""}: ${minutes.toFixed(1)} minutes, ${shotsIn(root)} shots, ${(size / 1024 / 1024).toFixed(1)} MB`;
  log(summary);
  if (options.summaryFile) appendFileSync(options.summaryFile, `${summary}\n`);
  return failed || stopped || oversize || Object.values(missing).some((list) => list.length > 0) ? 1 : 0;
}

/**
 * What is wrong with a downloaded piece folder, against its look list:
 * nothing missing, no other screen, an `index.md` and an empty `_missing.json`
 * for each language. A screen a view may legitimately lack (`isOptional`) may
 * be there or not.
 */
export function verify(whole: Look, folder: string): string[] {
  const problems: string[] = [];
  const pieceFile = resolve(folder, PIECE_FILE);
  const look = existsSync(pieceFile) ? pieceOf(whole, (JSON.parse(readFileSync(pieceFile, "utf8")) as { piece: string }).piece) : whole;
  if (!existsSync(resolve(folder, "index.md"))) problems.push("index.md is missing");
  const languages = new Set(look.languages.map((language) => language.locale));
  for (const entry of existsSync(folder) ? readdirSync(folder, { withFileTypes: true }) : []) {
    if (entry.isDirectory() && !languages.has(entry.name)) problems.push(`extra language folder ${entry.name}`);
  }
  for (const { locale, views } of look.languages) {
    const dir = resolve(folder, locale);
    const listed = resolve(dir, "_missing.json");
    if (!existsSync(listed)) problems.push(`${locale}/_missing.json is missing`);
    else for (const entry of JSON.parse(readFileSync(listed, "utf8")) as string[]) problems.push(`missing ${entry}`);
    for (const entry of missingIn(look, folder, locale)) if (!problems.includes(`missing ${entry}`)) problems.push(`missing ${entry}`);
    for (const view of views) {
      const wanted = expectedScreens(view, look.screens);
      const allowed = new Set([...wanted.required, ...wanted.optional]);
      const viewDir = resolve(dir, view.key);
      for (const file of existsSync(viewDir) ? readdirSync(viewDir) : []) {
        const match = SHOT_FILE.exec(file);
        if (match !== null && !allowed.has(match[2]!)) problems.push(`extra ${locale}/${view.key}/${file}`);
      }
    }
    for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
      if (entry.isDirectory() && !views.some((view) => view.key === entry.name)) problems.push(`extra view folder ${locale}/${entry.name}`);
    }
  }
  return problems;
}
