# Copy style

How Floor Fifty talks to a player. Every word on screen, including an
`aria-label`, follows these rules.

## Voice

Plain, calm and direct. The game speaks to the player as "you", says what
happened and what they can do next, and does not joke, scold or apologise.

- **Say it in the game's terms.** A player never reads a protocol version, a
  bundle name, an action ID or a library's message. Server and transport
  wording is for logs; the client rewords every refusal by its code
  (`PLAYER_WORDS` in `managers/network/colyseus-network.ts`).
- **Every failure names a way forward**, in the message or in the panel's
  button ("Try again", "Reload the game").
- **No contractions:** "cannot", "could not", "you are".

## Form

| Kind | Case | Ends with | Example |
| --- | --- | --- | --- |
| Button, tab, label, title | Sentence case | Nothing | `Race again`, `Room code`, `Paused` |
| Message (status, error, hint in prose) | Sentence case | A full stop | `Room code copied.` |
| Compact hint on a single line | Sentence case | Nothing, with `·` between parts | `Drag to steer · flick down to fast fall · tap the timer to restart` |
| Pending state | Sentence case | `…` (one character, never `...`) | `Reconnecting…` |

- Write text in sentence case in the source. Where a design wants capitals
  (HUD labels, seat tags), CSS sets `text-transform: uppercase`, so screen
  readers read words rather than letters.
- A missing value is an em dash: `—`.
- Numbers in fixed prose are words ("Up to four players"); numbers the game
  computes or shows as data are digits (`Lap 2/3`, `01 / 50`).
- Proper names keep their capitals: Floor Fifty, SNEKPRTY, song titles.

## Words

Use the same word for the same thing everywhere.

| Use | Not |
| --- | --- |
| room, room code | lobby, session, match code |
| race, racer | match, game (for one race), player (in race copy) |
| host | owner, leader |
| fast fall (no hyphen) | fast-fall, drop, dive |
| restart | reset, respawn |
| full screen (two words) | fullscreen |
| floors | platforms |
| Leave room (in the ready room) / Leave race (during a race) | Quit, Exit |
| Return to menu | Main menu, Home |
