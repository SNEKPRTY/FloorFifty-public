# Floor Fifty in six languages

How the game's words are translated, reviewed and shipped. The design is the
languages spec.

## The six

| Tag | Language | Endonym in the picker |
| --- | --- | --- |
| `en` | English, the source | English |
| `ja` | Japanese | 日本語 |
| `ko` | Korean | 한국어 |
| `es-419` | Spanish, neutral Latin American | Español |
| `pt-BR` | Portuguese, Brazilian | Português (Brasil) |
| `zh-Hans` | Chinese, Simplified (Traditional readers land here too) | 简体中文 |

**Stays English in every language:** the Floor Fifty wordmark, song titles and
artists, the announcer's recorded voice, and the on-stage words that match it
("GO!", "GAME!"). The studio name SNEKPRTY and key legends (A, D, S, R, Esc)
are not translated either. Everything else is.

## Where the words live

- `apps/client/messages/ui/<tag>.json`: the interface.
- `apps/client/messages/content/<tag>.json`: stage, character and pack names,
  unlock hints, tutorial prompts. The English file is generated from
  `content/*.toml` by `pnpm content:build`; never edit it by hand.
- `apps/client/messages/context.json`: for every key, a `note` saying where it
  appears and what it means, an optional `maxChars`, and an optional
  `screenshot` under `docs/i18n/screens/`.
- `apps/client/messages/review/<tag>.json`: the review state (below).

## Rules for a translation

- **Keep every placeholder exactly:** `{name}`, `{seconds}`, `{clock}` and the
  rest are filled in by the game. `{glyph}` in a tutorial prompt is where the
  controller's button picture goes; keep it once, anywhere in the sentence.
- **Keep markup around the same words:** `{#strong}Race continues{/strong}`
  marks the bold part; move it with the words it belongs to.
- **Plurals** are lists of variants keyed by the language's plural categories
  (`one`, `few`, `other`… as `Intl.PluralRules` names them); `*` covers every
  category. Japanese, Korean and Chinese need only `*`.
- **`maxChars`** is the most that fits where the string is drawn. A longer
  string fails the parity check.
- **No gender.** The game never knows a player's gender, so no message may
  depend on it. Prefer neutral forms ("Ganó: Ana", not "Ana es la ganadora").
- **Typed names stay as typed.** `{name}` is whatever the player wrote.

## The workflow

1. **Draft.** `pnpm i18n:draft <tag>` lists the keys a language lacks. The
   machine draft is written from that list, key by key, against each key's
   context note. No translation API is called at build time.
2. **Check.** `pnpm i18n:check` holds every language that has a catalogue to
   parity with English: every key, the same placeholders, full plurals,
   `maxChars`. It runs in `pnpm test` as `tests/client/i18n/catalogue.test.ts`.
3. **Fonts.** After any Japanese, Korean or Chinese change, run
   `pnpm fonts:subset`, or the coverage test fails.
4. **Export.** `pnpm i18n:export <tag>` writes `docs/i18n/review/<tag>.csv`,
   with the columns `key, en, translation, note, maxChars, screenshot,
   approved`. Send it, with `docs/i18n/screens/<tag>/`, to the reviewer.
5. **Review.** The reviewer corrects the `translation` column and marks
   `approved` (`yes`, `y`, `x`, `1` or `true`) on each string they sign off.
   A plural's translation cell is its variant list as JSON; keep the shape.
6. **Import.** `pnpm i18n:import <tag> <file.csv> --reviewer <name>` applies
   the corrections, records each approved string, and appends the date,
   language, reviewer and count to `docs/i18n/reviews.md`.
7. **Release.** `pnpm i18n:check --release` also refuses a missing language and
   any unreviewed string. Development and e2e builds show drafts freely; only
   the release waits on reviewers.

**A review lapses by itself.** The review state for a key is
`sha256(english + "\u0000" + translation)`. Change either text and the string
is unreviewed again, with no flag to clear by hand.

