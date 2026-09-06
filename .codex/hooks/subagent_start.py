"""Inject durable repository rules and Sol/Luna role boundaries into subagents."""
from __future__ import annotations

import json
import sys


CONTEXT = (
    "TrustFlow subagent contract: before acting, read AGENTS.md, CLAUDE.md, every .agents/rules/*.md, "
    "and .agents/skills/sol-architect-orchestration/SKILL.md completely. Respect graphify-before-source-exploration "
    "when graphify-out/graph.json exists and run graphify update . after production-code changes. Keep scope bounded "
    "to the assigned package, preserve dirty changes, and report findings/files/commands/failures/risks concisely. "
    "Universal orchestration: every planned feature, refactor, or code change uses the GPT-5.6-Sol medium architect "
    "for planning, decomposition, integration, and final PASS/BLOCK review, with GPT-5.6-Luna medium agents for bounded slices. "
    "Only an explicit override in the current user task may change this hierarchy; direct execution is reserved for trivial "
    "non-planning inspection or tiny mechanical actions. The GPT-5.6-Sol medium architect owns requirements, decomposition, "
    "integration, and final PASS/BLOCK; GPT-5.6-Luna medium workers execute only assigned slices and do not broaden scope "
    "or make final acceptance decisions. "
    "Read-only/reviewer agents must not edit files."
)


def main() -> int:
    try:
        json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        pass
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "SubagentStart", "additionalContext": CONTEXT}}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
