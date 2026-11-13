"""
Deterministic intent layer for POST /api/chat. Runs BEFORE the model.

- Reads the project list with ONE constant SELECT (no user text ever reaches SQL), then
  matches the question and filters in Python. Tech matching is by whole item in the
  comma-separated tech_stack ("Java" does not match "JavaScript", "C" does not match "C++").
- Answers are built here, never by the model: {"kind", "answer", "items", "suggestions", ...}.
- Returns None when nothing matches, so the caller can try the guarded NL-to-SQL path and
  then the old keyword logic.

No third-party imports, so it is easy to test.
"""

import difflib
import os
import re
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

PROJECT_COLUMNS = (
    "id", "title", "summary", "description", "tech_stack", "project_date",
    "role", "context", "category", "featured", "github_url", "demo_url",
)
PROJECTS_SQL = "SELECT " + ", ".join(PROJECT_COLUMNS) + " FROM projects ORDER BY sort_order, id LIMIT 200"
MAX_ITEMS = 12

STATIC_SUGGESTIONS = [
    "How many projects use Python?",
    "Which projects are featured?",
    "What did you build with Flask?",
]

ALIASES = {
    "js": "javascript", "ts": "typescript", "py": "python", "postgres": "postgresql",
    "node": "node.js", "nodejs": "node.js", "reactjs": "react", "react.js": "react",
    "golang": "go", "cpp": "c++", "csharp": "c#", "k8s": "kubernetes",
}
CATEGORY_LABELS = {"ai_ml": "AI / ML", "ai": "AI", "ml": "ML", "web": "Web", "game": "Game", "games": "Games",
                   "research": "Research", "systems": "Systems", "tooling": "Tooling"}
_CATEGORY_WORDS = {
    "ai_ml": r"\bai\b|\bml\b|machine learning|artificial intelligence",
    "game": r"\bgames?\b|\bgaming\b",
    "web": r"\bweb\b|\bwebsites?\b",
    "research": r"\bresearch\b",
    "systems": r"\bsystems? (?:programming|projects?)\b|\blow[- ]level\b",
    "tooling": r"\btooling\b",
}
_AMBIGUOUS_TECH = {"c", "r", "go", "d"}
_GENERIC_TITLE_WORDS = {
    "application", "project", "projects", "system", "website", "platform", "generator", "simulator",
    "declaration", "recommendation", "personal", "predictive", "cooperative", "portfolio", "backend",
    "multiplayer", "academic", "planner", "gamified", "interest", "conflict",
}
_STOP = {"the", "a", "an", "your", "his", "my", "of", "and", "project", "projects", "me", "you", "about"}
_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

_MUTATION_RE = re.compile(r"\b(delete|drop|remove|insert|update|truncate|alter|erase|destroy|overwrite)\b")
_SMALLTALK = {"hi", "hello", "hey", "yo", "thanks", "thank you", "ok", "okay", "test", "testing"}
_KEYWORDS_RE = re.compile(
    r"project|built|build|made|creat|tech|stack|featured|highlight|role|github|repo|demo|link|hackathon|"
    r"about|portfolio|work|skill|language|framework|tool|categor|recent|latest|newest|20\d\d|how many|list|show|"
    r"best|top|use|using|used|know|experience"
)


# --------------------------------------------------------------------------- loading
def rows_to_projects(columns: Optional[Sequence[str]], rows: Sequence[Sequence[Any]]) -> List[Dict[str, Any]]:
    cols = [str(c).strip().lower() for c in columns] if columns else list(PROJECT_COLUMNS)
    return [{c: r[i] for i, c in enumerate(cols) if i < len(r)} for r in rows]


def load_from_runner(runner) -> List[Dict[str, Any]]:
    cols, rows = runner.run(PROJECTS_SQL, [])
    return rows_to_projects(cols, rows)


