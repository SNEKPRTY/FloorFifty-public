import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "./support/test";
import { SCREENS_OUT, expectedScreens, missingOf, partsOf, readNotes, screensTaken, selectedViews, walkLocale } from "./support/screens-walk";

/**
 * What the screens walk left (`screens-walk.spec.ts`): the Playwright
 * project's teardown, so it runs after every walk test, passed or failed.
 *
 * It fails when a screen a view needs is missing, or a part of a view's walk
 * never ran, because the visual audit does not begin until every view is
 * whole. Screens a view may legitimately lack (a card shown only the first
 * time, a region that did not need scrolling) are listed and do not fail it.
 *
 * It writes `evidence/screens/<locale>/_missing.json` (`<view>/<nn>-<screen>`,
 * `<view>/<nn>-<screen>: blank canvas` or `<view>: the <part> part never finished`
 * for each gap, an empty list when whole), `_summary.md`, and the same text to the job
 * summary when there is one: per view, how many of the screens it has, what is
 * missing, and what each part of the walk could not do.
 */

test("every view has every screen it needs", () => {
  const lines: string[] = [`# Screens walk, in ${walkLocale()}`, ""];
  const missing: string[] = [];
  let taken = 0;
  let total = 0;

  const views = selectedViews();
  lines.push(`${views.length} view(s) walked.`, "", "| view | screens | missing | optional, absent |", "| --- | --- | --- | --- |");
  const details: string[] = [];
  for (const view of views) {
    const { required, optional } = expectedScreens(view);
    const have = screensTaken(view);
    const lacking = required.filter((screen) => !have.has(screen));
    const optionalLacking = optional.filter((screen) => !have.has(screen));
    const notes = readNotes(view);
    const partsNotRun = partsOf(view).filter((part) => notes[part] === undefined);

    taken += required.length - lacking.length;
    total += required.length;
    missing.push(...missingOf(view));

    lines.push(`| ${view.key} | ${required.length - lacking.length}/${required.length} | ${lacking.join(", ") || "none"} | ${optionalLacking.join(", ") || "none"} |`);
    const said = Object.entries(notes).flatMap(([part, notesOfPart]) => notesOfPart.map((note) => `- ${part}: ${note}`));
    if (said.length > 0 || partsNotRun.length > 0) {
      details.push(`### ${view.key}`, "", ...said, ...partsNotRun.map((part) => `- ${part}: never finished`), "");
    }
  }
  lines.push("", `${taken} of ${total} required screens taken.`, "");
  if (details.length > 0) lines.push("## What the walk could not do", "", ...details);

  const summary = `${lines.join("\n")}\n`;
  mkdirSync(SCREENS_OUT, { recursive: true });
  writeFileSync(resolve(SCREENS_OUT, "_summary.md"), summary);
  writeFileSync(resolve(SCREENS_OUT, "_missing.json"), `${JSON.stringify(missing, null, 2)}\n`);
  const jobSummary = process.env["GITHUB_STEP_SUMMARY"];
  if (jobSummary !== undefined && jobSummary !== "") appendFileSync(jobSummary, summary);

  expect(missing, "screens the walk did not take").toEqual([]);
});
