#!/usr/bin/env python3
"""
Teal brazier flames + softer campfire. Run from the repo root:  python apply_flames_patch.py [--scene DIR] [--no-campfire]
Checks every anchor in every file first and writes NOTHING on a mismatch. Keeps CRLF/LF.
Backups: <file>.pre-flames.bak (delete before committing). Idempotent.
Files: src/scene/throneRoom.ts (edited), src/scene/fire.ts (edited, skip with --no-campfire),
       src/scene/tealFlame.ts (new).
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
EDITS = json.load(open(os.path.join(HERE, "edits.json"), encoding="utf-8"))


def read(p):
    raw = open(p, "rb").read().decode("utf-8")
    return raw.replace("\r\n", "\n"), "\r\n" in raw


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", default=os.path.join("src", "scene"))
    ap.add_argument("--no-campfire", action="store_true")
    a = ap.parse_args()
    errors, plan = [], []
    for name in ("throneRoom.ts", "fire.ts"):
        if name == "fire.ts" and a.no_campfire:
            continue
        p = os.path.join(a.scene, name)
        if not os.path.isfile(p):
            errors.append(f"missing file: {p}")
            continue
        text, crlf = read(p)
        mine = [(o, n) for f, o, n in EDITS if f == name]
        if "createTealFlames" in text or (name == "fire.ts" and "w: 1.9, h: 1.9" in text):
            print(f"{name}: already applied")
            continue
        for i, (old, new) in enumerate(mine, 1):
            c = text.count(old)
            if c != 1:
                errors.append(f"{name} edit {i}: anchor found {c} times (expected 1): {old[:50]!r}")
            else:
                text = text.replace(old, new)
        plan.append((p, text, crlf))
    dest = os.path.join(a.scene, "tealFlame.ts")
    new = open(os.path.join(HERE, "files", "tealFlame.ts"), encoding="utf-8").read()
    if os.path.exists(dest):
        if read(dest)[0] == new:
            print("tealFlame.ts: already applied")
        else:
            errors.append("tealFlame.ts exists and differs; not overwriting")
    else:
        plan.append((dest, new, True))
    if errors:
        print("NOTHING WRITTEN. Problems:")
        for e in errors:
            print("  -", e)
        return 1
    for p, text, crlf in plan:
        if os.path.exists(p):
            open(p + ".pre-flames.bak", "wb").write(open(p, "rb").read())
        open(p, "wb").write((text.replace("\n", "\r\n") if crlf else text).encode("utf-8"))
        print("wrote", p)
    print("done" if plan else "nothing to do")
    return 0


if __name__ == "__main__":
    sys.exit(main())
