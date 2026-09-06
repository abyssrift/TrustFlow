"""Fast, fail-closed only for narrowly recognizable destructive shell commands."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def emit(payload: dict) -> None:
    print(json.dumps(payload, separators=(",", ":")))


def repo_root(cwd: str) -> Path:
    current = Path(cwd or ".").resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    return current


def broad_recursive_target(command: str) -> bool:
    """Only flag recursive deletion aimed at a filesystem root or home variable."""
    if not (
        re.search(r"\bremove-item\b[^\r\n;]*(?:-recurse|-r)\b", command)
        or re.search(r"\brm\b[^\r\n;]*-[^\s;]*r[^\s;]*\b", command)
    ):
        return False
    return bool(
        re.search(r"(?:^|[\s\"'=])/(?=\s|$)", command)
        or re.search(r"(?:^|[\s\"'=])[a-z]:/?(?=\s|$)", command)
        or re.search(r"(?:^|[\s\"'=])~(?:[/\\]|\s|$)", command)
        or re.search(r"\$(?:env:)?home\b", command)
    )


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        return 0
    command = str((event.get("tool_input") or {}).get("command") or "")
    normalized = command.replace("\\", "/").lower()
    destructive = (
        broad_recursive_target(normalized)
        or re.search(r"\bgit\s+reset\s+--hard\b", normalized)
        or re.search(r"\bgit\s+clean\s+-[^\r\n;]*f", normalized)
        or re.search(r"\bdel(?:ete)?\b[^\r\n;]*/s\b", normalized)
    )
    if destructive:
        emit({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "TrustFlow policy blocks broadly destructive shell commands; narrow the target and obtain explicit user direction."}})
        return 0

    root = repo_root(str(event.get("cwd") or "."))
    graph = root / "graphify-out" / "graph.json"
    source_probe = re.search(
        r"\b(?:rg|ripgrep|grep|find|fd|ack|ag|cat|type|gc|get-content|select-string|sed)\b",
        normalized,
    )
    if graph.is_file() and source_probe and "graphify" not in normalized:
        emit({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": "MANDATORY TrustFlow orientation: graphify-out/graph.json exists. Run `graphify query \"<question>\"`, `graphify explain \"<concept>\"`, or `graphify path \"<A>\" \"<B>\"` before raw source exploration; only then inspect targeted files."}})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
