"""
Database Module for Portfolio Backend

Handles all database operations including:
- Database initialization
- Connection management
- Schema creation

This module separates database concerns from application logic,
making the codebase more maintainable and testable.

Uses SQLite for local development with a schema that's compatible
with PostgreSQL for production deployment.
"""

import sqlite3
import os

# ===========================
# DATABASE CONFIGURATION
# ===========================

# Default database path - can be overridden via environment variable
DATABASE_PATH = os.getenv('DATABASE_PATH', 'portfolio.db')


def get_db_connection():
    """
    Creates and returns a database connection.
    
    Returns:
        sqlite3.Connection: Database connection object
    
    Note:
        Row factory is set to sqlite3.Row for dict-like access,
        but we use tuple access in queries for clarity.
    """
    conn = sqlite3.connect(DATABASE_PATH)
    # Enable foreign key constraints (off by default in SQLite)
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def init_db():
    """
    Initializes the database with required tables.
    
    This function is idempotent - it can be called multiple times
    safely. Tables are only created if they don't exist.
    
    Schema design notes:
    - Uses INTEGER PRIMARY KEY for auto-incrementing IDs (SQLite)
    - Compatible with PostgreSQL SERIAL type for production migration
    - Includes constraints for data integrity
    - TIMESTAMP DEFAULT CURRENT_TIMESTAMP for audit trail
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create projects table
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
    
    # Create contacts table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL CHECK(length(name) <= 100),
            email TEXT NOT NULL CHECK(length(email) <= 100),
            message TEXT NOT NULL CHECK(length(message) <= 1000),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create index on created_at for efficient date-based queries
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
    
    print(f"Database initialized at {DATABASE_PATH}")


def reset_db():
    """
    Drops all tables and recreates the schema.
    
    WARNING: This function deletes all data. Only use for development/testing.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Drop tables if they exist
    cursor.execute('DROP TABLE IF EXISTS projects')
    cursor.execute('DROP TABLE IF EXISTS contacts')
    
    conn.commit()
    conn.close()
    
    # Recreate schema
    init_db()
    print("Database reset complete")


# ===========================
# MIGRATION UTILITIES
# ===========================

def get_postgresql_schema():
    """
    Returns the PostgreSQL-compatible schema for production deployment.
    
    Use this when migrating from SQLite to PostgreSQL on Render or Fly.io.
    
    Key differences from SQLite:
    - SERIAL instead of INTEGER PRIMARY KEY AUTOINCREMENT
    - VARCHAR(n) instead of TEXT with CHECK constraints
    - Explicit timestamp format
    
    Returns:
        str: SQL schema string for PostgreSQL
    """
    return '''
    -- Projects table
    CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        description VARCHAR(2000) NOT NULL,
        tech_stack VARCHAR(300) NOT NULL,
        github_url VARCHAR(300),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Contacts table
    CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL,
        message VARCHAR(1000) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_projects_created 
    ON projects(created_at DESC);
    
    CREATE INDEX IF NOT EXISTS idx_contacts_created 
    ON contacts(created_at DESC);
    '''


# ===========================
# MAIN EXECUTION
# ===========================

if __name__ == '__main__':
    """
    Command-line interface for database management.
    
    Usage:
        python db.py              # Initialize database
        python db.py reset        # Reset database (delete all data)
        python db.py postgres     # Print PostgreSQL schema
    """
    import sys
    
    if len(sys.argv) > 1:
        command = sys.argv[1]
        
        if command == 'reset':
            confirm = input("This will delete all data. Are you sure? (yes/no): ")
            if confirm.lower() == 'yes':
                reset_db()
            else:
                print("Reset cancelled")
        
        elif command == 'postgres':
            print("PostgreSQL Schema:")
            print("=" * 50)
            print(get_postgresql_schema())
        
        else:
            print(f"Unknown command: {command}")
            print("Available commands: reset, postgres")
    
    else:
        # Default: initialize database
        init_db()