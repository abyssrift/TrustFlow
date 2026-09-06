"""Add UI rules before TSX/JSX edits without blocking unrelated changes."""
from __future__ import annotations

import json
import re
import sys


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        return 0
    raw = json.dumps(event.get("tool_input") or {}).replace("\\", "/").lower()
    if re.search(r"(?:^|[^a-z0-9])[^\"']+\.(?:tsx|jsx)(?:[^a-z0-9]|$)", raw):
        print(json.dumps({"systemMessage": "TrustFlow UI rules apply before TSX/JSX edits.", "hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": "UI-visible edit detected. Read and follow .agents/rules/ui-consistency.md, .agents/rules/ux-consistency.md, and .agents/rules/ui-style-guide.md before editing, as required by CLAUDE.md. If animation changes, also read animation-consistency.md."}}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