## Register

| Language | Sentences (hints, errors, tutorial) | Buttons, tabs and labels |
| --- | --- | --- |
| JA | です／ます | plain nouns or dictionary-form verbs (プレイ, 設定) |
| KO | 해요체 | nouns (설정, 나가기) |
| ES-419 | tú; neutral Latin American: no vosotros, no voseo, no words only one country uses | infinitives (Jugar, Salir) |
| PT-BR | você | infinitives (Jogar, Sair) |
| ZH-Hans | concise, plain | short verbs or nouns; no 您 on a button |

The game is an arcade racer: friendly and quick, never formal or cute.

## Glossary

One term per idea, in every string of a language. A term the game shows on a
HUD or button must match wherever a sentence names it (the tutorial says
"until the Floors counter is full": use the HUD's own word for Floors).

| Idea (EN) | JA | KO | ES-419 | PT-BR | ZH-Hans |
| --- | --- | --- | --- | --- | --- |
| floor (a platform to land on; also the HUD counter "Floors") | フロア | 층 | piso / Pisos | andar / Andares | 楼层 |
| lap | 周 (HUD: 周回) | 바퀴 | vuelta | volta | 圈 |
| fast fall | 急降下 | 급강하 | caer rápido | cair rápido | 急降 |
| restart (the climb) | リスタート | 다시 시작 | reiniciar | reiniciar | 重新开始 |
| room / room code | ルーム / ルームコード | 방 / 방 코드 | sala / código de sala | sala / código da sala | 房间 / 房间码 |
| host | ホスト | 방장 | anfitrión | anfitrião | 房主 |
| ready / not ready | 準備OK / 準備取り消し | 준비 완료 / 준비 취소 | Listo / Cancelar | Pronto / Cancelar | 准备 / 取消准备 |
| lock in | 決定 | 확정 | confirmar | confirmar | 确定 |
| stage / song / character | ステージ / 曲 / キャラクター | 스테이지 / 곡 / 캐릭터 | escenario / canción / personaje | fase / música / personagem | 关卡 / 歌曲 / 角色 |
| pack / DLC | パック / DLC | 팩 / DLC | paquete / DLC | pacote / DLC | 包 / DLC |
| unlock / locked | アンロック / ロック中 | 잠금 해제 / 잠김 | desbloquear / bloqueado | desbloquear / bloqueado | 解锁 / 未解锁 |
| tutorial | チュートリアル | 튜토리얼 | tutorial | tutorial | 教程 |
| Find a race | レースを探す | 레이스 찾기 | Buscar carrera | Procurar corrida | 寻找比赛 |
| Race alone | ひとりでレース | 혼자 레이스 | Carrera individual | Corrida individual | 独自比赛 |
| Settings / Controls | 設定 / 操作 | 설정 / 조작 | Configuración / Controles | Configurações / Controles | 设置 / 操作 |
| Mute | ミュート | 음소거 | Silenciar | Silenciar | 静音 |
| Graphics quality | 画質 | 그래픽 품질 | Calidad gráfica | Qualidade gráfica | 画质 |
| LCD panel effect | 液晶パネル効果 | LCD 화면 효과 | Efecto de pantalla LCD | Efeito de tela LCD | 液晶屏效果 |

## For the reviewers: questions the drafts leave open

- **ES / PT "ready":** a racer's state and the Ready button read *Listo* /
  *Pronto*, which are grammatically masculine. Games use them widely as a
  state word, but if your style guide wants a neutral form, change both
  `ready_ready` and the glossary row.
- **Character names:** *Buzo* / *Mergulhador* (Diver) are masculine nouns.
  They name a character, not the player; keep or change as reads best.
- **"GO" vs the spoken "Go":** the on-stage GO! word stays English (it
  matches the recorded voice). `race_go` is only what a screen reader says at
  the start; it is translated.
