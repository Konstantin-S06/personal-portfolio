"""
Request handler for POST /api/chat. Kept out of app.py so it can be tested without
the rest of the app.

Order: validate input -> rate limit -> deterministic intents (chat_intents; code-built
answers, no model) -> guarded NL-to-SQL on a read-only connection -> existing keyword logic
(ai_helper.answer_portfolio_question). Question text is never logged, only its length.

Every response body has: kind ("list" | "count" | "text" | "refusal"), answer (string),
items, suggestions, sql_query (always None). Counts and lists may add "count".
Intent answers to open questions may add "prose": a short model-written paragraph that was validated
(chat_prose); it is absent when the model is slow, unavailable or its output was rejected.
"""

import hashlib
import logging
import os
import re
from typing import Any, Callable, Dict, Optional, Tuple

from chat_intents import (
    answer_intent,
    load_from_connection,
    load_from_runner,
    refusal_body,
)
from chat_prose import PROSE_TIMEOUT_S, add_prose
from chat_sql import MAX_QUESTION_CHARS, RateLimiter, answer_with_sql

logger = logging.getLogger(__name__)

_limiter: Optional[RateLimiter] = None


def get_limiter() -> RateLimiter:
    global _limiter
    if _limiter is None:
        _limiter = RateLimiter.from_env()
    return _limiter


def visitor_key(req) -> str:
    """
    Hash of the client IP. Behind proxies the real IP is the Nth entry from the right of
    X-Forwarded-For; CHAT_PROXY_HOPS sets N (default 1). Entries further left can be forged.
    """
    try:
        hops = max(1, int(os.getenv("CHAT_PROXY_HOPS", "1")))
    except ValueError:
        hops = 1
    parts = [p.strip() for p in (req.headers.get("X-Forwarded-For") or "").split(",") if p.strip()]
    ip = parts[-hops] if len(parts) >= hops else (req.remote_addr or "unknown")
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


def clean_question(raw: Any) -> Tuple[Optional[str], Optional[str]]:
    if not isinstance(raw, str):
        return None, "Question is required"
    q = " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", raw).split())
    if not q:
        return None, "Question is required"
    if len(q) > MAX_QUESTION_CHARS:
        return None, "Question too long"
    return q, None


def _default_llm(messages, max_tokens, temperature):
    from ai_helper import call_hf_chat  # lazy: needs the openai package

    return call_hf_chat(messages, max_tokens=max_tokens, temperature=temperature)


def _default_prose_llm(messages, max_tokens, temperature):
    from ai_helper import call_hf_chat  # lazy: needs the openai package

    return call_hf_chat(messages, max_tokens=max_tokens, temperature=temperature, timeout=PROSE_TIMEOUT_S)


def _default_runner_factory():
    from readonly_db import get_readonly_runner

    return get_readonly_runner()


def _default_fallback(question: str) -> str:
    from ai_helper import answer_portfolio_question
    from db import get_db_connection

    conn = get_db_connection()
    try:
        answer, _debug = answer_portfolio_question(question, conn)
    finally:
        conn.close()
    return answer


def _default_projects_loader():
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
    prose_llm: Optional[Callable] = None,
) -> Tuple[Dict[str, Any], int]:
    data = req.get_json(silent=True)
    if not isinstance(data, dict):
        return {"error": "Question is required"}, 400
    question, err = clean_question(data.get("question"))
    if err:
        return {"error": err}, 400

    decision = (limiter or get_limiter()).check(visitor_key(req))
    if not decision.allowed:
        mins = max(1, -(-decision.retry_after // 60))
        msg = (
            "That's a lot of questions in a short time. Please wait a minute and try again."
            if decision.reason == "minute"
            else f"The chat has reached its limit for now. Please try again in about {mins} minute{'s' if mins != 1 else ''}, or use the contact form."
        )
        return {"error": "Rate limit reached", "kind": "text", "answer": msg, "items": [], "suggestions": [],
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

    try:
        try:
            runner = (runner_factory or _default_runner_factory)()
        except Exception as e:  # includes ReadOnlyTokenError: SQL path stays off
            logger.error("chat SQL path disabled: %s", e)
        try:
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
                answer, debug = answer_with_sql(question, runner.run, llm or _default_llm)
                if answer is not None:
                    path = "sql"
                else:
                    logger.info("chat sql path declined: %s", debug.get("declined") or debug.get("rejected"))
            except ImportError:
                answer = None  # openai not installed; use the keyword logic
        if body is None and answer is None:
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
        return _text_body("Sorry, I encountered an error. Please try again."), 200
    finally:
        if runner is not None:
            try:
                runner.close()
            except Exception:
                pass

    prose_used = False
    if path == "intent" and body is not None:
        body, prose_used = add_prose(question, body, intent_name, prose_llm or _default_prose_llm)
    logger.info("chat path=%s intent=%s prose=%s question_chars=%d", path, intent_name or "-", "yes" if prose_used else "no", len(question))
    return body, 200
