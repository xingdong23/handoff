import { saveAttentionState } from "./store.js";
import { nowIso } from "./utils.js";

function hoursSince(date) {
  if (!date) return 0;
  return (Date.now() - new Date(date).getTime()) / 36e5;
}

export function computeAttention({ capsules = [], gitlab = {}, git = {} }) {
  const items = [];

  for (const capsule of capsules) {
    const age = hoursSince(capsule.updatedAt || capsule.createdAt);
    if (capsule.progress?.status === "in_progress" && age >= 24) {
      items.push({
        kind: "capsule",
        level: "medium",
        title: `${capsule.title} 已超过 24 小时没有更新`,
        detail: capsule.progress.nextStep || capsule.summary,
        ref: capsule.id
      });
    }
  }

  for (const mr of gitlab.mergeRequests || []) {
    const age = hoursSince(mr.updatedAt);
    if (age >= 48) {
      items.push({
        kind: "merge_request",
        level: "high",
        title: `!${mr.iid} 等待处理超过 48 小时`,
        detail: mr.title,
        ref: mr.webUrl
      });
    }
    if (mr.pipeline?.status === "failed") {
      items.push({
        kind: "pipeline",
        level: "high",
        title: `!${mr.iid} Pipeline 失败`,
        detail: mr.title,
        ref: mr.pipeline.webUrl || mr.webUrl
      });
    }
  }

  for (const pipeline of gitlab.pipelines || []) {
    if (pipeline.status === "failed") {
      items.push({
        kind: "pipeline",
        level: "high",
        title: `Pipeline ${pipeline.id} 失败`,
        detail: pipeline.ref || pipeline.sha,
        ref: pipeline.webUrl
      });
    }
  }

  if (git.dirtyFiles?.length) {
    items.push({
      kind: "git",
      level: "low",
      title: `${git.dirtyFiles.length} 个文件存在本地变更`,
      detail: git.dirtyFiles.slice(0, 5).join(", "),
      ref: git.root
    });
  }

  return items;
}

export function saveAttention(cwd, items) {
  const payload = {
    scannedAt: nowIso(),
    items
  };
  return saveAttentionState(cwd, payload);
}
