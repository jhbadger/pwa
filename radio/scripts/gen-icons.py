#!/usr/bin/env python3
"""Generate radio app PNG icons (192, 512, maskable, apple-touch-icon) without dependencies."""
import math, struct, zlib, os

BG     = (0x15, 0x16, 0x1c, 0xff)  # #15161c
PANEL  = (0x1e, 0x20, 0x29, 0xff)  # #1e2029
ACCENT = (0xe0, 0x95, 0x4f, 0xff)  # #e0954f
HEADER = (0x19, 0x1d, 0x36, 0xff)  # #191d36
TRANS  = (0, 0, 0, 0)


def write_png(path, w, h, rows):
    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)
    raw = b''.join(b'\x00' + b''.join(bytes(p) for p in row) for row in rows)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))


def blend(dst, src, alpha):
    a = alpha / 255.0
    return [min(255, int(src[i] * a + dst[i] * (1 - a))) for i in range(3)] + [min(255, dst[3] + int(alpha))]


def make_icon(size, maskable=False):
    img = [[list(TRANS)] * size for _ in range(size)]
    cx = size / 2.0
    cy = size / 2.0

    # Fill the entire canvas with BG (maskable icons use full bleed)
    pad   = int(size * (0.0 if maskable else 0.04))
    cr    = int(size * (0.0 if maskable else 0.18))   # corner radius

    # Draw rounded-rect background (or full square for maskable)
    x0, y0, x1, y1 = pad, pad, size - pad, size - pad
    for y in range(size):
        for x in range(size):
            if maskable or _in_rrect(x, y, x0, y0, x1, y1, cr):
                img[y][x] = list(PANEL)

    # Draw a subtle top gradient strip (header colour)
    stripe_h = int(size * 0.28)
    for y in range(y0, min(y0 + stripe_h, y1)):
        for x in range(x0, x1):
            if maskable or _in_rrect(x, y, x0, y0, x1, y1, cr):
                t = 1.0 - (y - y0) / stripe_h
                img[y][x] = _lerp_px(PANEL, HEADER, t * 0.7)

    # Draw three concentric arcs (radio waves) centred in the icon
    thick = max(1.5, size / 80)
    for i, frac in enumerate([0.22, 0.32, 0.42]):
        _draw_arc(img, cx, cy, size * frac, thick, ACCENT, -70, 70, size)
        _draw_arc(img, cx, cy, size * frac, thick, ACCENT, 110, 250, size)

    # Centre dot
    dot_r = size * 0.065
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - cx, y - cy)
            if d < dot_r - 0.5:
                img[y][x] = list(ACCENT)
            elif d < dot_r + 0.5:
                t = (dot_r + 0.5 - d)
                img[y][x] = _lerp_px(img[y][x], ACCENT, t)

    return [list(map(tuple, row)) for row in img]


def _in_rrect(x, y, x0, y0, x1, y1, r):
    if x < x0 or y < y0 or x >= x1 or y >= y1:
        return False
    dx = max(0, x0 + r - x, x - (x1 - r - 1))
    dy = max(0, y0 + r - y, y - (y1 - r - 1))
    return dx * dx + dy * dy <= r * r


def _lerp_px(a, b, t):
    return [int(a[i] + (b[i] - a[i]) * t) for i in range(4)]


def _draw_arc(img, cx, cy, radius, thick, color, a0, a1, size):
    steps = int(abs(a1 - a0) * max(6, radius / 2))
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        for dr in range(-int(thick * 4), int(thick * 4) + 1):
            r2 = radius + dr * 0.25
            px = int(cx + r2 * math.sin(a))
            py = int(cy - r2 * math.cos(a))
            dist = abs(dr * 0.25) / thick
            alpha = max(0.0, 1.0 - dist)
            if 0 <= px < size and 0 <= py < size:
                img[py][px] = _lerp_px(img[py][px], list(color), alpha)


os.makedirs('icons', exist_ok=True)

for sz in [192, 512]:
    rows = make_icon(sz)
    write_png(f'icons/icon-{sz}.png', sz, sz, rows)
    print(f'  icons/icon-{sz}.png')
    rows_m = make_icon(sz, maskable=True)
    write_png(f'icons/icon-{sz}-maskable.png', sz, sz, rows_m)
    print(f'  icons/icon-{sz}-maskable.png')

rows_a = make_icon(180)
write_png('icons/apple-touch-icon.png', 180, 180, rows_a)
print('  icons/apple-touch-icon.png')
