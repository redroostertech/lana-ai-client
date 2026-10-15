# LANA One brand kit

Vector sources for the LANA One wordmark ("LANA | 1") and mark (two corner
brackets and a 1). They were redrawn as exact polygons from the approved
artwork (`source-wordmark.png`, `source-icon.png`, 2026-10-15). `build.py`
holds the measured shapes and regenerates every file below. It needs Python 3
with Pillow: `python3 build.py <out-dir>`.

| File | Use |
|---|---|
| `lana-one-wordmark-dark.svg` | Wordmark, dark ink. Use on light backgrounds. |
| `lana-one-wordmark-light.svg` | Wordmark, light ink. Use on dark backgrounds. |
| `lana-one-mark-dark.svg` / `-light.svg` | Mark only, for small or square spaces. |
| `favicon.svg` | Mark that switches ink with `prefers-color-scheme`. |
| `app-icon-light.svg` | App icon: dark mark on a white rounded tile. This is the shipped icon (`build/icons/app-icon.svg`). |
| `app-icon-dark.svg` | App icon variant: light mark on a dark tile. |

Inks: dark `#111111`, light `#F5F5F4`.

Where each one is used in the client:
- Wordmark: `src/img/logo-dark.png` (light sign-in and onboarding pages, the release email) and `src/img/logo-light.png` (the dark sidebar). Both PNGs carry transparent padding above and below. A 28px-tall sidebar logo is therefore about 116px wide, and the pages' existing heights still fit.
- Mark: the loading screen (`lex-loader.js`, drawn inline and animated, its ink following the loader theme), the favicons of `embed.html` and `doc-studio/index.html`, the screen-voice overlay, and the app icon.

To change the app icon: render the new master to `build/icons/icon.png` (1024px), then run `npm run generate:app-icons`.
