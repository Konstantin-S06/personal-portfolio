"""
Database Module for Portfolio Backend - PostgreSQL Compatible
"""

import os

# Get database URL from environment
DATABASE_URL = os.getenv('DATABASE_URL')

def get_db_connection():
    """
    Creates and returns a database connection.
    Uses PostgreSQL in production, SQLite for local development.
    """
    if DATABASE_URL:
        # Production: Use PostgreSQL
        import psycopg2
        conn = psycopg2.connect(DATABASE_URL)
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
    
    if DATABASE_URL:
        # PostgreSQL syntax
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                description VARCHAR(2000) NOT NULL,
                tech_stack VARCHAR(300) NOT NULL,
                github_url VARCHAR(300),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    else:
        # SQLite syntax (for local development)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL CHECK(length(title) <= 200),
                description TEXT NOT NULL CHECK(length(description) <= 2000),
                tech_stack TEXT NOT NULL CHECK(length(tech_stack) <= 300),
                github_url TEXT CHECK(github_url IS NULL OR length(github_url) <= 300),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    
    conn.commit()
    conn.close()
    
    db_type = "PostgreSQL" if DATABASE_URL else "SQLite"
    print(f"Database initialized successfully using {db_type}")


def reset_db():
    """
    Drops all tables and recreates the schema.
    WARNING: This deletes all data. Only use for development/testing.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Drop tables if they exist
    cursor.execute('DROP TABLE IF EXISTS projects CASCADE')
    cursor.execute('DROP TABLE IF EXISTS contacts CASCADE')
    
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