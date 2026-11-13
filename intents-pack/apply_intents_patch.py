#!/usr/bin/env python3
"""
Applies the chat intent layer. Run from the repo root:  python apply_intents_patch.py [--root DIR] [--css PATH]

Checks EVERY anchor first and writes NOTHING if any check fails. Keeps each file's line endings
(CRLF or LF). Backups: <file>.pre-intents.bak (delete them before committing). Idempotent.

Touches:  backend/chat_service.py (exact edits)   backend/chat_intents.py (new)
          backend/tests/test_chat_intents.py (new)   src/components/ChatPanel.tsx (replaced)
          styles.css (chat CSS appended at the end)
"""
import argparse
import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CSS_MARK = "Chat answers v3"

SERVICE_EDITS = [
    ('''Order: validate input -> rate limit -> guarded NL-to-SQL on a read-only connection ->
existing keyword logic (ai_helper.answer_portfolio_question) if that path is unavailable
or declines. Question text is never logged, only its length.
"""''', '''Order: validate input -> rate limit -> deterministic intents (chat_intents; code-built
answers, no model) -> guarded NL-to-SQL on a read-only connection -> existing keyword logic
(ai_helper.answer_portfolio_question). Question text is never logged, only its length.

Every response body has: kind ("list" | "count" | "text" | "refusal"), answer (string),
items, suggestions, sql_query (always None). Counts and lists may add "count".
"""'''),
    ('''from chat_sql import MAX_QUESTION_CHARS, RateLimiter, answer_with_sql
''', '''from chat_intents import (
    answer_intent,
    load_from_connection,
    load_from_runner,
    refusal_body,
)
from chat_sql import MAX_QUESTION_CHARS, RateLimiter, answer_with_sql
'''),
    ('''def handle_chat(
    req,
    *,
    limiter: Optional[RateLimiter] = None,
    llm: Optional[Callable] = None,
    runner_factory: Optional[Callable] = None,
    fallback: Optional[Callable[[str], str]] = None,
) -> Tuple[Dict[str, Any], int]:''', '''def _default_projects_loader():
    from db import get_db_connection

    conn = get_db_connection()
    try:
        return load_from_connection(conn)
    finally:
        conn.close()


# The keyword fallback ends in one of these when it has nothing to say. Those are refusals,
# not answers, so they are returned as kind="refusal" with example questions that work.
REFUSAL_PREFIXES = (
    "I can only answer questions about",
    "I can answer questions about",
    "The chat assistant is read-only",
)


def _text_body(answer: str) -> Dict[str, Any]:
    return {"kind": "text", "answer": answer, "items": [], "suggestions": [], "sql_query": None}


def handle_chat(
    req,
    *,
    limiter: Optional[RateLimiter] = None,
    llm: Optional[Callable] = None,
    runner_factory: Optional[Callable] = None,
    fallback: Optional[Callable[[str], str]] = None,
    projects_loader: Optional[Callable] = None,
) -> Tuple[Dict[str, Any], int]:'''),
    ('''        return {"error": "Rate limit reached", "answer": msg, "retry_after": decision.retry_after}, 429

    answer: Optional[str] = None
    path = "fallback"
    runner = None
    try:''', '''        return {"error": "Rate limit reached", "kind": "text", "answer": msg, "items": [], "suggestions": [],
                "retry_after": decision.retry_after}, 429

    answer: Optional[str] = None
    body: Optional[Dict[str, Any]] = None
    path = "fallback"
    intent_name = ""
    runner = None

    def load_projects():
        if projects_loader is not None:
            return projects_loader()
        if runner is not None:
            return load_from_runner(runner)
        return _default_projects_loader()

    try:'''),
    ('''        if runner is not None:
            try:
                answer, debug = answer_with_sql(question, runner.run, llm or _default_llm)''', '''        try:
            body = answer_intent(question, load_projects)
        except Exception as e:  # DB hiccup etc.: fall through to the model path
            logger.warning("chat intent layer failed: %s", type(e).__name__)
            body = None
        if body is not None:
            path = "intent"
            intent_name = str(body.pop("intent", "") or "")
            body["sql_query"] = None
        elif runner is not None:
            try:
                answer, debug = answer_with_sql(question, runner.run, llm or _default_llm)'''),
    ('''        if answer is None:
            answer = (fallback or _default_fallback)(question)
    except ImportError:
        return {"answer": "AI chat is not configured. Please set HUGGINGFACE_API_KEY.", "sql_query": None}, 200
    except Exception as e:
        logger.error("chat error: %s", type(e).__name__)
        return {"answer": "Sorry, I encountered an error. Please try again.", "sql_query": None}, 200''', '''        if body is None and answer is None:
            answer = (fallback or _default_fallback)(question)
        if body is None:
            if isinstance(answer, str) and answer.startswith(REFUSAL_PREFIXES):
                try:
                    projects = load_projects()
                except Exception:
                    projects = None
                body = refusal_body(projects)
                body.pop("intent", None)
                body["sql_query"] = None
                path = "refusal"
            else:
                body = _text_body(answer)
    except ImportError:
        return _text_body("AI chat is not configured. Please set HUGGINGFACE_API_KEY."), 200
    except Exception as e:
        logger.error("chat error: %s", type(e).__name__)
        return _text_body("Sorry, I encountered an error. Please try again."), 200'''),
    ('''    logger.info("chat path=%s question_chars=%d", path, len(question))
    return {"answer": answer, "sql_query": None}, 200''', '''    logger.info("chat path=%s intent=%s question_chars=%d", path, intent_name or "-", len(question))
    return body, 200'''),
]


