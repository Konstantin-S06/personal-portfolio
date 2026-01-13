"""
AI Helper using Hugging Face via OpenAI-compatible API
Improved with better error handling and logging
"""

import os
import re
import logging
from openai import OpenAI

# Set up logging - this will show in Render logs
logger = logging.getLogger(__name__)

# Configure Hugging Face via OpenAI-compatible API
HF_API_KEY = os.getenv('HUGGINGFACE_API_KEY') or os.getenv('HF_TOKEN')
HF_MODEL = "openai/gpt-oss-20b:groq"

if HF_API_KEY:
    client = OpenAI(
        base_url="https://router.huggingface.co/v1",
        api_key=HF_API_KEY,
    )
    logger.info(f"Hugging Face API configured with model: {HF_MODEL}")
else:
    client = None
    logger.error("HUGGINGFACE_API_KEY or HF_TOKEN not set")

def call_hf_api(prompt, max_tokens=200, temperature=0.1):
    """
    Call Hugging Face API using OpenAI-compatible interface
    """
    if not client:
        logger.error("Hugging Face client not configured")
        return None
    
    try:
        logger.info("Calling Hugging Face API...")
        completion = client.chat.completions.create(
            model=HF_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=max_tokens,
            temperature=temperature,
        )
        
        response_text = completion.choices[0].message.content.strip()
        logger.info(f"Got response from Hugging Face API: {response_text[:100]}...")
        return response_text
        
    except Exception as e:
        logger.error(f"Hugging Face API call failed: {e}", exc_info=True)
        return None

def create_sql_query(user_question):
    """
    Convert natural language to SQL using Hugging Face
    """
    
    if not client:
        logger.error("Hugging Face client not configured")
        return None
    
    logger.info(f"Creating SQL query for: {user_question}")
    
    # Determine database type
    DATABASE_URL = os.getenv('DATABASE_URL')
    
    # Flexible prompt that lets AI reason about questions
    prompt = f"""You are a SQL query generator for a portfolio projects database. Analyze the question and generate an appropriate PostgreSQL SELECT query.

DATABASE SCHEMA:
Table: projects
Columns: id, title, description, tech_stack (comma-separated technologies), github_url, created_at

INSTRUCTIONS:
- Return ONLY the SQL query (no explanation, no markdown, no code blocks)
- Use ILIKE for case-insensitive text searches with % wildcards
- If the question asks "how many" or "count", use SELECT COUNT(*) FROM projects with appropriate WHERE clause
- Understand variations in phrasing (e.g., "used X for", "uses X", "with X", "X projects" all mean searching tech_stack for X)
- For technology questions: search tech_stack column using ILIKE
- For hackathon/achievement questions: search description and title for relevant keywords
- For "all technologies" or "list technologies": SELECT tech_stack FROM projects (returns all tech_stack values)
- For subjective questions like "most impressive": SELECT all projects (SELECT * FROM projects) to let analysis happen later
- Be flexible with phrasing - understand the intent behind the question
- Only return a SQL query if the question is about projects/portfolio - be creative in matching questions to queries

EXAMPLES:
"How many projects?" → SELECT COUNT(*) FROM projects
"How many projects use Python?" → SELECT COUNT(*) FROM projects WHERE tech_stack ILIKE '%Python%'
"How many projects has Konstantin used java for?" → SELECT COUNT(*) FROM projects WHERE tech_stack ILIKE '%Java%'
"how many projects use python" → SELECT COUNT(*) FROM projects WHERE tech_stack ILIKE '%python%'
"How many hackathons has Konstantin won?" → SELECT COUNT(*) FROM projects WHERE (description ILIKE '%hackathon%' OR title ILIKE '%hackathon%') AND (description ILIKE '%won%' OR description ILIKE '%winning%' OR description ILIKE '%award%' OR description ILIKE '%prize%' OR description ILIKE '%first place%' OR description ILIKE '%1st place%' OR description ILIKE '%champion%')
"how many hackathon wins" → SELECT COUNT(*) FROM projects WHERE (description ILIKE '%hackathon%' OR title ILIKE '%hackathon%') AND (description ILIKE '%won%' OR description ILIKE '%winning%' OR description ILIKE '%award%' OR description ILIKE '%prize%' OR description ILIKE '%first place%' OR description ILIKE '%1st place%' OR description ILIKE '%champion%')
"What are all the technologies that Konstantin has used?" → SELECT tech_stack FROM projects
"What is the most impressive project?" → SELECT title, description, tech_stack FROM projects
"Python projects?" → SELECT title, description, tech_stack FROM projects WHERE tech_stack ILIKE '%Python%'
"Wellspring project?" → SELECT title, description, tech_stack FROM projects WHERE title ILIKE '%Wellspring%'
"Latest project?" → SELECT title, description, tech_stack FROM projects ORDER BY created_at DESC LIMIT 1

Question: {user_question}
SQL:"""

    try:
        raw_response = call_hf_api(prompt, max_tokens=200, temperature=0.1)
        
        if not raw_response:
            logger.error("No response from Hugging Face API")
            return None
        
        logger.info(f"Raw Hugging Face response (full): {raw_response}")
        
        # Clean up response - remove any markdown
        sql_query = raw_response
        
        # Remove code blocks
        if '```sql' in sql_query:
            sql_query = sql_query.split('```sql')[1].split('```')[0].strip()
        elif '```' in sql_query:
            sql_query = sql_query.split('```')[1].split('```')[0].strip()
        
        # Remove "SQL:" prefix if present
        sql_query = re.sub(r'^(SQL|Query):\s*', '', sql_query, flags=re.IGNORECASE)
        
        # Remove any trailing explanation
        sql_query = sql_query.split('\n')[0].strip()
        
        logger.info(f"Cleaned SQL: {sql_query}")

        # Very flexible validation - just check if it's SQL-like
        if any(keyword in sql_query.upper() for keyword in ['SELECT', 'COUNT', 'FROM']):
            logger.info(f"Valid SQL detected: {sql_query}")
            return sql_query

        logger.warning(f"Response doesn't look like SQL: {sql_query}")
        return None
        
    except Exception as e:
        logger.error(f"Error in create_sql_query: {e}", exc_info=True)
        return None


