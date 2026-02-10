"""
Database Module for Portfolio Backend - PostgreSQL Compatible
"""

import os
import urllib.parse

# Load environment variables from backend/.env if present (local dev convenience).
# This keeps secrets out of git while allowing simple local setup.
try:
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
except Exception:
    pass

# Get database URL from environment
DATABASE_URL = os.getenv('DATABASE_URL')
TURSO_DATABASE_URL = os.getenv('TURSO_DATABASE_URL')
TURSO_AUTH_TOKEN = os.getenv('TURSO_AUTH_TOKEN')

# Prefer Turso if configured; Postgres only if Turso is not set.
IS_TURSO = bool(TURSO_DATABASE_URL)
IS_POSTGRES = bool(DATABASE_URL) and not IS_TURSO


def _to_libsql_url(url: str) -> str:
    """
    libsql_client expects URL schemes like:
    - libsql://... (Turso remote)
    - file:///... (local file)
    Users will typically provide TURSO_DATABASE_URL in the right libsql:// form.
    """
    u = str(url).strip()
    if not u:
        return u

    # libsql-client uses the URL path verbatim when building the ws/wss URL.
    # If the path is empty (e.g., "libsql://host"), it may produce "wss://host"
    # which can cause handshake failures. Normalize to at least "/" (i.e. "libsql://host/").
    try:
        parsed = urllib.parse.urlparse(u)
        if parsed.scheme in ("libsql", "ws", "wss", "http", "https") and (parsed.path == ""):
            u = urllib.parse.urlunparse(
                (parsed.scheme, parsed.netloc, "/", parsed.params, parsed.query, parsed.fragment)
            )
    except Exception:
        pass

    return u


def _to_http_fallback_url(url: str) -> str:
    """
    Convert libsql/ws/wss URLs to http/https for fallback transport.
    This avoids Hrana WebSocket handshake issues in some environments.
    """
    u = str(url).strip()
    if not u:
        return u
    try:
        parsed = urllib.parse.urlparse(u)
        scheme = parsed.scheme.lower()
        if scheme == "libsql":
            scheme = "https"
        elif scheme == "wss":
            scheme = "https"
        elif scheme == "ws":
            scheme = "http"
        elif scheme in ("https", "http", "file"):
            scheme = parsed.scheme
        else:
            scheme = parsed.scheme

        path = parsed.path or "/"
        return urllib.parse.urlunparse((scheme, parsed.netloc, path, parsed.params, parsed.query, parsed.fragment))
    except Exception:
        # Best-effort: simple replace
        if u.startswith("libsql://"):
            return "https://" + u[len("libsql://") :]
        if u.startswith("wss://"):
            return "https://" + u[len("wss://") :]
        if u.startswith("ws://"):
            return "http://" + u[len("ws://") :]
        return u


class _TursoCursor:
    def __init__(self, client_sync):
        self._client = client_sync
        self._last_result = None
        self.lastrowid = None

    def execute(self, sql, params=None):
        args = None
        if params is not None:
            # libsql_client accepts list/tuple of parameters
            if isinstance(params, tuple):
                args = list(params)
            else:
                args = params
        self._last_result = self._client.execute(str(sql), args)
        try:
            self.lastrowid = self._last_result.last_insert_rowid
        except Exception:
            self.lastrowid = None
        return self

    def fetchall(self):
        if not self._last_result:
            return []
        return list(getattr(self._last_result, "rows", []) or [])

    def fetchone(self):
        rows = self.fetchall()
        return rows[0] if rows else None


class _TursoConnection:
    def __init__(self, client_sync):
        self._client = client_sync

    def cursor(self):
        return _TursoCursor(self._client)

    def commit(self):
        # Turso/libSQL executes statements immediately; keep for API compatibility.
        return None

    def close(self):
        try:
            self._client.close()
        except Exception:
            pass

