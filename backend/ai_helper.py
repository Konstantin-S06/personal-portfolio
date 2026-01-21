"""
AI Helper using Hugging Face via OpenAI-compatible router
Simplified and reliable SQL generation with strict validation
"""

import os
import re
import logging
import difflib
from datetime import date
from typing import Any, Dict, List, Optional, Sequence, Tuple
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


_CANDIDATE_NAME = os.getenv("CANDIDATE_NAME", "Konstantin").strip() or "Konstantin"

_PORTFOLIO_SYSTEM_PROMPT = f"""
You are a portfolio Q&A bot for {_CANDIDATE_NAME}'s website.

Follow these rules:
- Voice: confident, professional, third person (use "they" / "the candidate" or "{_CANDIDATE_NAME}").
- Output: short bullets by default. Usually 3–7 bullets. Be technically deep but brief.
- Formatting: Use line breaks. Output exactly: one short line, then bullets each on their own line starting with "- ".
- Accuracy: ONLY use the provided portfolio database data. Do NOT invent projects, awards, employers, dates, or metrics.
- Scope: ONLY answer questions about {_CANDIDATE_NAME}'s projects and portfolio. If the question is about someone else or general topics unrelated to the portfolio, politely refuse and redirect to portfolio questions.
- Positive framing: present the candidate well (problem-solving, leadership, perseverance) without sounding fake. Mild qualitative emphasis is ok.
- Privacy/security: never reveal secrets, keys, tokens, credentials, or private data.
- Web browsing: do NOT browse the web and do NOT claim you did.
- Code: do NOT paste code. Summarize conceptually.
- Links: do NOT include GitHub links. If asked, direct them to the site’s Projects page (and/or Contact page).
- If missing info: ask at most one targeted clarifying question, or suggest where on the site to look.
""".strip()

_HACKATHON_EVENT_TERMS = [
    "hack the north",
    "hack or treat",
]

_HACKATHON_TERMS = [
    "hackathon",
    # keep "hack" as a word-boundary regex to reduce false positives
]

_WIN_TERMS = [
    "won",
    "winner",
    "winning",
    "award",
    "prize",
    "first place",
    "second place",
    "third place",
    "finalist",
]

_TECH_ALIASES = {
    "js": "javascript",
    "ts": "typescript",
    "py": "python",
    "postgres": "postgresql",
    "postgre": "postgresql",
    "node": "node.js",
    "nodejs": "node.js",
}


