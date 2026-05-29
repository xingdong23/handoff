---
allowed-tools: Bash(/opt/homebrew/bin/node:*), Bash(/Users/chengzheng/workspace/chuangxin/handoff/bin/handoff.js:*), Bash(handoff:*)
description: Import a Handoff Capsule and continue from its recovery prompt
---

Import the capsule, token, or API URL named in `$ARGUMENTS`.

Run:

```bash
/opt/homebrew/bin/node /Users/chengzheng/workspace/chuangxin/handoff/bin/handoff.js import "$ARGUMENTS"
```

Use the returned Recovery Prompt as the active context for continuing the task.
