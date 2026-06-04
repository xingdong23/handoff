---
name: handoff-capsule
description: Capture, import, attach, share, and track AI conversation assets with Handoff. Use when a Claude Code session needs to preserve context, continue a previous chat, pass context across chats, inspect Git delivery state, or open the Handoff dashboard.
---

# Handoff Capsule

Handoff turns an AI conversation into a reusable Capsule. A Capsule should contain a readable title, current state, progress, decisions, confirmed facts, related files, next actions, and the Git requirement status for the files that belong to the current demand.

## Unified Assets

Capsules, Knowledge Capsules, and Skill Assets are all Handoff assets. Use the unified asset commands when the exact type is already known by id or share URL.

```bash
handoff asset list
handoff asset show "<asset-id>"
handoff asset share "<asset-id>"
handoff asset import "<asset-id-or-token-or-url>"
```

Use `handoff import "<asset-id-or-token-or-url>"` as the generic import command. It returns the right context for the asset type: recovery prompt for Capsule, project knowledge for Knowledge Capsule, and reusable procedure for Skill Asset.

## Requirement Capsule

Use requirement analysis when a PRD, demand note, or meeting note should become structured project context before implementation starts.

```bash
handoff requirement analyze "<short-readable-title>" --stdin
```

Prefer structured input with title, summary, background, goals, scope, nonGoals, personas, flows, acceptanceCriteria, openQuestions, systems, files, impacts, and tasks. The returned Requirement Capsule can be used as source context for later Capture, Knowledge Capsule extraction, and Team Memory.

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

## Knowledge Capsule

Use knowledge extraction when a high-value conversation should become reusable team knowledge.

Create a Knowledge Capsule from raw text or a file:

```bash
handoff knowledge ingest "<short-readable-title>" --stdin
```

Extract from an existing Capsule:

```bash
handoff knowledge extract "<capsule-id>"
```

The returned Knowledge Capsule keeps the reusable summary, topics, facts, decisions, files, commands, next actions, and source Capsule reference.

Share a Knowledge Capsule when team members need to read it without restoring the full source conversation.

```bash
handoff knowledge share "<knowledge-id>"
```

## Team Memory

Use team memory when existing Knowledge Capsules should be merged into a team-level memory snapshot.

```bash
handoff memory build --scope team
```

Use `--scope project` when only the current project should be included.
Use `--min-score 70` when only Knowledge Capsules with enough quality signals should be included.

## Skill Platform

Use Skill Platform when a reusable Skill, Knowledge Capsule, or expert experience should enter team review and become shareable.

Submit a manual Skill Asset:

```bash
handoff skill submit "<short-readable-title>" --stdin
```

Create a Skill Asset from raw text or a file:

```bash
handoff skill ingest "<short-readable-title>" --stdin
```

Create a Skill Asset from an existing Capsule:

```bash
handoff skill from-capsule "<capsule-id>"
```

Create a Skill Asset from an existing Knowledge Capsule:

```bash
handoff skill from-knowledge "<knowledge-id>"
```

Approve and share it:

```bash
handoff skill review "<asset-id>" --approve
handoff skill share "<asset-id>"
```

Reference a Skill Asset into the current AI chat by id, token, share page URL, or API URL. Skill import is lazy by default and returns a Manifest first:

```bash
handoff skill import "<asset-id-or-token-or-url>"
```

Load full Skill content only when the current task needs that Skill:

```bash
handoff skill import "<asset-id-or-token-or-url>" --activate
```

Enter a clean team development mode backed by Harness and approved Handoff Skill manifests:

```bash
handoff mode enter team-development
```

Import a Skill into the active mode:

```bash
handoff mode import "<skill-id>"
```

## Dashboard

Use the dashboard to inspect projects, Capsule progress, Git state, GitLab merge requests, and attention items.

```bash
handoff open --workspace .
```

## Git Requirement Status

When producing or reviewing a Capsule, make sure the related files are present in the `files` list. Handoff uses that list to decide whether the current demand has been committed and pushed. Avoid mixing unrelated dirty files into the demand status.
