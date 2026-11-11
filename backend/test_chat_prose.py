"""Run from backend/:  python -m unittest test_chat_prose -v   (no network, no API key needed)"""
import json
import os
import unittest

import chat_prose
from chat_prose import add_prose, clean_prose, wants_prose
from chat_service import handle_chat
from chat_sql import RateLimiter

HERE = os.path.dirname(os.path.abspath(__file__))
GOOD = ("Konstantin does not rank his work, but the ECCC declaration system shows the most real-world impact "
        "and the Hanabi research shows his evaluation skills. Ask about any of the others.")


class Req:
    headers = {}
    remote_addr = "1.2.3.4"

    def __init__(self, q):
        self._q = q

    def get_json(self, silent=True):
        return {"question": self._q}


def no_runner():
    raise RuntimeError("no db in tests")


def load_rows():
    path = os.path.join(HERE, "projects.json")
    if not os.path.exists(path):
        raise unittest.SkipTest("projects.json not found next to the tests")
    with open(path, encoding="utf-8") as f:
        return json.load(f)["projects"]


def ask(q, prose_llm):
    rows = load_rows()
    return handle_chat(
        Req(q),
        limiter=RateLimiter(per_minute=999, per_day=9999, global_per_day=9999),
        runner_factory=no_runner,
        projects_loader=lambda: rows,
        prose_llm=prose_llm,
    )


class Wants(unittest.TestCase):
    body = {"kind": "list", "items": [{"title": "X"}]}

    def test_open_questions(self):
        self.assertTrue(wants_prose("What is the best project", self.body, "filter"))
        self.assertTrue(wants_prose("tell me about squirrl", {"kind": "text", "items": [{"title": "X"}]}, "project"))

    def test_plain_questions_stay_deterministic(self):
        self.assertFalse(wants_prose("Which projects are featured?", self.body, "filter"))
        self.assertFalse(wants_prose("How many projects use Python?", {"kind": "count", "items": [{}]}, "count"))
        self.assertFalse(wants_prose("best project links", self.body, "links"))
        self.assertFalse(wants_prose("best project", {"kind": "list", "items": []}, "filter"))


class Clean(unittest.TestCase):
    g = "Entries (2):\n1. A | Date: Jun 2026\n2. B | Date: Mar 2026\n2"

    def test_strips_markup(self):
        t = clean_prose("**Answer:** - They built A in a team. Worth a look for C# fans.", self.g)
        self.assertEqual(t, "They built A in a team. Worth a look for C# fans.")

    def test_rejects_links_and_refusals(self):
        self.assertIsNone(clean_prose("See https://example.com for the full story of project A.", self.g))
        self.assertIsNone(clean_prose("I'm sorry, but I can't help with that request today.", self.g))
        self.assertIsNone(clean_prose(None, self.g))
        self.assertIsNone(clean_prose("short", self.g))

    def test_rejects_invented_numbers(self):
        self.assertIsNone(clean_prose("They shipped 40 projects in 2026 and won every award.", self.g))
        self.assertIsNotNone(clean_prose("They worked on 2 of these in 2026, starting with A.", self.g))

    def test_trims_cut_off_replies(self):
        t = clean_prose("They built A in June 2026. They also built B, which is a", self.g)
        self.assertEqual(t, "They built A in June 2026.")

    def test_trims_long_replies(self):
        long = "They built A in 2026. " * 40
        t = clean_prose(long, self.g)
        self.assertLessEqual(len(t), chat_prose.PROSE_MAX_CHARS)
        self.assertTrue(t.endswith("."))


class Add(unittest.TestCase):
    def setUp(self):
        chat_prose._cache.clear()

    def test_end_to_end_best_project(self):
        calls = []

        def llm(messages, max_tokens, temperature):
            calls.append(messages)
            return GOOD

        body, status = ask("What is the best project", llm)
        self.assertEqual(status, 200)
        self.assertEqual(body["kind"], "list")
        self.assertEqual(body["prose"], GOOD)
        self.assertEqual(len(body["items"]), 6)
        self.assertEqual(len(calls), 1)
        sent = calls[0][1]["content"]
        self.assertNotIn("http", sent.lower())
        self.assertIn("Entries (6):", sent)

    def test_second_identical_question_uses_cache(self):
        n = []
        llm = lambda m, t, x: (n.append(1), GOOD)[1]
        ask("What is the best project", llm)
        ask("What is the best project", llm)
        self.assertEqual(len(n), 1)

    def test_plain_questions_never_call_the_model(self):
        def llm(*a):
            raise AssertionError("model must not be called")

        body, _ = ask("Which projects are featured?", llm)
        self.assertNotIn("prose", body)
        rows = load_rows()
        py = sum(1 for p in rows if "python" in [t.strip().lower() for t in p["tech_stack"].split(",")])
        body, _ = ask("How many projects use Python?", llm)
        self.assertEqual(body["kind"], "count")
        self.assertEqual(body["count"], py)

    def test_model_failures_keep_the_old_answer(self):
        def boom(*a):
            raise TimeoutError("slow")

        for llm in (boom, lambda *a: None, lambda *a: "ok", lambda *a: "See https://x.io for details on that."):
            chat_prose._cache.clear()
            body, status = ask("What is the best project", llm)
            self.assertEqual(status, 200)
            self.assertNotIn("prose", body)
            self.assertEqual(len(body["items"]), 6)

    def test_skips_are_logged_with_a_reason(self):
        with self.assertLogs("chat_prose", level="WARNING") as cm:
            ask("What is the best project", lambda *a: None)
        self.assertIn("model returned no text", cm.output[0])
        chat_prose._cache.clear()
        with self.assertLogs("chat_prose", level="WARNING") as cm:
            ask("What is the best project", lambda *a: "They have 99 projects and love every one of them dearly.")
        self.assertIn("numbers that are not in the data: 99", cm.output[0])

    def test_project_card_drops_repeated_summary(self):
        body, _ = ask("Tell me about Squirrl", lambda *a: "Squirrl turns Canvas assignments into quests and rewards finished work, a team project with friends and battles.")
        self.assertIn("prose", body)
        lines = body["answer"].split("\n")
        self.assertTrue(lines[0].startswith("Squirrl"))
        self.assertTrue(all(ln.startswith(("Built with:", "Role:", "Date:")) for ln in lines[1:]))


if __name__ == "__main__":
    unittest.main()