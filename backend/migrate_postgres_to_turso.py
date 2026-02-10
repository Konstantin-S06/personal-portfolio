"""
One-time migration: PostgreSQL (Render DATABASE_URL) -> Turso (libSQL / SQLite).

Reads from:
  - DATABASE_URL (PostgreSQL)
Writes to:
  - TURSO_DATABASE_URL (libsql://...)
  - TURSO_AUTH_TOKEN

Usage (locally or on Render shell):
  python migrate_postgres_to_turso.py --wipe-target
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime
from typing import Any, Iterable, List, Optional, Sequence, Tuple


def _iso(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    s = str(v).strip()
    return s or None


def _require_env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise RuntimeError(f"Missing required env var: {name}")
    return v


def _pg_connect():
    import psycopg

    return psycopg.connect(_require_env("DATABASE_URL"))


def _turso_client_sync():
    import libsql_client

    return libsql_client.create_client_sync(
        _require_env("TURSO_DATABASE_URL"),
        auth_token=os.getenv("TURSO_AUTH_TOKEN") or None,
    )


def _ensure_target_schema():
    # Use your existing init_db() logic (which will target Turso when TURSO_DATABASE_URL is set).
    from db import init_db

    init_db()


def _fetchall(cursor, sql: str, params: Optional[Sequence[Any]] = None) -> List[Tuple]:
    cursor.execute(sql, params or ())
    return list(cursor.fetchall())


def _wipe_target(turso):
    # Order matters due to foreign keys (none currently, but keep consistent).
    turso.execute("DELETE FROM contacts")
    turso.execute("DELETE FROM projects")


def _migrate_projects(pg_conn, turso, upsert: bool = True) -> int:
    pg = pg_conn.cursor()

    # Prefer updated_at if present; fall back to created_at.
    # (If updated_at doesn't exist in old DB, this will error; we handle it by trying a narrower select.)
    select_sql_candidates = [
        """
        SELECT id, title, description, tech_stack, github_url, project_date, created_at, updated_at
        FROM projects
        ORDER BY id ASC
        """,
        """
        SELECT id, title, description, tech_stack, github_url, project_date, created_at
        FROM projects
        ORDER BY id ASC
        """,
        """
        SELECT id, title, description, tech_stack, github_url, created_at
        FROM projects
        ORDER BY id ASC
        """,
    ]

    rows = None
    used_variant = None
    for variant, sql in enumerate(select_sql_candidates):
        try:
            rows = _fetchall(pg, sql)
            used_variant = variant
            break
        except Exception:
            continue

    if rows is None:
        raise RuntimeError("Unable to SELECT from PostgreSQL projects table (schema mismatch).")

    if used_variant == 0:
        # full
        def map_row(r):
            return (
                r[0],
                r[1],
                r[2],
                r[3],
                r[4],
                _iso(r[5]),  # project_date
                _iso(r[6]),  # created_at
                _iso(r[7]),  # updated_at
            )
    elif used_variant == 1:
        def map_row(r):
            created = _iso(r[6])
            return (
                r[0],
                r[1],
                r[2],
                r[3],
                r[4],
                _iso(r[5]),  # project_date
                created,
                created,  # updated_at
            )
    else:
        def map_row(r):
            created = _iso(r[5])
            return (
                r[0],
                r[1],
                r[2],
                r[3],
                r[4],
                None,     # project_date
                created,
                created,  # updated_at
            )

    count = 0
    if upsert:
        stmt = """
        INSERT OR REPLACE INTO projects
          (id, title, description, tech_stack, github_url, project_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """
    else:
        stmt = """
        INSERT INTO projects
          (id, title, description, tech_stack, github_url, project_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """

    for r in rows:
        turso.execute(stmt, list(map_row(r)))
        count += 1

    return count


def _migrate_contacts(pg_conn, turso, upsert: bool = True) -> int:
    pg = pg_conn.cursor()

    select_sql_candidates = [
        """
        SELECT id, name, email, message, created_at
        FROM contacts
        ORDER BY id ASC
        """,
        """
        SELECT id, name, email, message
        FROM contacts
        ORDER BY id ASC
        """,
    ]

    rows = None
    used_variant = None
    for variant, sql in enumerate(select_sql_candidates):
        try:
            rows = _fetchall(pg, sql)
            used_variant = variant
            break
        except Exception:
            continue

    if rows is None:
        raise RuntimeError("Unable to SELECT from PostgreSQL contacts table (schema mismatch).")

    if used_variant == 0:
        def map_row(r):
            return (r[0], r[1], r[2], r[3], _iso(r[4]))
    else:
        def map_row(r):
            return (r[0], r[1], r[2], r[3], None)

    count = 0
    if upsert:
        stmt = """
        INSERT OR REPLACE INTO contacts
          (id, name, email, message, created_at)
        VALUES (?, ?, ?, ?, ?)
        """
    else:
        stmt = """
        INSERT INTO contacts
          (id, name, email, message, created_at)
        VALUES (?, ?, ?, ?, ?)
        """

    for r in rows:
        turso.execute(stmt, list(map_row(r)))
        count += 1

    return count


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(description="Migrate Postgres (DATABASE_URL) -> Turso (TURSO_DATABASE_URL).")
    parser.add_argument("--wipe-target", action="store_true", help="Delete all target rows before migrating.")
    parser.add_argument("--no-upsert", action="store_true", help="Use INSERT only (will fail on duplicates).")
    args = parser.parse_args(list(argv))

    # Validate env early
    _require_env("DATABASE_URL")
    _require_env("TURSO_DATABASE_URL")
    # TURSO_AUTH_TOKEN can be empty for file:// URLs, but required for libsql:// remote.

    _ensure_target_schema()

    pg_conn = _pg_connect()
    turso = _turso_client_sync()

    try:
        if args.wipe_target:
            _wipe_target(turso)

        upsert = not args.no_upsert
        pcount = _migrate_projects(pg_conn, turso, upsert=upsert)
        ccount = _migrate_contacts(pg_conn, turso, upsert=upsert)

        print(f"Migration complete. Projects: {pcount}, Contacts: {ccount}")
        return 0
    finally:
        try:
            pg_conn.close()
        except Exception:
            pass
        try:
            turso.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

