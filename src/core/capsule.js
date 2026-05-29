import { join } from "node:path";
import { readFileSync } from "node:fs";
import { capsuleId, compact, nowIso, unique, writeText } from "./utils.js";
import { getGitRequirementStatus, getGitSnapshot } from "./git.js";
import { ensureWorkspace, loadConfig, saveCapsule } from "./store.js";
import { bulletList, fieldLine, firstParagraph, sectionList } from "./markdown.js";
import { deriveTitle } from "./titles.js";

function normalizeInput(input) {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    return null;
  }
  return null;
}

function extractContext(input) {
  const json = normalizeInput(input);
  if (json) {
    return {
      raw: input,
      title: json.title || json.topic || json.subject || "",
      sourceApp: json.source?.app || json.sourceApp || "",
      chatName: json.source?.chatName || json.chatName || "",
      sessionId: json.source?.sessionId || json.sessionId || "",
      summary: json.summary || "",
      facts: json.facts || json.confirmedFacts || [],
      decisions: json.decisions || [],
      files: json.files || [],
      commands: json.commands || [],
      openQuestions: json.openQuestions || json.questions || [],
      nextActions: json.nextActions || json.nextSteps || [],
      currentStep: json.currentStep || json.current_step || "",
      nextStep: json.nextStep || json.next_step || "",
      progressPercent: Number(json.progressPercent ?? json.progress?.percent ?? 0),
      status: json.status || json.progress?.status || "in_progress"
    };
  }

  return {
    raw: input || "",
    title: fieldLine(input, ["title", "标题", "topic", "主题"]) || "",
    sourceApp: fieldLine(input, ["source", "source app", "来源"]) || "",
    chatName: fieldLine(input, ["chat", "chat name", "会话名"]) || "",
    sessionId: fieldLine(input, ["session", "session id", "会话 ID"]) || "",
    summary: fieldLine(input, ["summary", "摘要"]) || firstParagraph(input),
    facts: sectionList(input, ["facts", "confirmed facts", "已验证", "关键事实"]),
    decisions: sectionList(input, ["decisions", "已确定", "决策"]),
    files: sectionList(input, ["files", "相关文件", "涉及文件"]),
    commands: sectionList(input, ["commands", "命令"]),
    openQuestions: sectionList(input, ["open questions", "questions", "待确认", "开放问题"]),
    nextActions: sectionList(input, ["next actions", "next steps", "下一步", "后续处理"]),
    currentStep: fieldLine(input, ["current step", "当前步骤"]) || "",
    nextStep: fieldLine(input, ["next step", "下一步"]) || "",
    progressPercent: Number(fieldLine(input, ["progress", "进度"]).replace("%", "")) || 0,
    status: fieldLine(input, ["status", "状态"]) || "in_progress"
  };
}

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

function statusText(value) {
  const labels = {
    yes: "yes",
    no: "no",
    unknown: "unknown"
  };
  return labels[value] || "unknown";
}

function formatCommit(commit) {
  if (!commit?.sha) return "none";
  return `${commit.sha.slice(0, 12)} ${commit.subject || ""}`.trim();
}

export function formatGitRequirementStatus(requirement) {
  if (!requirement?.repos?.length) {
    return "Scope: unknown\nBranch: none\nCommitted to Git: unknown\nPushed to remote: unknown";
  }

  return requirement.repos.map((repo, index) => {
    const prefix = requirement.repos.length > 1 ? `Repo ${index + 1}: ${repo.root}` : `Repo: ${repo.root}`;
    const files = repo.scopeFiles?.length ? repo.scopeFiles.join(", ") : "unknown";
    const dirty = repo.dirtyFiles?.length ? repo.dirtyFiles.join(", ") : "none";
    const unpushed = repo.unpushedCommits?.length
      ? repo.unpushedCommits.map(formatCommit).join("; ")
      : "none";
    return [
      prefix,
      `Branch: ${repo.branch || "none"}`,
      `Upstream: ${repo.upstream || "none"}`,
      `Scope files: ${files}`,
      `Committed to Git: ${statusText(repo.committed)}`,
      `Pushed to remote: ${statusText(repo.pushed)}`,
      `Dirty scoped files: ${dirty}`,
      `Latest scoped commit: ${formatCommit(repo.latestCommit)}`,
      `Unpushed scoped commits: ${unpushed}`
    ].join("\n");
  }).join("\n\n");
}

export function buildRecoveryPrompt(capsule) {
  const facts = capsule.contextPack.facts.length
    ? capsule.contextPack.facts.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "暂无已验证事实。";
  const decisions = capsule.contextPack.decisions.length
    ? capsule.contextPack.decisions.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "暂无已确定决策。";
  const files = capsule.contextPack.files.length
    ? capsule.contextPack.files.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "暂无相关文件。";
  const nextActions = capsule.contextPack.nextActions.length
    ? capsule.contextPack.nextActions.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : capsule.progress.nextStep || "继续阅读上下文并补齐下一步处理。";

  return [
    "# Handoff Recovery Prompt",
    "",
    `Project: ${capsule.project.name}`,
    `Capsule: ${capsule.id}`,
    `Source: ${capsule.source.app}${capsule.source.chatName ? ` / ${capsule.source.chatName}` : ""}`,
    "",
    "## Current State",
    capsule.summary || "暂无摘要。",
    "",
    "## Progress",
    `Status: ${capsule.progress.status}`,
    `Percent: ${capsule.progress.percent}%`,
    `Current step: ${capsule.progress.currentStep || "暂无记录"}`,
    `Next step: ${capsule.progress.nextStep || "暂无记录"}`,
    "",
    "## Git Requirement Status",
    formatGitRequirementStatus(capsule.git.requirement),
    "",
    "## Confirmed Facts",
    facts,
    "",
    "## Decisions",
    decisions,
    "",
    "## Files",
    files,
    "",
    "## Continue From",
    nextActions
  ].join("\n");
}

