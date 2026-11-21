# Typefaces

Self-hosted rather than linked from a CDN. A game that loads its face from
`fonts.googleapis.com` shows fallback text whenever that request is slow or
blocked, and fallback text in a pixel-art menu is the one element that does not
look drawn. Hosting the files also keeps the client working offline, which is
how it is developed and how the end-to-end probe runs it.

The wordmark is Fraunces (its `latin` subset). Every menu is set in Fusion Pixel
(Owner, 2026-11-18), the 12 px proportional cut by TakWolf, in its JP, KR and SC
regional forms (languages spec §6.1). Fusion Pixel draws crisp only at whole
multiples of 12 px on the screen, so every UI size is a whole step (12, 24, 36, 48; `tests/client/features/i18n/typography.test.ts` fails otherwise). Each is cut by `pnpm fonts:subset` to the characters its locale's
catalogues use, plus ASCII, CJK punctuation and the full-width forms. A
browser fetches a face only when text uses it, so an English, Spanish or
Portuguese player never downloads a CJK byte, and a Japanese player
downloads only the JP subset. `tests/client/features/i18n/fonts.test.ts` fails if a
catalogue gains a character its subset lacks, so re-run the script after
editing a CJK translation. A typed name in characters outside the active
subset falls back to the system stack, which every supported OS fills.

The fonts are served as `woff2`, which every browser the client supports reads.

| File | Family | Axes / weights | Licence |
| --- | --- | --- | --- |
| `fraunces-latin-var.woff2` | Fraunces | `opsz` 9–144, `wght` 100–900, `SOFT` 0–100, `WONK` 0–1 | SIL Open Font License 1.1 |
| `ff-pixel-latin.woff2` | FF Pixel (Latin) | one weight, declared 400–800 | SIL Open Font License 1.1 |
| `ff-pixel-jp-subset.woff2` | FF Pixel JP | one weight, declared 400–800 | SIL Open Font License 1.1 |
| `ff-pixel-kr-subset.woff2` | FF Pixel KR | one weight, declared 400–800 | SIL Open Font License 1.1 |
| `ff-pixel-sc-subset.woff2` | FF Pixel SC | one weight, declared 400–800 | SIL Open Font License 1.1 |
| `ff-pixel-jp-endonym.woff2` | FF Pixel JP Endonym (日本語 only) | one weight, declared 400–800 | SIL Open Font License 1.1 |
| `ff-pixel-kr-endonym.woff2` | FF Pixel KR Endonym (한국어 only) | one weight, declared 400–800 | SIL Open Font License 1.1 |
| `ff-pixel-sc-endonym.woff2` | FF Pixel SC Endonym (简体中文 only) | one weight, declared 400–800 | SIL Open Font License 1.1 |

## Provenance

Recorded so the bytes can be re-fetched and checked. `sha256` is of the file as
committed.

| File | Source | Retrieved | SHA-256 |
| --- | --- | --- | --- |
| `fraunces-latin-var.woff2` | `fonts.gstatic.com/s/fraunces/v38/6NUV8FyLNQOQZAnv9ZwIlOkuy91B.woff2` | 2026-09-20 | `94bb7e04bb1a32237a67935c72526e42a3e52ee4aebd50299802b18a93114251` |
| `ff-pixel-latin.woff2` | cut from `fusion-pixel-12px-proportional-sc.woff2` | 2026-11-18 | `f66a1a1bc3f95934de4d14e3882218f78aa4f706726dab282c1061aa7658d2c8` |
| `ff-pixel-jp-subset.woff2` | cut from `fusion-pixel-12px-proportional-jp.woff2` | 2026-11-21 | `51e3dcb066e9e1c142541b805ca83e7fafcb776941723ff57094a1cd364c55d4` |
| `ff-pixel-kr-subset.woff2` | cut from `fusion-pixel-12px-proportional-kr.woff2` | 2026-11-21 | `3646bbec33761fe091cb3ceab24eda938310b2ac67aa09e73fb03b11a4806b40` |
| `ff-pixel-sc-subset.woff2` | cut from `fusion-pixel-12px-proportional-sc.woff2` | 2026-11-21 | `9fa79e890a52484ccc39d6b105f50b195cf563417f63db7b79fa53f90cba495f` |
| `ff-pixel-jp-endonym.woff2` | cut from the JP source | 2026-11-18 | `67dee2358d97f77073c785373a179f0d9ceabf80268d4c6cd91ab1732abeeeca` |
| `ff-pixel-kr-endonym.woff2` | cut from the KR source | 2026-11-18 | `1946f934fb455b4bf97379b0e037406a109f5056120aa2d9e3f6f5c09b1983f4` |
| `ff-pixel-sc-endonym.woff2` | cut from the SC source | 2026-11-18 | `987332d19e925abc468859bf2465b5c2ea144770b7fc68561aa022a7fa308fff` |

