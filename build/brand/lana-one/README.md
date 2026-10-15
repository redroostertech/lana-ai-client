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
| `app-icon-light.svg` | App icon: dark mark on a white rounded tile. This is the LANA One app icon (`build/icons-lana-one/app-icon.svg`). |
| `app-icon-dark.svg` | App icon variant: light mark on a dark tile. |

Inks: dark `#111111`, light `#F5F5F4`.

## Which app shows it

The client ships in two products, and `lanaFlavor` decides which look it gets
(`src/js/brand/lana-brand.js`):

- `lana`: the LANA client. This is the default, and its pages keep the LANA AI
  look exactly as written.
- `lana-one`: the client inside LANA One. LANA One's `package.json` says
  `"lanaFlavor": "lana-one"`, and a packaged LANA One runs the client code
  with that file.

The value is stamped at build time in `package.json` (`bundle-electron.js`
copies it into `electron-dist/package.json`). When the app is not packaged,
`LANA_FLAVOR=lana-one npm run electron:dev` overrides it. A packaged app
ignores the variable.

In `lana-one`, the preload rebrands each page as it is parsed:
- `img/logo-{light,dark}.png` becomes `img/lana-one/logo-{light,dark}.png`.
  Those are the wordmark, padded so the pages' existing 28px and 48px heights
  keep about the old footprint.
- Titles say LANA One.
- The embed and doc-studio favicon becomes the mark.
- The legacy page loader shows the mark on `#111111`.

`lex-loader` draws the animated mark itself, and the screen-voice overlay
switches to `lana-one-mark-light.svg`. The app icons are in
`build/icons-lana-one`, and LANA One's electron-builder config points at them.
The Dock icon in development follows the flavor.

To regenerate the icon set: render a 1024px master to
`build/icons-lana-one/icon.png`, then run the client's icon generator with
the output directory set to `build/icons-lana-one`.
