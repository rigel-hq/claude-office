#!/bin/bash
# Forward Claude Code hook events to RigelHQ Session Gateway
# Reads JSON from stdin (hook payload), POSTs to backend
# Always exits 0 so Claude Code is never blocked

INPUT=$(cat)

# Add the hook event type from the environment if available
EVENT_TYPE="${CLAUDE_HOOK_EVENT_TYPE:-unknown}"

curl -s -X POST http://localhost:4000/hooks/event \
  -H 'Content-Type: application/json' \
  -d "$INPUT" \
  2>/dev/null || true

exit 0
