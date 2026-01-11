"""
Flask Backend for Personal Portfolio

This backend provides a RESTful API for managing portfolio projects
and contact form submissions. It demonstrates production-ready practices:
- Environment-based configuration
- SQL injection prevention via parameterized queries
- Input validation
- Proper HTTP status codes
- CORS handling for cross-origin requests
- Clean separation of concerns

Author: John Doe
"""

import os
import sqlite3
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from db import init_db, get_db_connection

# ===========================
# APPLICATION SETUP
# ===========================

app = Flask(__name__)

# CORS configuration - allows frontend to make requests from different origin
# In production, replace '*' with your specific frontend domain
CORS(app, resources={
    r"/api/*": {
        "origins": "*",  # Change to your GitHub Pages URL in production
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    }
})

# Environment-based configuration
# Set these as environment variables in production
app.config['DATABASE'] = os.getenv('DATABASE_PATH', 'portfolio.db')
app.config['ENV'] = os.getenv('FLASK_ENV', 'production')

# Initialize database on startup
with app.app_context():
    init_db()

# ===========================
# API ROUTES
# ===========================

@app.route('/api/projects', methods=['GET'])
def get_projects():
    """
    GET /api/projects
    
    Returns all projects from the database.
    Response format: {"projects": [...]}
    
    Status codes:
    - 200: Success
    - 500: Server error
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Fetch all projects, ordered by most recent first
        cursor.execute('''
            SELECT id, title, description, tech_stack, github_url
            FROM projects
            ORDER BY id DESC
        ''')
        
        projects = []
        for row in cursor.fetchall():
            projects.append({
                'id': row[0],
                'title': row[1],
                'description': row[2],
                'tech_stack': row[3],
                'github_url': row[4]
            })
        
        conn.close()
        
        return jsonify({'projects': projects}), 200
        
    except Exception as e:
        app.logger.error(f"Error fetching projects: {str(e)}")
        return jsonify({'error': 'Failed to fetch projects'}), 500


@app.route('/api/projects', methods=['POST'])
def create_project():
    """
    POST /api/projects
    
    Creates a new project in the database.
    
    Expected JSON body:
    {
        "title": "Project Title",
        "description": "Project description",
        "tech_stack": "Python, Flask, SQL",
        "github_url": "https://github.com/..." (optional)
    }
    
    Status codes:
    - 201: Created successfully
    - 400: Invalid input
    - 500: Server error
    """
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['title', 'description', 'tech_stack']
        for field in required_fields:
            if not data.get(field) or not data.get(field).strip():
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # Extract and sanitize data
        title = data['title'].strip()
        description = data['description'].strip()
        tech_stack = data['tech_stack'].strip()
        github_url = data.get('github_url', '').strip() or None
        
        # Additional validation
        if len(title) > 200:
            return jsonify({'error': 'Title too long (max 200 characters)'}), 400
        
        if len(description) > 2000:
            return jsonify({'error': 'Description too long (max 2000 characters)'}), 400
        
        if len(tech_stack) > 300:
            return jsonify({'error': 'Tech stack too long (max 300 characters)'}), 400
        
        # Validate GitHub URL if provided
        if github_url and not github_url.startswith('http'):
            return jsonify({'error': 'Invalid GitHub URL'}), 400
        
        # Insert into database using parameterized query (prevents SQL injection)
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO projects (title, description, tech_stack, github_url)
            VALUES (?, ?, ?, ?)
        ''', (title, description, tech_stack, github_url))
        
        conn.commit()
        project_id = cursor.lastrowid
        conn.close()
        
        return jsonify({
            'message': 'Project created successfully',
            'project_id': project_id
        }), 201
        
    except Exception as e:
        app.logger.error(f"Error creating project: {str(e)}")
        return jsonify({'error': 'Failed to create project'}), 500


@app.route('/api/contact', methods=['POST'])
def submit_contact():
    """
    POST /api/contact
    
    Stores contact form submission in database.
    
    Expected JSON body:
    {
        "name": "Full Name",
        "email": "email@example.com",
        "message": "Message content"
    }
    
    Status codes:
    - 201: Created successfully
    - 400: Invalid input
    - 500: Server error
    """
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['name', 'email', 'message']
        for field in required_fields:
            if not data.get(field) or not data.get(field).strip():
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # Extract and sanitize data
        name = data['name'].strip()
        email = data['email'].strip()
        message = data['message'].strip()
        
        # Additional validation
        if len(name) > 100:
            return jsonify({'error': 'Name too long (max 100 characters)'}), 400
        
        if len(email) > 100:
            return jsonify({'error': 'Email too long (max 100 characters)'}), 400
        
        if len(message) > 1000:
            return jsonify({'error': 'Message too long (max 1000 characters)'}), 400
        
        # Basic email format validation
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Insert into database using parameterized query
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO contacts (name, email, message)
            VALUES (?, ?, ?)
        ''', (name, email, message))
        
        conn.commit()
        contact_id = cursor.lastrowid
        conn.close()
        
        return jsonify({
            'message': 'Contact form submitted successfully',
            'contact_id': contact_id
        }), 201
        
    except Exception as e:
        app.logger.error(f"Error submitting contact form: {str(e)}")
        return jsonify({'error': 'Failed to submit contact form'}), 500


@app.route('/api/health', methods=['GET'])
def health_check():
    """
    GET /api/health
    
    Simple health check endpoint for deployment monitoring.
    
    Returns:
    - 200: Service is healthy
    """
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat()
    }), 200


# ===========================
# ERROR HANDLERS
# ===========================

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Endpoint not found'}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors"""
    return jsonify({'error': 'Method not allowed'}), 405


@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500


# ===========================
# APPLICATION ENTRY POINT
# ===========================

if __name__ == '__main__':
    # Development server configuration
    # In production, use a WSGI server like Gunicorn
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_ENV') == 'development'
    
    app.run(
        host='0.0.0.0',  # Allow external connections
        port=port,
        debug=debug
    )