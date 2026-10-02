#!/usr/bin/env python3
"""Keep The Page — icon generator.

The Chrome Web Store rejects a listing with no icon, and the 128px one is also
what the install dialog shows, so these are not decoration. They are drawn here
rather than kept as opaque binaries so a colour or a corner radius can be
changed without a design tool, and so the four sizes can never drift apart.

The mark: a white article page carrying a padlock, on brunswick green. Two
rules at the top say
"article", the padlock says the page is held open and stays yours. At 16px the
padlock is the only detail that survives, so it is drawn large and solid and
nothing else competes with it.

Each size is drawn at 8x and box-filtered down, which keeps the edges clean at
16px; drawing straight at 16 leaves the rounded corners ragged.

The 128 is the one the store shows, and the store asks for the mark to occupy
96x96 of that 128 canvas with the rest left as padding. The browser's own
sizes -- 48, 32, 16 -- are full bleed, because padding there just makes the
icon look small beside everybody else's in the toolbar.

    python3 icons/make-icons.py        # rewrites icons/icon{16,32,48,128}.png

Not shipped in the store package -- package.sh excludes it.
"""

from PIL import Image, ImageDraw

SIZES = (16, 32, 48, 128)
PADDED = {128: 96}                       # store canvas: 96px of mark in 128px
SS = 8                                   # supersampling factor

GREEN = (27, 77, 62, 255)                # brunswick green, #1b4d3e -- the tile
BRASS = (181, 166, 66, 255)              # #b5a642 -- the padlock
PAPER = (255, 255, 255, 255)
RULE = (176, 186, 184, 255)              # text lines: neutral grey, so the brass
                                         # is the only warm thing in the mark


def draw(size):
    s = size * SS
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 16px cannot hold the rules as well as the padlock -- downscaled together
    # they merge into a grey smear. Below 32 the page is drawn larger and bare,
    # and the padlock takes the space the text gives up.
    detail = size >= 32

    # Rounded tile. Radius is a fraction of the size so every icon matches.
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=GREEN)

    # The page itself, centred, portrait, with a margin that survives downscaling.
    m = s * (0.20 if detail else 0.13)
    inset_y = s * (0.15 if detail else 0.09)
    page = (m, inset_y, s - m, s - inset_y)
    x0, y0, x1, y1 = page
    d.rounded_rectangle(page, radius=max(1, int(s * 0.035)), fill=PAPER)

    # Two rules at the top. Enough to read as text, few enough to leave the
    # padlock the only thing with any weight.
    if detail:
        inset = (x1 - x0) * 0.17
        lh = max(1, int(s * 0.05))
        for i, frac in enumerate((1.0, 0.62)):
            ly = y0 + (y1 - y0) * (0.13 + i * 0.13)
            d.rounded_rectangle(
                (x0 + inset, ly, x0 + inset + (x1 - x0 - inset * 2) * frac, ly + lh),
                radius=lh / 2.0, fill=RULE)

    # The padlock, sitting on the lower two-thirds of the page.
    bw = (x1 - x0) * (0.50 if detail else 0.62)   # body width
    bh = bw * 0.78                             # body height
    bx = (x0 + x1 - bw) / 2.0
    # Low on the page where the text would be at 32px and up; centred at 16,
    # where a page with a lot of white above the lock reads as an empty box.
    by = (y1 - (y1 - y0) * 0.17 - bh) if detail else (y0 + y1 - bh) / 2.0 + bh * 0.18
    # Shackle: a half-ring above the body, open at the bottom.
    sw = bw * 0.56                             # shackle outer width
    st = max(1, int(bw * 0.17))                # shackle thickness
    sx = (x0 + x1 - sw) / 2.0
    sy = by - sw * 0.52
    d.arc((sx, sy, sx + sw, sy + sw), start=180, end=360, fill=BRASS, width=st)
    d.rectangle((sx, sy + sw / 2.0, sx + st, by), fill=BRASS)
    d.rectangle((sx + sw - st, sy + sw / 2.0, sx + sw - 1, by), fill=BRASS)
    # Body, with a keyhole punched back out to the page so it reads at 48px up.
    d.rounded_rectangle((bx, by, bx + bw, by + bh),
                        radius=max(1, int(bw * 0.16)), fill=BRASS)
    kr = bw * (0.11 if detail else 0.14)
    kcx, kcy = (bx + bw / 2.0), (by + bh * 0.42)
    d.ellipse((kcx - kr, kcy - kr, kcx + kr, kcy + kr), fill=PAPER)
    if detail:
        d.rectangle((kcx - kr * 0.52, kcy, kcx + kr * 0.52, by + bh * 0.76), fill=PAPER)

    if size in PADDED:
        mark = img.resize((PADDED[size], PADDED[size]), Image.LANCZOS)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        off = (size - PADDED[size]) // 2
        out.paste(mark, (off, off))
        return out
    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    for n in SIZES:
        p = os.path.join(here, 'icon%d.png' % n)
        draw(n).save(p, 'PNG', optimize=True)
        print('wrote', p)
