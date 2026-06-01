---
allowed-tools: Bash(handoff:*)
description: 从文本或文件生成 Handoff 知识胶囊
---

把 `$ARGUMENTS` 指定的标题和输入内容生成 Knowledge Capsule。系统会保留来源 Capsule，并返回 Knowledge Capsule id。

执行：

```bash
handoff knowledge ingest "$ARGUMENTS" --stdin
```

从文件生成：

```bash
handoff knowledge ingest "$ARGUMENTS" --from ./note.md
```
