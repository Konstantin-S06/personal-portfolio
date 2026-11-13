"""Run from backend/:  python try_prose.py "What is the best project"

Calls the real model once, with the same prompt the chat uses and the entries from projects.json,
and shows what came back and whether the validator accepted it. Use it to find out why a
paragraph does or does not appear. Needs HUGGINGFACE_API_KEY (or HF_TOKEN) in backend/.env."""
import json
import os
import sys
import time

import db  # noqa: F401  (loads backend/.env so the API key is visible)
import chat_prose
from chat_intents import answer_intent
from chat_service import _default_prose_llm

question = " ".join(sys.argv[1:]).strip() or "What is the best project"
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "projects.json"), encoding="utf-8") as f:
    rows = json.load(f)["projects"]

print("API key visible:", bool(os.getenv("HUGGINGFACE_API_KEY") or os.getenv("HF_TOKEN")))
body = answer_intent(question, lambda: rows)
if body is None:
    sys.exit("The intent layer has no answer for this question, so the model path would handle it instead.")
intent = body.pop("intent", "")
print("intent:", intent, "| kind:", body["kind"], "| items:", len(body["items"]))
print("model is asked:", chat_prose.wants_prose(question, body, intent))

seen = {}


def llm(messages, max_tokens, temperature):
    t0 = time.time()
    try:
        seen["raw"] = _default_prose_llm(messages, max_tokens, temperature)
    finally:
        seen["secs"] = round(time.time() - t0, 1)
    return seen["raw"]


out, used = chat_prose.add_prose(question, body, intent, llm)
if "raw" in seen:
    print(f"model call took {seen['secs']}s, raw reply: {seen['raw']!r}")
    text, why = chat_prose._clean(seen["raw"], chat_prose.grounding_for(body["items"]))
    print("validator:", "accepted" if text else "REJECTED: " + why)
print("prose used:", used)
if used:
    print("\n" + out["prose"])
