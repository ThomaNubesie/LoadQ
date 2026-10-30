#!/usr/bin/env python3
"""Add the visit counter to every page of loadq.ca (idempotent).

    python3 site/add_hit_tag.py          # show what would change
    python3 site/add_hit_tag.py --write  # do it

Inserts <script src="/assets/hit.js" defer></script> before </body> in each .html under site/.
Run it again after adding pages; files that already have the tag are left alone.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TAG = '<script src="/assets/hit.js" defer></script>'
write = "--write" in sys.argv

changed, already, skipped = [], [], []
for root, _dirs, files in os.walk(HERE):
    if "node_modules" in root:
        continue
    for name in files:
        if not name.endswith(".html"):
            continue
        path = os.path.join(root, name)
        html = open(path, encoding="utf-8").read()
        rel = os.path.relpath(path, HERE)
        if TAG in html:
            already.append(rel)
        elif "</body>" in html:
            if write:
                open(path, "w", encoding="utf-8").write(html.replace("</body>", f"  {TAG}\n</body>", 1))
            changed.append(rel)
        else:
            skipped.append(rel)

print(f"{'added to' if write else 'would add to'}: {len(changed)}")
for f in changed:
    print("  " + f)
if already:
    print(f"already tagged: {len(already)}")
if skipped:
    print(f"no </body>, skipped: {len(skipped)}")
    for f in skipped:
        print("  " + f)
