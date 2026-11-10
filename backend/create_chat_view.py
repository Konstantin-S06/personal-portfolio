"""
Creates (or recreates) the chat_projects_v view. Run once from the backend folder,
using the normal WRITE credentials (TURSO_AUTH_TOKEN), after any schema change:

    python create_chat_view.py --dry-run     # print the SQL only
    python create_chat_view.py               # apply it

Turso/SQLite only. The chatbot will only ever read this view.
"""

import sys

from chat_sql import DROP_VIEW_SQL, VIEW_COLUMNS, VIEW_NAME, VIEW_SQL


def main() -> int:
    if "--dry-run" in sys.argv:
        print(DROP_VIEW_SQL + ";")
        print(VIEW_SQL + ";")
        return 0

    import db

    if db.IS_POSTGRES:
        print("This script supports Turso/SQLite only (the chat SQL path is off for Postgres).")
        return 1

    conn = db.get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(DROP_VIEW_SQL)
        cur.execute(VIEW_SQL)
        conn.commit()

        cur.execute(f"SELECT COUNT(*) FROM {VIEW_NAME}")
        print(f"{VIEW_NAME}: {cur.fetchone()[0]} rows")

        cur.execute(f"PRAGMA table_info({VIEW_NAME})")
        found = [str(r[1]) for r in cur.fetchall()]
        print("columns:", ", ".join(found))
        if found != list(VIEW_COLUMNS):
            print("WARNING: columns differ from chat_sql.VIEW_COLUMNS. Run the app once so init_db adds missing columns, then rerun.")
            return 2
    finally:
        conn.close()
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
