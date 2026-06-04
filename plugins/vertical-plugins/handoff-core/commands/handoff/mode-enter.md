---
allowed-tools: Bash(handoff:*)
description: 进入 Handoff 团队工作模式
---

进入 `$ARGUMENTS` 指定的 Handoff 工作模式。未提供参数时默认进入 `team-development`。

执行：

```bash
handoff mode enter "$ARGUMENTS"
```

返回模式提示词。该模式会引用审核通过的团队 Skill Manifest，并集成 Harness 阶段开发流程。
