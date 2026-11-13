"""
Read-only database access for the chatbot.

- Turso: refuses to build a runner unless the token's JWT says it is read-only
  (claim "a" == "ro") and unexpired. Reads TURSO_READONLY_AUTH_TOKEN, never the write token.
- Local SQLite (dev): opens the file with mode=ro and PRAGMA query_only.
- Postgres: not supported here; the caller falls back to the keyword logic.

Reminder: a read-only token can still read every table. chat_sql.validate_sql() is
what keeps queries on the chat_projects_v view.
"""

import base64
import json
import logging
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)


class ReadOnlyTokenError(Exception):
    """Token missing, malformed, expired, or not read-only. Messages never include the token."""


def _jwt_payload(token: str) -> dict:
    parts = (token or "").strip().split(".")
    if len(parts) != 3:
        raise ReadOnlyTokenError("token is not a JWT")
    seg = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(seg.encode("ascii")))
    except Exception:
        raise ReadOnlyTokenError("token payload could not be decoded")
    if not isinstance(payload, dict):
        raise ReadOnlyTokenError("token payload is not an object")
    return payload


def require_readonly_token(token: Optional[str], now: Optional[float] = None) -> None:
    if not token:
        raise ReadOnlyTokenError("no read-only token configured")
    payload = _jwt_payload(token)
    if payload.get("a") != "ro":
        raise ReadOnlyTokenError("token is not read-only")
    exp = payload.get("exp")
    if isinstance(exp, (int, float)) and exp < (time.time() if now is None else now):
        raise ReadOnlyTokenError("token has expired")


def _check_select(sql: str) -> None:
    # Last line of defence; chat_sql has already validated.
    if not sql.lstrip().upper().startswith("SELECT"):
        raise ValueError("runner only executes SELECT")


class TursoReadOnlyRunner:
    def __init__(self, url: str, token: str, fallback_url: Optional[str] = None, conn: Any = None):
        require_readonly_token(token)
        if conn is None:
            from db import _TursoConnection  # existing adapter

            conn = _TursoConnection(primary_url=url, auth_token=token, fallback_url=fallback_url)
        self._conn = conn

    def run(self, sql: str, args: Sequence[Any]) -> Tuple[Sequence[str], Sequence[Sequence[Any]]]:
        _check_select(sql)
        res = self._conn._execute_with_fallback(sql, list(args))
        cols = list(getattr(res, "columns", None) or [])
        rows = [tuple(row[i] for i in range(len(cols))) for row in (getattr(res, "rows", None) or [])]
        return cols, rows

    def close(self) -> None:
        self._conn.close()


class SqliteReadOnlyRunner:
    def __init__(self, path: str):
        uri = Path(path).resolve().as_uri() + "?mode=ro"
        self._conn = sqlite3.connect(uri, uri=True)
        self._conn.execute("PRAGMA query_only = ON")

    def run(self, sql: str, args: Sequence[Any]) -> Tuple[Sequence[str], Sequence[Sequence[Any]]]:
        _check_select(sql)
        cur = self._conn.execute(sql, list(args))
        cols = [d[0] for d in (cur.description or [])]
        return cols, cur.fetchall()

    def close(self) -> None:
        self._conn.close()


def get_readonly_runner():
    """
    Returns a runner, or None when NL-to-SQL should stay off (no read-only token, Postgres,
    no local DB). Raises ReadOnlyTokenError if a token is set but is NOT read-only/valid, so
    the caller can log loudly and disable the SQL path.
    """
    import db  # loads backend/.env before we read the environment

    if db.IS_TURSO:
        token = os.getenv("TURSO_READONLY_AUTH_TOKEN")
        if not token:
            return None
        primary = db._to_libsql_url(db.TURSO_DATABASE_URL)
        fallback = db._to_http_fallback_url(primary)
        return TursoReadOnlyRunner(primary, token, fallback_url=None if fallback == primary else fallback)
    if db.IS_POSTGRES:
        return None
    if os.path.exists("portfolio.db"):
        return SqliteReadOnlyRunner("portfolio.db")
    return None
