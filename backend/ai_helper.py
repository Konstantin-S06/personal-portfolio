"""
AI Helper using Hugging Face via OpenAI-compatible router
Uses multiple models with fallback
"""

import os
import re
import logging
from openai import OpenAI

# Set up logging
logger = logging.getLogger(__name__)

# Configure Hugging Face via OpenAI-compatible API
HF_API_KEY = os.getenv('HUGGINGFACE_API_KEY') or os.getenv('HF_TOKEN')

if HF_API_KEY:
    try:
        client = OpenAI(
            base_url="https://router.huggingface.co/v1",
            api_key=HF_API_KEY,
        )
        logger.info("Hugging Face OpenAI-compatible client configured")
    except Exception as e:
        logger.error(f"Failed to initialize client: {e}")
        client = None
else:
    client = None
    logger.error("HUGGINGFACE_API_KEY or HF_TOKEN not set")

# Models to try in order
MODELS = [
    "openai/gpt-oss-20b:groq",  # Original model
    "mistralai/Mistral-7B-Instruct-v0.2",  # Alternative
    "meta-llama/Llama-3.2-3B-Instruct",  # Smaller alternative
]


def call_hf_api(prompt, max_tokens=200, temperature=0.1):
    """
    Call Hugging Face API with model fallback
    """
    if not client:
        logger.error("Client not configured")
        return None
    
    for model in MODELS:
        try:
            logger.info(f"Trying model: {model}")
            completion = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=temperature,
            )
            
            if completion and completion.choices and len(completion.choices) > 0:
                message = completion.choices[0].message
                if message and hasattr(message, 'content'):
                    content = message.content
                    if content:
                        text = str(content).strip()
                        if text:
                            logger.info(f"Success with {model}: {text[:100]}...")
                            return text
            
            logger.warning(f"Empty response from {model}, trying next...")
            
        except Exception as e:
            logger.warning(f"Model {model} failed: {e}, trying next...")
            continue
    
    logger.error("All models failed")
    return None


def create_sql_query(user_question):
    """
    Convert natural language to SQL using AI
    """
    if not client:
        logger.error("Client not configured")
        return None
    
    logger.info(f"Creating SQL for: {user_question}")
    
    # Simple, direct prompt
    prompt = f"""Generate a PostgreSQL SELECT query for this question.

Database: projects table
Columns: id, title, description, tech_stack, github_url, created_at

Question: {user_question}

Return only the SQL query, no explanation:"""

    response = call_hf_api(prompt, max_tokens=150, temperature=0.0)
    
    if not response:
        logger.error("No response from API")
        return None
    
    # Clean response
    sql_query = response.strip()
    
    # Remove markdown
    sql_query = re.sub(r'```sql\n?', '', sql_query, flags=re.IGNORECASE)
    sql_query = re.sub(r'```\n?', '', sql_query)
    sql_query = re.sub(r'^(SQL|Query):\s*', '', sql_query, flags=re.IGNORECASE)
    
    # Get first SELECT line
    for line in sql_query.split('\n'):
        line = line.strip().rstrip(';')
        if line.upper().startswith('SELECT'):
            sql_query = line
            break
    
    logger.info(f"Cleaned SQL: {sql_query}")
    
    # Validate
    if not sql_query.upper().startswith('SELECT'):
        logger.warning(f"Not valid SQL: {sql_query}")
        return None
    
    # Security check
    dangerous = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE']
    if any(word in sql_query.upper() for word in dangerous):
        logger.error(f"Dangerous SQL blocked: {sql_query}")
        return None
    
    return sql_query


def format_sql_results(user_question, results, sql_query=None):
    """
    Format SQL results into natural language
    """
    if not client:
        return "AI not configured"
    
    if not results or len(results) == 0:
        return "No matching projects were found."
    
    is_count = sql_query and 'COUNT(*)' in sql_query.upper()
    
    if is_count:
        count = results[0][0] if results[0] else 0
        question_lower = user_question.lower()
        
        if 'hackathon' in question_lower:
            if any(word in question_lower for word in ['won', 'win', 'wins']):
                return f"Konstantin has won {count} hackathon{'s' if count != 1 else ''}."
            else:
                return f"Konstantin has competed in {count} hackathon{'s' if count != 1 else ''}."
        elif 'use' in question_lower or 'python' in question_lower or 'java' in question_lower:
            tech_match = re.search(r'use[sd]?\s+(\w+)', question_lower)
            if tech_match:
                tech = tech_match.group(1).capitalize()
                return f"Konstantin has {count} project{'s' if count != 1 else ''} that use{'s' if count == 1 else ''} {tech}."
        return f"Konstantin has {count} project{'s' if count != 1 else ''}."
    
    # Try AI formatting for non-count queries
    try:
        if len(results) == 1:
            row = results[0]
            prompt = f"""Answer this question about a project.

Question: {user_question}
Project: {row[0] if len(row) > 0 else ''}
Details: {row[1][:150] if len(row) > 1 else ''}

Answer in 1-2 sentences:"""
        else:
            project_list = '\n'.join([f"{i+1}. {row[0]}" for i, row in enumerate(results[:5]) if isinstance(row, tuple) and len(row) > 0])
            prompt = f"""Answer this question about projects.

Question: {user_question}
Projects:
{project_list}

Answer in 1-2 sentences:"""
        
        response = call_hf_api(prompt, max_tokens=150, temperature=0.3)
        if response and len(response) > 10:
            return response
    except Exception as e:
        logger.warning(f"AI formatting failed: {e}")
    
    # Fallback
    if len(results) == 1:
        return f"Found: {results[0][0]}"
    else:
        titles = [str(row[0]) for row in results[:3] if isinstance(row, tuple) and len(row) > 0]
        more = f" and {len(results)-3} more" if len(results) > 3 else ""
        return f"Found {len(results)} project{'s'}: {', '.join(titles)}{more}"
