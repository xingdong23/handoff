---
allowed-tools: Bash(handoff:*)
description: 向当前 Handoff 工作模式导入 Skill
---

向当前 Handoff 工作模式主动导入 `$ARGUMENTS` 指定的 Skill，加载完整正文并标记为已激活。

执行：

```bash
handoff mode import "$ARGUMENTS"
```

需要在整段会话中长期保留该 Skill 时，使用 `--pin` 钉住：

```bash
handoff mode import "$ARGUMENTS" --pin
```

> 进入模式时自动批量加载的云端团队 Skill 只保留头部描述（Manifest）；这里的主动 import 始终加载完整正文。
