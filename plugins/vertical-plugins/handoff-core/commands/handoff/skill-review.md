---
allowed-tools: Bash(handoff:*)
description: 审核 Handoff Skill Asset
---

审核 `$ARGUMENTS` 指定的 Skill Asset。

通过审核：

```bash
handoff skill review "$ARGUMENTS" --approve
```

驳回审核：

```bash
handoff skill review "$ARGUMENTS" --reject
```

审核通过后可以使用 `handoff skill share "$ARGUMENTS"` 生成分享资料。