def read(path):
    with open(path, "rb") as f:
        raw = f.read().decode("utf-8")
    crlf = "\r\n" in raw
    return raw.replace("\r\n", "\n"), crlf


def payload(name):
    with open(os.path.join(HERE, "files", name), "rb") as f:
        return f.read().decode("utf-8").replace("\r\n", "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--css", default=None, help="path to the stylesheet that holds the chat CSS")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    errors, plan = [], []  # plan: (path, new_text, crlf)

    def need(path):
        if not os.path.isfile(path):
            errors.append(f"missing file: {path}")
            return False
        return True

    # backend/chat_service.py: exact edits
    svc = os.path.join(root, "backend", "chat_service.py")
    if need(svc):
        text, crlf = read(svc)
        if "from chat_intents import" in text:
            print("chat_service.py: already applied")
        else:
            for i, (old, new) in enumerate(SERVICE_EDITS, 1):
                n = text.count(old)
                if n != 1:
                    errors.append(f"chat_service.py edit {i}: anchor found {n} times (expected 1)")
                else:
                    text = text.replace(old, new)
            plan.append((svc, text, crlf))

    # new files (create, or skip when identical, or refuse when different)
    for rel, name in (("backend/chat_intents.py", "chat_intents.py"), ("backend/tests/test_chat_intents.py", "test_chat_intents.py")):
        dest = os.path.join(root, *rel.split("/"))
        if not os.path.isdir(os.path.dirname(dest)):
            errors.append(f"missing folder: {os.path.dirname(dest)}")
            continue
        new = payload(name)
        if os.path.exists(dest):
            old, _ = read(dest)
            if old == new:
                print(f"{rel}: already applied")
            else:
                errors.append(f"{rel} exists and differs; not overwriting")
        else:
            plan.append((dest, new, True))

    # ChatPanel.tsx: replace (anchors prove it is the file we saw)
    cp = os.path.join(root, "src", "components", "ChatPanel.tsx")
    if need(cp):
        text, crlf = read(cp)
        new = payload("ChatPanel.tsx")
        if "function parseReply" in text:
            print("ChatPanel.tsx: already applied")
        else:
            for anchor in ("chat-speaking", "const SUGGESTIONS = ['How many projects use Python?'", "export function ChatPanel({ title }"):
                if text.count(anchor) != 1:
                    errors.append(f"ChatPanel.tsx anchor not found exactly once: {anchor[:40]}")
            plan.append((cp, new, crlf))

    # CSS
    css = a.css and os.path.abspath(a.css)
    if not css:
        found = [p for p in glob.glob(os.path.join(root, "src", "**", "styles.css"), recursive=True)]
        found += [p for p in glob.glob(os.path.join(root, "**", "styles.css"), recursive=True) if "node_modules" not in p and p not in found]
        css = found[0] if found else None
    if not css or not need(css):
        errors.append("could not find styles.css; pass --css PATH")
    else:
        text, crlf = read(css)
        if CSS_MARK in text:
            print("styles.css: already applied")
        elif ".chat-card .chat-chips" not in text or "Finale: contact centring and chat panel" not in text:
            errors.append("styles.css does not contain the finale chat CSS anchors")
        else:
            plan.append((css, text.rstrip("\n") + "\n" + payload("chat_answers.css"), crlf))

    if errors:
        print("NOTHING WRITTEN. Problems:")
        for e in errors:
            print("  -", e)
        return 1
    for path, text, crlf in plan:
        if os.path.exists(path):
            with open(path, "rb") as f, open(path + ".pre-intents.bak", "wb") as b:
                b.write(f.read())
        with open(path, "wb") as f:
            f.write((text.replace("\n", "\r\n") if crlf else text).encode("utf-8"))
        print("wrote", os.path.relpath(path, root))
    print("done" if plan else "nothing to do")
    return 0


if __name__ == "__main__":
    sys.exit(main())
