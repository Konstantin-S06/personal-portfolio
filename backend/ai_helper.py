"""
AI Helper using Free Hugging Face API
Uses Meta's Llama model for text generation
"""

import os
import requests
import json

HF_API_KEY = os.getenv('HUGGING_FACE_API_KEY')
# Using Meta's Llama 2 - completely free!
MODEL_URL = "https://api-inference.huggingface.co/models/meta-llama/Llama-2-7b-chat-hf"

def query_llama(prompt, max_tokens=500):
    """
    Query Hugging Face's free Llama model
    """
    headers = {
        "Authorization": f"Bearer {HF_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "inputs": prompt,
        "parameters": {
            "max_new_tokens": max_tokens,
            "temperature": 0.1,  # Low temperature for factual responses
            "return_full_text": False
        }
    }
    
    try:
        response = requests.post(MODEL_URL, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        result = response.json()
        
        if isinstance(result, list) and len(result) > 0:
            return result[0].get('generated_text', '').strip()
        return None
        
    except Exception as e:
        print(f"Error calling Hugging Face API: {e}")
        return None


def create_sql_query(user_question):
    """
    Convert natural language to SQL using free AI
    """
    
    prompt = f"""You are a SQL expert. Convert this question to a PostgreSQL SELECT query.

DATABASE SCHEMA:
Table: projects
Columns: id, title, description, tech_stack, github_url, created_at

RULES:
1. ONLY generate SELECT queries
2. Return ONLY the SQL query, nothing else
3. If question is not about projects, return exactly: INVALID_QUESTION

Question: {user_question}

SQL Query:"""

    sql_query = query_llama(prompt, max_tokens=150)
    
    if not sql_query:
        return None
        
    # Clean up the response
    sql_query = sql_query.strip()
    
    # Validate it's a SELECT query
    if sql_query.upper().startswith('SELECT'):
        return sql_query
    elif 'INVALID_QUESTION' in sql_query:
        return None
    else:
        return None


def format_sql_results(user_question, results):
    """
    Format SQL results into natural language
    """
    
    if not results or len(results) == 0:
        results_text = "No results found"
    else:
        results_text = str(results[:5])  # Limit to first 5 results
    
    prompt = f"""You are a helpful assistant. Answer this question about Konstantin's portfolio projects.

Question: {user_question}
Database Results: {results_text}

Provide a friendly, concise answer (2-3 sentences max). If no results, say you couldn't find matching projects.

Answer:"""

    answer = query_llama(prompt, max_tokens=200)
    
    if answer:
        return answer
    else:
        return "I found some results but had trouble formatting the response. Please try rephrasing your question."


def get_schema_info():
    """Returns database schema"""
    return """
    Table: projects
    Columns:
    - id: INTEGER
    - title: VARCHAR(200)
    - description: VARCHAR(2000)  
    - tech_stack: VARCHAR(300)
    - github_url: VARCHAR(300)
    - created_at: TIMESTAMP
    """