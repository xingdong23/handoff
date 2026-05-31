---
allowed-tools: Bash(handoff:*)
description: 分析需求文档并生成 Handoff Requirement Capsule
---

分析当前需求资料，并生成 Requirement Capsule。`$ARGUMENTS` 作为需求标题。

先把 PRD、需求说明或会议纪要整理成 JSON，再执行：

```bash
handoff requirement analyze "$ARGUMENTS" --stdin <<'JSON'
{
  "summary": "需求摘要",
  "background": "业务背景",
  "goals": ["目标"],
  "scope": ["范围"],
  "nonGoals": ["非范围"],
  "personas": ["用户角色"],
  "flows": ["核心流程"],
  "acceptanceCriteria": ["验收标准"],
  "openQuestions": ["开放问题"],
  "systems": ["相关系统"],
  "files": ["相关文件"],
  "impacts": ["影响范围"],
  "tasks": ["建议任务"]
}
JSON
```

如果需求文档已经保存为文件，可以执行：

```bash
handoff requirement analyze "$ARGUMENTS" --from <file>
```

返回 Requirement Capsule id 和 SQLite 存储引用。
