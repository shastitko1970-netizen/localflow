"""Generate LocalFlow app icons (PNG set + proper multi-size ICO)."""

from __future__ import annotations

import io
import struct
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    import subprocess
    import sys

    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow", "-q"])
    from PIL import Image, ImageDraw

out = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
out.mkdir(parents=True, exist_ok=True)


def make_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = max(1, size // 16)
    r = max(4, size // 5)
    d.rounded_rectangle(
        [pad, pad, size - pad - 1, size - pad - 1],
        radius=r,
        fill=(24, 36, 48, 255),
    )
    cx, cy = size // 2, size // 2 + max(1, size // 28)
    rad = max(6, size // 3)
    d.ellipse(
        [cx - rad, cy - rad, cx + rad, cy + rad],
        fill=(232, 120, 64, 255),
    )
    bars = 5
    bw = max(2, size // 14)
    gap = max(2, size // 22)
    total_w = bars * bw + (bars - 1) * gap
    x0 = (size - total_w) // 2
    heights = [0.35, 0.7, 1.0, 0.55, 0.4]
    for i, h in enumerate(heights):
        bh = max(bw, int(rad * 1.55 * h))
        x = x0 + i * (bw + gap)
        y1 = cy + bh // 2
        y0 = cy - bh // 2
        d.rounded_rectangle(
            [x, y0, x + bw, y1],
            radius=max(1, bw // 2),
            fill=(255, 248, 240, 255),
        )
    return img


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def write_ico(path: Path, images: list[Image.Image]) -> None:
    """Write a Vista+ ICO with embedded PNG payloads for each size."""
    payloads = [png_bytes(im) for im in images]
    count = len(images)
    offset = 6 + 16 * count
    entries = bytearray()
    data = bytearray()
    for im, payload in zip(images, payloads):
        w = 0 if im.width >= 256 else im.width
        h = 0 if im.height >= 256 else im.height
        entries += struct.pack(
            "<BBBBHHII",
            w,
            h,
            0,  # color count
            0,  # reserved
            1,  # planes
            32,  # bit count
            len(payload),
            offset + len(data),
        )
        data += payload
    header = struct.pack("<HHH", 0, 1, count)
    path.write_bytes(header + entries + data)


master = make_icon(1024)
master.save(out / "icon-master.png")

for name, sz in [
    ("32x32.png", 32),
    ("128x128.png", 128),
    ("128x128@2x.png", 256),
    ("icon.png", 512),
]:
    master.resize((sz, sz), Image.Resampling.LANCZOS).save(out / name)

ico_sizes = [16, 24, 32, 48, 64, 128, 256]
write_ico(out / "icon.ico", [make_icon(sz) for sz in ico_sizes])

for name, sz in [
    ("Square30x30Logo.png", 30),
    ("Square44x44Logo.png", 44),
    ("Square71x71Logo.png", 71),
    ("Square89x89Logo.png", 89),
    ("Square107x107Logo.png", 107),
    ("Square142x142Logo.png", 142),
    ("Square150x150Logo.png", 150),
    ("Square284x284Logo.png", 284),
    ("Square310x310Logo.png", 310),
    ("StoreLogo.png", 50),
]:
    master.resize((sz, sz), Image.Resampling.LANCZOS).save(out / name)

raw = (out / "icon.ico").read_bytes()
count = struct.unpack_from("<H", raw, 4)[0]
print("icons written", out)
print("ico bytes", len(raw), "entries", count)
