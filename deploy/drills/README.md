# Failure drills

Release readiness §12.2. These are run by hand against **staging**, never production, before the MVP release gate.

Every drill ends with the same check, `deploy/drills/check.sh`:
- `/ready` is true;
- the live room count goes back to 0 once the bots stop;
- a fresh room races.

No step may be manual. Results go in `docs/release-review.md`.

`FF_API` is the staging API, `FF_ORIGIN` the staging client's origin, and `ssh staging` the admin login (`docs/release.md`).

| Drill | Script | Pass |
| --- | --- | --- |
| Kill the live colour mid-race, with 2 real clients and 20 bot rooms | `kill-mid-race.sh` | The clients show "disconnected too long" when the grace window ends, never a frozen race. systemd restarts the colour in under 10 s |
| `tc netem` delay of 500, 1000 and 2000 ms (±30%) and 2% loss | `netem.sh <delay-ms>` | At 500 ms the race is playable. At 1000 and 2000 ms the indicator reads degraded, and the race never desyncs or freezes. Results agree on every client |
| `activate` under 20 bot rooms | `activate-under-load.sh` | Racing rooms finish on the old colour, lobbies hear `SERVER_UPDATING` and recreate on the new one, and no bot is stuck |
| 17 sockets from one address; fill to `MAX_ROOMS` + 1 | `socket-cap.sh` | The 17th socket is refused and the other 16 are unaffected. The extra room gets `SERVER_BUSY` |
| 60-minute soak of bot create → race → leave | `soak.sh` | Server RSS stays within 10% after the first 10 minutes. Rooms and sockets return to 0 between waves |
| Stop the process and leave it stopped | `stopped.sh` | Caddy answers 502. The client shows "cannot start" with Try again, and recovers when the process returns |
| Rebuild staging from nothing | `docs/release.md` › "Rebuild the staging VM from nothing" | The box serves the current build from `deploy/` and the runbook alone |
| The anti-vibe exploit rows (appendix B) | `pnpm exec vite-node deploy/drills/exploits.ts -- --url $FF_API --origin $FF_ORIGIN` | Each row ends with the room healthy and the other seats unaffected |
