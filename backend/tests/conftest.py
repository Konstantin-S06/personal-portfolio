import os
import sqlite3
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chat_sql import VIEW_SQL  # noqa: E402

SECRET = "SECRET-SENTINEL-do-not-leak"

PROJECTS = [
    ("Alpha Platform", "Built a backend platform", "Python, Flask, SQL", "2026-06-01", "Alpha summary", "Backend dev", "Internship", "backend", 1, "https://github.com/secret/alpha"),
    ("Beta Bot", "A chat bot", "JavaScript, React", "2026-02-10", "Beta summary", "Solo", "Personal", "web", 1, "https://github.com/secret/beta"),
    ("Gamma Game", "Multiplayer battleship", "Python, Pygame", "2025-10-05", "Gamma summary", "Solo", "Personal", "game", 0, None),
    ("Delta Notes", "Undated note", "Node.js", None, None, None, None, None, 0, None),
]


@pytest.fixture()
def db_path(tmp_path):
    path = tmp_path / "portfolio.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, tech_stack TEXT,
            project_date DATE, summary TEXT, role TEXT, context TEXT, category TEXT,
            featured INTEGER NOT NULL DEFAULT 0, github_url TEXT, demo_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, sort_order INTEGER DEFAULT 100
        );
        CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT, email TEXT, message TEXT);
        """
    )
    for p in PROJECTS:
        conn.execute(
            "INSERT INTO projects (title, description, tech_stack, project_date, summary, role, context, category, featured, github_url) VALUES (?,?,?,?,?,?,?,?,?,?)",
            p,
        )
    conn.execute("INSERT INTO contacts (name, email, message) VALUES (?,?,?)", ("Visitor", "leak@example.com", SECRET))
    conn.execute(VIEW_SQL)
    conn.commit()
    conn.close()
    return str(path)


@pytest.fixture()
def runner(db_path):
    from readonly_db import SqliteReadOnlyRunner

    r = SqliteReadOnlyRunner(db_path)
    yield r
    r.close()
