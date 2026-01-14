"""
AI Helper using Hugging Face via OpenAI-compatible router
Simplified and reliable SQL generation with strict validation
"""

import os
import re
import logging
from openai import OpenAI

# Set up logging
logger = logging.getLogger(__name__)

# Configure Hugging Face API
HF_API_KEY = os.getenv('HUGGINGFACE_API_KEY') or os.getenv('HF_TOKEN')

if HF_API_KEY:
    try:
        client = OpenAI(
            base_url="https://router.huggingface.co/v1",
            api_key=HF_API_KEY,
        )
        logger.info("Hugging Face API client configured")
    except Exception as e:
        logger.error(f"Failed to initialize client: {e}")
        client = None
else:
    client = None
    logger.error("HUGGINGFACE_API_KEY or HF_TOKEN not set")

# Models to try (fallback if one fails)
MODELS = [
    "openai/gpt-oss-20b:groq",
    "mistralai/Mistral-7B-Instruct-v0.2",
]


def call_hf_api(prompt, max_tokens=200, temperature=0.1):
    """
    Call Hugging Face API with model fallback
    """
    if not client:
        return None
    
    for model in MODELS:
        try:
            completion = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=temperature,
            )
            
            if completion and completion.choices and len(completion.choices) > 0:
                message = completion.choices[0].message
                if message and hasattr(message, 'content') and message.content:
                    text = str(message.content).strip()
                    if text:
                        return text
        except Exception as e:
            logger.warning(f"Model {model} failed: {e}")
            continue
    
    return None


def create_sql_query(user_question):
    """
    Convert natural language to SQL using AI with structured prompt and aggressive parsing
    
    IMPROVED PROMPT DESIGN:
    - Less literal keyword matching
    - Better semantic coverage for hackathons (includes event names)
    - Explicit about what we're counting (projects, not events)
    - More flexible pattern matching
    """
    if not client:
        logger.error("Client not configured")
        return None
    
    logger.info(f"Creating SQL for: {user_question}")
    
    # Improved prompt: semantic understanding over literal matching
    prompt = f"""Generate a PostgreSQL SELECT query for this question.

Database: projects table
Columns: id, title, description, tech_stack, github_url, created_at

IMPORTANT: Return ONLY the SQL query on a single line. No explanations, no markdown, no code blocks.

SEMANTIC RULES (not just keywords):
- "How many projects?" = count all projects
- "Projects with [technology]" = search tech_stack for that technology (case-insensitive)
- "Most recent project" = order by created_at DESC, limit 1
- "List all projects" = select all project data
- "Hackathons" questions = search for hackathon-related terms in description/title:
  * Include: "hackathon", "hack", "hack the north", "hack or treat", "hackathon winner", "first place"
  * For "won"/"wins"/"winner": also require win indicators (won, winning, winner, award, prize, first place, first)
  * For "competed"/"participated": just search for hackathon terms (no win requirement)

EXAMPLES:
Question: "How many projects?" 
SQL: SELECT COUNT(*) FROM projects

Question: "Projects with Python?"
SQL: SELECT title, description, tech_stack FROM projects WHERE tech_stack ILIKE '%Python%'

Question: "Most recent project?"
SQL: SELECT title, description, tech_stack FROM projects ORDER BY created_at DESC LIMIT 1

Question: "List all projects"
SQL: SELECT title, description, tech_stack FROM projects

Question: "How many hackathons"
SQL: SELECT COUNT(*) FROM projects WHERE description ILIKE '%hackathon%' OR title ILIKE '%hackathon%' OR description ILIKE '%hack%' OR title ILIKE '%hack%'

Question: "How many hackathon wins"
SQL: SELECT COUNT(*) FROM projects WHERE (description ILIKE '%hackathon%' OR title ILIKE '%hackathon%' OR description ILIKE '%hack%' OR title ILIKE '%hack%') AND (description ILIKE '%won%' OR description ILIKE '%winning%' OR description ILIKE '%winner%' OR description ILIKE '%award%' OR description ILIKE '%prize%' OR description ILIKE '%first place%' OR description ILIKE '%first%')

Question: {user_question}
SQL:"""

    response = call_hf_api(prompt, max_tokens=200, temperature=0.0)
    
    if not response:
        logger.error("No response from API")
        return None
    
    # Aggressive SQL extraction: find anything between SELECT and semicolon/newline/end
    # Remove markdown code blocks
    response = re.sub(r'```sql\n?', '', response, flags=re.IGNORECASE)
    response = re.sub(r'```\n?', '', response)
    
    # Remove "SQL:" prefix
    response = re.sub(r'^(SQL|Query):\s*', '', response, flags=re.IGNORECASE)
    
    # Extract SQL: find SELECT... up to semicolon, newline, or end
    sql_match = re.search(r'(SELECT.*?)(?:;|$)', response, re.IGNORECASE | re.DOTALL)
    if sql_match:
        sql_query = sql_match.group(1).strip()
    else:
        # Fallback: just take the first line that starts with SELECT
        for line in response.split('\n'):
            line = line.strip()
            if line.upper().startswith('SELECT'):
                sql_query = line.rstrip(';').strip()
                break
        else:
            sql_query = response.strip().rstrip(';')
    
    # Join multi-line queries into single line
    sql_query = ' '.join(sql_query.split())
    
    logger.info(f"Extracted SQL: {sql_query}")
    
    # Validation: must start with SELECT and contain FROM
    if not sql_query.upper().startswith('SELECT'):
        logger.warning(f"Invalid SQL - doesn't start with SELECT: {sql_query}")
        return None
    
    if 'FROM' not in sql_query.upper():
        logger.warning(f"Invalid SQL - missing FROM: {sql_query}")
        return None
    
    # Security check: block dangerous operations
    dangerous = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE']
    if any(word in sql_query.upper() for word in dangerous):
        logger.error(f"Dangerous SQL blocked: {sql_query}")
        return None
    
    return sql_query


