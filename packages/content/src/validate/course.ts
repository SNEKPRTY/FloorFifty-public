/**
 * Authored course validation.
 *
 * The stage schema proves a `[course]` table is well-formed on its own: four
 * phrases, named once each, in order, each with a purpose and a sane range.
 * What it cannot see is how many floors the course actually has, because that
 * comes from the resolved tuning layer above it.
 *
 * This pass is that join. It asks one question -- do the phrases account for
 * every generated floor, exactly once -- and the reason it is worth asking is
 * that the answer is how a reviewer knows the course review is complete. A
 * phrase list with a hole in it describes a climb nobody wrote down, and a
 * phrase list that overlaps describes two intentions for one floor.
 *
 * Floor zero never appears. It is the fixed starting seat every race begins
 * on, not something the course teaches.
 */

import { resolveTuning, type ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { type Diagnostic, sortDiagnostics } from "../diagnostics";
import type { ParsedContent } from "../types";

/**
 * The top floor index of a stage's climb, or nothing.
 *
 * `resolveTuning` throws on an out-of-range override, and this pass runs
 * beside `validateBounds`, which is the pass that owns that failure and
 * reports it against the line the author wrote. Swallowing it here is what
 * keeps a single bad `GRAVITY` reading as one diagnostic about gravity rather
 * than as a crash from the course checker, which knows nothing about it.
 */
function highestFloor(
  base: Partial<ResolvedTuning>,
  overrides: Partial<ResolvedTuning>,
): number | undefined {
  try {
    return resolveTuning({ ...base, ...overrides }).COURSE_FLOOR_COUNT - 1;
  } catch {
    return undefined;
  }
}

export function validateCourses(parsed: ParsedContent): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const base = parsed.tuning.value as Partial<ResolvedTuning>;

  for (const stage of parsed.stages) {
    const course = stage.value.course;
    if (course === undefined) continue;

    // The stage's own overrides sit above the base layer, so a stage that
    // lengthens its climb is measured against the climb it actually has.
    const highest = highestFloor(base, stage.value.courseTuning);
    if (highest === undefined) continue;

    const owner = new Map<number, string>();
    for (const phrase of course.phrases) {
      for (let floor = phrase.fromFloor; floor <= phrase.toFloor; floor += 1) {
        const existing = owner.get(floor);
        if (existing !== undefined) {
          diagnostics.push({
            code: "invalidCourse",
            file: stage.file,
            keyPath: `course.phrases.${phrase.name}`,
            message: `floor ${floor} is already claimed by the ${existing} phrase`,
          });
          continue;
        }
        owner.set(floor, phrase.name);

        if (floor > highest)
          diagnostics.push({
            code: "invalidCourse",
            file: stage.file,
            keyPath: `course.phrases.${phrase.name}`,
            message: `floor ${floor} is past the top of the course, which ends at ${highest}`,
          });
      }
    }

    const missing: number[] = [];
    for (let floor = 1; floor <= highest; floor += 1) {
      if (!owner.has(floor)) missing.push(floor);
    }
    if (missing.length > 0)
      diagnostics.push({
        code: "invalidCourse",
        file: stage.file,
        keyPath: "course.phrases",
        message:
          `no phrase accounts for floor${missing.length > 1 ? "s" : ""} ` +
          `${missing.join(", ")}; every floor a player climbs needs a recorded purpose`,
      });

    // The extension (race-options spec §4): floors above the stage's own top,
    // up to the tallest finite mode's, each accounted for exactly once.
    const tallest = tallestFiniteFloor(base, stage.value.courseTuning, parsed.modes) ?? highest;
    const claimed = new Set<number>();
    for (const [index, entry] of (course.extension ?? []).entries()) {
      const keyPath = `course.extension.${index}`;
      for (let floor = entry.fromFloor; floor <= entry.toFloor; floor += 1) {
        if (claimed.has(floor) || floor <= highest) {
          diagnostics.push({ code: "invalidCourse", file: stage.file, keyPath, message: `floor ${floor} is already accounted for` });
          continue;
        }
        if (floor > tallest) {
          diagnostics.push({
            code: "invalidCourse",
            file: stage.file,
            keyPath,
            message: `floor ${floor} is past the tallest finite course, which ends at ${tallest}`,
          });
          continue;
        }
        claimed.add(floor);
      }
    }
    const unclaimed: number[] = [];
    for (let floor = highest + 1; floor <= tallest; floor += 1) if (!claimed.has(floor)) unclaimed.push(floor);
    if (unclaimed.length > 0)
      diagnostics.push({
        code: "invalidCourse",
        file: stage.file,
        keyPath: "course.extension",
        message: `no phrase accounts for floors ${describeRanges(unclaimed)}; a mode climbs them, so they need a recorded purpose`,
      });
  }

  return sortDiagnostics(diagnostics);
}

/** The top floor of the tallest finite mode on this stage, or nothing when no finite mode resolves. */
function tallestFiniteFloor(
  base: Partial<ResolvedTuning>,
  overrides: Partial<ResolvedTuning>,
  modes: ParsedContent["modes"],
): number | undefined {
  const tops = modes
    .filter((mode) => mode.value.course === "finite")
    .map((mode) => highestFloor(base, { ...overrides, ...mode.value.tuning }))
    .filter((top): top is number => top !== undefined);
  return tops.length === 0 ? undefined : Math.max(...tops);
}

/** `[20, 21, …, 49]` as `20–49`; gaps make a comma-separated list. */
function describeRanges(floors: readonly number[]): string {
  const parts: string[] = [];
  let start = floors[0]!;
  for (let i = 1; i <= floors.length; i += 1) {
    if (floors[i] !== floors[i - 1]! + 1) {
      parts.push(start === floors[i - 1] ? String(start) : `${start}–${floors[i - 1]}`);
      start = floors[i]!;
    }
  }
  return parts.join(", ");
}
