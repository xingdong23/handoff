---
allowed-tools: Bash(handoff:*)
description: Import a Handoff Capsule, Knowledge, or Skill Asset context
---

Import the Capsule id, Skill Asset id, share token, share page URL, or share API URL named in `$ARGUMENTS`.

Run:

```bash
handoff import "$ARGUMENTS"
```

Use the returned Recovery Prompt, Knowledge context, or Skill Manifest as the active context for continuing the task.

Skill imports are lazy by default. Use `handoff import "$ARGUMENTS" --activate` only when the full Skill content is needed.
