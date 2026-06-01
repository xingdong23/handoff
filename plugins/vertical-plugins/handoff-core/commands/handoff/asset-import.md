---
allowed-tools: Bash(handoff:*)
description: 导入 Handoff 统一资产到当前 AI 对话
---

导入 `$ARGUMENTS` 指定的资产。参数可以是资产 id、分享 token、本地分享页面地址或 API 地址。

执行：

```bash
handoff asset import "$ARGUMENTS"
```

返回适合注入当前 AI 对话的上下文。
