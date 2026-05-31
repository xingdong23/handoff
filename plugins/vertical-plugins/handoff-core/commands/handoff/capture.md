---
allowed-tools: Bash(handoff:*), Bash(git status:*), Bash(git diff:*), Bash(git branch:*)
description: Capture the current Claude Code conversation as a Handoff Capsule
---

Create a compact Handoff Capsule for the current conversation.

Build a JSON body from the current task state, then run:

```bash
handoff capture "$ARGUMENTS" --source claude-code --stdin <<'JSON'
{
  "title": "Short readable title for this chat",
  "summary": "What has been discussed so far.",
  "status": "in_progress",
  "progressPercent": 45,
  "currentStep": "Current point in the conversation.",
  "nextStep": "Next executable step.",
  "facts": ["Confirmed fact"],
  "decisions": ["Decision already made"],
  "files": ["src/example.ts"],
  "commands": ["npm test"],
  "openQuestions": ["Question that still matters"],
  "nextActions": ["Concrete next action"]
}
JSON
```

Return the Capsule id and storage reference.
