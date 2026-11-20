# Strings changed by the production audit's fixes: November 14, 2026

Status: **drafted, nothing approved.** Every string here needs the Owner's approval in all six languages before the release check (`pnpm i18n:check --release`) passes, as any changed string does (finish-for-launch spec, question 2). Approving is the same few minutes as the launch packet ([launch-2026-11-14.md](launch-2026-11-14.md)): open each language's sheet (`pnpm i18n:export <tag>` regenerates it), write `yes` in the `approved` column on the rows named here and on no others, then `pnpm i18n:import <tag> <file.csv> --reviewer "owner (mcthaydt)"`.

The English words are the coordinator's and the Owner's to settle; the translations are machine drafts in the languages' registers (`docs/i18n/README.md`).

## Awaiting approval

| Key | English | Where | Status |
| --- | --- | --- | --- |
| `idle_warning_line` | Nobody's playing. This room closes in 1 minute. | A banner, a minute before the server closes a room nobody has used for ten minutes (audit B1). | **English approved by the Owner ("B. Shorter"); translations awaiting approval** |
| `idle_warning_keep` | Keep it open | The button on that banner. | **English approved by the Owner ("B. Shorter"); translations awaiting approval** |

The drafts, so a reader of one language can check them:

| Language | `idle_warning_line` | `idle_warning_keep` |
| --- | --- | --- |
| ja | 誰もプレイしていません。このルームはあと1分で閉じます。 | 開いたままにする |
| ko | 아무도 플레이하지 않아요. 이 방이 1분 뒤에 닫혀요. | 열어 두기 |
| es-419 | Nadie está jugando. Esta sala se cerrará en 1 minuto. | Mantenerla abierta |
| pt-BR | Ninguém está jogando. Esta sala fecha em 1 minuto. | Manter aberta |
| zh-Hans | 没人在玩。这个房间将在1分钟后关闭。 | 保持开启 |

## Still to come, once the Owner's words arrive

Planned in the audit's order and sent to the Owner as one batch (S7, S15, S18, S19, S21): the "could not reach the game server" line, the boot-failure body, the Survival tutorial end card, the default mode's visible name and its translated badge, and the copy-style fixes (contractions, "Fullscreen" to "Full screen", "platform" and "match" and "games" for floor and race, "Save a replay", "DNS", "Replay unavailable"). None is written yet; each will be added here as it is.
