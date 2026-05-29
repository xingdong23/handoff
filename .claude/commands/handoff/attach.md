---
allowed-tools: Bash(/opt/homebrew/bin/node:*), Bash(/Users/chengzheng/workspace/chuangxin/handoff/bin/handoff.js:*), Bash(handoff:*)
description: Attach another chat capsule as compact context
---

Attach the capsule named in `$ARGUMENTS` as compact external context.

Run:

```bash
/opt/homebrew/bin/node /Users/chengzheng/workspace/chuangxin/handoff/bin/handoff.js attach "$ARGUMENTS"
```

Use the returned facts, decisions, and next actions as referenced context.
