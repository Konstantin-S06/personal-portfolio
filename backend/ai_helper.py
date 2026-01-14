"""
AI Helper using Hugging Face Inference API (Free, No Limits)
Uses Qwen model which is fast and good at SQL
"""

import os
import re
import logging
import requests
import json

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Hugging Face API setup
HF_API_KEY = os.getenv('HUGGINGFACE_API_KEY') or os.getenv('HF_TOKEN')
HF_API_URL = "https://api-inference.huggingface.co/models/Qwen/Qwen2.5-Coder-32B-Instruct"

if not HF_API_KEY:
    logger.error("HUGGINGFACE_API_KEY not set!")


def call_hf_api(prompt, max_tokens=300, temperature=0.1):
    """
    Call Hugging Face Inference API directly (simpler and more reliable)
    """
    if not HF_API_KEY:
        logger.error("No API key configured")
        return None
    
    headers = {
        "Authorization": f"Bearer {HF_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "inputs": prompt,
        "parameters": {
            "max_new_tokens": max_tokens,
            "temperature": temperature,
            "return_full_text": False,
            "do_sample": False  # Deterministic for SQL generation
        }
    }
    
    try:
        logger.info("Calling Hugging Face API...")
        response = requests.post(HF_API_URL, headers=headers, json=payload, timeout=30)
        
        if response.status_code == 503:
            logger.warning("Model is loading, waiting 20 seconds...")
            import time
            time.sleep(20)
            response = requests.post(HF_API_URL, headers=headers, json=payload, timeout=30)
        
        response.raise_for_status()
        result = response.json()
        
        logger.info(f"Raw API response: {result}")
        
        # Handle different response formats
        if isinstance(result, list) and len(result) > 0:
            text = result[0].get('generated_text', '')
        elif isinstance(result, dict):
            text = result.get('generated_text', '')
        else:
            logger.error(f"Unexpected response format: {result}")
            return None
        
        if not text:
            logger.error("Empty response from API")
            return None
        
        logger.info(f"Generated text: {text[:200]}...")
        return text.strip()
        
    except requests.exceptions.Timeout:
        logger.error("API request timed out")
        return None
    except requests.exceptions.RequestException as e:
        logger.error(f"API request failed: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        return None


def create_sql_query(user_question):
    """
    Convert natural language to SQL using Qwen (better at coding tasks)
    """
    if not HF_API_KEY:
        logger.error("No API key")
        return None
    
    logger.info(f"Creating SQL for: {user_question}")
    
    # Very simple, direct prompt
    prompt = f"""Convert this question to a PostgreSQL SELECT query.

Database: projects table
Columns: id, title, description, tech_stack, github_url, created_at

Rules:
- Return ONLY the SQL query
- No explanations
- Use ILIKE for text search
- For "how many", use COUNT(*)

Question: {user_question}

SQL:"""

    response = call_hf_api(prompt, max_tokens=100, temperature=0.0)
    
    if not response:
        logger.error("No response from API")
        return None
    
    # Clean the response
    sql_query = response.strip()
    
    # Remove markdown code blocks
    sql_query = re.sub(r'```sql\n?', '', sql_query, flags=re.IGNORECASE)
    sql_query = re.sub(r'```\n?', '', sql_query)
    
    # Get just the SQL line
    for line in sql_query.split('\n'):
        line = line.strip()
        if line.upper().startswith('SELECT'):
            sql_query = line.rstrip(';')
            break
    
    logger.info(f"Cleaned SQL: {sql_query}")
    
    # Validate
    if not sql_query.upper().startswith('SELECT'):
        logger.warning(f"Not valid SQL: {sql_query}")
        return None
    
    # Security check
    dangerous = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE']
    sql_upper = sql_query.upper()
    if any(word in sql_upper for word in dangerous):
        logger.error(f"Dangerous SQL blocked: {sql_query}")
        return None
    
    return sql_query


def format_sql_results(user_question, results, sql_query=None):
    """
    Format SQL results into natural language
    """
    if not HF_API_KEY:
        return "AI not configured"
    
    logger.info(f"Formatting {len(results)} results")
    
    if not results or len(results) == 0:
        return "I couldn't find any matching projects in Konstantin's portfolio."
    
    # Detect COUNT query
    is_count = sql_query and 'COUNT(*)' in sql_query.upper()
    
    if is_count:
        count = results[0][0]
        # Simple direct answer for counts
        return f"Konstantin has {count} project{'s' if count != 1 else ''} in his portfolio."
    
    # Format project results
    if len(results) == 1:
        row = results[0]
        if len(row) >= 2:
            prompt = f"""Answer in 1-2 friendly sentences.

Question: {user_question}
Project: {row[0]}
Details: {row[1][:150]}

Answer:"""
        else:
            return f"I found: {row[0]}"
    else:
        # Multiple results
        project_list = []
        for i, row in enumerate(results[:5], 1):
            if isinstance(row, tuple) and len(row) > 0:
                project_list.append(f"{i}. {row[0]}")
        
        projects_text = '\n'.join(project_list)
        more = f" (showing first 5 of {len(results)})" if len(results) > 5 else ""
        
        prompt = f"""Answer naturally in 1-2 sentences.

Question: {user_question}
Projects found{more}:
{projects_text}

Answer:"""
    
    response = call_hf_api(prompt, max_tokens=150, temperature=0.3)
    
    if response and len(response) > 10:
        return response
    
    # Fallback if AI formatting fails
    if len(results) == 1:
        return f"Found: {results[0][0]}"
    else:
        titles = [str(row[0]) for row in results[:3]]
        more = f" and {len(results)-3} more" if len(results) > 3 else ""
        return f"Found {len(results)} projects: {', '.join(titles)}{more}"
