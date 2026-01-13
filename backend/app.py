"""
Flask Backend for Personal Portfolio
Author: Konstantin Shtop
"""

import os
import logging
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from db import init_db, get_db_connection

# ===========================
# APPLICATION SETUP
# ===========================

app = Flask(__name__)

# Configure logging to show INFO level and above
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

CORS(app, resources={
    r"/api/*": {
        "origins": "*",
        "methods": ["GET", "POST", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    }
})

app.config['DATABASE'] = os.getenv('DATABASE_PATH', 'portfolio.db')
app.config['ENV'] = os.getenv('FLASK_ENV', 'production')

# Initialize database on startup
with app.app_context():
    init_db()

# Check database type once
DATABASE_URL = os.getenv('DATABASE_URL')

# ===========================
# API ROUTES
# ===========================

@app.route('/api/projects', methods=['GET'])
def get_projects():
    """GET /api/projects - Returns all projects"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
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
    """POST /api/projects - Creates a new project"""
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['title', 'description', 'tech_stack']
        for field in required_fields:
            if not data.get(field) or not data.get(field).strip():
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # Extract and sanitize
        title = data['title'].strip()
        description = data['description'].strip()
        tech_stack = data['tech_stack'].strip()
        github_url = data.get('github_url', '').strip() or None
        
        # Validation
        if len(title) > 200:
            return jsonify({'error': 'Title too long'}), 400
        if len(description) > 2000:
            return jsonify({'error': 'Description too long'}), 400
        if len(tech_stack) > 300:
            return jsonify({'error': 'Tech stack too long'}), 400
        if github_url and not github_url.startswith('http'):
            return jsonify({'error': 'Invalid GitHub URL'}), 400
        
        # Insert with correct placeholder syntax
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if DATABASE_URL:
            # PostgreSQL - use RETURNING to get the ID
            cursor.execute('''
                INSERT INTO projects (title, description, tech_stack, github_url)
                VALUES (%s, %s, %s, %s)
                RETURNING id
            ''', (title, description, tech_stack, github_url))
            project_id = cursor.fetchone()[0]
        else:
            # SQLite
            cursor.execute('''
                INSERT INTO projects (title, description, tech_stack, github_url)
                VALUES (?, ?, ?, ?)
            ''', (title, description, tech_stack, github_url))
            project_id = cursor.lastrowid
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'Project created successfully',
            'project_id': project_id
        }), 201
        
    except Exception as e:
        app.logger.error(f"Error creating project: {str(e)}")
        return jsonify({'error': f'Database error: {str(e)}'}), 500


@app.route('/api/projects/<int:project_id>', methods=['DELETE'])
def delete_project(project_id):
    """DELETE /api/projects/<id> - Deletes a project"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if project exists
        if DATABASE_URL:
            cursor.execute('SELECT id FROM projects WHERE id = %s', (project_id,))
        else:
            cursor.execute('SELECT id FROM projects WHERE id = ?', (project_id,))
        
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Project not found'}), 404
        
        # Delete the project
        if DATABASE_URL:
            cursor.execute('DELETE FROM projects WHERE id = %s', (project_id,))
        else:
            cursor.execute('DELETE FROM projects WHERE id = ?', (project_id,))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'Project deleted successfully',
            'project_id': project_id
        }), 200
        
    except Exception as e:
        app.logger.error(f"Error deleting project: {str(e)}")
        return jsonify({'error': f'Database error: {str(e)}'}), 500


