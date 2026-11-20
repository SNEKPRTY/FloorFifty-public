/**
 * A mode's course against its clock (race-options spec §3.1).
 *
 * The schema proves `course` is a known word. What it cannot see is the
 * resolved tuning, and the rule is a join of the two: an endless course has
 * no top to finish at, so it ends on its clock, and a finite course ends at
 * its top, so a clock on it would be a second way to end a race nobody wrote.
 *
 * The clock is the mode's alone. The room layers base → stage → mode, so a
 * stage that set `RACE_TIME_LIMIT_TICKS` would turn a finite mode endless on
 * that stage; a stage that sets it is refused outright (audit remediation B6).
 */

import { type Diagnostic, sortDiagnostics } from "../diagnostics";
import type { ParsedContent } from "../types";

export function validateModes(parsed: ParsedContent): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const base = parsed.tuning.value["RACE_TIME_LIMIT_TICKS"] ?? 0;

  for (const mode of parsed.modes) {
    const limit = mode.value.tuning.RACE_TIME_LIMIT_TICKS ?? base;
    const at = { code: "invalidMode" as const, file: mode.file, keyPath: "tuning.RACE_TIME_LIMIT_TICKS" };
    if (mode.value.course === "endless" && !(limit > 0)) {
      diagnostics.push({ ...at, message: "an endless mode ends on its clock, so it needs a positive RACE_TIME_LIMIT_TICKS" });
    }
    if (mode.value.course === "finite" && limit > 0) {
      diagnostics.push({ ...at, message: "a finite mode ends at its top floor and takes no RACE_TIME_LIMIT_TICKS" });
    }
    // Survival's host picks the clock (survival spec §5): an endless mode offers lengths, a finite one none.
    const clocksAt = { code: "invalidMode" as const, file: mode.file, keyPath: "clocks" };
    if (mode.value.course === "endless" && (mode.value.clocks === undefined || mode.value.clocks.length === 0)) {
      diagnostics.push({ ...clocksAt, message: "an endless mode offers clock lengths, so it needs clocks" });
    }
    if (mode.value.course === "finite" && mode.value.clocks !== undefined) {
      diagnostics.push({ ...clocksAt, message: "only an endless mode has a clock to choose" });
    }
  }

  for (const stage of parsed.stages) {
    if (stage.value.courseTuning["RACE_TIME_LIMIT_TICKS"] === undefined) continue;
    diagnostics.push({
      code: "invalidMode",
      file: stage.file,
      keyPath: "courseTuning.RACE_TIME_LIMIT_TICKS",
      message: "a race's clock is its mode's; a stage's courseTuning may not set RACE_TIME_LIMIT_TICKS",
    });
  }

  return sortDiagnostics(diagnostics);
}
