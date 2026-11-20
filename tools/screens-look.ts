// `pnpm screens:look`: photographs the screens a draft pull request asked for in
// tests/e2e/look.json (the gate's `screens` job). `--verify <folder>` checks a
// downloaded piece folder (shots.ts fetch) against the list instead. Usage:
//   pnpm screens:look [--look <file>]        (FF_WALK_PIECE=<n>/<of> walks one piece;
//                                             FF_LOOK_PICK is the gate's pick of screens and sizes)
//   pnpm screens:look --verify <folder> [--look <file>]
import { execFileSync, spawn } from "node:child_process";
import { EVIDENCE_ROOT } from "../tests/e2e/support/evidence";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LOOK_FILE, PICK_FILE, loadLook, pickFromEnv, pieceOf, runLook, verify, type Walk } from "./screens-look/look";

const args = process.argv.slice(2);
const after = (flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const folder = after("--verify");
// The gate's pick (FF_LOOK_PICK); a downloaded folder keeps the one its walk used.
const kept = folder === undefined ? undefined : resolve(folder, PICK_FILE);
const pick = pickFromEnv(kept !== undefined && existsSync(kept) ? readFileSync(kept, "utf8") : process.env["FF_LOOK_PICK"]);
const look = loadLook(after("--look") ?? LOOK_FILE, pick);

if (folder !== undefined) {
  const problems = verify(look, folder);
  for (const problem of problems) console.log(problem);
  console.log(problems.length === 0 ? `${folder} matches the look list` : `${problems.length} problem(s) in ${folder}`);
  process.exitCode = problems.length === 0 ? 0 : 1;
} else {
  // The gate's screens job walks one piece of the look on each GPU pod (FF_WALK_PIECE).
  const share = pieceOf(look, process.env["FF_WALK_PIECE"]);
  // Playwright starts a server and browsers, so the whole process group is stopped, and killed if it is still there at the end.
  let killGroup: () => void = () => undefined;
  const walk = ({ env, signal }: Walk): Promise<number> =>
    new Promise((done) => {
      const child = spawn("pnpm", ["exec", "playwright", "test", "--project=screens-walk", `--workers=${process.env["FF_WORKERS"] ?? "4"}`, "--retries=0"], {
        stdio: "inherit",
        detached: true,
        env: { ...process.env, ...env },
      });
      const stop = (how: NodeJS.Signals): void => {
        try {
          process.kill(-child.pid!, how);
        } catch {
          // The group is already gone.
        }
      };
      killGroup = () => stop("SIGKILL");
      signal.addEventListener("abort", () => stop("SIGTERM"));
      child.on("close", (code) => done(code ?? 1));
    });
  process.exitCode = await runLook({
    look: share,
    root: `${EVIDENCE_ROOT}/screens`,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    now: () => Date.now(),
    wait: (ms) => new Promise((done) => setTimeout(done, ms).unref()),
    walk,
    log: (line) => console.log(line),
    summaryFile: process.env["GITHUB_STEP_SUMMARY"],
  });
  killGroup();
}
