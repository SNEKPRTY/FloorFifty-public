# Icons

The browser tab, home-screen and web-manifest icons, derived from the supplied
icon art committed at `packages/asset-contract/assets/source/icon.png`
(1250 x 1250; `icon-sm.png` beside it is the same art at its native pixel size).

Served from `public/` rather than through the art manifest: the page head and
the web manifest address them by a fixed path before any script runs, and
nothing the renderer loads reaches them.

Regenerate with macOS `sips` after replacing the source:

```bash
for n in 32 180 192 512; do
  sips -z $n $n packages/asset-contract/assets/source/icon.png \
    --out apps/client/public/icons/icon-$n.png
done
```

| File | Used by |
| --- | --- |
| `icon-32.png` | Browser tab favicon |
| `icon-180.png` | iOS Add to Home Screen (`apple-touch-icon`) |
| `icon-192.png` | Android home screen, web manifest |
| `icon-512.png` | Web manifest (install splash, store listings) |
