---
allowed-tools: Bash(handoff:*)
description: Import a Handoff Capsule, Knowledge, or Skill Asset context
---

Import the Capsule id, Skill Asset id, share token, share page URL, or share API URL named in `$ARGUMENTS`.

Run:

```bash
handoff import "$ARGUMENTS"
```

Use the returned Recovery Prompt, Knowledge context, or full Skill content as the active context for continuing the task.

An explicit import always returns the full content. Manifest-only (head/description) loading happens only during team mode auto-load on `handoff mode enter`.
