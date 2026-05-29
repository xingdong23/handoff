---
allowed-tools: Bash(handoff:*)
description: Export a Capsule into the current Git repository
---

Export the Capsule named in `$ARGUMENTS` into the current Git repository.

Run:

```bash
handoff git sync "$ARGUMENTS"
```

Return the staged files summary.
