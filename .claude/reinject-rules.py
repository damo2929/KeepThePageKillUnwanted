#!/usr/bin/env python3
"""Re-inject this repo's CLAUDE.md rules into the model's context.

Wired to SessionStart and PostCompact in .claude/settings.json.

PostCompact is the event that matters. A compact replaces the conversation
with a summary, and anything the summary did not carry is gone -- including
rules the agent was told once at the start. PostCompact runs after that
replacement, so what it returns lands in the fresh context. (PreCompact runs
*before*, and cannot put anything into the window that replaces it.)

Emits the hook JSON contract: hookSpecificOutput.additionalContext is fed back
to the model. Prints "{}" and exits 0 on any problem -- a hook that fails must
never block a session.
"""
import json
import os
import sys

MAX_CHARS = 20000


def main():
    event = 'SessionStart'
    try:
        payload = json.load(sys.stdin)
        event = payload.get('hook_event_name') or event
    except Exception:
        pass  # no stdin, or not JSON: fall back to the default event name

    root = os.environ.get('CLAUDE_PROJECT_DIR') or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, 'CLAUDE.md')

    try:
        with open(path, encoding='utf-8') as fh:
            rules = fh.read()
    except Exception:
        print('{}')
        return

    if not rules.strip():
        print('{}')
        return

    if len(rules) > MAX_CHARS:
        rules = rules[:MAX_CHARS] + '\n\n[truncated — read CLAUDE.md in full]'

    header = (
        'Standing rules for this repository, re-injected because context may '
        'have been compacted. These are not optional and they did not expire:\n\n'
    )
    print(json.dumps({
        'hookSpecificOutput': {
            'hookEventName': event,
            'additionalContext': header + rules,
        }
    }))


if __name__ == '__main__':
    main()
