"""Replaces the chat CSS block in styles.css with chat v2.
Run from the folder that contains src/:  python apply_chat_ui_v2.py [src-folder]
Writes nothing if the old block is not found exactly once. Backup: styles.css.pre-chat-v2.bak
"""
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "src")
HERE = Path(__file__).resolve().parent
OLD = "/* Chat: card sits low so the throne stays visible above it. */"
NEW_MARK = "/* Chat v2:"

hits = [p for p in ROOT.rglob("styles.css") if "node_modules" not in p.parts]
if len(hits) != 1:
    sys.exit(f"NOTHING WRITTEN. expected one styles.css under {ROOT}, found {len(hits)}")
css = hits[0]
raw = css.read_bytes().decode("utf-8")
crlf = "\r\n" in raw
text = raw.replace("\r\n", "\n")
if NEW_MARK in text:
    sys.exit("already applied")
if text.count(OLD) != 1:
    sys.exit(f"NOTHING WRITTEN. old chat block marker found {text.count(OLD)} times (need 1)")
head = text[: text.index(OLD)]
out = head + (HERE / "chat.css").read_text(encoding="utf-8").replace("\r\n", "\n")
bak = css.with_name(css.name + ".pre-chat-v2.bak")
if not bak.exists():
    bak.write_bytes(raw.encode("utf-8"))
css.write_bytes((out.replace("\n", "\r\n") if crlf else out).encode("utf-8"))
print("styles.css: chat block replaced")
