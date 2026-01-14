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
    Convert natural language to SQL using AI with detailed instructions
    """
    if not client:
        logger.error("Client not configured")
        return None
    
    logger.info(f"Creating SQL for: {user_question}")
    
    # More detailed prompt with specific examples
    prompt = f"""Generate a PostgreSQL SELECT query for this question.

Database table: projects
Columns: id, title, description, tech_stack (comma-separated), github_url, created_at

IMPORTANT RULES:
- Use ILIKE with % wildcards for case-insensitive text search
- For "how many" questions, use SELECT COUNT(*) FROM projects
- For "what technologies" or "list technologies" questions, use: SELECT tech_stack FROM projects (NOT COUNT)
- For technology searches (Java, Python, etc.), use: tech_stack ILIKE '%TechnologyName%'
- For hackathon "won"/"wins"/"winner" questions, use: SELECT COUNT(*) FROM projects WHERE (description ILIKE '%hackathon%' OR title ILIKE '%hackathon%') AND (description ILIKE '%won%' OR description ILIKE '%winning%' OR description ILIKE '%winner%' OR description ILIKE '%award%' OR description ILIKE '%prize%' OR description ILIKE '%first place%' OR description ILIKE '%first%')
- For hackathon "competed" or "participated" questions, use: description ILIKE '%hackathon%' OR title ILIKE '%hackathon%'
- For project name searches, use: title ILIKE '%ProjectName%'

EXAMPLES:
Question: "How many projects?" → SELECT COUNT(*) FROM projects
Question: "How many projects use Java?" → SELECT COUNT(*) FROM projects WHERE tech_stack ILIKE '%Java%'
Question: "How many hackathons has Konstantin won?" → SELECT COUNT(*) FROM projects WHERE (description ILIKE '%hackathon%' OR title ILIKE '%hackathon%') AND (description ILIKE '%won%' OR description ILIKE '%winning%' OR description ILIKE '%winner%' OR description ILIKE '%award%' OR description ILIKE '%prize%' OR description ILIKE '%first place%' OR description ILIKE '%first%')
Question: "how many hackathon wins?" → SELECT COUNT(*) FROM projects WHERE (description ILIKE '%hackathon%' OR title ILIKE '%hackathon%') AND (description ILIKE '%won%' OR description ILIKE '%winning%' OR description ILIKE '%winner%' OR description ILIKE '%award%' OR description ILIKE '%prize%' OR description ILIKE '%first place%' OR description ILIKE '%first%')
Question: "How many hackathons has Konstantin competed in?" → SELECT COUNT(*) FROM projects WHERE description ILIKE '%hackathon%' OR title ILIKE '%hackathon%'
Question: "What technologies?" → SELECT tech_stack FROM projects
Question: "What technologies has Konstantin used?" → SELECT tech_stack FROM projects

Question: {user_question}
Return ONLY the SQL query, no explanation:"""

    response = call_hf_api(prompt, max_tokens=200, temperature=0.0)
    
    if not response:
        logger.error("No response from API")
        return None
    
    # Clean response
    sql_query = response.strip()
    
    # Remove markdown
    sql_query = re.sub(r'```sql\n?', '', sql_query, flags=re.IGNORECASE)
    sql_query = re.sub(r'```\n?', '', sql_query)
    sql_query = re.sub(r'^(SQL|Query):\s*', '', sql_query, flags=re.IGNORECASE)
    
    # Join all lines into a single query (SQL queries can span multiple lines)
    sql_query = ' '.join(line.strip() for line in sql_query.split('\n') if line.strip() and not line.strip().startswith('--'))
    
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
    question_lower = user_question.lower()
    is_tech_stack_query = sql_query and 'tech_stack' in sql_query.lower() and 'COUNT' not in sql_query.upper()
    
    # Handle COUNT queries
    if is_count:
        count = results[0][0] if results[0] else 0
        
        if 'hackathon' in question_lower:
            if any(word in question_lower for word in ['won', 'win', 'wins', 'winner']):
                return f"Konstantin has won {count} hackathon{'s' if count != 1 else ''}."
            else:
                return f"Konstantin has competed in {count} hackathon{'s' if count != 1 else ''}."
        elif 'use' in question_lower or 'python' in question_lower or 'java' in question_lower:
            tech_match = re.search(r'use[sd]?\s+(\w+)', question_lower)
            if tech_match:
                tech = tech_match.group(1).capitalize()
                return f"Konstantin has {count} project{'s' if count != 1 else ''} that use{'s' if count == 1 else ''} {tech}."
        return f"Konstantin has {count} project{'s' if count != 1 else ''}."
    
    # Handle tech_stack queries (list all technologies)
    if is_tech_stack_query:
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
        return "No technologies found."
    
    # For non-count queries, format directly (don't use AI to avoid it asking questions)
    if len(results) == 1:
        row = results[0]
        if isinstance(row, tuple) and len(row) >= 2:
            # Check if question is asking about a specific project
            question_lower = user_question.lower()
            title = str(row[0]) if row[0] else ""
            description = str(row[1]) if len(row) > 1 and row[1] else ""
            
            # For "hack or treat" or similar specific project questions, give direct answer
            if 'hack or treat' in question_lower or 'hackathon win' in question_lower or 'hackathon' in question_lower:
                return f"{title}. {description[:200]}" if description else title
            else:
                return f"{title}. {description[:150]}" if description else title
        return f"Found: {results[0][0]}"
    else:
        # Multiple results - list them
        titles = []
        for row in results[:5]:
            if isinstance(row, tuple) and len(row) > 0:
                titles.append(str(row[0]))
        
        if titles:
            if len(results) <= 5:
                return f"Found {len(results)} project{'s'}: {', '.join(titles)}"
            else:
                return f"Found {len(results)} project{'s'}: {', '.join(titles[:5])}, and {len(results) - 5} more"
        return f"Found {len(results)} result{'s' if len(results) != 1 else ''}."
