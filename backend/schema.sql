-- ===========================
-- PERSONAL PORTFOLIO DATABASE SCHEMA
-- ===========================
--
-- This schema is designed for production use with the following principles:
-- 1. Normalization: Tables are in 3NF (no redundant data)
-- 2. Data integrity: Appropriate constraints and checks
-- 3. Scalability: Indexed for common query patterns
-- 4. Compatibility: Works with both SQLite (dev) and PostgreSQL (prod)
--
-- Author: John Doe
-- Last Updated: 2026-01-11

-- ===========================
-- PROJECTS TABLE
-- ===========================
--
-- Stores portfolio project information.
-- Each project represents a technical achievement to showcase.
--
-- Design decisions:
-- - title: Limited to 200 chars for display consistency
-- - description: Up to 2000 chars to include problem statement + approach
-- - tech_stack: Comma-separated string for simplicity (denormalized choice)
--   Alternative: Separate tech_stack table with many-to-many relationship
--   Tradeoff: Current design favors simplicity over query flexibility
-- - github_url: Optional, for projects with public repos
-- - project_date: Human-meaningful project date (separate from created_at)
-- - created_at: Audit trail and ordering by recency (insert time)
-- - updated_at: Audit trail for edits

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- SQLite syntax
    -- id SERIAL PRIMARY KEY,               -- PostgreSQL syntax
    
    title TEXT NOT NULL CHECK(length(title) <= 200),
    description TEXT NOT NULL CHECK(length(description) <= 2000),
    tech_stack TEXT NOT NULL CHECK(length(tech_stack) <= 300),
    github_url TEXT CHECK(github_url IS NULL OR length(github_url) <= 300),
    project_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for displaying projects in reverse chronological order
CREATE INDEX IF NOT EXISTS idx_projects_created 
ON projects(created_at DESC);

-- ===========================
-- CONTACTS TABLE
-- ===========================
--
-- Stores contact form submissions.
-- Used to track inquiries from recruiters, collaborators, etc.
--
-- Design decisions:
-- - No sensitive data storage (passwords, tokens, etc.)
-- - Email validation happens at application layer
-- - message field limited to prevent abuse
-- - created_at for response time tracking
--
-- Future considerations:
-- - Add 'status' field (unread/read/responded)
-- - Add 'category' field (job/collaboration/other)
-- - Consider archival strategy for old messages

CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- SQLite syntax
    -- id SERIAL PRIMARY KEY,               -- PostgreSQL syntax
    
    name TEXT NOT NULL CHECK(length(name) <= 100),
    email TEXT NOT NULL CHECK(length(email) <= 100),
    message TEXT NOT NULL CHECK(length(message) <= 1000),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for retrieving recent contacts first
CREATE INDEX IF NOT EXISTS idx_contacts_created 
ON contacts(created_at DESC);

-- ===========================
-- SAMPLE DATA (OPTIONAL)
-- ===========================
--
-- Uncomment to populate with sample projects for testing/demo

/*
INSERT INTO projects (title, description, tech_stack, github_url) VALUES
(
    'Personal Portfolio Website',
    'Full-stack personal portfolio demonstrating production-ready engineering practices. Built with clean architecture, RESTful API design, and proper separation of concerns. Features include dynamic project loading, contact form with database storage, and admin panel for content management.',
    'Python, Flask, SQLite, HTML5, CSS3, JavaScript, RESTful API',
    'https://github.com/yourusername/portfolio'
),
(
    'E-commerce REST API',
    'Scalable backend API for e-commerce platform built with Flask and PostgreSQL. Implements JWT authentication, role-based access control, payment processing integration, and comprehensive test coverage. Designed with microservices architecture principles.',
    'Python, Flask, PostgreSQL, Redis, JWT, Stripe API, Docker',
    'https://github.com/yourusername/ecommerce-api'
),
(
    'Real-time Chat Application',
    'WebSocket-based chat application supporting multiple rooms, private messaging, and presence indicators. Features include message persistence, typing indicators, and read receipts. Demonstrates real-time communication patterns and state management.',
    'Python, Flask-SocketIO, JavaScript, WebSocket, Redis, PostgreSQL',
    'https://github.com/yourusername/chat-app'
);
*/

-- ===========================
-- POSTGRESQL MIGRATION NOTES
-- ===========================
--
-- When migrating from SQLite to PostgreSQL:
--
-- 1. Replace INTEGER PRIMARY KEY AUTOINCREMENT with SERIAL PRIMARY KEY
-- 2. Replace TEXT with VARCHAR(n) for consistency
-- 3. Ensure TIMESTAMP handling matches your timezone requirements
-- 4. Test all CHECK constraints (PostgreSQL is stricter than SQLite)
-- 5. Update connection string in environment variables
--
-- Example PostgreSQL connection string:
-- postgresql://user:password@host:port/database
--
-- Render.com provides this automatically via DATABASE_URL environment variable