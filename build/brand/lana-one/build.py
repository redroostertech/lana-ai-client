"""Build the LANA One brand kit from measured polygons.

Coordinates are in the source images' pixel space, measured from the two
approved PNGs (wordmark 1448x1086, icon 1254x1254). Every output, SVG and PNG,
comes from these polygons, so light and dark variants are identical in shape.
"""
import os
import sys
from PIL import Image, ImageDraw

OUT = sys.argv[1]
DARK_INK = '#111111'
LIGHT_INK = '#F5F5F4'

# Wordmark "LANA | 1": cap height y 474..628.
A1 = [(368, 628), (453, 474), (478, 474), (562, 628), (528, 628), (465, 514), (402, 628)]
WORDMARK = [
    [(201, 474), (232, 474), (232, 599), (333, 599), (333, 628), (201, 628)],          # L
    A1,                                                                                 # A (no crossbar)
    [(611, 628), (611, 474), (638, 474), (743, 582), (743, 474), (773, 474),
     (773, 628), (746, 628), (641, 520), (641, 628)],                                   # N
    [(x + 454, y) for x, y in A1],                                                      # A
    [(1082, 449), (1093, 449), (1093, 648), (1082, 648)],                               # divider
    [(1167, 494), (1217, 469), (1247, 469), (1247, 628), (1208, 628), (1208, 505), (1167, 526)],  # 1
]
WORDMARK_BOX = (201, 449, 1247, 648)

# Icon: two corner brackets (the second is the first turned 180 degrees) and a 1.
TL = [(358, 384), (731, 384), (731, 474), (450, 474), (450, 767), (358, 767)]
MARK = [
    TL,
    [(1255 - x, 1303 - y) for x, y in TL],
    [(550, 578), (624, 537), (661, 537), (661, 780), (602, 780), (602, 600), (550, 627)],
]
MARK_BOX = (358, 384, 897, 919)


def square(box):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    s = max(w, h)
    return (x0 - (s - w) / 2, y0 - (s - h) / 2, s, s)


def svg(polys, view, fill, extra_style=''):
    x, y, w, h = view
    paths = ''.join(
        '<path d="M' + ' L'.join(f'{px:g},{py:g}' for px, py in p) + 'Z"/>' for p in polys)
    style = f'<style>{extra_style}</style>' if extra_style else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x:g} {y:g} {w:g} {h:g}">'
            f'{style}<g fill="{fill}">{paths}</g></svg>\n')


def write(name, text):
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(text)


def raster(polys, view, size, fill, pad=0.0, bg=None, tile=None, scale=4):
    """Draw polys into a size=(w,h) PNG; view is the source box fit with pad (fraction)."""
    W, H = size[0] * scale, size[1] * scale
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0) if bg is None else bg)
    d = ImageDraw.Draw(img)
    if tile:
        inset, radius, tfill = tile
        edge = '#E4E4E2' if tfill.upper() == '#FFFFFF' else None   # faint edge so a white tile holds its shape on white
        d.rounded_rectangle([inset * scale, inset * scale, W - inset * scale - 1, H - inset * scale - 1],
                            radius=radius * scale, fill=tfill, outline=edge,
                            width=max(1, round(W / 256)) if edge else 0)
        avail = (W - 2 * inset * scale, H - 2 * inset * scale)
        origin = (inset * scale, inset * scale)
    else:
        avail, origin = (W, H), (0, 0)
    vx, vy, vw, vh = view
    k = min(avail[0] * (1 - 2 * pad) / vw, avail[1] * (1 - 2 * pad) / vh)
    ox = origin[0] + (avail[0] - vw * k) / 2 - vx * k
    oy = origin[1] + (avail[1] - vh * k) / 2 - vy * k
    for p in polys:
        d.polygon([(ox + px * k, oy + py * k) for px, py in p], fill=fill)
    return img.resize(size, Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
wm_view = (WORDMARK_BOX[0], WORDMARK_BOX[1], WORDMARK_BOX[2] - WORDMARK_BOX[0], WORDMARK_BOX[3] - WORDMARK_BOX[1])
mk_view = square(MARK_BOX)

# Vector logos. "dark" = dark ink for light backgrounds; "light" = light ink for dark backgrounds.
write('lana-one-wordmark-dark.svg', svg(WORDMARK, wm_view, DARK_INK))
write('lana-one-wordmark-light.svg', svg(WORDMARK, wm_view, LIGHT_INK))
write('lana-one-mark-dark.svg', svg(MARK, mk_view, DARK_INK))
write('lana-one-mark-light.svg', svg(MARK, mk_view, LIGHT_INK))
# Favicon that follows the browser/OS theme by itself.
write('favicon.svg', svg(MARK, mk_view, DARK_INK,
      'g{fill:' + DARK_INK + '}@media (prefers-color-scheme: dark){g{fill:' + LIGHT_INK + '}}'))

# Raster logos (transparent).
ratio = wm_view[3] / wm_view[2]
for w in (512, 1024, 2048):
    h = round(w * ratio)
    for tone, ink in (('dark', DARK_INK), ('light', LIGHT_INK)):
        raster(WORDMARK, wm_view, (w, h), ink).save(os.path.join(OUT, f'lana-one-wordmark-{tone}-{w}w.png'))
for s in (64, 128, 256, 512, 1024):
    for tone, ink in (('dark', DARK_INK), ('light', LIGHT_INK)):
        raster(MARK, mk_view, (s, s), ink).save(os.path.join(OUT, f'lana-one-mark-{tone}-{s}.png'))

# App icons: macOS-style rounded tile (824 of 1024, 100 inset, radius 185), mark at ~50% of the tile.
TILE = {'light': ('#FFFFFF', DARK_INK), 'dark': ('#111111', LIGHT_INK)}
for tone, (tile_fill, ink) in TILE.items():
    for s in (16, 32, 64, 128, 256, 512, 1024):
        k = s / 1024
        raster(MARK, mk_view, (s, s), ink, pad=0.24, tile=(100 * k, 185 * k, tile_fill)) \
            .save(os.path.join(OUT, f'app-icon-{tone}-{s}.png'))
    # Full-bleed square (for Windows .ico, web manifests and maskable icons).
    for s in (16, 32, 48, 180, 192, 256, 512):
        raster(MARK, mk_view, (s, s), ink, pad=0.2, bg=tile_fill).save(os.path.join(OUT, f'square-icon-{tone}-{s}.png'))
def app_icon_svg(tile_fill, ink):
    vx, vy, vw, vh = mk_view
    k = 824 * (1 - 2 * 0.24) / vw
    tx = 100 + (824 - vw * k) / 2 - vx * k
    ty = 100 + (824 - vh * k) / 2 - vy * k
    paths = ''.join('<path d="M' + ' L'.join(f'{px:g},{py:g}' for px, py in p) + 'Z"/>' for p in MARK)
    edge = ' stroke="#E4E4E2" stroke-width="4"' if tile_fill == '#FFFFFF' else ''
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
            f'<rect x="100" y="100" width="824" height="824" rx="185" fill="{tile_fill}"{edge}/>'
            f'<g fill="{ink}" transform="translate({tx:.3f} {ty:.3f}) scale({k:.6f})">{paths}</g></svg>\n')


write('app-icon-light.svg', app_icon_svg('#FFFFFF', DARK_INK))
write('app-icon-dark.svg', app_icon_svg('#111111', LIGHT_INK))
print('ok')
