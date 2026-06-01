---
allowed-tools: Bash(handoff:*)
description: 从知识胶囊抽取 Skill Asset
---

从 `$ARGUMENTS` 指定的 Knowledge Capsule 抽取可审核、可分享的 Skill Asset。

执行：

```bash
handoff skill from-knowledge "$ARGUMENTS"
```

返回 Skill Asset id 和 SQLite 存储引用。适合把一次高质量 AI 对话提炼为团队可复用资料。
