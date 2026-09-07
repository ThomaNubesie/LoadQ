import qrcode
from PIL import Image, ImageDraw, ImageFont
import os

DEST = os.path.expanduser("~/Desktop/loadq-qr")
os.makedirs(DEST, exist_ok=True)

QR_SIZE = 1000
PAD_TOP = 80
PAD_BOTTOM = 140
PAD_SIDES = 80
LABEL_HEIGHT = 100

BG = "#0F0A00"
FG = "#F5F5F5"
ACCENT = "#F7931A"

def gen(url, label, out):
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=20,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color=FG, back_color=BG).convert("RGB")
    img = img.resize((QR_SIZE, QR_SIZE), Image.NEAREST)

    canvas_w = QR_SIZE + 2 * PAD_SIDES
    canvas_h = PAD_TOP + QR_SIZE + PAD_BOTTOM
    canvas = Image.new("RGB", (canvas_w, canvas_h), BG)
    canvas.paste(img, (PAD_SIDES, PAD_TOP))

    draw = ImageDraw.Draw(canvas)

    # Heading: LoadQ in orange
    try:
        heading_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 64)
        label_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 48)
    except Exception:
        heading_font = ImageFont.load_default()
        label_font = ImageFont.load_default()

    heading = "LoadQ"
    bbox = draw.textbbox((0, 0), heading, font=heading_font)
    tw = bbox[2] - bbox[0]
    draw.text(((canvas_w - tw) / 2, 10), heading, fill=ACCENT, font=heading_font)

    bbox2 = draw.textbbox((0, 0), label, font=label_font)
    lw = bbox2[2] - bbox2[0]
    draw.text(((canvas_w - lw) / 2, PAD_TOP + QR_SIZE + 30), label, fill=FG, font=label_font)

    canvas.save(out, "PNG")
    print(f"wrote {out}")

gen("https://testflight.apple.com/join/dvFFngSP",
    "iOS — TestFlight",
    os.path.join(DEST, "loadq-ios-testflight.png"))

gen("https://play.google.com/apps/internaltest/4701707282664092289",
    "Android — Play Internal Test",
    os.path.join(DEST, "loadq-android-internal.png"))

gen("https://apps.apple.com/ca/app/id6770652996",
    "iOS App Store",
    os.path.join(DEST, "loadq-ios-appstore.png"))

# Unified QR — single sticker / poster / business card.
# Detects the user's device on loadq.ca/get and sends them to the right store.
gen("https://loadq.ca/get",
    "loadq.ca/get",
    os.path.join(DEST, "loadq-get.png"))
