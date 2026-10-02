#!/usr/bin/env python3
"""Keep The Page Kill Unwanted — the small promotional tile the store requires.

The Web Store will not take a listing without a 440x280 promo tile, and it is
the image that appears beside the item in search and category pages. It reuses
the icon's mark and colours rather than inventing a second identity: brunswick
green, the brass padlock, the white page.

    python3 store/make-promo.py        # writes store/promo-440x280.png

The optional marquee tile (1400x560) is not generated -- it is only needed for
featured placement, and a stretched version of this one would look it.

Not shipped in the extension package; package.sh ships only what the manifest
reaches.
"""

import importlib.util
import os

from PIL import Image, ImageDraw, ImageFont

# make-icons.py has a hyphen in its name, so it cannot be imported by name.
# It is loaded by path instead -- the mark and the colours are defined once,
# there, and the tile must not drift from the icon it sits beside.
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    'make_icons', os.path.join(HERE, '..', 'icons', 'make-icons.py'))
icons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(icons)

W, H = 440, 280
GREEN = icons.GREEN
PAPER = (255, 255, 255, 255)
MUTED = (176, 196, 188, 255)             # the green, lightened -- reads as a caption

FONT_BOLD = '/usr/share/fonts/liberation-sans-fonts/LiberationSans-Bold.ttf'
FONT_REG = '/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf'


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        # No Liberation on this box. The default bitmap font is ugly but the
        # tile still builds, and a wrong-looking tile is easier to notice than
        # a missing one.
        return ImageFont.load_default()


def fit(lines, path, limit, start=34, floor=18):
    """Largest size at which every line clears `limit` pixels.

    The name is set in the manifest and can change again; a hard-coded point
    size would quietly run the longest line off the edge of the tile, and a
    promo image is not something anyone re-reads before uploading it.
    """
    size = start
    while size > floor:
        f = font(path, size)
        if max(f.getlength(t) for t in lines) <= limit:
            return f, size
        size -= 1
    return font(path, floor), floor


def main():
    img = Image.new('RGBA', (W, H), GREEN)
    d = ImageDraw.Draw(img)

    mark = icons.draw(160)               # drawn at the size it is placed at
    img.paste(mark, (34, (H - 160) // 2), mark)

    x = 34 + 160 + 30
    lines = ('Keep The Page', 'Kill Unwanted')
    f, size = fit(lines, FONT_BOLD, W - x - 28)
    top = (H - (size * 2 + 10 + 26)) // 2
    for i, line in enumerate(lines):
        d.text((x, top + i * (size + 10)), line, font=f, fill=PAPER)
    d.text((x, top + 2 * (size + 10) + 8), 'Walls off. Article on.',
           font=font(FONT_REG, 17), fill=MUTED)

    out = os.path.join(HERE, 'promo-440x280.png')
    img.convert('RGB').save(out, 'PNG', optimize=True)
    print('wrote', out)


if __name__ == '__main__':
    main()
