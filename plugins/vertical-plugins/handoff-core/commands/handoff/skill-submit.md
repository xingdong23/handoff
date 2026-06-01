---
allowed-tools: Bash(handoff:*)
description: 提交 Skill、知识胶囊或经验到 Handoff Skill 平台
---

把 `$ARGUMENTS` 指定的标题作为 Skill Asset 提交到 Handoff Skill 平台。

执行示例：

```bash
handoff skill submit "$ARGUMENTS" --stdin
```

也可以从文件提交：

```bash
handoff skill submit "$ARGUMENTS" --from ./skill.md --type skill
```

返回 Skill Asset id 和 SQLite 存储引用。审核通过后可以分享给团队成员使用。
