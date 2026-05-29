---
allowed-tools: Bash(handoff:*)
description: Scan GitLab merge requests, pipelines, and issues
---

Scan GitLab state for the current project.

Run:

```bash
handoff gitlab scan "$ARGUMENTS"
```

Use `--project-id group/project` when the project id has not been saved.
