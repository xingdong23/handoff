---
allowed-tools: Bash(handoff:*)
description: 从 Handoff Capsule 抽取 Skill Asset
---

从 `$ARGUMENTS` 指定的 Capsule 抽取可审核、可分享的 Skill Asset。

执行：

```bash
handoff skill from-capsule "$ARGUMENTS"
```

返回 Skill Asset id 和 SQLite 存储引用。审核通过后使用 `handoff skill share` 生成分享资料。
