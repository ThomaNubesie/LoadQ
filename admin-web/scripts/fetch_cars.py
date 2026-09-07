"""Pre-fetch one vehicle image per make/model/colour in the fleet, downscaled.

The board render died fetching 1200x750 PNGs from cdn.imagin.studio per request. These are
fetched ONCE, resized to 380px wide, and served from admin.loadq.ca itself, so the render
does a same-origin read of a ~20KB file instead of five foreign round trips.

Run again whenever new vehicles are added; existing files are skipped.
"""
import io, json, re, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

OUT = "/Users/admin/Desktop/LoadQ/admin-web/public/cars"
CUSTOMER = "img"
WIDTH = 380

# Mirrors utils/vehicleImage.ts, plus normalisation for the spellings that exist in the
# vehicles table: a double space in "grand  caravan", the "oddessey" typo, trim suffixes
# like "XL" and "Prime (PHEV)" that imagin does not recognise as families.
MODEL_FAMILY = {
    "hiace": "hiace", "hiace long": "hiace", "urvan": "urvan", "sprinter": "sprinter",
    "coaster": "coaster", "land cruiser": "land-cruiser", "prado": "land-cruiser-prado",
    "fortuner": "fortuner", "corolla": "corolla", "accord": "accord", "logan": "logan",
    "oddessey": "odyssey", "grand  caravan": "grand-caravan", "grand caravan": "grand-caravan",
    "town & country": "town-country", "rav4 prime (phev)": "rav4", "santa fe xl": "santa-fe",
    "santa fe": "santa-fe", "outlander sport": "outlander", "mazda5": "mazda5",
}

def family(model: str) -> str:
    m = re.sub(r"\s+", " ", model.lower().strip())
    return MODEL_FAMILY.get(m, m.split(" ")[0])

def slug(make: str, model: str, color: str) -> str:
    s = f"{make.lower().strip()}-{family(model)}-{(color or 'default').lower().strip()}"
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")

def url(make: str, model: str, color: str) -> str:
    from urllib.parse import urlencode
    p = {"customer": CUSTOMER, "make": make.lower().strip(), "modelFamily": family(model),
         "zoomType": "fullscreen", "angle": "01"}
    if color and color not in ("", "other"):
        p["paintId"] = color.lower().strip().replace(" ", "-")
    return "https://cdn.imagin.studio/getImage?" + urlencode(p)

def grab(row):
    make, model, color = row["make"], row["model"], row["color"]
    name = slug(make, model, color)
    path = f"{OUT}/{name}.jpg"
    try:
        with open(path, "rb"):
            return (name, "exists")
    except FileNotFoundError:
        pass
    try:
        raw = urllib.request.urlopen(url(make, model, color), timeout=45).read()
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
        im.save(path, "JPEG", quality=82, optimize=True)
        return (name, f"{im.size[0]}x{im.size[1]}")
    except Exception as e:
        return (name, f"FAIL {type(e).__name__}")

rows = json.load(open(sys.argv[1]))
with ThreadPoolExecutor(max_workers=6) as ex:
    results = list(ex.map(grab, rows))

ok = [r for r in results if not r[1].startswith("FAIL")]
bad = [r for r in results if r[1].startswith("FAIL")]
print(f"fetched/kept {len(ok)} of {len(results)}")
for n, s in bad:
    print("  missing:", n, s)
