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
    Format SQL results into natural language using Hugging Face
    """
    
    if not client:
        return "AI service not configured."
    
    # Detect query type
    is_count_query = sql_query and 'COUNT(*)' in sql_query.upper()
    is_tech_stack_query = sql_query and 'tech_stack' in sql_query.lower() and 'COUNT' not in sql_query.upper()
    
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
            # For better formatting, convert tuples to readable format
            # Include all results (not just first 5) for comprehensive analysis
            # Just use the raw results - the AI can parse them appropriately
            results_text = str(results)
            logger.info(f"Formatting {num_results} results")
    
    # Build prompt based on question type
    question_lower = user_question.lower()
    is_all_technologies = 'technolog' in question_lower and ('all' in question_lower or 'list' in question_lower or 'what are' in question_lower)
    is_impressive = 'impressive' in question_lower or 'best' in question_lower or 'favorite' in question_lower
    
    # Build a more focused prompt based on question type
    
    if is_all_technologies:
        prompt = f"""Question: {user_question}
Database results (tech_stack from all projects): {results_text}

Extract all unique technologies from the comma-separated tech_stack values. List them in a clear, comma-separated format.
Example format: "Konstantin has used: Python, JavaScript, React, Flask, Node.js"
Answer:"""
    elif is_impressive:
        prompt = f"""Question: {user_question}
Database results (all projects): {results_text}

Analyze the projects and identify the most impressive one based on complexity, technologies used, and descriptions. Name the project and give a brief reason (1-2 sentences).
Answer:"""
    elif is_count_query:
        prompt = f"""Question: {user_question}
Count result: {num_results}

Provide a clear, direct answer stating the count. Be precise and factual.
Answer:"""
    else:
        prompt = f"""Question: {user_question}
Database results: {results_text}

Provide a clear, professional answer based on the data (1-2 sentences). Be factual and concise.
Answer:"""

    try:
        # Use higher max_tokens for complex questions like "all technologies" or "most impressive"
        max_tokens = 250 if (is_all_technologies or is_impressive) else 150
        answer = call_hf_api(prompt, max_tokens=max_tokens, temperature=0.7)
        
        if answer and answer.strip():
            logger.info(f"Formatted answer: {answer}")
            return answer.strip()
        
        logger.warning(f"API returned empty answer for question: {user_question}")
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
