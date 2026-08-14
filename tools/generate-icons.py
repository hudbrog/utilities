#!/usr/bin/env python3

from pathlib import Path

from PIL import Image, ImageDraw


OUTPUT = Path(__file__).resolve().parents[1] / "public" / "icons"
TEAL = "#1f6f78"
ORANGE = "#f29c6b"
PURPLE = "#6b5ca5"


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    scale = size / 512
    image = Image.new("RGBA", (size, size), TEAL if maskable else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if not maskable:
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=112 * scale, fill=TEAL)
        bubble = (36, 120, 408, 338)
        tail = [(222, 325), (140, 398), (158, 329)]
        dots = [(159, 229, ORANGE), (230, 229, TEAL), (301, 229, PURPLE)]
        radius = 23
    else:
        bubble = (72, 146, 394, 330)
        tail = [(238, 320), (172, 378), (187, 323)]
        dots = [(170, 238, ORANGE), (233, 238, TEAL), (296, 238, PURPLE)]
        radius = 19

    left, top, right, bottom = (round(value * scale) for value in bubble)
    draw.rounded_rectangle((left, top, right, bottom), radius=56 * scale, fill="white")
    draw.polygon([(round(x * scale), round(y * scale)) for x, y in tail], fill="white")

    for x, y, color in dots:
        draw.ellipse(
            (
                round((x - radius) * scale),
                round((y - radius) * scale),
                round((x + radius) * scale),
                round((y + radius) * scale),
            ),
            fill=color,
        )

    return image


OUTPUT.mkdir(parents=True, exist_ok=True)
draw_icon(192).save(OUTPUT / "icon-192.png", optimize=True)
draw_icon(512).save(OUTPUT / "icon-512.png", optimize=True)
draw_icon(180).save(OUTPUT / "apple-touch-icon.png", optimize=True)
draw_icon(512, maskable=True).save(OUTPUT / "maskable-512.png", optimize=True)
