import pytest

from apply_chat_patch import NEW_ROUTE, PatchError, apply

APP = '''from flask import Flask, request, jsonify
app = Flask(__name__)


@app.route('/api/contact', methods=['POST'])
def submit_contact():
    return jsonify({}), 201


@app.route('/api/chat', methods=['POST'])
def chat():
    """old"""
    try:
        from ai_helper import answer_portfolio_question
        data = request.get_json()
        app.logger.info(f"Chat question: {data}")
        return jsonify({'answer': 'x'}), 200
    except ImportError:
        return jsonify({'answer': 'nope'}), 200


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy'}), 200
'''


def write(tmp_path, text, crlf=False):
    p = tmp_path / "app.py"
    p.write_bytes((text.replace("\n", "\r\n") if crlf else text).encode())
    return str(p)


@pytest.mark.parametrize("crlf", [False, True])
def test_patch_applies_keeps_line_endings_and_other_routes(tmp_path, crlf):
    p = write(tmp_path, APP, crlf)
    assert apply(p) == "patched"
    out = open(p, "rb").read().decode()
    assert ("\r\n" in out) == crlf
    norm = out.replace("\r\n", "\n")
    assert "from chat_service import handle_chat" in norm
    assert "Chat question" not in norm and "answer_portfolio_question" not in norm
    assert "def submit_contact" in norm and "def health_check" in norm
    compile(norm, "app.py", "exec")
    assert (tmp_path / "app.py.pre-chat.bak").exists()
    assert apply(p) == "already applied"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda t: t.replace("@app.route('/api/chat', methods=['POST'])", "@app.route('/api/chat2', methods=['POST'])"),
        lambda t: t.replace("@app.route('/api/health', methods=['GET'])", "@app.route('/api/healthz', methods=['GET'])"),
        lambda t: t + "\n" + "@app.route('/api/chat', methods=['POST'])\ndef chat2():\n    return 1\n",
        lambda t: t.replace("def chat():", "def talk():"),
        lambda t: t.replace("def health_check", "@app.route('/api/extra')\ndef extra():\n    return 1\n\n\n@app.route('/api/health', methods=['GET'])\ndef health_check"),
    ],
)
def test_patch_refuses_and_writes_nothing_on_mismatch(tmp_path, mutate):
    text = mutate(APP)
    p = write(tmp_path, text)
    before = open(p, "rb").read()
    with pytest.raises(PatchError):
        apply(p)
    assert open(p, "rb").read() == before
    assert not (tmp_path / "app.py.pre-chat.bak").exists()


def test_new_route_is_valid_python():
    compile("from flask import jsonify, request\napp=None\n" + NEW_ROUTE.replace("@app.route", "#@app.route"), "x", "exec")