def format_sql_results(user_question, results, sql_query=None):
    """
    Format SQL results into natural language
    
    IMPROVED: Clearer about what we're actually counting (projects mentioning hackathons, not hackathon events)
    """
    if not results or len(results) == 0:
        return "No matching projects were found."
    
    is_count_query = sql_query and 'COUNT(*)' in sql_query.upper()
    question_lower = user_question.lower()
    
    # For COUNT queries: Skip AI and format directly
    if is_count_query:
        count = results[0][0] if results[0] else 0
        
        if 'hackathon' in question_lower:
            if any(word in question_lower for word in ['won', 'win', 'wins', 'winner']):
                return f"Konstantin has won {count} hackathon{'s' if count != 1 else ''}."
            else:
                # More accurate wording: "projects involving hackathons" vs "hackathons competed in"
                # But keep user-friendly language while being aware of the limitation
                return f"Konstantin has {count} project{'s' if count != 1 else ''} involving hackathons."
        elif any(tech in question_lower for tech in ['python', 'java', 'javascript', 'react', 'use']):
            tech_match = re.search(r'use[sd]?\s+(\w+)', question_lower)
            if tech_match:
                tech = tech_match.group(1).capitalize()
                return f"Konstantin has {count} project{'s' if count != 1 else ''} that use{'s' if count == 1 else ''} {tech}."
        return f"Konstantin has {count} project{'s' if count != 1 else ''}."
    
    # Check if this is a tech_stack query (list all technologies)
    is_tech_stack_query = sql_query and 'tech_stack' in sql_query.lower() and 'COUNT' not in sql_query.upper()
    if is_tech_stack_query:
        all_techs = set()
        for row in results:
            if isinstance(row, tuple) and len(row) > 0:
                tech_stack = str(row[0]) if row[0] else ""
            else:
                tech_stack = str(row)
            techs = [t.strip() for t in tech_stack.split(',') if t.strip()]
            all_techs.update(techs)
        
        if all_techs:
            tech_list = sorted(list(all_techs))
            return f"Konstantin has used: {', '.join(tech_list)}"
        return "No technologies found."
    
    # For other queries: Try simple AI formatting, fallback to direct formatting
    if client and len(results) <= 5:
        try:
            # Simplified prompt
            results_text = str(results[:5])
            prompt = f"""Answer this question concisely (1-2 sentences).

Question: {user_question}
Data: {results_text}

Answer:"""
            
            response = call_hf_api(prompt, max_tokens=150, temperature=0.3)
            if response and len(response) > 10:
                return response.strip()
        except Exception as e:
            logger.warning(f"AI formatting failed: {e}")
    
    # Direct formatting fallback
    if len(results) == 1:
        row = results[0]
        if isinstance(row, tuple) and len(row) > 0:
            return str(row[0])
        return str(row)
    else:
        titles = [str(row[0]) if isinstance(row, tuple) and len(row) > 0 else str(row) for row in results[:5]]
        if titles:
            if len(results) <= 5:
                return f"Found {len(results)} project{'s'}: {', '.join(titles)}"
            else:
                return f"Found {len(results)} project{'s'}: {', '.join(titles)}, and {len(results) - 5} more"
        return f"Found {len(results)} result{'s' if len(results) != 1 else ''}."
