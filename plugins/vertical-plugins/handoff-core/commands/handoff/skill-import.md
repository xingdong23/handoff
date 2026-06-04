---
allowed-tools: Bash(handoff:*)
description: 导入 Handoff Skill Asset 到当前 AI 对话
---

导入 `$ARGUMENTS` 指定的 Skill Asset。参数可以是本地 Skill Asset id、分享 token、本地分享页面地址或 API 地址。

执行：

```bash
handoff skill import "$ARGUMENTS"
```

返回完整 Skill 正文，适合直接注入当前 AI 对话作为可用能力或经验上下文。

> 只加载 Skill 头部描述（Manifest）的场景仅出现在进入团队工作模式时的自动批量加载，主动 import 始终返回完整正文。
