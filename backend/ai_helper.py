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
    
    # Improved prompt for better project name recognition and flexible searches
    prompt = f"""You are a SQL query generator. Convert the user's question into a PostgreSQL SELECT query.

TABLE: projects
COLUMNS: id, title, description, tech_stack, github_url, created_at

CRITICAL RULES:
1. If the question asks "how many" or "count", you MUST use: SELECT COUNT(*) FROM projects [WHERE clause if needed]
2. Return ONLY the SQL query - no explanations, no markdown, no code blocks
3. Use ILIKE for case-insensitive text matching (e.g., '%Python%' matches 'python', 'Python', 'PYTHON')
4. For technology searches: use tech_stack ILIKE '%TechnologyName%'
5. For hackathon/win questions: search description for 'hackathon', 'won', 'win', 'award', 'prize', 'first place', 'champion'
6. For project name searches: use title ILIKE '%ProjectName%'

EXAMPLES:
Question: "How many projects?" 
SQL: SELECT COUNT(*) FROM projects

Question: "How many projects use Python?"
SQL: SELECT COUNT(*) FROM projects WHERE tech_stack ILIKE '%Python%'

Question: "how many projects use python"
SQL: SELECT COUNT(*) FROM projects WHERE tech_stack ILIKE '%python%'

Question: "How many hackathons has Konstantin won?"
SQL: SELECT COUNT(*) FROM projects WHERE (description ILIKE '%hackathon%' OR title ILIKE '%hackathon%') AND (description ILIKE '%won%' OR description ILIKE '%win%' OR description ILIKE '%award%' OR description ILIKE '%prize%' OR description ILIKE '%first place%' OR description ILIKE '%champion%')

Question: "Python projects?"
SQL: SELECT title, description, tech_stack FROM projects WHERE tech_stack ILIKE '%Python%'

Question: "Wellspring project?"
SQL: SELECT title, description, tech_stack FROM projects WHERE title ILIKE '%Wellspring%'

Question: "Latest project?"
SQL: SELECT title, description, tech_stack FROM projects ORDER BY created_at DESC LIMIT 1

Question: "What uses React?"
SQL: SELECT title, description, tech_stack FROM projects WHERE tech_stack ILIKE '%React%'

Question: "Weather forecast?"
SQL: INVALID

Now convert this question:
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
        
        # Check for off-topic
        if 'INVALID' in sql_query.upper():
            logger.warning("Question marked as INVALID (off-topic)")
            return None
        
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
    Format SQL results into natural language using Hugging Face
    """
    
    if not client:
        return "AI service not configured."
    
    # Detect if this is a COUNT query
    is_count_query = sql_query and 'COUNT(*)' in sql_query.upper()
    
    if not results or len(results) == 0:
        results_text = "No results found in database"
        num_results = 0
    else:
        if is_count_query:
            # For COUNT queries, extract the actual count value
            num_results = results[0][0] if results[0] else 0
            results_text = f"Count: {num_results}"
            logger.info(f"COUNT query result: {num_results}")
        else:
            num_results = len(results)
            # Limit to first 5 results for readability
            results_text = str(results[:5])
            logger.info(f"Formatting {num_results} results")
    
    prompt = f"""Answer this question about Konstantin Shtop's portfolio projects in a clear, professional manner.

Question: {user_question}
Data from database: {results_text}

INSTRUCTIONS:
- Provide a direct, informative answer (1-2 sentences)
- Be professional and concise - avoid excessive enthusiasm or asterisks
- If the question asks "how many", state the exact number from the data (e.g., "Konstantin has X projects that use Python")
- If listing projects, mention them by name
- If no results (count is 0), simply state that no matching projects were found
- Focus on factual information from the data
- Do not add asterisks or excessive praise

Answer:"""

    try:
        answer = call_hf_api(prompt, max_tokens=150, temperature=0.7)
        
        if answer:
            logger.info(f"Formatted answer: {answer}")
            return answer
        
        # Fallback response if we couldn't extract the answer
        if num_results > 0:
            return f"I found {num_results} result(s) in Konstantin's portfolio projects."
        else:
            return "I couldn't find any matching projects in Konstantin's portfolio."
        
    except Exception as e:
        logger.error(f"Failed to format results: {e}", exc_info=True)
        # Fallback response
        if num_results > 0:
            return f"I found {num_results} result(s) in Konstantin's portfolio projects."
        else:
            return "I couldn't find any matching projects in Konstantin's portfolio."