def load_from_connection(conn) -> List[Dict[str, Any]]:
    cur = conn.cursor()
    cur.execute(PROJECTS_SQL)
    return rows_to_projects(PROJECT_COLUMNS, cur.fetchall())


# --------------------------------------------------------------------------- normalising
def _s(v: Any) -> str:
    return "" if v is None else " ".join(str(v).split())


def _clip(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _is_true(v: Any) -> bool:
    return _s(v).lower() in {"1", "true", "t", "yes", "y"}


def _url(v: Any) -> Optional[str]:
    s = _s(v)
    return s if re.match(r"^https?://\S+$", s, re.I) and len(s) <= 300 else None


def _date(v: Any) -> Optional[str]:
    s = _s(v)[:10]
    return s if re.match(r"^\d{4}-\d{2}-\d{2}$", s) else None


def _fmt_date(d: Optional[str]) -> Optional[str]:
    if not d:
        return None
    return f"{_MONTH_NAMES[int(d[5:7]) - 1]} {d[:4]}" if 1 <= int(d[5:7]) <= 12 else d[:4]


def _canon(t: str) -> str:
    t = " ".join(t.lower().split())
    return ALIASES.get(t, t)


def _cat_label(c: Optional[str]) -> Optional[str]:
    if not c:
        return None
    return CATEGORY_LABELS.get(c, c.replace("_", " ").title())


def _prep(rows: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for r in rows:
        title = _s(r.get("title"))
        if not title:
            continue
        techs = [t.strip() for t in _s(r.get("tech_stack")).split(",") if t.strip()]
        out.append({
            "title": title, "summary": _s(r.get("summary")), "description": _s(r.get("description")),
            "techs": techs, "canon": {_canon(t) for t in techs}, "date": _date(r.get("project_date")),
            "role": _s(r.get("role")), "context": _s(r.get("context")),
            "category": _s(r.get("category")).lower().replace(" ", "_") or None,
            "featured": _is_true(r.get("featured")),
            "github_url": _url(r.get("github_url")), "demo_url": _url(r.get("demo_url")),
        })
    return out


def _item(p: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": p["title"], "tech_stack": list(p["techs"]), "category": _cat_label(p["category"]),
        "summary": _clip(p["summary"] or p["description"], 180) or None, "role": p["role"] or None,
        "date": _fmt_date(p["date"]), "github_url": p["github_url"], "demo_url": p["demo_url"],
    }


def _norm(q: str) -> str:
    q = q.lower().replace("’", "'")
    q = re.sub(r"[?!,;:()\"“”]", " ", q)
    return " ".join(q.split()).strip(" .")


def _plural(n: int, word: str = "project") -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _result(kind: str, answer: str, items: Optional[List[dict]] = None, intent: str = "", **extra: Any) -> Dict[str, Any]:
    body = {"kind": kind, "answer": answer, "items": (items or [])[:MAX_ITEMS], "suggestions": [], "intent": intent}
    body.update(extra)
    return body


def _name() -> str:
    return (os.getenv("CANDIDATE_NAME", "Konstantin") or "Konstantin").strip() or "Konstantin"


# --------------------------------------------------------------------------- detection
def _tech_vocab(projects) -> Dict[str, str]:
    """canonical name -> display name (most common casing)."""
    counts: Dict[str, Dict[str, int]] = {}
    for p in projects:
        for t in p["techs"]:
            counts.setdefault(_canon(t), {}).setdefault(t, 0)
            counts[_canon(t)][t] += 1
    return {c: max(v, key=lambda k: (v[k], k)) for c, v in counts.items()}


def _detect_techs(q: str, vocab: Dict[str, str]) -> List[str]:
    terms = set(vocab) | {a for a, c in ALIASES.items() if c in vocab}
    work, found = " " + q + " ", []
    for term in sorted(terms, key=len, reverse=True):
        e = re.escape(term)
        if term in _AMBIGUOUS_TECH:
            pat = (rf"\b(?:in|with|using|uses?|used|know|knows)\s+{e}(?![a-z0-9+#.])"
                   rf"|(?<![a-z0-9+#.]){e}\s+(?:projects?|language|programming)\b")
        else:
            pat = rf"(?<![a-z0-9+#.]){e}(?![a-z0-9+#])"
        m = re.search(pat, work)
        if m:
            work = work[: m.start()] + " " + work[m.end():]
            c = ALIASES.get(term, term)
            if c not in found:
                found.append(c)
    return found


def _title_keys(projects) -> List[Tuple[Dict[str, Any], List[str]]]:
    token_counts: Dict[str, int] = {}
    for p in projects:
        main = re.split(r"\s*[:(]\s*", p["title"].lower())[0]
        for tok in set(re.findall(r"[a-z0-9]+", main)):
            token_counts[tok] = token_counts.get(tok, 0) + 1
    out = []
    for p in projects:
        t = p["title"].lower()
        main = re.split(r"\s*[:(]\s*", t)[0].strip(" )")
        keys = {t, main} | set(re.findall(r"\(([^)]+)\)", t))
        for tok in re.findall(r"[a-z0-9]+", main):
            if len(tok) >= 5 and tok not in _GENERIC_TITLE_WORDS and token_counts.get(tok) == 1:
                keys.add(tok)
        out.append((p, sorted((k.strip() for k in keys if len(k.strip()) >= 4), key=len, reverse=True)))
    return out


def _detect_titles(q: str, projects) -> List[Dict[str, Any]]:
    keyed = _title_keys(projects)
    hits = [p for p, keys in keyed if any(re.search(rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])", q) for k in keys)]
    if hits:
        return hits
    m = re.search(r"\b(?:about|describe|explain|what is|what's|whats|details? (?:on|of|about))\s+(.+)$", q)
    if not m:
        return []
    phrase = [w for w in re.findall(r"[a-z0-9]+", m.group(1)) if w not in _STOP]
    if not phrase:
        return []
    pset = set(phrase)
    for p, _ in keyed:
        toks = set(re.findall(r"[a-z0-9]+", re.split(r"\s*[:(]\s*", p["title"].lower())[0]))
        if len(pset) >= 2 and pset <= toks and len(pset) / max(1, len(toks)) >= 0.6:
            return [p]
    if len(phrase) <= 2:  # typo tolerance: "squirel" -> "squirrl"
        allkeys = [k for _, keys in keyed for k in keys]
        close = difflib.get_close_matches(" ".join(phrase), allkeys, n=1, cutoff=0.8)
        if close:
            return [p for p, keys in keyed if close[0] in keys][:1]
    return []


# --------------------------------------------------------------------------- filters
def _parse_filters(q: str, projects, vocab) -> Dict[str, Any]:
    f: Dict[str, Any] = {"techs": _detect_techs(q, vocab), "any": bool(re.search(r"\bor\b", q))}
    cats = {p["category"] for p in projects if p["category"]}
    f["category"] = None
    for key, pat in _CATEGORY_WORDS.items():
        if key in cats and re.search(pat, q):
            f["category"] = key
            break
    if f["category"] is None:
        for c in cats:
            if re.search(rf"\b{re.escape(c.replace('_', ' '))}\b", q):
                f["category"] = c
                break
    m = re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d\d)\b", q)
    y = re.search(r"\b(20\d\d)\b", q)
    f["month"] = (_MONTHS.index(m.group(1)) + 1) if m else None
    f["year"] = int(m.group(2)) if m else (int(y.group(1)) if y else None)
    f["featured"] = bool(re.search(r"\bfeatured\b|\bhighlight(?:s|ed)?\b|\bbest\b|\btop\b|\bflagship\b|\bstrongest\b|\bimpressive\b|\bproudest\b", q))
    f["hack"] = bool(re.search(r"\bhackathons?\b|\bhacks?\b", q))
    f["wins"] = f["hack"] and bool(re.search(r"\bwon\b|\bwins?\b|\bwinner\b|\bawards?\b|\bprizes?\b|\bplace\b", q))
    lat = re.search(r"\b(latest|newest|most recent|last)\b", q)
    f["latest"] = 1 if lat else (3 if re.search(r"\brecent\b", q) else None)
    return f


_PLACE_RE = re.compile(r"\b(?:1st|2nd|3rd|first|second|third)\s+place\b|\bwon\b|\bwinner\b|\bawards?\b|\bprize\b", re.I)


def _active(f) -> bool:
    return bool(f["techs"] or f["category"] or f["year"] or f["featured"] or f["hack"] or f["latest"])


def _apply(projects, f) -> List[Dict[str, Any]]:
    out = []
    for p in projects:
        if f["techs"]:
            hit = [t in p["canon"] for t in f["techs"]]
            if not (any(hit) if f["any"] else all(hit)):
                continue
        if f["category"] and p["category"] != f["category"]:
            continue
        if f["year"] and not (p["date"] or "").startswith(str(f["year"])):
            continue
        if f["month"] and (not p["date"] or int(p["date"][5:7]) != f["month"]):
            continue
        if f["featured"] and not p["featured"]:
            continue
        if f["hack"] and "hackathon" not in p["context"].lower():
            continue
        if f["wins"] and not _PLACE_RE.search(p["context"] + " " + p["summary"]):
            continue
        out.append(p)
    if f["latest"]:
        out = sorted([p for p in out if p["date"]], key=lambda p: p["date"], reverse=True)[: f["latest"]]
    return out


def _describe(f, vocab, n: int) -> str:
    adj = ("featured " if f["featured"] else "") + ("hackathon " if f["hack"] else "")
    parts = [f"{adj}{'project' if n == 1 else 'projects'}"]
    if f["wins"]:
        parts.append("with a listed placement")
    if f["techs"]:
        names = [vocab.get(t, t) for t in f["techs"]]
        parts.append(("uses " if n == 1 else "use ") + (" or " if f["any"] else " and ").join(names))
        parts[-1] = "that " + parts[-1]
    if f["category"]:
        parts.append("in " + (_cat_label(f["category"]) or f["category"]))
    if f["year"]:
        parts.append("from " + (f"{_MONTH_NAMES[f['month'] - 1]} " if f["month"] else "") + str(f["year"]))
    return " ".join(parts)


# --------------------------------------------------------------------------- answers
def _detail(p) -> Dict[str, Any]:
    lines = [p["title"], p["summary"] or p["description"]]
    if p["techs"]:
        lines.append("Built with: " + ", ".join(p["techs"]))
    if p["role"]:
        lines.append("Role: " + p["role"])
    if p["date"]:
        lines.append("Date: " + (_fmt_date(p["date"]) or ""))
    return _result("text", "\n".join(lines), [_item(p)], "project")


def _answer(q: str, projects) -> Optional[Dict[str, Any]]:
    vocab = _tech_vocab(projects)
    f = _parse_filters(q, projects, vocab)
    titles = _detect_titles(q, projects)
    wants_count = bool(re.search(r"\bhow many\b|\bnumber of\b|\bcount\b", q))
    tech_words = bool(re.search(r"\btech\b|\bstack\b|\btechnolog\w*|\bbuilt with\b|\blanguages?\b|\bframeworks?\b|\buse[sd]?\b|\busing\b", q))

    # links / demos
    if re.search(r"\bgithub\b|\brepos?\b|\brepositor(?:y|ies)\b|\bsource code\b|\bdemos?\b|\blinks?\b|\burls?\b|\blive\b", q):
        pool = titles or [p for p in projects if p["github_url"] or p["demo_url"]]
        linked = [p for p in pool if p["github_url"] or p["demo_url"]]
        if linked:
            head = "Links" + (f" for {linked[0]['title']}" if titles and len(titles) == 1 else " listed in the portfolio")
            return _result("list", head + ":", [_item(p) for p in linked], "links")
        who = titles[0]["title"] if titles else "any project"
        return _result("text", f"No public repo or demo link is listed for {who} yet. Some repositories are private; "
                       "the contact form is the best way to ask.", [], "links")

    # role
    if re.search(r"\broles?\b|\bresponsib\w+|\bwhat did you do (?:in|on|for)\b|\byour part\b", q):
        if titles:
            p = titles[0]
            if p["role"]:
                return _result("text", f"Role on {p['title']}: {p['role']}", [_item(p)], "role")
            return _detail(p)
        rows = [p for p in projects if p["role"]]
        if rows:
            return _result("list", f"Roles across {_plural(len(rows))}:", [_item(p) for p in rows], "role")

    # one named project
    if titles and not (f["techs"] and not tech_words):
        if len(titles) > 1:
            return _result("list", f"{_plural(len(titles))} match:", [_item(p) for p in titles], "title")
        p = titles[0]
        if f["techs"]:
            has = [t for t in f["techs"] if t in p["canon"]]
            nice = [vocab.get(t, t) for t in f["techs"]]
            if len(has) == len(f["techs"]):
                return _result("text", f"Yes, {p['title']} lists {', '.join(nice)} in its tech stack.", [_item(p)], "title_tech")
            return _result("text", f"No, {p['title']} does not list {', '.join(nice)}. Its stack: {', '.join(p['techs'])}.", [_item(p)], "title_tech")
        if re.search(r"\btech\b|\bstack\b|\btechnolog\w*|\bbuilt with\b|\blanguages?\b|\buse[sd]?\b", q):
            return _result("text", f"{p['title']} is built with: {', '.join(p['techs']) or 'no tech listed'}.", [_item(p)], "title_tech")
        return _detail(p)
    if titles and f["techs"] and tech_words:
        pass  # e.g. "projects like squirrl that use react": fall to the filter branch

    if _active(f):
        matches = _apply(projects, f)
        desc = _describe(f, vocab, len(matches))
        if not matches:
            extra = ""
            dates = sorted({p["date"][:4] for p in projects if p["date"]})
            if f["year"] and dates:
                extra = f" Projects in the portfolio are dated {dates[0]}" + (f" to {dates[-1]}." if dates[-1] != dates[0] else ".")
            return _result("text", f"I couldn't find any {desc}.{extra}", [], "filter")
        if f["latest"]:
            head = ("Most recent " if f["latest"] == 1 else f"{len(matches)} most recent ") + desc
            return _result("list", head + ":", [_item(p) for p in matches], "latest")
        if wants_count:
            return _result("count", f"{len(matches)} {desc}", [_item(p) for p in matches], "count", count=len(matches))
        more = f" Showing {MAX_ITEMS}." if len(matches) > MAX_ITEMS else ""
        return _result("list", f"{len(matches)} {desc}:{more}", [_item(p) for p in matches], "filter", count=len(matches))

    if wants_count and re.search(r"project", q):
        feat = sum(1 for p in projects if p["featured"])
        return _result("count", f"{_plural(len(projects))} in the portfolio, {feat} of them featured.", [], "count_all", count=len(projects))

    if re.search(r"\btechnolog\w*|\btech stack\b|\bskills?\b|\blanguages?\b|\bframeworks?\b|\btools\b|\bstack\b", q):
        freq: Dict[str, int] = {}
        for p in projects:
            for c in p["canon"]:
                freq[c] = freq.get(c, 0) + 1
        top = sorted(freq, key=lambda c: (-freq[c], c))[:30]
        if top:
            return _result("text", "Technologies across the portfolio: " + ", ".join(f"{vocab.get(c, c)} ({freq[c]})" for c in top)
                           + ". The number is how many projects use it.", [], "tech_overview")

    if re.search(r"\b(list|show|display|see|browse|all|every|what|which)\b", q) and re.search(r"\bprojects?\b|\bportfolio\b|\bwork\b", q) \
            or re.search(r"\bwhat (?:have|did|do|has)\b.*\b(?:built|build|made|create\w*|work\w* on)\b", q):
        more = f" Showing {MAX_ITEMS}." if len(projects) > MAX_ITEMS else ""
        return _result("list", f"{_plural(len(projects))} in the portfolio.{more}", [_item(p) for p in projects], "list_all", count=len(projects))
    return None


# --------------------------------------------------------------------------- public API
def suggestions_for(projects_raw: Sequence[Dict[str, Any]], n: int = 3) -> List[str]:
    """Example questions, each checked against the data so every one gets a real answer."""
    projects = _prep(projects_raw)
    if not projects:
        return list(STATIC_SUGGESTIONS)[:n]
    vocab = _tech_vocab(projects)
    freq: Dict[str, int] = {}
    for p in projects:
        for c in p["canon"]:
            freq[c] = freq.get(c, 0) + 1
    ranked = sorted(freq, key=lambda c: (-freq[c], c))
    cands = ["Which projects are featured?"]
    if ranked:
        cands.append(f"How many projects use {vocab[ranked[0]]}?")
    pool = [p for p in projects if p["featured"]] or projects
    first = min(pool, key=lambda p: len(re.split(r"\s*[:(]\s*", p["title"])[0]))
    cands.append("Tell me about " + re.split(r"\s*[:(]\s*", first["title"])[0].strip())
    if len(ranked) > 1:
        cands.append(f"What did you build with {vocab[ranked[1]]}?")
    if any("hackathon" in p["context"].lower() for p in projects):
        cands.append("Which projects came from hackathons?")
    out: List[str] = []
    for c in cands:
        r = _answer(_norm(c), projects)
        if r and r["kind"] in ("list", "count", "text") and (r["items"] or r["kind"] == "count"):
            out.append(c)
        if len(out) == n:
            break
    return out or list(STATIC_SUGGESTIONS)[:n]


def refusal_body(projects_raw: Optional[Sequence[Dict[str, Any]]] = None) -> Dict[str, Any]:
    try:
        sugg = suggestions_for(projects_raw or [])
    except Exception:
        sugg = list(STATIC_SUGGESTIONS)
    text = (f"I can answer questions about {_name()}'s projects: what they're built with, which are featured, "
            "hackathons, dates and roles. Try one of these:")
    body = _result("refusal", text, [], "refusal")
    body["suggestions"] = sugg
    return body


def readonly_refusal(projects_raw: Optional[Sequence[Dict[str, Any]]] = None) -> Dict[str, Any]:
    body = refusal_body(projects_raw)
    body["answer"] = f"This chat is read-only. It can only answer questions about {_name()}'s portfolio. Try one of these:"
    body["intent"] = "readonly"
    return body


def _should_try(q: str) -> bool:
    if q in _SMALLTALK or len(q) < 3:
        return False
    return bool(_KEYWORDS_RE.search(q)) or len(q) <= 60


def answer_intent(question: str, load_projects: Callable[[], Sequence[Dict[str, Any]]]) -> Optional[Dict[str, Any]]:
    """Returns a response body, or None when no intent matches. May raise if loading fails."""
    q = _norm(question)
    if not _should_try(q):
        return None
    raw = load_projects()
    if _MUTATION_RE.search(q):
        return readonly_refusal(raw)
    projects = _prep(raw or [])
    if not projects:
        return None
    result = _answer(q, projects)
    if result is not None and result["kind"] == "text" and not result["items"] and result["intent"] in ("filter", "links"):
        result["suggestions"] = suggestions_for(raw)  # "nothing found": point at questions that work
    return result
