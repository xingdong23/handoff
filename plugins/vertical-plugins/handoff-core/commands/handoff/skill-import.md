---
allowed-tools: Bash(handoff:*)
description: 引用或激活 Handoff Skill Asset 到当前 AI 对话
---

引用 `$ARGUMENTS` 指定的 Skill Asset。参数可以是本地 Skill Asset id、分享 token、本地分享页面地址或 API 地址。

执行：

```bash
handoff skill import "$ARGUMENTS"
```

默认只返回 Skill Manifest，用于判断当前任务是否需要该能力。

需要完整 Skill 内容时执行：

```bash
handoff skill import "$ARGUMENTS" --activate
```
