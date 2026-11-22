/**
 * Source-tree shapes.
 *
 * Reading, parsing, and validation are three separate passes, and these are
 * the values they hand each other. Every one of them keeps the originating
 * file beside the value, because a diagnostic that cannot name a file is a
 * diagnostic an author cannot act on.
 */

import type {
  CharacterContent,
  ModeContent,
  SongContent,
  StageContent,
  UnlockContent,
} from "@floor-fifty/shared/content/game-content";
import type { AuthoredJuice } from "./schema/juice";
import type { AuthoredPrompts } from "./schema/prompts";
import type {
  PresentationFlow,
  PresentationRouting,
} from "@floor-fifty/shared/content/presentation";
import type { Diagnostic } from "./diagnostics";

/** One authored file, with the repository-relative path a diagnostic names. */
export type SourceFile = { readonly file: string; readonly text: string };

/** Every authored file, read but not yet parsed. */
export type RawSourceTree = {
  readonly tuning: SourceFile;
  readonly flow: SourceFile;
  readonly eventRouting: SourceFile;
  readonly catalog: SourceFile;
  readonly prompts: SourceFile;
  readonly unlocks: SourceFile;
  readonly blockedNames: SourceFile;
  readonly juice: SourceFile;
  readonly characters: readonly SourceFile[];
  readonly stages: readonly SourceFile[];
  readonly songs: readonly SourceFile[];
  readonly modes: readonly SourceFile[];
};

/** A parsed value that still remembers where it came from. */
export type Located<T> = { readonly file: string; readonly value: T };

/** The enabled, ordered, public set. Item files carry no second flag. */
export type CatalogSource = {
  readonly modes: readonly string[];
  readonly packs: readonly {
    readonly id: string;
    readonly title: string;
    readonly dlc: boolean;
    readonly stages: readonly string[];
    readonly songs: readonly string[];
    readonly characters: readonly string[];
  }[];
  /** Flattened from `packs`, in pack order: what every other pass reads. */
  readonly characters: readonly string[];
  readonly stages: readonly string[];
  readonly songs: readonly string[];
};

export type ParsedContent = {
  readonly tuning: Located<Readonly<Record<string, number>>>;
  readonly flow: Located<PresentationFlow>;
  readonly eventRouting: Located<PresentationRouting>;
  readonly catalog: Located<CatalogSource>;
  readonly unlocks: Located<readonly UnlockContent[]>;
  /** Words a typed name may not contain in a public room. */
  readonly blockedNames: Located<readonly string[]>;
  /** Racer juice (polish spec §4.1): presentation only. */
  readonly juice: Located<AuthoredJuice>;
  /** As authored, naming its stage; `buildPayload` resolves it. */
  readonly prompts: Located<AuthoredPrompts>;
  readonly characters: readonly Located<CharacterContent>[];
  readonly stages: readonly Located<StageContent>[];
  readonly songs: readonly Located<SongContent>[];
  readonly modes: readonly Located<ModeContent>[];
};

export type ParseResult =
  | { readonly ok: true; readonly parsed: ParsedContent }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