def format_sql_results(user_question, results, sql_query=None):
    """
    Format SQL results into natural language - simplified with direct formatting
    """
    
    if not results or len(results) == 0:
        return "No matching projects were found."
    
    # Detect query type
    is_count_query = sql_query and 'COUNT(*)' in sql_query.upper()
    question_lower = user_question.lower()
    is_all_technologies = 'technolog' in question_lower and ('all' in question_lower or 'list' in question_lower)
    
    # Handle COUNT queries directly - no AI needed
    if is_count_query:
        count = results[0][0] if results[0] else 0
        logger.info(f"COUNT query result: {count}")
        
        # Format based on question context
        if 'hackathon' in question_lower and ('won' in question_lower or 'win' in question_lower):
            return f"Konstantin has won {count} hackathon{'s' if count != 1 else ''}."
        elif 'project' in question_lower:
            return f"Konstantin has {count} project{'s' if count != 1 else ''}."
        else:
            return f"{count}"
    
    # Handle "all technologies" queries directly
    if is_all_technologies:
        # Extract all technologies from tech_stack results
        all_techs = set()
        for row in results:
            if isinstance(row, tuple) and len(row) > 0:
                tech_stack = row[0] if row[0] else ""
            else:
                tech_stack = str(row)
            
            # Split comma-separated technologies
            techs = [t.strip() for t in str(tech_stack).split(',') if t.strip()]
            all_techs.update(techs)
        
        if all_techs:
            tech_list = sorted(list(all_techs))
            return f"Konstantin has used: {', '.join(tech_list)}"
        else:
            return "No technologies found."
    
    # For other queries, try AI but with a simple fallback
    if not client:
        # Fallback: list project titles
        titles = []
        for row in results[:5]:  # Limit to 5
            if isinstance(row, tuple) and len(row) > 0:
                titles.append(str(row[0]))
        if titles:
            return f"Found {len(results)} project(s): {', '.join(titles)}"
        return f"Found {len(results)} result(s)."
    
    # Try AI formatting with simple prompt
    try:
        results_text = str(results[:10])  # Limit for prompt size
        prompt = f"""Question: {user_question}
Data: {results_text}

Answer the question concisely (1-2 sentences):"""
        
        answer = call_hf_api(prompt, max_tokens=150, temperature=0.7)
        if answer and answer.strip():
            return answer.strip()
    except Exception as e:
        logger.error(f"AI formatting failed: {e}")
    
    # Final fallback: list project titles
    titles = []
    for row in results[:5]:
        if isinstance(row, tuple) and len(row) > 0:
            titles.append(str(row[0]))
    if titles:
        return f"Found {len(results)} project(s): {', '.join(titles)}"
    return f"Found {len(results)} result(s)."