export function buildContextPackMarkdown(capsule) {
  return [
    `# ${capsule.title}`,
    "",
    `Capsule: ${capsule.id}`,
    `Project: ${capsule.project.name}`,
    `Status: ${capsule.progress.status}`,
    "",
    "## Summary",
    capsule.summary || "暂无摘要。",
    "",
    "## Git Requirement Status",
    "",
    formatGitRequirementStatus(capsule.git.requirement),
    "",
    bulletList("Facts", capsule.contextPack.facts),
    bulletList("Decisions", capsule.contextPack.decisions),
    bulletList("Files", capsule.contextPack.files),
    bulletList("Commands", capsule.contextPack.commands),
    bulletList("Open Questions", capsule.contextPack.openQuestions),
    bulletList("Next Actions", capsule.contextPack.nextActions),
    "## Recovery Prompt",
    "",
    capsule.contextPack.recoveryPrompt,
    ""
  ].join("\n");
}

export function buildSharePackMarkdown(capsule) {
  return [
    `# ${capsule.title}`,
    "",
    "## What changed in the conversation",
    "",
    capsule.summary || "暂无摘要。",
    "",
    "## Progress",
    "",
    `Status: ${capsule.progress.status}`,
    `Percent: ${capsule.progress.percent}%`,
    `Next step: ${capsule.progress.nextStep || "暂无记录"}`,
    "",
    "## Git Requirement Status",
    "",
    formatGitRequirementStatus(capsule.git.requirement),
    "",
    bulletList("Decisions", capsule.contextPack.decisions),
    bulletList("Next Actions", capsule.contextPack.nextActions),
    "## Git",
    "",
    `Branch: ${capsule.git.branch || "none"}`,
    `Dirty files: ${capsule.git.dirtyFiles.length}`,
    ""
  ].join("\n");
}

export function createCapsule(options = {}) {
  const cwd = options.cwd || process.cwd();
  const paths = ensureWorkspace(cwd, { projectId: options.projectId });
  const config = loadConfig(cwd);
  const input = options.input || "";
  const context = extractContext(input);
  const title = deriveTitle({ optionTitle: options.title, context, input });
  const id = options.id || capsuleId(title);
  const git = getGitSnapshot(cwd);
  const gitRequirement = getGitRequirementStatus(cwd, context.files || []);
  const createdAt = nowIso();
  const files = unique([...(context.files || []), ...(git.dirtyFiles || [])]);
  const summary = options.summary || context.summary || compact(input, 280) || "暂无摘要。";
  const sourceApp = options.source || context.sourceApp || firstEnv(["HANDOFF_SOURCE_APP", "CLAUDE_CODE_SOURCE_APP"]) || "manual";
  const chatName = options.chatName || context.chatName || firstEnv(["HANDOFF_CHAT_NAME", "CLAUDE_CODE_CHAT_NAME", "CLAUDE_CHAT_NAME"]);
  const sessionId = options.sessionId || context.sessionId || firstEnv([
    "HANDOFF_SESSION_ID",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_SESSION_ID",
    "CLAUDECODE_SESSION_ID",
    "CLAUDE_CONVERSATION_ID"
  ]);

  const capsule = {
    schemaVersion: 1,
    id,
    title,
    project: {
      id: options.projectId || config.projectId,
      name: config.projectName || config.projectId,
      root: paths.root
    },
    source: {
      app: sourceApp,
      chatName,
      sessionId
    },
    summary,
    progress: {
      status: context.status || "in_progress",
      percent: Math.max(0, Math.min(100, context.progressPercent || 0)),
      currentStep: context.currentStep || "",
      nextStep: context.nextStep || context.nextActions?.[0] || ""
    },
    contextPack: {
      facts: context.facts || [],
      decisions: context.decisions || [],
      files,
      commands: context.commands || [],
      openQuestions: context.openQuestions || [],
      nextActions: context.nextActions || [],
      recoveryPrompt: ""
    },
    git: {
      isRepo: git.isRepo,
      root: git.root,
      branch: git.branch,
      status: git.status,
      dirtyFiles: git.dirtyFiles,
      diffStat: git.diffStat,
      lastCommit: git.lastCommit,
      requirement: gitRequirement
    },
    gitlab: {
      mergeRequests: [],
      issues: [],
      pipelines: []
    },
    share: {
      visibility: "private",
      tokens: []
    },
    createdAt,
    updatedAt: createdAt
  };

  capsule.contextPack.recoveryPrompt = buildRecoveryPrompt(capsule);

  const capsuleDir = saveCapsule(cwd, capsule, [
    { kind: "json", name: "capsule.json", value: capsule },
    { kind: "text", name: "transcript.md", value: context.raw || input, writeText },
    { kind: "text", name: "context-pack.md", value: buildContextPackMarkdown(capsule), writeText },
    { kind: "text", name: "share-pack.md", value: buildSharePackMarkdown(capsule), writeText },
    { kind: "text", name: "recovery-prompt.md", value: capsule.contextPack.recoveryPrompt, writeText },
    { kind: "json", name: "files.json", value: { files } },
    { kind: "json", name: "gitlab-links.json", value: capsule.gitlab },
    { kind: "text", name: "decisions.md", value: bulletList("Decisions", capsule.contextPack.decisions), writeText },
    { kind: "text", name: "next-actions.md", value: bulletList("Next Actions", capsule.contextPack.nextActions), writeText }
  ]);

  return { capsule, capsuleDir };
}

export function readTranscript(path) {
  return readFileSync(join(path, "transcript.md"), "utf8");
}
