---
allowed-tools: Bash(handoff:*)
description: 导入 Handoff Skill Asset 到当前 AI 对话
---

导入 `$ARGUMENTS` 指定的 Skill Asset。参数可以是本地 Skill Asset id、分享 token、本地分享页面地址或 API 地址。

执行：

```bash
handoff skill import "$ARGUMENTS"
```

返回适合注入当前 AI 对话的 Skill 上下文。
