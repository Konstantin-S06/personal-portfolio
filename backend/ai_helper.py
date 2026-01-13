"""
AI Helper using Free Google Gemini API
Improved with better error handling and logging
"""

import os
import re
import google.generativeai as genai

# Configure Gemini
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel('gemini-1.5-flash')
else:
    model = None

def create_sql_query(user_question):
    """
    Convert natural language to SQL using Gemini
    """
    
    if not model:
        print("ERROR: GEMINI_API_KEY not set")
        return None
    
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
- For counting: SELECT COUNT(*)
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
        response = model.generate_content(
            prompt,
            generation_config={
                'temperature': 0.1,  # Very low for consistent SQL
                'max_output_tokens': 200
            }
        )
        
        # Handle response - may raise exception if blocked/filtered
        try:
            raw_response = response.text.strip()
        except Exception as text_error:
            print(f"[ERROR] Failed to extract text from response: {text_error}")
            # Try to get candidates if available
            if hasattr(response, 'candidates') and response.candidates:
                if hasattr(response.candidates[0], 'content'):
                    raw_response = response.candidates[0].content.parts[0].text.strip()
                else:
                    print("[ERROR] Could not extract response text")
                    return None
            else:
                return None
        
        print(f"[DEBUG] Raw Gemini response: {raw_response}")
        
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
        
        print(f"[DEBUG] Cleaned SQL: {sql_query}")
        
        # Check for off-topic
        if 'INVALID' in sql_query.upper():
            print("[DEBUG] Question marked as INVALID (off-topic)")
            return None
        
        # Very flexible validation - just check if it's SQL-like
        if any(keyword in sql_query.upper() for keyword in ['SELECT', 'COUNT', 'FROM']):
            print(f"[DEBUG] Valid SQL detected: {sql_query}")
            return sql_query
        
        print(f"[DEBUG] Response doesn't look like SQL: {sql_query}")
        return None
        
    except Exception as e:
        print(f"[ERROR] Gemini API call failed: {e}")
        import traceback
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
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
    
    print(f"[DEBUG] Formatting {num_results} results")
    
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
        
        answer = response.text.strip()
        print(f"[DEBUG] Formatted answer: {answer}")
        return answer
        
    except Exception as e:
        print(f"[ERROR] Failed to format results: {e}")
        # Fallback response
        if num_results > 0:
            return f"I found {num_results} result(s) in Konstantin's portfolio projects."
        else:
            return "I couldn't find any matching projects in Konstantin's portfolio."