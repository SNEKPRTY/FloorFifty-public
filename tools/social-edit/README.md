# "Every screen is a race" — the 13-second vertical trailer

Spec: the project's internal notes
Plan: the project's internal notes

Deliverable: `docs/media/social/floor-fifty-every-screen.mp4` — 1080×1920, 30 fps,
H.264 + AAC, 13.33 s, cut to `TrailerTheme.wav`.

## Running it

```bash
pnpm install
pnpm assets:sync                                  # once per worktree
cp <TrailerTheme.wav> .                            # supplied master; gitignored

pnpm e2e:serve                                     # background: one shared run
pnpm exec vite-node tools/social-edit/capture.ts   # 5 races x 4 POVs -> evidence/social-2026-10-05/raw

node tools/social-edit/render.mjs                  # accent layer -> accent/accent.mov
node tools/social-edit/cut.mjs                     # gameplay cut -> cut.mp4 (400 frames)
node tools/social-edit/assemble.mjs                # -> docs/media/social/floor-fifty-every-screen.mp4

node tools/social-edit/verify.mjs                  # shape, loudness, no-app-changes, contact sheet
node tools/social-edit/playback-check.mjs          # loads, seeks, plays in a browser
```

The three data files are `plan.json` (races), `timeline.json` (the beat map) and
`shots.json` (the cut). Everything else is code. To retime a card or move a shot,
edit the data and re-run `render` → `cut` → `assemble`; the shoot is not repeated.

## Things that will bite you

- **`NODE_ENV=production` in the shell stops the e2e server dead.** It refuses to
  start with the test driver token set in production (`process-safety.ts`).
  Run the shoot with `env -u NODE_ENV`.
- **`?dev=` flags do nothing in the e2e client.** It is a production build, so
  `dev = import.meta.env.DEV` is false. The `friends` pack (kitsune, robo) is
  granted by seeding `floor-fifty.entitlements.v1` in the context, and progress
  by seeding `floor-fifty.progress.v1` — the same way the previous campaign did.
- **Ports come from the checkout path** (`playwright.config.ts` hashes the
  directory): server `4400 + slot`, client `4500 + slot`. `capture.ts` imports
  the config to publish them, so never hard-code one.
- **Capture the way `race-recorder.ts` does**: copy each rendered frame into a 2D
  canvas and capture that. A stream on the WebGL canvas is tied to compositor
  presentation — measured 34.6 fps drawn, 9.6 fps recorded.
- **Park the idle clients.** Four pages share one browser and only the frontmost
  is unthrottled; each filmed page is brought to the front first.
- **The cut's segments are whole frames.** The concat demuxer cannot split a
  frame, so rounded segments drift — half a second of drift is enough to put the
  graphics out of step with the picture. The cut and the accent layer are both
  exactly 400 frames.
- **`ffmpeg` eats a heredoc's stdin.** Pass `-nostdin` in any read loop.

## What this does not do

Capture is best-effort, not a fixed rate: this machine renders the game at
17–60 fps under capture, so takes are 12–30 fps and the cut conforms them to 30.
Nothing under `apps/` or `packages/` is touched.