def _ensure_project_columns(cursor, is_postgres: bool):
    """
    Best-effort schema migration for existing databases.
    Adds:
    - project_date: an explicit date for the project (separate from created_at)
    - updated_at: last update timestamp
    """
    if is_postgres:
        cursor.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_date DATE")
        cursor.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
        return

    # SQLite: ADD COLUMN has no IF NOT EXISTS on older versions, so we try and ignore failures.
    try:
        cursor.execute("ALTER TABLE projects ADD COLUMN project_date DATE")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE projects ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    except Exception:
        pass


def get_db_connection():
    """
    Creates and returns a database connection.
    Uses Turso (libSQL / hosted SQLite) when configured, otherwise PostgreSQL,
    otherwise local SQLite for development.
    """
    if IS_TURSO:
        import libsql_client
        primary_url = _to_libsql_url(TURSO_DATABASE_URL)
        try:
            client = libsql_client.create_client_sync(
                primary_url,
                auth_token=TURSO_AUTH_TOKEN,
            )
            return _TursoConnection(client)
        except Exception as e:
            # Robust fallback: retry with HTTP transport (https://...) if WS handshake fails.
            fallback_url = _to_http_fallback_url(primary_url)
            if fallback_url and fallback_url != primary_url:
                client = libsql_client.create_client_sync(
                    fallback_url,
                    auth_token=TURSO_AUTH_TOKEN,
                )
                return _TursoConnection(client)
            raise e

    if IS_POSTGRES:
        # Production: Use PostgreSQL with psycopg3
        import psycopg
        conn = psycopg.connect(DATABASE_URL)
        return conn
    else:
        # Local development: Use SQLite
        import sqlite3
        conn = sqlite3.connect('portfolio.db')
        conn.execute('PRAGMA foreign_keys = ON')
        return conn


def init_db():
    """
    Initializes the database with required tables.
    Compatible with both PostgreSQL and SQLite.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if IS_POSTGRES:
        # PostgreSQL syntax
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                description VARCHAR(2000) NOT NULL,
                tech_stack VARCHAR(300) NOT NULL,
                github_url VARCHAR(300),
                project_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS contacts (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) NOT NULL,
                message VARCHAR(1000) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create indexes
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_projects_created 
            ON projects(created_at DESC)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_contacts_created 
            ON contacts(created_at DESC)
        ''')

        # Backfill/ensure columns on existing DBs
        _ensure_project_columns(cursor, is_postgres=True)
    else:
        # SQLite / libSQL (Turso) syntax
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL CHECK(length(title) <= 200),
                description TEXT NOT NULL CHECK(length(description) <= 2000),
                tech_stack TEXT NOT NULL CHECK(length(tech_stack) <= 300),
                github_url TEXT CHECK(github_url IS NULL OR length(github_url) <= 300),
                project_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL CHECK(length(name) <= 100),
                email TEXT NOT NULL CHECK(length(email) <= 100),
                message TEXT NOT NULL CHECK(length(message) <= 1000),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_projects_created 
            ON projects(created_at DESC)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_contacts_created 
            ON contacts(created_at DESC)
        ''')

        # Backfill/ensure columns on existing DBs
        _ensure_project_columns(cursor, is_postgres=False)
    
    conn.commit()
    conn.close()
    
    db_type = "Turso (libSQL)" if IS_TURSO else ("PostgreSQL" if IS_POSTGRES else "SQLite")
    print(f"Database initialized successfully using {db_type}")


def reset_db():
    """
    Drops all tables and recreates the schema.
    WARNING: This deletes all data. Only use for development/testing.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Drop tables if they exist
    if IS_POSTGRES:
        cursor.execute('DROP TABLE IF EXISTS projects CASCADE')
        cursor.execute('DROP TABLE IF EXISTS contacts CASCADE')
    else:
        cursor.execute('DROP TABLE IF EXISTS projects')
        cursor.execute('DROP TABLE IF EXISTS contacts')
    
    conn.commit()
    conn.close()
    
    # Recreate schema
    init_db()
    print("Database reset complete")


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == 'reset':
        confirm = input("This will delete all data. Are you sure? (yes/no): ")
        if confirm.lower() == 'yes':
            reset_db()
        else:
            print("Reset cancelled")
    else:
        init_db()