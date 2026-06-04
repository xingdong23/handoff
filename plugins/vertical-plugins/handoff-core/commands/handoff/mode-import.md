---
allowed-tools: Bash(handoff:*)
description: 向当前 Handoff 工作模式导入 Skill
---

向当前 Handoff 工作模式导入 `$ARGUMENTS` 指定的 Skill。

执行：

```bash
handoff mode import "$ARGUMENTS"
```

默认只引用 Skill Manifest。需要完整内容时执行：

```bash
handoff mode import "$ARGUMENTS" --activate
```
