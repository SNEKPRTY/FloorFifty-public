/**
 * Authoring diagnostics.
 *
 * Every refusal in this package is one of these: a stable code, the
 * repository-relative file an author has to open, the dotted key inside it,
 * and a message that says what to write instead. Nothing here throws -- the
 * compiler collects independent failures so one save reports all of them.
 */

import type { ContentResultCode } from "@floor-fifty/shared/content/game-content";

export type Diagnostic = {
  readonly code: ContentResultCode;
  readonly file: string;
  readonly keyPath: string;
  readonly message: string;
};

export const formatDiagnostic = (d: Diagnostic): string =>
  `${d.file}: ${d.keyPath}: ${d.code}: ${d.message}`;

/**
 * The one ordering every pass uses.
 *
 * Diagnostics are accumulated by several independent validators, so without a
 * single comparator the same broken file would report its problems in a
 * different order on different runs.
 */
export const compareDiagnostics = (a: Diagnostic, b: Diagnostic): number =>
  a.file.localeCompare(b.file) ||
  a.keyPath.localeCompare(b.keyPath) ||
  a.code.localeCompare(b.code);

export const sortDiagnostics = (diagnostics: readonly Diagnostic[]): Diagnostic[] =>
  [...diagnostics].sort(compareDiagnostics);