The FF Pixel files are cut, not downloaded. The OFL reserves the name "Fusion Pixel" and treats a subset as a Modified Version, so each cut carries our own name, "FF Pixel" (name table rewritten in `subset-fonts.ts`); the copyright notice, `OFL-FusionPixel.txt` and the credit to Fusion Pixel stay. Their sources, the 12 px
proportional files of `@fontsource/fusion-pixel-12px-proportional-{jp,kr,sc}`
5.3.0 (served by jsDelivr), are pinned by URL,
retrieval date and SHA-256 in `packages/asset-contract/fonts-src/sources.json`.
They are not committed (0.6 MB each): `pnpm fonts:subset` fetches a missing
one and refuses a hash that does not match. The subset hashes above change
whenever a CJK catalogue does; the script prints sizes, and this table is
updated with the files.

The `v38` and `v20` segments are Google Fonts' own revision of each family and
are what pins these bytes; a re-release of either family lands under a new
segment. The upstream families and their variable axes are documented at
<https://github.com/undercasetype/Fraunces>.

The Fraunces file is a variable font, so one file serves every display weight,
optical size and the `SOFT`/`WONK` axes the wordmark sets. Its `wght` default is
900; the wordmark overrides it, as it does the other axes.

## Licences

Every file is under the SIL Open Font License, Version 1.1, which permits
commercial use, embedding and redistribution. The full licence text for each face
is vendored beside it:

- `OFL-Fraunces.txt` — Fraunces, by Undercase Type (Phaedra Charles, Flavia Zimbardi).
- `OFL-FusionPixel.txt` — Fusion Pixel Font, by TakWolf (Reserved Font Name "Fusion Pixel").

**Fraunces** — <https://fonts.google.com/specimen/Fraunces>
**Fusion Pixel Font** — <https://github.com/TakWolf/fusion-pixel-font>

## Why these

Two faces for the game's own type, and only two (`tests/client/features/i18n/typography.test.ts`
holds the line). Fraunces carries the wordmark: an upright, broad-shouldered serif
whose variable axes let one file hold the whole display range. Fusion Pixel Font
carries everything else (controls, names, numerals, all UI text) because it is a
pixel face that has real glyphs for English, Japanese, Korean and Simplified
Chinese in one family, so the menus look the same in every language. Press Start 2P
and Silkscreen were removed on 2026-09-22 when nothing used them; Manrope and Noto
Sans CJK were replaced by Fusion Pixel in this change.

Sizes for the pixel faces are set in multiples of the design grid where
possible, because a pixel face rendered at a fractional size is resampled and
loses the crispness it was chosen for. Fusion Pixel is a 12 px design, so UI type steps in whole multiples of 12 px
(12, 24) wherever the layout allows it. Fraunces carries no such constraint.

## One face, both layers

The pixel faces serve the canvas as well as the page. The Pixi HUD sets type
through `Text` with `fontFamily: "Silkscreen"`, so a drawn readout and an HTML
label are the same face at the same size. The editorial faces are DOM-only: the
smooth HUD is an HTML overlay at CSS resolution, so its type never passes
through the renderer.

That replaced an earlier plan to draw the HUD from a generated glyph page —
"Arcade Chip 5x7", a bitmap font authored in this repository and rasterised into
the `ui.font` asset. It was built for a Pixi `BitmapText` path that was never
wired up: nothing installs a `BitmapFont`, and doing so would have been new
infrastructure for the result a webfont already gives. It is retired, and
`ui.font` is gone from the manifest. `git log` holds it.
