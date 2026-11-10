import json
import logging

import pytest
from flask import Flask, jsonify, request

from chat_service import clean_question, handle_chat, visitor_key
from chat_sql import RateLimiter, VIEW_NAME

V = VIEW_NAME


class Clock:
    t = 86400 * 20000 + 100

    def __call__(self):
        return self.t


def make_client(**kw):
    app = Flask(__name__)

    @app.route("/api/chat", methods=["POST"])
    def chat():
        body, status = handle_chat(request, **kw)
        return jsonify(body), status

    return app.test_client()


class FakeRunner:
    def __init__(self, cols=("title",), rows=(("Alpha",),)):
        self.cols, self.rows, self.closed = cols, rows, False

    def run(self, sql, args):
        return self.cols, self.rows

    def close(self):
        self.closed = True


def sql_llm(sql=f"SELECT title FROM {V}", params=None):
    return lambda m, mt, t: json.dumps({"sql": sql, "params": params or {}})


def fresh_limiter(**kw):
    return RateLimiter(clock=Clock(), **kw)


def test_input_validation():
    c = make_client(limiter=fresh_limiter(), runner_factory=lambda: None, fallback=lambda q: "fb")
    assert c.post("/api/chat", data="notjson", content_type="text/plain").status_code == 400
    assert c.post("/api/chat", json=[1]).status_code == 400
    assert c.post("/api/chat", json={}).status_code == 400
    assert c.post("/api/chat", json={"question": "   "}).status_code == 400
    assert c.post("/api/chat", json={"question": 5}).status_code == 400
    r = c.post("/api/chat", json={"question": "x" * 301})
    assert r.status_code == 400 and r.get_json()["error"] == "Question too long"
    assert c.post("/api/chat", json={"question": "x" * 300}).status_code == 200


def test_clean_question_strips_control_chars():
    assert clean_question("a\x00b\n\tc  d")[0] == "a b c d"


def test_sql_path_used_and_runner_closed():
    runner = FakeRunner()
    c = make_client(
        limiter=fresh_limiter(), runner_factory=lambda: runner, llm=sql_llm(), fallback=lambda q: pytest.fail("no fallback")
    )
    r = c.post("/api/chat", json={"question": "list titles"})
    assert r.status_code == 200 and "Alpha" in r.get_json()["answer"] and r.get_json()["sql_query"] is None
    assert runner.closed


@pytest.mark.parametrize("llm", [lambda m, mt, t: None, sql_llm("SELECT * FROM contacts"), lambda m, mt, t: 1 / 0])
def test_fallback_when_sql_path_declines(llm):
    runner = FakeRunner()
    c = make_client(limiter=fresh_limiter(), runner_factory=lambda: runner, llm=llm, fallback=lambda q: "keyword answer")
    assert c.post("/api/chat", json={"question": "hi"}).get_json()["answer"] == "keyword answer"
    assert runner.closed


def test_fallback_when_no_runner_or_runner_factory_raises():
    c = make_client(limiter=fresh_limiter(), runner_factory=lambda: None, fallback=lambda q: "fb1")
    assert c.post("/api/chat", json={"question": "hi"}).get_json()["answer"] == "fb1"

    def boom():
        raise RuntimeError("token not read-only")

    c = make_client(limiter=fresh_limiter(), runner_factory=boom, fallback=lambda q: "fb2")
    assert c.post("/api/chat", json={"question": "hi"}).get_json()["answer"] == "fb2"


def test_rate_limit_429_with_friendly_answer():
    c = make_client(limiter=fresh_limiter(per_minute=2), runner_factory=lambda: None, fallback=lambda q: "ok")
    assert [c.post("/api/chat", json={"question": "hi"}).status_code for _ in range(3)] == [200, 200, 429]
    body = c.post("/api/chat", json={"question": "hi"}).get_json()
    assert body["error"] == "Rate limit reached" and "wait" in body["answer"].lower() and body["retry_after"] > 0


def test_global_limit_message():
    c = make_client(limiter=fresh_limiter(global_per_day=1), runner_factory=lambda: None, fallback=lambda q: "ok")
    c.post("/api/chat", json={"question": "hi"})
    r = c.post("/api/chat", json={"question": "hi"}, headers={"X-Forwarded-For": "9.9.9.9"})
    assert r.status_code == 429 and "contact form" in r.get_json()["answer"]


def test_unexpected_error_returns_friendly_200():
    def bad(q):
        raise RuntimeError("kaboom with secret details")

    c = make_client(limiter=fresh_limiter(), runner_factory=lambda: None, fallback=bad)
    r = c.post("/api/chat", json={"question": "hi"})
    assert r.status_code == 200 and "kaboom" not in r.get_data(as_text=True)


def test_import_error_message():
    def bad(q):
        raise ImportError("openai")

    c = make_client(limiter=fresh_limiter(), runner_factory=lambda: None, fallback=bad)
    assert "not configured" in c.post("/api/chat", json={"question": "hi"}).get_json()["answer"]


def test_question_text_never_logged(caplog):
    caplog.set_level(logging.DEBUG)
    c = make_client(limiter=fresh_limiter(), runner_factory=lambda: FakeRunner(), llm=sql_llm(), fallback=lambda q: "x")
    c.post("/api/chat", json={"question": "my very private question text"})
    assert "private question" not in caplog.text and "question_chars=" in caplog.text


def test_visitor_key_proxy_hops(monkeypatch):
    app = Flask(__name__)
    with app.test_request_context("/", headers={"X-Forwarded-For": "6.6.6.6, 1.1.1.1, 10.0.0.1"}, environ_base={"REMOTE_ADDR": "10.9.9.9"}):
        monkeypatch.delenv("CHAT_PROXY_HOPS", raising=False)
        k1 = visitor_key(request)
        monkeypatch.setenv("CHAT_PROXY_HOPS", "2")
        k2 = visitor_key(request)
    with app.test_request_context("/", headers={"X-Forwarded-For": "7.7.7.7, 1.1.1.1, 10.0.0.1"}):
        monkeypatch.setenv("CHAT_PROXY_HOPS", "2")
        k3 = visitor_key(request)  # forged left entry doesn't change the key
        monkeypatch.setenv("CHAT_PROXY_HOPS", "garbage")
        visitor_key(request)
    with app.test_request_context("/", environ_base={"REMOTE_ADDR": "5.5.5.5"}):
        k4 = visitor_key(request)
    assert k1 != k2 and k2 == k3 and k4 and len({k1, k2, k4}) == 3
