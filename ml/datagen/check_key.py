"""`uv run python -m datagen.check_key`: one tiny call to the bulk model through the backend.

Prints `OK <model> via <base url>` (exit 0) or `FAIL <error message>` (exit 1). The API key is
never printed. The answer is also written to <output_root>/key_status.json for runners.
"""

from __future__ import annotations

import json
import sys
import time

from .config import default
from .transport import OpenAITransport, TransportError


def check(transport=None) -> tuple[bool, str]:
    cfg = default()
    model = cfg.role("bulk")["model"]
    import time as _t

    ok, msg = False, "FAIL no attempt"
    for attempt in range(6):  # 429/5xx from a busy proxy are not key failures: back off
        try:
            t = transport or OpenAITransport(timeout=60)
            resp = t.chat(
                {
                    "model": model,
                    "max_completion_tokens": 16,
                    "messages": [{"role": "user", "content": "Reply with: ok"}],
                }
            )
            u = resp.get("usage") or {}
            base = getattr(t, "base_url", None) or "default"
            ok, msg = (
                True,
                (
                    f"OK {resp.get('model') or model} via {base} "
                    f"(prompt {u.get('prompt_tokens')}, completion {u.get('completion_tokens')})"
                ),
            )
            break
        except TransportError as e:
            ok, msg = False, f"FAIL {e.status or ''} {e.code or ''} {e}".replace("  ", " ")
            if not e.retryable or attempt == 5:
                break
            _t.sleep(min(60, 5 * 2**attempt))
    (cfg.output_root / "key_status.json").write_text(
        json.dumps({"ok": ok, "message": msg, "model": model, "checked_at": time.time()})
    )
    return ok, msg


def main() -> None:
    ok, msg = check()
    print(msg)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