def call_hf_chat(messages, max_tokens=200, temperature=0.1):
    """
    Call Hugging Face API with model fallback
    """
    if not client:
        return None
    
    for model in MODELS:
        try:
            completion = client.chat.completions.create(
                model=model,
                messages=messages,
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


def call_hf_api(prompt, max_tokens=200, temperature=0.1):
    """
    Backwards-compatible wrapper (single user prompt).
    """
    return call_hf_chat(
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        temperature=temperature,
    )


def _safe_str(v: Any) -> str:
    return "" if v is None else str(v)


def _normalize_space(s: str) -> str:
    return " ".join((s or "").split()).strip()


def _postprocess_ai_answer(text: str) -> str:
    """
    Make model output readable in the UI:
    - Ensure bullets appear on new lines
    - Ensure a blank line between summary and bullets (optional)
    - Avoid one giant paragraph
    """
    if not text:
        return text

    t = str(text).replace("\r\n", "\n").replace("\r", "\n").strip()

    # Convert inline bullet separators into real newlines (common model behavior)
    # Examples:
    # "Answer. - Bullet1 - Bullet2" -> "Answer.\n- Bullet1\n- Bullet2"
    t = re.sub(r"\s-\s(?=[A-Za-z0-9])", "\n- ", t)
    t = re.sub(r"\.\s*\n-\s", ".\n- ", t)
    t = re.sub(r"\.\s*-\s", ".\n- ", t)

    # If we still have no newlines but multiple sentences, add a soft break after the first sentence.
    if "\n" not in t:
        parts = re.split(r"(?<=[.!?])\s+", t, maxsplit=1)
        if len(parts) == 2:
            t = parts[0].strip() + "\n" + parts[1].strip()

    # Collapse excessive blank lines
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    return t


def _tokenize(s: str) -> List[str]:
    return [t for t in re.split(r"[^a-z0-9]+", (s or "").lower()) if len(t) >= 3]


def _parse_dateish(value: Any) -> Optional[date]:
    """
    Parse dates coming from Postgres (date object) or SQLite (string).
    Accepts:
    - YYYY-MM-DD
    - YYYY-MM-DDTHH:MM...
    - YYYY-MM-DD HH:MM...
    """
    if value is None:
        return None
    if isinstance(value, date):
        return value
    s = str(value).strip()
    if not s:
        return None
    s10 = s[:10]
    try:
        return date.fromisoformat(s10)
    except Exception:
        return None


_MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


def _month_range(year: int, month: int) -> Tuple[date, date]:
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    return start, end


def _extract_date_range(question: str) -> Optional[Tuple[date, date, str]]:
    """
    Detect queries like:
    - "october 2025", "oct 2025"
    - "2025-10", "2025/10"
    - "10/2025"
    - "in 2025"
    Returns (start, end, label)
    """
    q = (question or "").lower()

    # Month name + year (e.g., october 2025)
    m = re.search(r"\b([a-z]{3,9})\s+(\d{4})\b", q)
    if m and m.group(1) in _MONTHS:
        month = _MONTHS[m.group(1)]
        year = int(m.group(2))
        start, end = _month_range(year, month)
        label = f"{m.group(1).title()} {year}"
        return start, end, label

    # YYYY-MM or YYYY/MM
    m = re.search(r"\b(\d{4})[-/](\d{1,2})\b", q)
    if m:
        year = int(m.group(1))
        month = int(m.group(2))
        if 1 <= month <= 12:
            start, end = _month_range(year, month)
            label = f"{year}-{month:02d}"
            return start, end, label

    # MM/YYYY
    m = re.search(r"\b(\d{1,2})[/-](\d{4})\b", q)
    if m:
        month = int(m.group(1))
        year = int(m.group(2))
        if 1 <= month <= 12:
            start, end = _month_range(year, month)
            label = f"{year}-{month:02d}"
            return start, end, label

    # Year-only (e.g., in 2025)
    m = re.search(r"\b(in\s+)?(\d{4})\b", q)
    if m:
        year = int(m.group(2))
        start = date(year, 1, 1)
        end = date(year + 1, 1, 1)
        label = f"{year}"
        return start, end, label

    return None


def _project_blob(p: Dict[str, Any]) -> str:
    return f"{p.get('title','')} {p.get('description','')} {p.get('tech_stack','')}".lower()


def _is_hackathon_project(p: Dict[str, Any]) -> bool:
    text = _project_blob(p)
    if any(term in text for term in _HACKATHON_EVENT_TERMS):
        return True
    if "hackathon" in text:
        return True
    if re.search(r"\bhack\b", text):
        return True
    return False


def _is_hackathon_win_project(p: Dict[str, Any]) -> bool:
    if not _is_hackathon_project(p):
        return False
    text = _project_blob(p)
    return any(term in text for term in _WIN_TERMS)


def _parse_tech_stack(tech_stack: str) -> List[str]:
    parts = [t.strip() for t in (tech_stack or "").split(",")]
    return [p for p in parts if p]


def _normalize_tech(s: str) -> str:
    s = (s or "").strip().lower()
    s = _TECH_ALIASES.get(s, s)
    return s


def _extract_requested_techs(question: str, known_techs: Sequence[str]) -> List[str]:
    q = (question or "").lower()
    hits: List[str] = []

    # Alias-first (so "js" can match "JavaScript" even if "js" isn't in known_techs)
    for short, full in _TECH_ALIASES.items():
        if re.search(rf"\b{re.escape(short)}\b", q):
            hits.append(full)

    # Direct match against known techs
    for tech in known_techs:
        t = tech.strip()
        if not t:
            continue
        if re.search(rf"\b{re.escape(t.lower())}\b", q):
            hits.append(t.lower())

    # Dedup, preserve order
    out: List[str] = []
    for h in hits:
        hn = _normalize_tech(h)
        if hn and hn not in out:
            out.append(hn)
    return out


def _project_uses_tech(p: Dict[str, Any], tech_norm: str) -> bool:
    ts = [_normalize_tech(t) for t in _parse_tech_stack(_safe_str(p.get("tech_stack")))]
    if tech_norm in ts:
        return True
    # fallback substring match (handles "react.js" vs "react")
    blob = ",".join(ts)
    return tech_norm in blob


def fetch_projects(conn) -> List[Dict[str, Any]]:
    """
    Fetch all portfolio projects from the database connection.
    Does NOT return github_url to avoid accidental link leakage in responses.
    """
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, title, description, tech_stack, project_date, created_at
        FROM projects
        ORDER BY created_at DESC, id DESC
        """
    )

    projects: List[Dict[str, Any]] = []
    for row in cursor.fetchall():
        # row: (id, title, description, tech_stack, project_date, created_at)
        projects.append(
            {
                "id": row[0],
                "title": _safe_str(row[1]),
                "description": _safe_str(row[2]),
                "tech_stack": _safe_str(row[3]),
                "project_date": _safe_str(row[4]),
                "created_at": _safe_str(row[5]),
            }
        )
    return projects


def _best_project_match(projects: Sequence[Dict[str, Any]], question: str) -> Optional[Dict[str, Any]]:
    q = (question or "").strip()
    if not q or not projects:
        return None

    ql = q.lower()

    # Try to extract a likely project phrase (e.g., "what about X", "tell me about X", "technologies did X use")
    phrase = None
    m = re.search(r"\btechnolog(?:y|ies)\s+did\s+(.+?)\s+use\b", ql)
    if m:
        phrase = m.group(1)
    if not phrase:
        m = re.search(r"\b(?:what about|tell me about|about)\s+(.+)$", ql)
        if m:
            phrase = m.group(1)
    phrase = (phrase or "").strip(" ?.!\"'")

    candidates = [ql]
    if phrase and phrase not in candidates:
        candidates.insert(0, phrase)

    # 1) Direct substring match on candidates (fast + best)
    for cand in candidates:
        for p in projects:
            t = (p.get("title", "") or "").lower()
            if t and t in cand:
                return p

    # 2) Token overlap score (handles "personal portfolio" vs "Personal Portfolio Website")
    best = None
    best_score = 0.0
    for p in projects:
        title = (p.get("title", "") or "").lower()
        title_tokens = set(_tokenize(title))
        if not title_tokens:
            continue
        for cand in candidates:
            cand_tokens = set(_tokenize(cand))
            if not cand_tokens:
                continue
            overlap = len(title_tokens.intersection(cand_tokens))
            score = overlap / max(1, len(title_tokens))
            if score > best_score:
                best_score = score
                best = p

    if best and best_score >= 0.45:
        return best

    # 3) Fuzzy match (last resort)
    best = None
    best_score = 0.0
    for p in projects:
        title = p.get("title", "") or ""
        for cand in candidates:
            score = difflib.SequenceMatcher(a=title.lower(), b=cand).ratio()
            if score > best_score:
                best_score = score
                best = p

    return best if best_score >= 0.55 else None


def answer_portfolio_question(user_question: str, conn) -> Tuple[str, Dict[str, Any]]:
    """
    DB-first portfolio Q&A.
    - Uses deterministic retrieval/filtering for reliability.
    - Uses the model only for concise, on-style formatting when helpful.

    Returns: (answer_text, debug_info)
    """
    question = _normalize_space(user_question)
    ql = question.lower()

    projects = fetch_projects(conn)
    debug: Dict[str, Any] = {"projects_total": len(projects)}

    if not question:
        return ("Ask a question about the portfolio projects (tech, hackathons, or a specific project).", debug)

    if not projects:
        return ("No projects are currently listed in the portfolio database.", debug)

    # Refuse attempts to modify the database via prompts (chat is read-only).
    if any(kw in ql for kw in ["delete ", "remove ", "drop ", "truncate", "insert ", "update ", "alter ", "create table", "add project"]):
        return (
            f"The chat assistant is read-only and can only answer questions about {_CANDIDATE_NAME}'s portfolio projects.",
            debug,
        )

    # Precompute known techs
    known_techs_set = set()
    for p in projects:
        for t in _parse_tech_stack(_safe_str(p.get("tech_stack"))):
            known_techs_set.add(t.strip().lower())
    known_techs = sorted([t for t in known_techs_set if t])

    asked_techs = _extract_requested_techs(question, known_techs)
    debug["asked_techs"] = asked_techs

    # Date-based queries (month/year/year-only) based on project_date (preferred) or created_at fallback.
    date_range = _extract_date_range(question)
    if date_range and any(kw in ql for kw in ["project", "projects", "built", "made", "created", "in "]):
        start, end, label = date_range
        matched_projects = []
        missing_project_date = 0
        for p in projects:
            pd = _parse_dateish(p.get("project_date"))
            if not pd:
                missing_project_date += 1
                pd = _parse_dateish(p.get("created_at"))
            if pd and start <= pd < end:
                matched_projects.append((pd, p))

        matched_projects.sort(key=lambda x: x[0])
        debug["date_label"] = label
        debug["date_matches"] = len(matched_projects)
        debug["projects_missing_project_date"] = missing_project_date

        if not matched_projects:
            note = ""
            if missing_project_date:
                note = f" ({missing_project_date} project{'s' if missing_project_date != 1 else ''} don’t have a project date set yet.)"
            return (f"No projects were found in {label}.{note}", debug)

        lines = [f"Projects in {label}:"]
        for pd, p in matched_projects[:15]:
            lines.append(f"- {p.get('title','Untitled')} — Date: {pd.isoformat()} — Tech: {p.get('tech_stack','')}")
        if len(matched_projects) > 15:
            lines.append(f"- …and {len(matched_projects) - 15} more.")
        return ("\n".join(lines), debug)

    # Hackathon queries (list / count / wins)
    if "hackathon" in ql or re.search(r"\bhack\b", ql):
        hack_projects = [p for p in projects if _is_hackathon_project(p)]
        hack_win_projects = [p for p in projects if _is_hackathon_win_project(p)]
        debug["hackathon_projects"] = len(hack_projects)
        debug["hackathon_win_projects"] = len(hack_win_projects)

        wants_count = bool(re.search(r"\bhow many\b|\bcount\b|\bnumber of\b", ql))
        wants_wins = any(w in ql for w in ["won", "win", "wins", "winner", "winners", "awards", "prizes", "first place"])
        wants_list = any(w in ql for w in ["list", "which", "show", "what are", "what projects"])

        if wants_count and wants_wins:
            n = len(hack_win_projects)
            return (f"{_CANDIDATE_NAME} has {n} hackathon-related project{'s' if n != 1 else ''} that mention wins/awards.", debug)

        if wants_count:
            n = len(hack_projects)
            return (f"{_CANDIDATE_NAME} has {n} hackathon-related project{'s' if n != 1 else ''} in the portfolio.", debug)

        if wants_list or True:
            if not hack_projects:
                return ("No hackathon-related projects were found in the portfolio database.", debug)
            lines = [f"Here are the hackathon-related projects in {_CANDIDATE_NAME}'s portfolio:"]
            for p in hack_projects[:12]:
                title = p.get("title", "Untitled")
                tech = _safe_str(p.get("tech_stack"))
                lines.append(f"- {title} — Tech: {tech}")
            if len(hack_projects) > 12:
                lines.append(f"- …and {len(hack_projects) - 12} more.")
            return ("\n".join(lines), debug)

    # Most recent project
    if any(kw in ql for kw in ["most recent", "latest", "newest"]):
        p = projects[0]
        return (
            "\n".join(
                [
                    f"{_CANDIDATE_NAME}'s most recent project is **{p.get('title','')}**.",
                    f"- Tech: {p.get('tech_stack','')}",
                    f"- Summary: {_normalize_space(p.get('description',''))}",
                ]
            ),
            debug,
        )

    # List all projects
    if re.search(r"\blist\b|\bshow\b|\ball projects\b", ql):
        lines = [f"{_CANDIDATE_NAME} has {len(projects)} projects in the portfolio:"]
        for p in projects[:20]:
            lines.append(f"- {p.get('title','Untitled')} — Tech: {p.get('tech_stack','')}")
        if len(projects) > 20:
            lines.append(f"- …and {len(projects) - 20} more.")
        return ("\n".join(lines), debug)

    # Count projects (possibly by tech)
    if re.search(r"\bhow many\b|\bcount\b|\bnumber of\b", ql) and "project" in ql:
        if asked_techs:
            tech_norm = asked_techs[0]
            matches = [p for p in projects if _project_uses_tech(p, tech_norm)]
            return (f"{_CANDIDATE_NAME} has {len(matches)} project{'s' if len(matches) != 1 else ''} that use {tech_norm}.", debug)
        return (f"{_CANDIDATE_NAME} has {len(projects)} projects in the portfolio.", debug)

    # Technology queries
    if any(kw in ql for kw in ["tech stack", "technologies", "tools"]) and any(
        kw in ql for kw in ["used", "use", "worked with", "experience"]
    ):
        # If the question mentions a specific project, answer for that project only.
        matched_project = _best_project_match(projects, question)
        if matched_project:
            tech = _safe_str(matched_project.get("tech_stack"))
            title = matched_project.get("title", "Untitled")
            return (
                "\n".join(
                    [
                        f"{title} used the following technologies:",
                        f"- Tech stack: {tech}",
                    ]
                ),
                debug,
            )

        # If they asked for a specific tech, list matching projects
        if asked_techs:
            tech_norm = asked_techs[0]
            matches = [p for p in projects if _project_uses_tech(p, tech_norm)]
            if not matches:
                return (f"No projects explicitly list {tech_norm} in the tech stack.", debug)
            lines = [f"Projects that use {tech_norm}:"]
            for p in matches[:12]:
                lines.append(f"- {p.get('title','Untitled')} — Tech: {p.get('tech_stack','')}")
            if len(matches) > 12:
                lines.append(f"- …and {len(matches) - 12} more.")
            return ("\n".join(lines), debug)

        # Otherwise list overall tech inventory (bounded)
        techs_pretty = sorted({t for p in projects for t in _parse_tech_stack(_safe_str(p.get("tech_stack"))) if t.strip()})
        if not techs_pretty:
            return ("No technologies were found in the portfolio database.", debug)
        top = techs_pretty[:40]
        suffix = f" (plus {len(techs_pretty) - 40} more)" if len(techs_pretty) > 40 else ""
        return (f"{_CANDIDATE_NAME}'s portfolio includes: {', '.join(top)}{suffix}", debug)

    # Specific project deep-dive
    matched = _best_project_match(projects, question)
    if matched:
        date_part = ""
        if matched.get("project_date"):
            date_part = f"- Date: {matched.get('project_date')}"
        return (
            "\n".join(
                [
                    f"**{matched.get('title','')}**",
                    date_part if date_part else "- Date: (not listed)",
                    f"- Tech: {matched.get('tech_stack','')}",
                    f"- Summary: {_normalize_space(matched.get('description',''))}",
                ]
            ),
            debug,
        )

    # If we couldn't match portfolio intent, refuse instead of answering generally.
    looks_portfolio_related = any(
        kw in ql
        for kw in [
            "project",
            "projects",
            "portfolio",
            "hackathon",
            "tech",
            "technologies",
            "tech stack",
            "tools",
            "built",
            "worked on",
            "used",
        ]
    ) or bool(asked_techs)
    if not looks_portfolio_related:
        return (
            f"I can only answer questions about {_CANDIDATE_NAME}'s portfolio projects (e.g., tech used, hackathons, or a specific project).",
            debug,
        )

    # Model formatting fallback with full DB context (no links, no code)
    if client:
        context_lines = []
        for p in projects[:25]:
            context_lines.append(
                f"- {p.get('title','Untitled')} | Tech: {p.get('tech_stack','')} | Description: {_normalize_space(p.get('description',''))}"
            )

        prompt = f"""
Portfolio database snapshot (projects):
{chr(10).join(context_lines)}

User question: {question}

FORMAT EXACTLY LIKE THIS (use newlines):
<one short sentence answering the question>
- <bullet 1>
- <bullet 2>
- <bullet 3>

Rules: 3–7 bullets, no GitHub links, no code, no markdown code blocks.
""".strip()

        response = call_hf_chat(
            messages=[
                {"role": "system", "content": _PORTFOLIO_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            max_tokens=380,
            temperature=0.2,
        )
        if response:
            response = _postprocess_ai_answer(response)

            # If the model got cut mid-word/bullet (common: trailing hyphen), avoid returning a half-answer.
            if re.search(r"[-‐‑–—]\s*$", response.strip()):
                # Keep it safe and concise rather than returning a half sentence.
                return (
                    f"I can answer questions about {_CANDIDATE_NAME}'s portfolio projects. Try asking about a specific project name, technologies used, hackathons, or project dates.",
                    debug,
                )
            return (response.strip(), debug)

    # Hard fallback
    return (
        f"I can answer questions about {_CANDIDATE_NAME}'s portfolio projects (tech used, hackathons, or specific projects). Try asking: “Which projects are hackathon-related?”",
        debug,
    )


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
