#!/usr/bin/env python3
"""Crop transparent/blank margins and export a tight square PNG for app icons."""
import sys
from pathlib import Path

from PIL import Image


def content_bbox(im: Image.Image, alpha_threshold: int = 20) -> tuple[int, int, int, int]:
    rgba = im.convert('RGBA')
    px = rgba.load()
    w, h = rgba.size
    min_x, min_y = w, h
    max_x, max_y = -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a <= alpha_threshold:
                continue
            # skip near-white / near-black matte
            if r > 240 and g > 240 and b > 240:
                continue
            if r < 15 and g < 15 and b < 15 and a < 128:
                continue
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
    if max_x < 0:
        raise SystemExit('no visible icon content found')
    return min_x, min_y, max_x + 1, max_y + 1


def trim_to_square(src: Path, dest: Path, size: int = 1024) -> None:
    im = Image.open(src).convert('RGBA')
    box = content_bbox(im)
    cropped = im.crop(box)
    side = max(cropped.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    ox = (side - cropped.width) // 2
    oy = (side - cropped.height) // 2
    square.paste(cropped, (ox, oy), cropped)
    out = square.resize((size, size), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, format='PNG')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(f'usage: {sys.argv[0]} <input.png> <output.png>')
    trim_to_square(Path(sys.argv[1]), Path(sys.argv[2]))