@app.route('/api/contact', methods=['POST'])
def submit_contact():
    """POST /api/contact - Stores contact form"""
    try:
        data = request.get_json()
        
        required_fields = ['name', 'email', 'message']
        for field in required_fields:
            if not data.get(field) or not data.get(field).strip():
                return jsonify({'error': f'Missing field: {field}'}), 400
        
        name = data['name'].strip()
        email = data['email'].strip()
        message = data['message'].strip()
        
        if len(name) > 100 or len(email) > 100 or len(message) > 1000:
            return jsonify({'error': 'Input too long'}), 400
        
        if '@' not in email:
            return jsonify({'error': 'Invalid email'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if DATABASE_URL:
            # PostgreSQL - use RETURNING to get the ID
            cursor.execute('''
                INSERT INTO contacts (name, email, message)
                VALUES (%s, %s, %s)
                RETURNING id
            ''', (name, email, message))
            contact_id = cursor.fetchone()[0]
        else:
            # SQLite
            cursor.execute('''
                INSERT INTO contacts (name, email, message)
                VALUES (?, ?, ?)
            ''', (name, email, message))
            contact_id = cursor.lastrowid
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'Contact form submitted successfully',
            'contact_id': contact_id
        }), 201
        
    except Exception as e:
        app.logger.error(f"Error submitting contact: {str(e)}")
        return jsonify({'error': 'Failed to submit contact form'}), 500


@app.route('/api/admin/verify', methods=['POST'])
def verify_admin():
    """POST /api/admin/verify - Verifies admin password"""
    try:
        data = request.get_json()
        
        if not data.get('password'):
            return jsonify({'error': 'Password required'}), 400
        
        submitted_password = data['password'].strip()
        correct_password = os.getenv('ADMIN_PASSWORD', 'default_password_change_me')
        
        if submitted_password == correct_password:
            import time
            import hashlib
            
            token = hashlib.sha256(
                f"{correct_password}_{int(time.time())}".encode()
            ).hexdigest()[:32]
            
            return jsonify({'success': True, 'token': token}), 200
        else:
            return jsonify({'error': 'Invalid password'}), 401
            
    except Exception as e:
        app.logger.error(f"Error verifying admin: {str(e)}")
        return jsonify({'error': 'Verification failed'}), 500


@app.route('/api/chat', methods=['POST'])
def chat():
    """POST /api/chat - AI-powered chat using Hugging Face"""
    try:
        from ai_helper import create_sql_query, format_sql_results
        
        data = request.get_json()
        
        if not data.get('question') or not data.get('question').strip():
            return jsonify({'error': 'Question is required'}), 400
        
        question = data['question'].strip()
        app.logger.info(f"Chat question: {question}")
        
        if len(question) > 500:
            return jsonify({'error': 'Question too long'}), 400
        
        # Convert to SQL using Gemini
        app.logger.info(f"About to call create_sql_query with question: '{question}'")
        sql_query = create_sql_query(question)
        app.logger.info(f"create_sql_query returned: {sql_query}")
        
        if sql_query is None:
            app.logger.warning("No SQL generated - question may be off-topic or API error occurred. Check ai_helper logs above for details.")
            return jsonify({
                'answer': "I can answer questions about Konstantin's portfolio projects. Try asking about specific projects, technologies used, or the number of projects.",
                'sql_query': None
            }), 200
        
        # Execute query
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute(sql_query)
            results = cursor.fetchall()
            app.logger.info(f"Query returned {len(results)} results")
        except Exception as sql_error:
            app.logger.error(f"SQL execution error: {sql_error}")
            conn.close()
            return jsonify({
                'answer': "I had trouble with that question. Try: 'How many projects?' or 'List all projects'",
                'sql_query': sql_query
            }), 200
        
        conn.close()
        
        # Format with AI
        answer = format_sql_results(question, results)
        app.logger.info(f"Final answer: {answer}")
        
        return jsonify({
            'answer': answer,
            'sql_query': sql_query
        }), 200
        
    except ImportError:
        return jsonify({
            'answer': 'AI chat is not configured. Please set HUGGINGFACE_API_KEY.',
            'sql_query': None
        }), 200
    except Exception as e:
        app.logger.error(f"Chat error: {str(e)}")
        return jsonify({
            'answer': 'Sorry, I encountered an error. Please try again.',
            'sql_query': None
        }), 200


@app.route('/api/health', methods=['GET'])
def health_check():
    """GET /api/health - Health check"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat()
    }), 200


# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_ENV') == 'development'
    
    app.run(host='0.0.0.0', port=port, debug=debug)