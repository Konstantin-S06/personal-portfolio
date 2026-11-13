"""Run from the project root: python apply_prose_patch.py
Adds model-written prose above the list for open questions ("What is the best project?", "Tell me about X").

Copy first:  chat_prose.py and test_chat_prose.py into backend/.
This script then patches three existing files:
  backend/chat_service.py          calls add_prose() after the intent layer (new optional arg prose_llm)
  backend/ai_helper.py             call_hf_chat gets an optional timeout so a slow model cannot hang the chat
  src/components/ChatPanel.tsx     reads body.prose and puts it under the lead line on the page
Checks every anchor in all three files first and writes nothing on any mismatch.
Backups: *.pre-prose.bak (delete them before committing)."""
import pathlib
import sys


def load(p):
    p = pathlib.Path(p)
    if not p.exists():
        sys.exit('MISSING FILE: ' + str(p))
    raw = p.read_bytes().decode('utf-8')
    return p, raw, '\r\n' in raw, raw.replace('\r\n', '\n')


if not pathlib.Path('backend/chat_prose.py').exists():
    sys.exit('MISSING FILE: backend/chat_prose.py (copy it into backend/ first)')

files = {}
for key, path in (('svc', 'backend/chat_service.py'), ('ai', 'backend/ai_helper.py'), ('panel', 'src/components/ChatPanel.tsx')):
    files[key] = list(load(path))  # [path, raw, crlf, text]

if 'add_prose' in files['svc'][3] or 'timeout=timeout' in files['ai'][3] or 'm.prose' in files['panel'][3]:
    sys.exit('Looks already patched (found add_prose / timeout / m.prose). Nothing written.')


def rep(key, old, new):
    n = files[key][3].count(old)
    if n != 1:
        sys.exit('ANCHOR FAILED (%d matches) in %s:\n%s' % (n, files[key][0], old[:160]))
    files[key][3] = files[key][3].replace(old, new)


# ---- chat_service.py ------------------------------------------------------------------------------------------
rep('svc', 'items, suggestions, sql_query (always None). Counts and lists may add "count".',
    'items, suggestions, sql_query (always None). Counts and lists may add "count".\n'
    'Intent answers to open questions may add "prose": a short model-written paragraph that was validated\n'
    '(chat_prose); it is absent when the model is slow, unavailable or its output was rejected.')
rep('svc', 'from chat_sql import MAX_QUESTION_CHARS, RateLimiter, answer_with_sql\n',
    'from chat_prose import PROSE_TIMEOUT_S, add_prose\nfrom chat_sql import MAX_QUESTION_CHARS, RateLimiter, answer_with_sql\n')
rep('svc', 'def _default_runner_factory():',
    'def _default_prose_llm(messages, max_tokens, temperature):\n'
    '    from ai_helper import call_hf_chat  # lazy: needs the openai package\n\n'
    '    return call_hf_chat(messages, max_tokens=max_tokens, temperature=temperature, timeout=PROSE_TIMEOUT_S)\n\n\n'
    'def _default_runner_factory():')
rep('svc', '    projects_loader: Optional[Callable] = None,\n) -> Tuple[Dict[str, Any], int]:',
    '    projects_loader: Optional[Callable] = None,\n    prose_llm: Optional[Callable] = None,\n) -> Tuple[Dict[str, Any], int]:')
rep('svc', '    logger.info("chat path=%s intent=%s question_chars=%d", path, intent_name or "-", len(question))\n    return body, 200',
    '    prose_used = False\n'
    '    if path == "intent" and body is not None:\n'
    '        body, prose_used = add_prose(question, body, intent_name, prose_llm or _default_prose_llm)\n'
    '    logger.info("chat path=%s intent=%s prose=%s question_chars=%d", path, intent_name or "-", "yes" if prose_used else "no", len(question))\n'
    '    return body, 200')

# ---- ai_helper.py ---------------------------------------------------------------------------------------------
rep('ai', 'def call_hf_chat(messages, max_tokens=200, temperature=0.1):',
    'def call_hf_chat(messages, max_tokens=200, temperature=0.1, timeout=None):')
rep('ai', '            completion = client.chat.completions.create(\n'
          '                model=model,\n'
          '                messages=messages,\n'
          '                max_tokens=max_tokens,\n'
          '                temperature=temperature,\n'
          '            )',
    '            extra = {} if timeout is None else {"timeout": timeout}  # None would mean "no timeout" to the SDK\n'
    '            completion = client.chat.completions.create(\n'
    '                model=model,\n'
    '                messages=messages,\n'
    '                max_tokens=max_tokens,\n'
    '                temperature=temperature,\n'
    '                **extra,\n'
    '            )')

# ---- ChatPanel.tsx --------------------------------------------------------------------------------------------
rep('panel', 'interface BotMsg {\n  kind: Kind;\n  text: string;\n  items: ChatItem[];',
    'interface BotMsg {\n  kind: Kind;\n  text: string;\n  /** Short model-written paragraph shown under the lead line; null when the server sent none. */\n  prose: string | null;\n  items: ChatItem[];')
rep('panel', '  return { kind, text, items: parseItems(data.items), suggestions };',
    '  return { kind, text, prose: str(data.prose)?.slice(0, 600) ?? null, items: parseItems(data.items), suggestions };')
rep('panel', '      text: "I couldn\'t reach the server just now. Try again in a moment.",\n      items: [],',
    '      text: "I couldn\'t reach the server just now. Try again in a moment.",\n      prose: null,\n      items: [],')
rep('panel', '  const out = [m.text];',
    "  // Lead line first, then the paragraph (if any), then the rest of the text and the project lines.\n"
    "  const lines = m.text.split('\\n');\n"
    "  const out = m.prose ? [lines[0], m.prose, ...lines.slice(1)] : [m.text];")

# ---- write everything (only reached when every anchor matched) -------------------------------------------
for key, (path, raw, crlf, text) in files.items():
    bak = path.with_name(path.name + '.pre-prose.bak')
    bak.write_bytes(raw.encode('utf-8'))
    path.write_bytes((text.replace('\n', '\r\n') if crlf else text).encode('utf-8'))
    print('patched', path)
print('Done. Run: cd backend && python -m unittest test_chat_prose -v. Delete the *.pre-prose.bak files before committing.')
