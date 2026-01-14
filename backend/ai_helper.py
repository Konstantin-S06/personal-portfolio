"""
AI Helper using Hugging Face API for SQL generation and result formatting
"""

import os
import re
import logging
from openai import OpenAI

# Set up logging
logger = logging.getLogger(__name__)

# Configure Hugging Face via OpenAI-compatible API
HF_API_KEY = os.getenv('HUGGINGFACE_API_KEY') or os.getenv('HF_TOKEN')
HF_MODEL = "openai/gpt-oss-20b:groq"

if HF_API_KEY:
    try:
        client = OpenAI(
            base_url="https://router.huggingface.co/v1",
            api_key=HF_API_KEY,
        )
        logger.info(f"Hugging Face API configured with model: {HF_MODEL}")
    except Exception as e:
        logger.error(f"Failed to initialize Hugging Face client: {e}")
        client = None
else:
    client = None
    logger.error("HUGGINGFACE_API_KEY or HF_TOKEN not set")


def call_hf_api(prompt, max_tokens=300, temperature=0.1):
    """
    Call Hugging Face API with proper error handling
    """
    if not client:
        logger.error("Hugging Face client not configured")
        return None
    
    try:
        logger.info("Calling Hugging Face API...")
        completion = client.chat.completions.create(
            model=HF_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=temperature,
        )
        
        # Check if response exists and has content
        if not completion or not completion.choices:
            logger.error("API returned no choices")
            return None
        
        message = completion.choices[0].message
        if not message or not hasattr(message, 'content'):
            logger.error("API response message has no content attribute")
            return None
        
        response_text = message.content
        if response_text is None:
            logger.error("API response content is None")
            return None
        
        response_text = response_text.strip()
        if not response_text:
            logger.warning("API returned empty string")
            return None
        
        logger.info(f"Got response from Hugging Face API: {response_text[:100]}...")
        return response_text
        
    except Exception as e:
        logger.error(f"Hugging Face API call failed: {e}", exc_info=True)
        return None


def create_sql_query(user_question):
    """
    Convert natural language to SQL using AI
    """
    if not client:
        logger.error("Hugging Face client not configured")
        return None
    
    logger.info(f"Creating SQL query for: {user_question}")
    
    prompt = f"""You are a SQL query generator for a portfolio projects database.

DATABASE SCHEMA:
Table: projects
Columns: id, title, description, tech_stack (comma-separated), github_url, created_at

TASK: Generate a PostgreSQL SELECT query for this question.

RULES:
- Return ONLY the SQL query, no explanation, no markdown
- Use ILIKE for case-insensitive searches with % wildcards
- For "how many" questions: use SELECT COUNT(*) FROM projects with WHERE if filtering
- For hackathon questions: 
  * "won"/"wins"/"winner" → filter by description containing both "hackathon" AND ("won"/"winning"/"award"/"prize"/"first place")
  * "competed"/"participated"/"competed in" → filter by description containing "hackathon" (no win requirement)
- For technology questions: search tech_stack column with ILIKE
- For "all technologies": SELECT tech_stack FROM projects
- For project names: search title column
- For subjective questions (impressive/best): SELECT all projects to analyze

EXAMPLES:
"How many projects?" → SELECT COUNT(*) FROM projects
"How many hackathons has Konstantin won?" → SELECT COUNT(*) FROM projects WHERE (description ILIKE '%hackathon%' OR title ILIKE '%hackathon%') AND (description ILIKE '%won%' OR description ILIKE '%winning%' OR description ILIKE '%award%' OR description ILIKE '%prize%' OR description ILIKE '%first place%')
"How many hackathons has Konstantin competed in?" → SELECT COUNT(*) FROM projects WHERE description ILIKE '%hackathon%' OR title ILIKE '%hackathon%'
"What technologies has Konstantin used?" → SELECT tech_stack FROM projects
"What projects use Python?" → SELECT title, description, tech_stack FROM projects WHERE tech_stack ILIKE '%Python%'

Question: {user_question}
SQL:"""

    try:
        raw_response = call_hf_api(prompt, max_tokens=200, temperature=0.1)
        
        if not raw_response:
            logger.error("No response from Hugging Face API")
            return None
        
        logger.info(f"Raw API response: {raw_response}")
        
        # Clean up response
        sql_query = raw_response
        
        # Remove code blocks
        if '```sql' in sql_query:
            sql_query = sql_query.split('```sql')[1].split('```')[0].strip()
        elif '```' in sql_query:
            sql_query = sql_query.split('```')[1].split('```')[0].strip()
        
        # Remove prefixes
        sql_query = re.sub(r'^(SQL|Query):\s*', '', sql_query, flags=re.IGNORECASE)
        
        # Get first line only (in case of explanations)
        sql_query = sql_query.split('\n')[0].strip()
        
        # Remove trailing semicolon
        sql_query = sql_query.rstrip(';')
        
        logger.info(f"Cleaned SQL: {sql_query}")
        
        # Validate it looks like SQL
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
    Format SQL results into natural language using AI
    """
    if not client:
        return "AI service not configured."
    
    if not results or len(results) == 0:
        return "No matching projects were found."
    
    # Prepare results data
    is_count_query = sql_query and 'COUNT(*)' in sql_query.upper()
    
    if is_count_query:
        count = results[0][0] if results[0] else 0
        results_text = f"Count: {count}"
    else:
        # Format results for AI
        formatted_results = []
        for row in results[:10]:  # Limit to 10 for prompt size
            if isinstance(row, tuple):
                if len(row) >= 3:
                    formatted_results.append({
                        'title': str(row[0]) if row[0] else '',
                        'description': str(row[1]) if len(row) > 1 and row[1] else '',
                        'tech_stack': str(row[2]) if len(row) > 2 and row[2] else ''
                    })
                elif len(row) == 1:
                    formatted_results.append({'tech_stack': str(row[0]) if row[0] else ''})
        results_text = str(formatted_results)
    
    # Build prompt
    prompt = f"""Answer this question about Konstantin Shtop's portfolio projects based on the database results.

Question: {user_question}
Database results: {results_text}

INSTRUCTIONS:
- Provide a clear, professional answer (1-3 sentences)
- Be factual and concise, avoid excessive enthusiasm
- If the question asks "how many", state the number clearly
- If asking about technologies, extract and list unique technologies from tech_stack (comma-separated)
- If asking about "most impressive" or "best", analyze the projects and name the most impressive one with a brief reason
- Mention project names when relevant
- If no results match, state that clearly

Answer:"""

    try:
        answer = call_hf_api(prompt, max_tokens=250, temperature=0.7)
        
        if answer and answer.strip():
            logger.info(f"Formatted answer: {answer}")
            return answer.strip()
        
        logger.warning("AI formatting returned empty, using fallback")
        
        # Fallback formatting
        if is_count_query:
            count = results[0][0] if results[0] else 0
            return f"{count}"
        else:
            titles = []
            for row in results[:5]:
                if isinstance(row, tuple) and len(row) > 0:
                    titles.append(str(row[0]))
            if titles:
                return f"Found {len(results)} project(s): {', '.join(titles)}"
            return f"Found {len(results)} result(s)."
        
    except Exception as e:
        logger.error(f"Error in format_sql_results: {e}", exc_info=True)
        # Fallback
        if is_count_query:
            count = results[0][0] if results[0] else 0
            return f"{count}"
        return f"Found {len(results)} result(s)."
