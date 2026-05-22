"""
Regenerate LoadQ adaptive icon with proper Android safe zone.

Android adaptive icons: foreground 432x432dp, inner 264x264dp is the "safe zone"
where any mask shape (circle/squircle/teardrop) is guaranteed to render content.
The outer 84dp on each side may be cropped depending on launcher.

We output at 1024x1024 (Expo's standard) and keep all visible content within
the inner 66% (~676px), centered. Background is solid orange so any mask still
shows the brand color.
"""

from PIL import Image, ImageDraw, ImageFont
import os

CANVAS = 1024
SAFE_INNER = int(CANVAS * 0.66)  # ~676
ORANGE = "#F7931A"
WHITE = "#FAFAF6"

OUT_ADAPTIVE = "/Users/admin/Desktop/LoadQ/assets/images/adaptive-icon.png"
OUT_ICON     = "/Users/admin/Desktop/LoadQ/assets/images/icon.png"

img = Image.new("RGB", (CANVAS, CANVAS), ORANGE)
draw = ImageDraw.Draw(img)

# Try a few fonts in order of preference.
font_paths = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
]
font = None
for size in range(440, 200, -10):
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                f = ImageFont.truetype(fp, size)
                # measure
                bbox = draw.textbbox((0, 0), "LQ", font=f)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
                # We want the text to fit comfortably inside the safe zone with
                # some breathing room on top/bottom. Cap to ~75% of safe zone.
                if tw <= SAFE_INNER * 0.85 and th <= SAFE_INNER * 0.85:
                    font = f
                    break
            except Exception:
                pass
    if font is not None:
        break

if font is None:
    font = ImageFont.load_default()

bbox = draw.textbbox((0, 0), "LQ", font=font)
tw = bbox[2] - bbox[0]
th = bbox[3] - bbox[1]
x_offset = -bbox[0]
y_offset = -bbox[1]
x = (CANVAS - tw) // 2 + x_offset
y = (CANVAS - th) // 2 + y_offset - int(CANVAS * 0.02)  # slight visual lift
draw.text((x, y), "LQ", fill=WHITE, font=font)

img.save(OUT_ADAPTIVE, "PNG")
print(f"wrote {OUT_ADAPTIVE}")

img.save(OUT_ICON, "PNG")
print(f"wrote {OUT_ICON}")
