"""Email notification for the contact form.

Uses Resend's HTTP API (standard library only, no new dependency). HTTP is used instead of SMTP because
hosts like Render commonly block outbound SMTP ports on free instances.

Environment variables (set them in backend/.env locally and in the Render dashboard):
  RESEND_API_KEY       required, from resend.com -> API Keys
  CONTACT_TO_EMAIL     required, where the messages should arrive (your inbox)
  CONTACT_FROM_EMAIL   optional, defaults to "Portfolio <onboarding@resend.dev>" (Resend's shared test sender,
                       which can only deliver to the email address your Resend account was created with)

If either required variable is missing, nothing is sent and one line is logged. The message is already saved
in the database by then, so a failed email never fails the form.
"""

import json
import logging
import os
import re
import threading
import urllib.error
import urllib.request

log = logging.getLogger(__name__)

_EMAIL_RE = re.compile(
    r"^[A-Za-z0-9._%+\-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$"
)


def is_valid_email(value: str) -> bool:
    """Plain address only (name@domain.tld). Rejects spaces, "Name <x@y>" forms, missing dots in the domain,
    doubled or edge dots, and over-long parts. It checks the shape, not whether the mailbox exists."""
    if not isinstance(value, str) or len(value) > 254 or not _EMAIL_RE.fullmatch(value):
        return False
    local = value.rsplit("@", 1)[0]
    return len(local) <= 64 and not local.startswith(".") and not local.endswith(".") and ".." not in value


RESEND_URL = "https://api.resend.com/emails"
TIMEOUT_SECONDS = 10


def _send(name: str, email: str, message: str, contact_id) -> None:
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    to_addr = os.getenv("CONTACT_TO_EMAIL", "").strip()
    from_addr = os.getenv("CONTACT_FROM_EMAIL", "").strip() or "Portfolio <onboarding@resend.dev>"
    if not api_key or not to_addr:
        log.warning("contact email skipped: RESEND_API_KEY or CONTACT_TO_EMAIL is not set")
        return

    # Plain text only, so nothing the visitor typed is ever interpreted as markup.
    body = (
        f"New message from your portfolio contact form (#{contact_id}).\n\n"
        f"Name: {name}\n"
        f"Email: {email}\n\n"
        f"{message}\n"
    )
    payload = {
        "from": from_addr,
        "to": [to_addr],
        "reply_to": email,  # hitting Reply in your mail app answers the visitor
        "subject": f"Portfolio message from {name[:60]}".replace("\r", " ").replace("\n", " "),
        "text": body,
    }
    req = urllib.request.Request(
        RESEND_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "portfolio-contact/1.0",  # Cloudflare (error 1010) blocks the default Python-urllib agent
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            log.info("contact email sent id=%s status=%s", contact_id, resp.status)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        log.error("contact email failed id=%s status=%s to=%r from=%r detail=%s", contact_id, e.code, to_addr, from_addr, detail)
    except Exception as e:  # network down, timeout, DNS...
        log.error("contact email failed id=%s error=%s", contact_id, e)


def notify_contact(name: str, email: str, message: str, contact_id=None) -> None:
    """Send the notification in a background thread so the visitor does not wait on the email provider."""
    threading.Thread(target=_send, args=(name, email, message, contact_id), daemon=True).start()