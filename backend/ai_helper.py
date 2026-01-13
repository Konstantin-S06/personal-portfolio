"""
AI Helper using Free Google Gemini API
Completely free, unlimited, and very reliable
"""

import os
import google.generativeai as genai

# Configure Gemini
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel('gemini-1.5-flash')
else:
    model = None

def create_sql_query(user_question):
    """
    Convert natural language to SQL using Gemini
    """
    
    if not model:
        print("ERROR: GEMINI_API_KEY not set")
        return None
    
    # Determine database type
    DATABASE_URL = os.getenv('DATABASE_URL')
    
    prompt = f"""You are a SQL expert. Convert this question to a PostgreSQL SELECT query.

DATABASE SCHEMA:
Table: projects
- id (integer)
- title (varchar 200)
- description (varchar 2000)
- tech_stack (varchar 300)
- github_url (varchar 300)
- created_at (timestamp)

RULES:
1. Return ONLY the SQL query, nothing else
2. ONLY generate SELECT queries (no INSERT, UPDATE, DELETE)
3. For "how many" questions, use COUNT(*)
4. For "most recent", use ORDER BY created_at DESC LIMIT 1
5. For technology searches, use ILIKE '%technology%' on tech_stack or description
6. If question is NOT about Konstantin's projects, return exactly: INVALID

EXAMPLES:
Question: "How many projects?"
Answer: SELECT COUNT(*) FROM projects

Question: "Projects with Python?"
Answer: SELECT title, description FROM projects WHERE tech_stack ILIKE '%Python%' OR description ILIKE '%Python%'

Question: "Most recent project?"
Answer: SELECT title, description FROM projects ORDER BY created_at DESC LIMIT 1

Question: "What's the weather?"
Answer: INVALID

Now convert this question:
"{user_question}"

SQL Query:"""

    try:
        response = model.generate_content(prompt)
        sql_query = response.text.strip()
        
        # Remove markdown code blocks if present
        if '```sql' in sql_query:
            sql_query = sql_query.split('```sql')[1].split('```')[0].strip()
        elif '```' in sql_query:
            sql_query = sql_query.split('```')[1].split('```')[0].strip()
        
        print(f"Gemini generated SQL: {sql_query}")
        
        # Validate response
        if 'INVALID' in sql_query.upper():
            print("Question is off-topic")
            return None
        
        if sql_query.upper().startswith('SELECT'):
            return sql_query
        
        print(f"Invalid SQL format: {sql_query}")
        return None
        
    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        return None


def format_sql_results(user_question, results):
    """
    Format SQL results into natural language using Gemini
    """
    
    if not model:
        return "AI service not configured."
    
    if not results or len(results) == 0:
        results_text = "No results found"
    else:
        # Limit to first 5 results
        results_text = str(results[:5])
    
    prompt = f"""You are answering a question about Konstantin Shtop's software engineering portfolio.

Question: {user_question}
Database Results: {results_text}

Provide a friendly, natural answer in 2-3 sentences. If no results, say you couldn't find matching projects.

Answer:"""

    try:
        response = model.generate_content(prompt)
        answer = response.text.strip()
        return answer
        
    except Exception as e:
        print(f"Error formatting results: {e}")
        if len(results) > 0:
            return f"I found {len(results)} result(s) in Konstantin's portfolio."
        else:
            return "I couldn't find any matching projects in Konstantin's portfolio."