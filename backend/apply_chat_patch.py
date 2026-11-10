"""
Replaces the /api/chat route in app.py with a thin call into chat_service.handle_chat.

    python apply_chat_patch.py            # patches app.py next to this script
    python apply_chat_patch.py path/to/app.py

All-or-nothing: if the anchors are not found exactly once, nothing is written.
Keeps CRLF line endings. Saves app.py.pre-chat.bak first. Safe to run twice.
"""

import os
import shutil
import sys

START = "@app.route('/api/chat', methods=['POST'])"
END = "@app.route('/api/health', methods=['GET'])"

NEW_ROUTE = '''@app.route('/api/chat', methods=['POST'])
def chat():
    """POST /api/chat - portfolio Q&A (guarded NL-to-SQL, keyword fallback)"""
    from chat_service import handle_chat

    body, status = handle_chat(request)
    return jsonify(body), status


'''


class PatchError(Exception):
    pass


def apply(path: str) -> str:
    with open(path, "rb") as f:
        raw = f.read().decode("utf-8")
    crlf = "\r\n" in raw
    text = raw.replace("\r\n", "\n")

    if "from chat_service import handle_chat" in text:
        return "already applied"
    if text.count(START) != 1:
        raise PatchError("could not find the /api/chat route exactly once")
    if text.count(END) != 1:
        raise PatchError("could not find the /api/health route exactly once")
    s, e = text.index(START), text.index(END)
    old = text[s:e]
    if s >= e or "def chat():" not in old or old.count("@app.route") != 1:
        raise PatchError("unexpected layout between the chat and health routes")

    new = text[:s] + NEW_ROUTE + text[e:]
    compile(new, path, "exec")  # syntax check before touching the file

    shutil.copyfile(path, path + ".pre-chat.bak")
    out = new.replace("\n", "\r\n") if crlf else new
    with open(path, "wb") as f:
        f.write(out.encode("utf-8"))
    return "patched"


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.py")
    try:
        print(apply(target))
    except PatchError as err:
        print(f"NOT PATCHED: {err}")
        sys.exit(1)
