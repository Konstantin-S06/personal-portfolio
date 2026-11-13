"""
Shared validation/serialization for projects (used by the API and seed_projects.py).
"""

import json
from datetime import date

CATEGORIES = ("web", "ai_ml", "systems", "game", "research", "tooling")
MAX_HIGHLIGHTS = 6
MAX_HIGHLIGHT_LEN = 240
DEFAULT_SORT_ORDER = 100

# Optional columns introduced after the original schema. Only these names are ever
# interpolated into SQL (never user input); values are always bound parameters.
EXTRA_FIELDS = ("summary", "role", "context", "highlights", "category", "featured", "sort_order", "demo_url")


def _opt_text(data, key, max_len, label):
    """Optional string. Returns (value|None, error|None)."""
    v = data.get(key)
    if v is None:
        return None, None
    if not isinstance(v, str):
        return None, f'{label} must be a string'
    v = v.strip()
    if not v:
        return None, None
    if len(v) > max_len:
        return None, f'{label} too long'
    return v, None


def _opt_url(data, key, label):
    v, err = _opt_text(data, key, 300, label)
    if err:
        return None, err
    if v and not v.startswith('http'):
        return None, f'Invalid {label}'
    return v, None


def parse_project_date(value):
    """Accepts YYYY-MM-DD or empty/null. Returns date | None | "INVALID"."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except Exception:
        return "INVALID"


def _parse_highlights(value):
    """Accepts a list or a JSON string. Returns (json_string|None, error|None)."""
    if value is None:
        return None, None
    if isinstance(value, str):
        if not value.strip():
            return None, None
        try:
            value = json.loads(value)
        except ValueError:
            return None, 'highlights must be valid JSON'
    if not isinstance(value, list):
        return None, 'highlights must be a list of strings'
    items = []
    for item in value:
        if not isinstance(item, str):
            return None, 'highlights must be a list of strings'
        item = item.strip()
        if not item:
            continue
        if len(item) > MAX_HIGHLIGHT_LEN:
            return None, f'Each highlight must be at most {MAX_HIGHLIGHT_LEN} characters'
        items.append(item)
    if len(items) > MAX_HIGHLIGHTS:
        return None, f'At most {MAX_HIGHLIGHTS} highlights allowed'
    if not items:
        return None, None
    return json.dumps(items, ensure_ascii=False), None


def highlights_to_list(raw):
    """Stored JSON string -> real list (never raises, never returns a string)."""
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw]
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return [x for x in parsed if isinstance(x, str)] if isinstance(parsed, list) else []


def validate_project(data):
    """
    Validate a POST/PUT/seed payload.

    Returns (clean, error). `clean` always has title, description, tech_stack, github_url,
    project_date (date | None). The optional columns are present only if the payload
    contained that key, so a PUT that omits them leaves stored values alone.
    """
    if not isinstance(data, dict):
        return None, 'Invalid JSON body'

    clean = {}
    for field, limit, msg in (
        ('title', 200, 'Title too long'),
        ('description', 2000, 'Description too long'),
        ('tech_stack', 300, 'Tech stack too long'),
    ):
        v = data.get(field)
        if not isinstance(v, str) or not v.strip():
            return None, f'Missing required field: {field}'
        v = v.strip()
        if len(v) > limit:
            return None, msg
        clean[field] = v

    clean['github_url'], err = _opt_url(data, 'github_url', 'GitHub URL')
    if err:
        return None, err

    d = parse_project_date(data.get('project_date'))
    if d == "INVALID":
        return None, 'Invalid project_date. Use YYYY-MM-DD.'
    clean['project_date'] = d

    for key, limit, label in (('summary', 280, 'summary'), ('role', 200, 'role'), ('context', 200, 'context')):
        if key in data:
            clean[key], err = _opt_text(data, key, limit, label)
            if err:
                return None, err

    if 'highlights' in data:
        clean['highlights'], err = _parse_highlights(data.get('highlights'))
        if err:
            return None, err

    if 'category' in data:
        cat = data.get('category')
        if isinstance(cat, str):
            cat = cat.strip() or None
        if cat is not None and cat not in CATEGORIES:
            return None, f'category must be one of: {", ".join(CATEGORIES)}'
        clean['category'] = cat

    if 'featured' in data:
        f = data.get('featured')
        if isinstance(f, bool):
            f = int(f)
        if f is None:
            f = 0
        if not isinstance(f, int) or f not in (0, 1):
            return None, 'featured must be 0 or 1'
        clean['featured'] = f

    if 'sort_order' in data:
        s = data.get('sort_order')
        if s is None or s == '':
            s = DEFAULT_SORT_ORDER
        if isinstance(s, bool) or not isinstance(s, int) or abs(s) > 1_000_000:
            return None, 'sort_order must be an integer'
        clean['sort_order'] = s

    if 'demo_url' in data:
        clean['demo_url'], err = _opt_url(data, 'demo_url', 'demo URL')
        if err:
            return None, err

    return clean, None
