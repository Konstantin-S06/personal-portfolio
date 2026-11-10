import base64
import json
import sqlite3
import types

import pytest

from readonly_db import (
    ReadOnlyTokenError,
    SqliteReadOnlyRunner,
    TursoReadOnlyRunner,
    require_readonly_token,
)


def jwt(payload):
    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    return f"{b64({'alg': 'EdDSA', 'typ': 'JWT'})}.{b64(payload)}.sig"


def test_accepts_readonly_without_expiry():
    require_readonly_token(jwt({"a": "ro", "iat": 1}))


def test_accepts_future_expiry():
    require_readonly_token(jwt({"a": "ro", "exp": 2000}), now=1000)


@pytest.mark.parametrize(
    "tok",
    [
        jwt({"a": "rw"}),
        jwt({"a": "ro_extra"}),
        jwt({}),
        jwt({"a": "ro", "exp": 5}),
        "",
        None,
        "not-a-jwt",
        "a.b.c",
        "a." + base64.urlsafe_b64encode(b"[1]").decode() + ".c",
    ],
)
def test_rejects_non_readonly_or_bad(tok):
    with pytest.raises(ReadOnlyTokenError):
        require_readonly_token(tok, now=1000)


def test_error_messages_never_contain_token():
    tok = jwt({"a": "rw", "secretmarker": "XYZ"})
    with pytest.raises(ReadOnlyTokenError) as e:
        require_readonly_token(tok)
    assert tok not in str(e.value) and "XYZ" not in str(e.value)


def test_turso_runner_refuses_write_token():
    with pytest.raises(ReadOnlyTokenError):
        TursoReadOnlyRunner("libsql://x", jwt({"a": "rw"}), conn=object())


def test_turso_runner_shapes_results_and_only_selects():
    seen = {}

    class Row:  # indexable like libsql_client rows
        def __init__(self, v):
            self.v = v

        def __getitem__(self, i):
            return self.v[i]

    class FakeConn:
        def _execute_with_fallback(self, sql, args):
            seen["call"] = (sql, args)
            return types.SimpleNamespace(columns=("title", "n"), rows=[Row(("A", 1)), Row(("B", 2))])

        def close(self):
            seen["closed"] = True

    r = TursoReadOnlyRunner("libsql://x", jwt({"a": "ro"}), conn=FakeConn())
    cols, rows = r.run("SELECT title, n FROM chat_projects_v WHERE id = ?", [3])
    assert list(cols) == ["title", "n"] and rows == [("A", 1), ("B", 2)]
    assert seen["call"] == ("SELECT title, n FROM chat_projects_v WHERE id = ?", [3])
    for bad in ("DELETE FROM projects", "  insert into x values (1)", "PRAGMA x", "DROP VIEW v"):
        with pytest.raises(ValueError):
            r.run(bad, [])
    r.close()
    assert seen["closed"]


def test_sqlite_runner_cannot_write(db_path, runner):
    with pytest.raises(ValueError):
        runner.run("DELETE FROM projects", [])
    # even bypassing the SELECT check, the connection itself is read-only
    with pytest.raises(sqlite3.OperationalError):
        runner._conn.execute("DELETE FROM projects")
    with pytest.raises(sqlite3.OperationalError):
        runner._conn.execute("CREATE TABLE zz (x INTEGER)")
    cols, rows = runner.run("SELECT COUNT(*) FROM projects", [])
    assert rows[0][0] == 4
