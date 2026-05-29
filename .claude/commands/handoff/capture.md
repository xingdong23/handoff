---
allowed-tools: Bash(/opt/homebrew/bin/node:*), Bash(/Users/chengzheng/workspace/chuangxin/handoff/bin/handoff.js:*), Bash(handoff:*), Bash(git status:*), Bash(git diff:*), Bash(git branch:*)
description: Package the current AI chat into a Handoff Capsule
---

Create a Handoff Capsule for the current conversation.

Build a compact JSON body from the current conversation and run:

```bash
/opt/homebrew/bin/node /Users/chengzheng/workspace/chuangxin/handoff/bin/handoff.js capture "$ARGUMENTS" --source claude-code --stdin <<'JSON'
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

Use this JSON shape:

```json
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
```
