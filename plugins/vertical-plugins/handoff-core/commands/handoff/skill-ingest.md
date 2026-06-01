---
allowed-tools: Bash(handoff:*)
description: 从文本或文件生成 Handoff Skill Asset
---

把 `$ARGUMENTS` 指定的标题和输入内容生成 Skill Asset。系统会保留来源 Capsule 和 Knowledge Capsule，并把 Skill Asset 放入审核队列。

执行：

```bash
handoff skill ingest "$ARGUMENTS" --stdin
```

从文件生成：

```bash
handoff skill ingest "$ARGUMENTS" --from ./experience.md
```
