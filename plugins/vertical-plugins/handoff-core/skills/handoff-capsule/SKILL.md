---
name: handoff-capsule
description: Capture, import, attach, share, and track AI conversation assets with Handoff. Use when a Claude Code session needs to preserve context, continue a previous chat, pass context across chats, inspect Git delivery state, or open the Handoff dashboard.
---

# Handoff Capsule

Handoff turns an AI conversation into a reusable Capsule. A Capsule should contain a readable title, current state, progress, decisions, confirmed facts, related files, next actions, and the Git requirement status for the files that belong to the current demand.

## Capture

Use capture when the current conversation contains useful context that should survive beyond the current chat.

```bash
handoff capture "<short-readable-title>" --source claude-code --stdin
```

Prefer structured JSON input with these fields:

```json
{
  "summary": "What has been discussed so far.",
  "status": "in_progress",
  "progressPercent": 60,
  "currentStep": "Current implementation point.",
  "nextStep": "Next concrete step.",
  "facts": ["Confirmed fact"],
  "decisions": ["Decision already made"],
  "files": ["src/example.ts"],
  "commands": ["npm test"],
  "nextActions": ["Concrete next action"]
}
```

## Import

Use import when another chat needs to continue the full conversation.

```bash
handoff import "<capsule-id-or-share-url>"
```

The returned Recovery Prompt is intended to become the active context for the next AI session.

## Attach

Use attach when the current chat only needs compact background from another Capsule.

```bash
handoff attach "<capsule-id>"
```

Attach should preserve the current chat's main context while adding facts, decisions, next actions, and scoped Git status from another conversation.

## Share

Use share when another person or another local chat needs a portable Capsule reference.

```bash
handoff share "<capsule-id>"
```

## Dashboard

Use the dashboard to inspect projects, Capsule progress, Git state, GitLab merge requests, and attention items.

```bash
handoff open --workspace .
```

## Git Requirement Status

When producing or reviewing a Capsule, make sure the related files are present in the `files` list. Handoff uses that list to decide whether the current demand has been committed and pushed. Avoid mixing unrelated dirty files into the demand status.
