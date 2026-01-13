"""
AI Helper using Free Google Gemini API
Improved with better error handling and logging
"""

import os
import re
import logging
import google.generativeai as genai

# Set up logging - this will show in Render logs
logger = logging.getLogger(__name__)

# Configure Gemini
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    # Use gemini-pro as it's the most stable and widely available model
    # Alternative: 'gemini-1.5-pro' or 'gemini-1.5-flash-latest' if available
    model = genai.GenerativeModel('gemini-pro')
    logger.info("Gemini model initialized successfully with gemini-pro")
else:
    model = None
    logger.error("GEMINI_API_KEY not set - model is None")

def create_sql_query(user_question):
    """
    Convert natural language to SQL using Gemini
    """
    
    if not model:
        logger.error("GEMINI_API_KEY not set - model is None")
        return None
    
    logger.info(f"Creating SQL query for: {user_question}")
    
    # Determine database type
    DATABASE_URL = os.getenv('DATABASE_URL')
    
    # Simpler, more direct prompt
    prompt = f"""Convert this question to a SQL SELECT query for a PostgreSQL database.

TABLE: projects
COLUMNS: id, title, description, tech_stack, github_url, created_at

RULES:
- Return ONLY the SQL query (no explanation, no markdown)
- Use SELECT queries only
- Use ILIKE for text searches
- For counting: SELECT COUNT(*) FROM projects
- For newest: ORDER BY created_at DESC LIMIT 1
- If not about projects, return: INVALID

EXAMPLES:
"How many projects?" → SELECT COUNT(*) FROM projects
"Python projects?" → SELECT title FROM projects WHERE tech_stack ILIKE '%Python%'
"Latest project?" → SELECT title, description FROM projects ORDER BY created_at DESC LIMIT 1
"Weather?" → INVALID

Question: {user_question}

SQL:"""

    try:
        logger.info("Calling Gemini API...")
        response = model.generate_content(
            prompt,
            generation_config={
                'temperature': 0.1,  # Very low for consistent SQL
                'max_output_tokens': 200
            }
        )
        logger.info("Got response from Gemini API")
        
        # Handle response - try multiple ways to get the text
        raw_response = None
        try:
            # Try the standard way first
            raw_response = response.text.strip()
            preview = raw_response[:100] if raw_response else "(empty)"
            logger.info(f"Got response.text: {preview}...")
        except AttributeError as attr_error:
            logger.error(f"response.text failed (AttributeError): {attr_error}")
            # Try alternative access methods
            try:
                if hasattr(response, 'candidates') and response.candidates:
                    if hasattr(response.candidates[0], 'content'):
                        if hasattr(response.candidates[0].content, 'parts'):
                            raw_response = response.candidates[0].content.parts[0].text.strip()
                            logger.info("Got response via candidates[0].content.parts[0].text")
                if not raw_response:
                    logger.error("Could not extract text from response using any method")
                    return None
            except Exception as alt_error:
                logger.error(f"Alternative text extraction failed: {alt_error}", exc_info=True)
                return None
        except Exception as text_error:
            logger.error(f"Failed to extract text from response: {text_error}", exc_info=True)
            return None
        
        if not raw_response:
            logger.error("raw_response is empty or None")
            return None
        
        logger.info(f"Raw Gemini response: {raw_response}")
        
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
        logger.error(f"Gemini API call failed: {e}", exc_info=True)
        return None


def format_sql_results(user_question, results):
    """
    Format SQL results into natural language using Gemini
    """
    
    if not model:
        return "AI service not configured."
    
    if not results or len(results) == 0:
        results_text = "No results found in database"
        num_results = 0
    else:
        num_results = len(results)
        # Limit to first 5 results for readability
        results_text = str(results[:5])
    
    logger.info(f"Formatting {num_results} results")
    
    prompt = f"""Answer this question about Konstantin Shtop's portfolio in a friendly way (2-3 sentences).

Question: {user_question}
Data from database: {results_text}

If no results, say you couldn't find matching projects. Be natural and conversational.

Answer:"""

    try:
        response = model.generate_content(
            prompt,
            generation_config={
                'temperature': 0.7,  # More creative for natural language
                'max_output_tokens': 150
            }
        )
        
        # Handle response - try multiple ways to get the text
        answer = None
        try:
            answer = response.text.strip()
            logger.info(f"Formatted answer: {answer}")
        except AttributeError as attr_error:
            logger.error(f"response.text failed in format_sql_results (AttributeError): {attr_error}")
            # Try alternative access methods
            try:
                if hasattr(response, 'candidates') and response.candidates:
                    if hasattr(response.candidates[0], 'content'):
                        if hasattr(response.candidates[0].content, 'parts'):
                            answer = response.candidates[0].content.parts[0].text.strip()
                            logger.info("Got formatted answer via candidates[0].content.parts[0].text")
            except Exception as alt_error:
                logger.error(f"Alternative text extraction failed in format_sql_results: {alt_error}", exc_info=True)
        
        if answer:
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