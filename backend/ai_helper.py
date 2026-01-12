"""
AI Helper using Free Groq API
Much faster and more reliable than Hugging Face
"""

import os
from groq import Groq

# Initialize Groq client
GROQ_API_KEY = os.getenv('GROQ_API_KEY')
client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

def create_sql_query(user_question):
    """
    Convert natural language to SQL using Groq's fast LLM
    """
    
    if not client:
        print("ERROR: GROQ_API_KEY not set")
        return None
    
    # Determine database type for correct placeholder syntax
    DATABASE_URL = os.getenv('DATABASE_URL')
    placeholder = '%s' if DATABASE_URL else '?'
    
    system_prompt = f"""You are a SQL expert. Convert questions to PostgreSQL SELECT queries.

DATABASE SCHEMA:
Table: projects
- id (integer)
- title (varchar 200)
- description (varchar 2000)
- tech_stack (varchar 300)
- github_url (varchar 300)
- created_at (timestamp)

RULES:
1. ONLY generate SELECT queries
2. Return ONLY the SQL query, nothing else (no explanation)
3. Use {placeholder} as placeholder (not ? or $1)
4. For "how many" questions, use COUNT(*)
5. For "most recent", use ORDER BY created_at DESC LIMIT 1
6. For technology searches, use ILIKE '%technology%' on tech_stack or description
7. If question is not about Konstantin's projects, return exactly: INVALID

EXAMPLES:
"How many projects?" -> SELECT COUNT(*) FROM projects
"Projects with Python?" -> SELECT title FROM projects WHERE tech_stack ILIKE '%Python%'
"Most recent project?" -> SELECT title, description FROM projects ORDER BY created_at DESC LIMIT 1
"What's the weather?" -> INVALID"""

    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",  # Fast and accurate
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_question}
            ],
            temperature=0.1,
            max_tokens=200
        )
        
        sql_query = completion.choices[0].message.content.strip()
        
        print(f"AI generated SQL: {sql_query}")
        
        # Validate response
        if 'INVALID' in sql_query.upper():
            return None
        
        if sql_query.upper().startswith('SELECT'):
            return sql_query
        
        print(f"Invalid SQL format: {sql_query}")
        return None
        
    except Exception as e:
        print(f"Error calling Groq API: {e}")
        return None


def format_sql_results(user_question, results):
    """
    Format SQL results into natural language using Groq
    """
    
    if not client:
        return "AI service not configured."
    
    if not results or len(results) == 0:
        results_text = "No results found"
    else:
        # Limit to first 5 results for readability
        results_text = str(results[:5])
    
    system_prompt = """You are a helpful assistant answering questions about Konstantin Shtop's software engineering portfolio.

Be friendly, concise (2-3 sentences max), and natural. If no results, say you couldn't find matching projects."""

    user_prompt = f"""Question: {user_question}

Database Results: {results_text}

Provide a natural answer based on these results."""

    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3,
            max_tokens=150
        )
        
        answer = completion.choices[0].message.content.strip()
        return answer
        
    except Exception as e:
        print(f"Error formatting results: {e}")
        if len(results) > 0:
            return f"I found {len(results)} result(s) in Konstantin's portfolio."
        else:
            return "I couldn't find any matching projects in Konstantin's portfolio."