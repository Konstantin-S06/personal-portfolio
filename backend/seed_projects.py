"""
Seed/upsert projects from backend/projects.json, matched by title. Idempotent.

Usage (from the backend/ directory, so local SQLite resolves the same portfolio.db as the app):
    python seed_projects.py [path/to/projects.json]
    python seed_projects.py --prune                    # dry run: list DB rows whose title is not in the file
    python seed_projects.py --prune --yes              # delete those rows
    python seed_projects.py --confirm-remote           # required when the target is Turso or PostgreSQL

The file may be a top-level array or {"projects": [...]}. Every entry is validated with
project_validation.validate_project (the same rules POST /api/projects uses); if any entry
is invalid, nothing is written and the script exits non-zero.

Uses whichever database db.py selects (Turso, Postgres or SQLite).
Prints a created/updated/skipped summary.
"""

import argparse
import json
import os
import sys
from urllib.parse import urlparse

from db import init_db, get_db_connection, IS_POSTGRES, IS_TURSO, TURSO_DATABASE_URL
from project_validation import validate_project, DEFAULT_SORT_ORDER, EXTRA_FIELDS

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "projects.json")
PH = "%s" if IS_POSTGRES else "?"

# Every column the seed owns (fixed whitelist, safe to interpolate).
COLS = ["title", "description", "tech_stack", "github_url", "project_date"] + list(EXTRA_FIELDS)


def _db_date(d):
    if d is None:
        return None
    return d if IS_POSTGRES else d.isoformat()


def _norm(col, v):
    """Normalize a stored/new value so they can be compared."""
    if col == "project_date":
        return None if v is None else (v.isoformat() if hasattr(v, "isoformat") else str(v))
    if col == "featured":
        return int(v or 0)
    if col == "sort_order":
        return DEFAULT_SORT_ORDER if v is None else int(v)
    return v


def load_items(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        if not isinstance(data.get("projects"), list):
            raise ValueError('projects.json object must contain a "projects" list')
        data = data["projects"]
    if not isinstance(data, list):
        raise ValueError('projects.json must be a list or {"projects": [...]}')
    return data


def describe_database():
    """Return (human-readable label, is_remote). Never includes credentials."""
    if IS_TURSO:
        host = urlparse(TURSO_DATABASE_URL).hostname or "unknown host"
        return f"Turso (libSQL) at {host}", True
    if IS_POSTGRES:
        return "PostgreSQL (DATABASE_URL)", True
    # Mirrors db.get_db_connection(), which opens 'portfolio.db' relative to the working directory.
    return f"SQLite file {os.path.abspath('portfolio.db')}", False


def _prune(cur, conn, keep_titles, apply):
    """List (and optionally delete) rows whose title is not in keep_titles."""
    cur.execute("SELECT id, title FROM projects ORDER BY id")
    stale = [(row[0], row[1]) for row in cur.fetchall() if row[1] not in keep_titles]

    if not stale:
        print("Prune: no database rows are missing from projects.json.")
        return 0

    if not apply:
        print(f"Prune (dry run): {len(stale)} row(s) not in projects.json would be deleted:")
        for pid, title in stale:
            print(f"  id={pid} title={title!r}")
        print("Nothing deleted. Re-run with --prune --yes to delete them.")
        return 0

    for pid, title in stale:
        cur.execute(f"DELETE FROM projects WHERE id = {PH}", (pid,))
        print(f"  deleted id={pid} title={title!r}")
    conn.commit()
    print(f"Prune: {len(stale)} row(s) deleted.")
    return 0


def seed(path=DEFAULT_PATH, prune=False, yes=False, confirm_remote=False):
    try:
        items = load_items(path)
    except (OSError, ValueError) as e:
        print(f"Cannot load {path}: {e}")
        return 1

    label, is_remote = describe_database()
    print(f"Database: {label}")

    # Validate everything before touching the database.
    cleaned = []
    errors = []
    for i, item in enumerate(items):
        clean, err = validate_project(item)
        if err:
            title = item.get("title") if isinstance(item, dict) else "?"
            errors.append(f"#{i} ({title}): {err}")
        else:
            cleaned.append(clean)

    if errors:
        print(f"Validation failed for {len(errors)} of {len(items)} entries in {path}. Nothing was written.")
        for e in errors:
            print(f"  invalid: {e}")
        return 1

    if is_remote and not confirm_remote:
        print("Refusing to run against a remote database without --confirm-remote. Nothing was written.")
        return 2

    if prune and not cleaned:
        print("Refusing to prune: projects.json has no valid entries, so every row would be treated as stale.")
        return 1

    init_db()  # make sure the schema (including new columns) exists

    conn = get_db_connection()
    cur = conn.cursor()
    created = updated = skipped = 0

    try:
        for clean in cleaned:
            # The seed file is the source of truth: omitted optional fields get defaults.
            clean.setdefault("featured", 0)
            clean.setdefault("sort_order", DEFAULT_SORT_ORDER)
            for c in EXTRA_FIELDS:
                clean.setdefault(c, None)
            new = {c: _norm(c, clean[c]) for c in COLS}

            cur.execute(f"SELECT id, {', '.join(COLS)} FROM projects WHERE title = {PH} ORDER BY id LIMIT 1",
                        (clean["title"],))
            row = cur.fetchone()

            if row is None:
                cur.execute(
                    f"INSERT INTO projects ({', '.join(COLS)}) VALUES ({', '.join([PH] * len(COLS))})",
                    tuple(_db_date(clean[c]) if c == "project_date" else clean[c] for c in COLS),
                )
                created += 1
                continue

            old = {c: _norm(c, row[idx + 1]) for idx, c in enumerate(COLS)}
            if old == new:
                skipped += 1
                continue

            set_sql = ", ".join(f"{c} = {PH}" for c in COLS)
            cur.execute(
                f"UPDATE projects SET {set_sql}, updated_at = CURRENT_TIMESTAMP WHERE id = {PH}",
                tuple(_db_date(clean[c]) if c == "project_date" else clean[c] for c in COLS) + (row[0],),
            )
            updated += 1

        conn.commit()

        print(f"Seed complete: {created} created, {updated} updated, {skipped} skipped, 0 invalid")

        if prune:
            _prune(cur, conn, {c["title"] for c in cleaned}, apply=yes)
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upsert projects from projects.json into the configured database.")
    parser.add_argument("path", nargs="?", default=DEFAULT_PATH, help="path to projects.json")
    parser.add_argument("--prune", action="store_true",
                        help="also list rows whose title is not in projects.json (dry run unless --yes)")
    parser.add_argument("--yes", action="store_true", help="with --prune, actually delete the listed rows")
    parser.add_argument("--confirm-remote", action="store_true",
                        help="required when the target database is Turso or PostgreSQL")
    args = parser.parse_args()

    if args.yes and not args.prune:
        parser.error("--yes only applies together with --prune")

    sys.exit(seed(args.path, prune=args.prune, yes=args.yes, confirm_remote=args.confirm_remote))
