"""
AI Helper using Hugging Face API for SQL generation and result formatting
"""

import os
import re
import logging
import time
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


def call_hf_api(prompt, max_tokens=300, temperature=0.1, retries=2):
    """
    Call Hugging Face API with retry logic and detailed logging
    """
    if not client:
        logger.error("Hugging Face client not configured")
        return None
    
    for attempt in range(retries + 1):
        try:
            logger.info(f"Calling Hugging Face API (attempt {attempt + 1}/{retries + 1})...")
            completion = client.chat.completions.create(
                model=HF_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=temperature,
            )
            
            # Log the raw response structure
            logger.info(f"Response type: {type(completion)}")
            logger.info(f"Response dir: {[attr for attr in dir(completion) if not attr.startswith('_')]}")
            
            if not completion:
                logger.error("Completion object is None")
                if attempt < retries:
                    time.sleep(1)
                    continue
                return None
            
            if not hasattr(completion, 'choices') or not completion.choices:
                logger.error(f"API returned no choices. Completion: {completion}")
                if attempt < retries:
                    time.sleep(1)
                    continue
                return None
            
            choice = completion.choices[0]
            logger.info(f"Choice type: {type(choice)}")
            logger.info(f"Choice dir: {[attr for attr in dir(choice) if not attr.startswith('_')]}")
            
            if not hasattr(choice, 'message'):
                logger.error("Choice has no message attribute")
                if attempt < retries:
                    time.sleep(1)
                    continue
                return None
            
            message = choice.message
            logger.info(f"Message type: {type(message)}")
            logger.info(f"Message dir: {[attr for attr in dir(message) if not attr.startswith('_')]}")
            
            # Try different ways to access content
            if hasattr(message, 'content'):
                response_text = message.content
            elif hasattr(message, 'text'):
                response_text = message.text
            else:
                logger.error(f"Message has no content or text attribute. Message: {message}")
                # Try to convert to dict
                try:
                    if hasattr(message, 'model_dump'):
                        msg_dict = message.model_dump()
                        logger.info(f"Message as dict: {msg_dict}")
                        response_text = msg_dict.get('content') or msg_dict.get('text')
                    else:
                        response_text = str(message)
                except:
                    response_text = None
            
            if response_text is None:
                logger.error("Response content is None after all attempts")
                if attempt < retries:
                    time.sleep(1)
                    continue
                return None
            
            response_text = str(response_text).strip()
            
            if not response_text:
                logger.warning(f"API returned empty string on attempt {attempt + 1}")
                if attempt < retries:
                    time.sleep(1)
                    continue
                return None
            
            logger.info(f"Got response from Hugging Face API ({len(response_text)} chars): {response_text[:200]}...")
            return response_text
            
        except Exception as e:
            logger.error(f"Hugging Face API call failed (attempt {attempt + 1}): {e}", exc_info=True)
            if attempt < retries:
                time.sleep(1)
                continue
            return None
    
    return None


def create_sql_query(user_question):
    """
    Convert natural language to SQL using AI with a simple, direct prompt
    """
    if not client:
        logger.error("Hugging Face client not configured")
        return None
    
    logger.info(f"Creating SQL query for: {user_question}")
    
    # Much simpler, more direct prompt
    prompt = f"""Generate a PostgreSQL SELECT query for this question about a projects database.

Database table: projects
Columns: id, title, description, tech_stack, github_url, created_at

Question: {user_question}

Return only the SQL query, nothing else:"""

    try:
        raw_response = call_hf_api(prompt, max_tokens=150, temperature=0.0)
        
        if not raw_response:
            logger.error("No response from Hugging Face API")
            return None
        
        logger.info(f"Raw API response: {raw_response}")
        
        # Clean up response
        sql_query = raw_response.strip()
        
        # Remove code blocks
        if '```sql' in sql_query:
            sql_query = sql_query.split('```sql')[1].split('```')[0].strip()
        elif '```' in sql_query:
            sql_query = sql_query.split('```')[1].split('```')[0].strip()
        
        # Remove prefixes
        sql_query = re.sub(r'^(SQL|Query):\s*', '', sql_query, flags=re.IGNORECASE)
        
        # Get first line only
        sql_query = sql_query.split('\n')[0].strip().rstrip(';')
        
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
        # Format results simply
        formatted_results = []
        for row in results[:5]:
            if isinstance(row, tuple):
                if len(row) >= 3:
                    formatted_results.append(f"Title: {row[0]}, Description: {row[1]}, Tech: {row[2]}")
                elif len(row) == 1:
                    formatted_results.append(f"Tech: {row[0]}")
        results_text = "\n".join(formatted_results)
    
    # Simple prompt
    prompt = f"""Answer this question based on the data:

Question: {user_question}
Data: {results_text}

Answer in 1-2 sentences:"""

    try:
        answer = call_hf_api(prompt, max_tokens=200, temperature=0.5)
        
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
