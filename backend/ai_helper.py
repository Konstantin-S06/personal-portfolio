"""
AI Helper using Hugging Face Inference API
Improved with better error handling and logging
"""

import os
import re
import logging
import requests

# Set up logging - this will show in Render logs
logger = logging.getLogger(__name__)

# Configure Hugging Face
HF_API_KEY = os.getenv('HUGGINGFACE_API_KEY')
HF_MODEL = "meta-llama/Llama-3.2-1B-Instruct"
HF_API_URL = f"https://api-inference.huggingface.co/models/{HF_MODEL}"

if HF_API_KEY:
    logger.info(f"Hugging Face API configured with model: {HF_MODEL}")
else:
    logger.error("HUGGINGFACE_API_KEY not set")

def call_hf_api(prompt, max_length=200, temperature=0.1):
    """
    Call Hugging Face Inference API
    """
    if not HF_API_KEY:
        logger.error("HUGGINGFACE_API_KEY not set")
        return None
    
    headers = {
        "Authorization": f"Bearer {HF_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "inputs": prompt,
        "parameters": {
            "max_new_tokens": max_length,
            "temperature": temperature,
            "return_full_text": False
        }
    }
    
    try:
        logger.info("Calling Hugging Face API...")
        response = requests.post(HF_API_URL, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        
        result = response.json()
        
        # Handle different response formats
        if isinstance(result, list) and len(result) > 0:
            if "generated_text" in result[0]:
                text = result[0]["generated_text"].strip()
            elif "summary_text" in result[0]:
                text = result[0]["summary_text"].strip()
            else:
                # Sometimes the text is directly in the list
                text = str(result[0]).strip()
        elif isinstance(result, dict):
            if "generated_text" in result:
                text = result["generated_text"].strip()
            else:
                text = str(result).strip()
        else:
            text = str(result).strip()
        
        logger.info(f"Got response from Hugging Face API: {text[:100]}...")
        return text
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Hugging Face API call failed: {e}", exc_info=True)
        if hasattr(e, 'response') and e.response is not None:
            logger.error(f"Response status: {e.response.status_code}, body: {e.response.text}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error calling Hugging Face API: {e}", exc_info=True)
        return None

def create_sql_query(user_question):
    """
    Convert natural language to SQL using Hugging Face
    """
    
    if not HF_API_KEY:
        logger.error("HUGGINGFACE_API_KEY not set")
        return None
    
    logger.info(f"Creating SQL query for: {user_question}")
    
    # Determine database type
    DATABASE_URL = os.getenv('DATABASE_URL')
    
    # Improved prompt for better project name recognition and flexible searches
    prompt = f"""Convert this question to a SQL SELECT query for a PostgreSQL database.

TABLE: projects
COLUMNS: id, title, description, tech_stack, github_url, created_at

RULES:
- Return ONLY the SQL query (no explanation, no markdown)
- Use SELECT queries only
- Use ILIKE for case-insensitive text searches
- Search in title, description, AND tech_stack when looking for keywords
- For project names: search title with ILIKE (e.g., "Wellspring" matches "Wellspring Attendance analysis")
- For questions about achievements/hackathons: search description with ILIKE
- For counting: SELECT COUNT(*) FROM projects
- For newest: ORDER BY created_at DESC LIMIT 1
- For listing: SELECT title, description, tech_stack FROM projects
- Only return INVALID if completely unrelated to projects/portfolio

EXAMPLES:
"How many projects?" → SELECT COUNT(*) FROM projects
"Python projects?" → SELECT title, description, tech_stack FROM projects WHERE tech_stack ILIKE '%Python%'
"Wellspring project?" → SELECT title, description, tech_stack FROM projects WHERE title ILIKE '%Wellspring%'
"Hackathons?" → SELECT title, description, tech_stack FROM projects WHERE description ILIKE '%hackathon%' OR title ILIKE '%hackathon%'
"Latest project?" → SELECT title, description, tech_stack FROM projects ORDER BY created_at DESC LIMIT 1
"What uses React?" → SELECT title, description, tech_stack FROM projects WHERE tech_stack ILIKE '%React%'
"Weather forecast?" → INVALID

Question: {user_question}

SQL:"""

    try:
        raw_response = call_hf_api(prompt, max_length=200, temperature=0.1)
        
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


def format_sql_results(user_question, results):
    """
    Format SQL results into natural language using Hugging Face
    """
    
    if not HF_API_KEY:
        return "AI service not configured."
    
    if not results or len(results) == 0:
        results_text = "No results found in database"
        num_results = 0
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
- If listing projects, mention them by name
- If no results, simply state that no matching projects were found
- Focus on factual information from the data

Answer:"""

    try:
        answer = call_hf_api(prompt, max_length=150, temperature=0.7)
        
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
