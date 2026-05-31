---
allowed-tools: Bash(handoff:*)
description: 从 Handoff Capsule 抽取团队知识胶囊
---

从 `$ARGUMENTS` 指定的 Capsule 抽取团队知识胶囊。

执行：

```bash
handoff knowledge extract "$ARGUMENTS"
```

返回知识胶囊 id 和 SQLite 存储引用。分享知识胶囊时使用：

```bash
handoff knowledge share "$ARGUMENTS"
```
