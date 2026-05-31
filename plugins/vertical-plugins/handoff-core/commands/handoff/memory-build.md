---
allowed-tools: Bash(handoff:*)
description: 汇总团队知识胶囊并生成团队知识记忆
---

汇总已有知识胶囊，生成新的团队知识记忆快照。

执行：

```bash
handoff memory build $ARGUMENTS
```

默认范围为 `team`，可以传入 `--scope project` 仅汇总当前项目，也可以传入 `--min-score 70` 只汇总质量分达到指定值的知识胶囊。
