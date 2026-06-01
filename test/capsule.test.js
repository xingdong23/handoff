import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCapsule } from "../src/core/capsule.js";
import { deleteCapsule, gitLabTokenConfigured, listProjects, loadGitLabToken, readCapsule, readCapsuleArtifacts, readShare, saveGitLabToken } from "../src/core/store.js";
import { createKnowledgeShare, createShare } from "../src/core/share.js";
import { computeAttention } from "../src/core/reminders.js";
import { getDashboard } from "../src/core/dashboard.js";
import { buildTeamMemory, createKnowledgeCapsule, listTeamMemorySnapshots, readKnowledgeCapsule } from "../src/core/knowledge.js";
import { analyzeRequirement, readRequirementCapsule } from "../src/core/requirement.js";
import {
  createSkillAssetFromCapsule,
  createSkillAssetFromKnowledge,
  createSkillAssetShare,
  importSkillAsset,
  readSkillAsset,
  reviewSkillAsset,
  submitSkillAsset
} from "../src/core/skill-platform.js";
import {
  convertAsset,
  createAssetShare,
  importAssetContext,
  ingestKnowledgeAsset,
  ingestSkillAsset,
  listAssets,
  readAsset
} from "../src/core/assets.js";
import { listActiveSessions } from "../src/core/active-sessions.js";

process.env.HANDOFF_CLAUDE_HOME = mkdtempSync(join(tmpdir(), "handoff-empty-claude-"));

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function gitCommit(cwd, message) {
  git(cwd, ["-c", "user.name=Handoff Test", "-c", "user.email=handoff@example.test", "commit", "-m", message]);
}

test("creates a capsule from structured json", () => {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-"));
  process.env.HANDOFF_DB = join(cwd, "handoff.sqlite");
  const input = JSON.stringify({
    summary: "Payment timeout design reached retry policy discussion.",
    status: "in_progress",
    progressPercent: 55,
    currentStep: "Review retry limits",
    nextStep: "Patch RetryScheduler",
    facts: ["RetryScheduler owns retry dispatch"],
    decisions: ["Use exponential backoff"],
    files: ["src/RetryScheduler.java"],
    nextActions: ["Add concurrency limit"]
  });

  const { capsule, capsuleDir } = createCapsule({ cwd, title: "payment timeout", input, source: "test" });
  assert.equal(capsule.progress.percent, 55);
  assert.equal(capsule.contextPack.decisions[0], "Use exponential backoff");
  assert.match(capsule.contextPack.recoveryPrompt, /Patch RetryScheduler/);
  assert.match(capsuleDir, /^sqlite:/);
  assert.match(readCapsuleArtifacts(cwd, capsule.id)["context-pack.md"], /RetryScheduler/);
  assert.equal(readCapsule(cwd, capsule.id).id, capsule.id);
});

test("derives a readable title when command title is generic", () => {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-"));
  process.env.HANDOFF_DB = join(cwd, "handoff.sqlite");
  const input = JSON.stringify({
    summary: "针对截图问题（car_service 是只读子 agent）做了根因定位与修复。",
    status: "in_progress",
    progressPercent: 92
  });

  const { capsule } = createCapsule({ cwd, title: "handoff capsule", input, source: "test" });
  assert.equal(capsule.title, "car_service 只读边界修复");
  assert.match(capsule.id, /cap_.*_car-service-只读边界修复/);
});

test("dashboard derives a readable title for legacy generic capsules", () => {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-"));
  process.env.HANDOFF_DB = join(cwd, "handoff.sqlite");
  const capsuleDir = join(cwd, ".handoff", "capsules", "cap_legacy");
  mkdirSync(capsuleDir, { recursive: true });
  writeFileSync(
    join(capsuleDir, "capsule.json"),
    `${JSON.stringify({
      id: "cap_legacy",
      title: "handoff capsule",
      summary: "针对截图问题（car_service 是只读子 agent）做了根因定位与修复。",
      source: { app: "claude-code", chatName: "micar-agent", sessionId: "" },
      progress: { status: "in_progress", percent: 92, currentStep: "", nextStep: "" },
      contextPack: { facts: [], decisions: [], files: [], commands: [], openQuestions: [], nextActions: [] },
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z"
    })}\n`,
    "utf8"
  );

  const dashboard = getDashboard(cwd);
  assert.equal(dashboard.projects[0].capsules[0].title, "car_service 只读边界修复");
  assert.equal(readCapsule(cwd, "cap_legacy").title, "car_service 只读边界修复");
});

test("rewrites low signal opening titles from conversation context", () => {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-"));
  process.env.HANDOFF_DB = join(cwd, "handoff.sqlite");
  const capsuleDir = join(cwd, ".handoff", "capsules", "cap_low_signal");
  mkdirSync(capsuleDir, { recursive: true });
  writeFileSync(
    join(capsuleDir, "capsule.json"),
    `${JSON.stringify({
      id: "cap_low_signal",
      title: "用户反馈截图：car_service 子 agent 是只读的",
      summary: "用户反馈截图：car_service 子 agent 是只读的（只能查不能预约），但 main agent 在工单查询结果后追加了\"要不要帮你重新约个时间？\"。定位根因后完成 car_service 只读边界与改约引导修复。",
      source: { app: "claude-code", chatName: "micar-agent", sessionId: "" },
      progress: { status: "in_progress", percent: 92, currentStep: "", nextStep: "" },
      contextPack: { facts: [], decisions: [], files: [], commands: [], openQuestions: [], nextActions: [] },
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z"
    })}\n`,
    "utf8"
  );

  assert.equal(getDashboard(cwd).projects[0].capsules[0].title, "car_service 只读边界与改约引导修复");
  assert.equal(readCapsule(cwd, "cap_low_signal").title, "car_service 只读边界与改约引导修复");
});

test("creates a share payload", () => {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-"));
  process.env.HANDOFF_DB = join(cwd, "handoff.sqlite");
  const { capsule } = createCapsule({ cwd, title: "share me", input: "summary: Ready to share", source: "test" });
  const share = createShare(cwd, capsule.id, { visibility: "team" });
  assert.equal(share.capsuleId, capsule.id);
  assert.equal(share.visibility, "team");
  assert.ok(share.token);
});

test("stores GitLab token locally without exposing the value", () => {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-"));
  process.env.HANDOFF_DB = join(cwd, "handoff.sqlite");
  createCapsule({ cwd, title: "gitlab settings", input: "summary: Settings", source: "test" });

  const result = saveGitLabToken("glpat-secret");

  assert.equal(result.tokenConfigured, true);
  assert.equal(loadGitLabToken(), "glpat-secret");
  assert.equal(gitLabTokenConfigured(), true);
  assert.equal(listProjects()[0].gitlab.tokenConfigured, true);
  assert.equal(listProjects()[0].gitlab.token, undefined);
});

test("includes scoped git requirement status in recovery prompt", () => {
  const root = mkdtempSync(join(tmpdir(), "handoff-git-"));
  const remote = join(root, "remote.git");
  const cwd = join(root, "repo");
  mkdirSync(cwd);
  process.env.HANDOFF_DB = join(root, "handoff.sqlite");

  git(root, ["init", "--bare", remote]);
  git(cwd, ["init"]);
  git(cwd, ["checkout", "-b", "feature/payment-timeout"]);
  writeFileSync(join(cwd, "feature.txt"), "base\n", "utf8");
  git(cwd, ["add", "feature.txt"]);
  gitCommit(cwd, "base");
  git(cwd, ["remote", "add", "origin", remote]);
  git(cwd, ["push", "-u", "origin", "feature/payment-timeout"]);

  writeFileSync(join(cwd, "feature.txt"), "base\nchanged\n", "utf8");
  const dirty = createCapsule({
    cwd,
    title: "payment timeout",
    input: JSON.stringify({ summary: "Payment timeout update", files: ["feature.txt"] }),
    source: "test"
  }).capsule;
  assert.match(dirty.contextPack.recoveryPrompt, /Branch: feature\/payment-timeout/);
  assert.match(dirty.contextPack.recoveryPrompt, /Committed to Git: no/);
  assert.match(dirty.contextPack.recoveryPrompt, /Pushed to remote: no/);

  git(cwd, ["add", "feature.txt"]);
  gitCommit(cwd, "payment timeout update");
  const committed = createCapsule({
    cwd,
    title: "payment timeout committed",
    input: JSON.stringify({ summary: "Payment timeout committed", files: ["feature.txt"] }),
    source: "test"
  }).capsule;
  assert.match(committed.contextPack.recoveryPrompt, /Committed to Git: yes/);
  assert.match(committed.contextPack.recoveryPrompt, /Pushed to remote: no/);
  assert.match(committed.contextPack.recoveryPrompt, /Unpushed scoped commits: [0-9a-f]{12} payment timeout update/);

  git(cwd, ["push"]);
  const pushed = createCapsule({
    cwd,
    title: "payment timeout pushed",
    input: JSON.stringify({ summary: "Payment timeout pushed", files: ["feature.txt"] }),
    source: "test"
  }).capsule;
  assert.match(pushed.contextPack.recoveryPrompt, /Committed to Git: yes/);
  assert.match(pushed.contextPack.recoveryPrompt, /Pushed to remote: yes/);
  assert.match(readCapsuleArtifacts(cwd, pushed.id)["context-pack.md"], /Git Requirement Status/);
  assert.equal(getDashboard(cwd).projects[0].capsules[0].git.requirement.repos[0].pushed, "yes");
});

test("replaces older capsule from the same chat", () => {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-"));
  process.env.HANDOFF_DB = join(cwd, "handoff.sqlite");

  const first = createCapsule({
    cwd,
    title: "first state",
    input: JSON.stringify({ summary: "First summary", progressPercent: 40 }),
    source: "claude-code",
    chatName: "micar-agent"
  }).capsule;
  const second = createCapsule({
    cwd,
    title: "second state",
    input: JSON.stringify({ summary: "Second summary", progressPercent: 90 }),
    source: "claude-code",
    chatName: "micar-agent"
  }).capsule;

  const dashboard = getDashboard(cwd);
  assert.equal(dashboard.totals.capsules, 1);
  assert.equal(dashboard.projects[0].capsules[0].id, second.id);
  assert.equal(dashboard.projects[0].capsules[0].title, "second state");
  assert.equal(readCapsule(cwd, first.id), null);
  assert.equal(readCapsule(cwd, second.id).summary, "Second summary");
});

test("deletes a capsule and its share payload", () => {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-"));
  process.env.HANDOFF_DB = join(cwd, "handoff.sqlite");
  const { capsule } = createCapsule({ cwd, title: "delete me", input: "summary: Remove this", source: "test" });
  const share = createShare(cwd, capsule.id, { visibility: "team" });

  const result = deleteCapsule(cwd, capsule.id);
  assert.equal(result.deleted, true);
  assert.equal(result.capsuleId, capsule.id);
  assert.equal(readCapsule(cwd, capsule.id), null);
  assert.equal(readShare(cwd, share.token), null);
  assert.equal(getDashboard(cwd).totals.capsules, 0);
});

test("dashboard reads multiple projects from shared sqlite", () => {
  const root = mkdtempSync(join(tmpdir(), "handoff-"));
  const projectA = mkdtempSync(join(root, "project-a-"));
  const projectB = mkdtempSync(join(root, "project-b-"));
  process.env.HANDOFF_DB = join(root, "handoff.sqlite");

  createCapsule({ cwd: projectA, title: "project a", input: "summary: Alpha", source: "test" });
  createCapsule({ cwd: projectB, title: "project b", input: "summary: Beta", source: "test" });

  const dashboard = getDashboard(projectA);
  assert.equal(dashboard.totals.projects, 2);
  assert.equal(dashboard.totals.capsules, 2);
  assert.equal(existsSync(join(projectA, ".handoff")), false);
  assert.equal(existsSync(join(projectB, ".handoff")), false);
});

test("computes attention items", () => {
  const oldDate = new Date(Date.now() - 72 * 36e5).toISOString();
  const items = computeAttention({
    capsules: [
      {
        id: "cap_old",
        title: "Old capsule",
        updatedAt: oldDate,
        progress: { status: "in_progress", nextStep: "Continue" }
      }
    ],
    gitlab: {
      mergeRequests: [
        {
          iid: 1,
          title: "MR",
          updatedAt: oldDate,
          webUrl: "https://gitlab.example/mr/1",
          pipeline: { status: "failed" }
        }
      ],
      pipelines: []
    },
    git: { dirtyFiles: ["a.js"], root: "/tmp/project" }
  });
  assert.equal(items.length, 4);
});

test("extracts a knowledge capsule and builds team memory", () => {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-"));
  process.env.HANDOFF_DB = join(cwd, "handoff.sqlite");
  const { capsule } = createCapsule({
    cwd,
    title: "payment timeout knowledge",
    input: JSON.stringify({
      summary: "Payment timeout was fixed by adding retry limits and a smaller connection pool timeout.",
      facts: ["RetryScheduler owns retry dispatch"],
      decisions: ["Use exponential backoff"],
      files: ["src/RetryScheduler.java"],
      commands: ["npm test"],
      nextActions: ["Watch production timeout rate"]
    }),
    source: "test"
  });

  const knowledge = createKnowledgeCapsule(cwd, capsule.id);
  const lowSignal = createCapsule({
    cwd,
    title: "low signal",
    input: JSON.stringify({ summary: "Short note only" }),
    source: "test"
  }).capsule;
  createKnowledgeCapsule(cwd, lowSignal.id);

  assert.equal(knowledge.capsuleId, capsule.id);
  assert.equal(knowledge.decisions[0], "Use exponential backoff");
  assert.match(knowledge.storage, /^sqlite:/);
  assert.equal(readKnowledgeCapsule(cwd, knowledge.id).facts[0], "RetryScheduler owns retry dispatch");

  const share = createKnowledgeShare(cwd, knowledge.id, { visibility: "team" });
  assert.equal(share.artifactType, "knowledge");
  assert.equal(share.artifactId, knowledge.id);
  assert.equal(readShare(cwd, share.token).knowledge.id, knowledge.id);

  const memory = buildTeamMemory(cwd, { scope: "team", minScore: 70 });

  assert.equal(memory.sourceCount, 1);
  assert.match(memory.markdown, /Use exponential backoff/);
  assert.equal(listTeamMemorySnapshots({ limit: 1 })[0].id, memory.id);
});

test("analyzes a requirement document into a requirement capsule", () => {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-"));
  process.env.HANDOFF_DB = join(cwd, "handoff.sqlite");
  const requirement = analyzeRequirement(
    cwd,
    JSON.stringify({
      summary: "Payment callback timeout must be reduced during peak traffic.",
      background: "Callbacks wait too long for pooled connections.",
      goals: ["Reduce timeout rate below 0.1%"],
      scope: ["Tune connection pool", "Cap retry attempts"],
      acceptanceCriteria: ["Load test passes", "Callback success rate meets target"],
      openQuestions: ["Whether rollout needs a feature switch"],
      systems: ["payment-service"],
      files: ["src/payment/callback.ts"],
      tasks: ["Add load test", "Update config notes"]
    }),
    { title: "payment callback timeout" }
  );

  assert.match(requirement.id, /^req_/);
  assert.equal(requirement.goals[0], "Reduce timeout rate below 0.1%");
  assert.equal(requirement.acceptanceCriteria.length, 2);
  assert.match(requirement.markdown, /Acceptance Criteria/);
  assert.equal(readRequirementCapsule(cwd, requirement.id).openQuestions[0], "Whether rollout needs a feature switch");
});

test("publishes skill assets after review", () => {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-"));
  process.env.HANDOFF_DB = join(cwd, "handoff.sqlite");
  const { capsule } = createCapsule({
    cwd,
    title: "payment retry operator skill",
    input: JSON.stringify({
      summary: "Payment retry handling uses bounded exponential backoff and replay tracing.",
      facts: ["RetryScheduler owns retry dispatch"],
      decisions: ["Use bounded exponential backoff"],
      files: ["src/RetryScheduler.java"],
      commands: ["npm test"],
      nextActions: ["Check replay trace before changing retry windows"]
    }),
    source: "test"
  });
  const knowledge = createKnowledgeCapsule(cwd, capsule.id);

  const fromKnowledge = createSkillAssetFromKnowledge(cwd, knowledge.id);
  const fromCapsule = createSkillAssetFromCapsule(cwd, capsule.id, { title: "retry review SOP" });
  const manual = submitSkillAsset(cwd, "# Oncall replay check\n\n1. Inspect trace id.\n2. Compare retry window.", {
    title: "oncall replay check",
    type: "experience"
  });

  assert.match(fromKnowledge.id, /^sk_/);
  assert.equal(fromKnowledge.source.id, knowledge.id);
  assert.equal(fromCapsule.source.id, capsule.id);
  assert.equal(manual.type, "experience");
  assert.equal(readSkillAsset(cwd, fromKnowledge.id).status, "submitted");
  assert.throws(() => createSkillAssetShare(cwd, fromKnowledge.id), /approved before sharing/);

  const reviewed = reviewSkillAsset(cwd, fromKnowledge.id, {
    approve: true,
    reviewer: "curator",
    notes: "Reusable retry procedure"
  });
  assert.equal(reviewed.status, "approved");
  assert.equal(reviewed.reviewer, "curator");

  const share = createSkillAssetShare(cwd, fromKnowledge.id, { visibility: "team" });
  assert.equal(share.artifactType, "skill_asset");
  assert.equal(share.artifactId, fromKnowledge.id);
  assert.equal(readShare(cwd, share.token).skill.id, fromKnowledge.id);
  assert.match(importSkillAsset(cwd, share), /bounded exponential backoff/);
  assert.equal(getDashboard(cwd).totals.skillAssets, 3);
});

test("manages capsules, knowledge, and skills through unified assets", () => {
  const cwd = mkdtempSync(join(tmpdir(), "handoff-"));
  process.env.HANDOFF_DB = join(cwd, "handoff.sqlite");

  const knowledgeBundle = ingestKnowledgeAsset(
    cwd,
    JSON.stringify({
      summary: "Callback timeout knowledge should be reusable inside the project.",
      facts: ["Connection pool wait time drives callback timeout"],
      decisions: ["Keep retry limit below three attempts"],
      commands: ["npm test"],
      nextActions: ["Watch timeout metric"]
    }),
    { title: "callback timeout knowledge" }
  );
  const skillBundle = ingestSkillAsset(
    cwd,
    JSON.stringify({
      summary: "Use the trace id to inspect callback retry behavior.",
      facts: ["Trace id links callback, retry, and replay records"],
      decisions: ["Inspect trace before changing retry windows"],
      commands: ["npm test"],
      nextActions: ["Open callback trace"]
    }),
    { title: "callback retry trace skill" }
  );

  const assets = listAssets(cwd);
  assert.ok(assets.some((asset) => asset.type === "capsule"));
  assert.ok(assets.some((asset) => asset.type === "knowledge"));
  assert.ok(assets.some((asset) => asset.type === "skill"));
  assert.equal(readAsset(cwd, knowledgeBundle.knowledge.id).type, "knowledge");
  assert.match(importAssetContext(cwd, knowledgeBundle.knowledge.id), /Handoff Knowledge Import/);

  const convertedKnowledge = convertAsset(cwd, knowledgeBundle.capsule.id, "knowledge");
  assert.equal(convertedKnowledge.target.type, "knowledge");
  assert.equal(convertedKnowledge.knowledge.capsuleId, knowledgeBundle.capsule.id);
  const convertedSkill = convertAsset(cwd, knowledgeBundle.capsule.id, "skill");
  assert.equal(convertedSkill.target.type, "skill");
  const skillFromKnowledge = convertAsset(cwd, knowledgeBundle.knowledge.id, "skill");
  assert.equal(skillFromKnowledge.target.type, "skill");

  const knowledgeShare = createAssetShare(cwd, knowledgeBundle.knowledge.id, { visibility: "team" });
  assert.equal(readShare(cwd, knowledgeShare.token).knowledge.id, knowledgeBundle.knowledge.id);
  assert.throws(() => createAssetShare(cwd, skillBundle.skill.id), /approved before sharing/);

  reviewSkillAsset(cwd, skillBundle.skill.id, { approve: true, reviewer: "asset curator" });
  const skillShare = createAssetShare(cwd, skillBundle.skill.id, { visibility: "team" });
  assert.equal(readShare(cwd, skillShare.token).skill.id, skillBundle.skill.id);
  assert.match(importAssetContext(cwd, readShare(cwd, skillShare.token)), /Handoff Skill Import/);
  assert.equal(getDashboard(cwd).totals.assets, 7);
});

test("reads 24h Claude Code sessions as dashboard assets", () => {
  const root = mkdtempSync(join(tmpdir(), "handoff-session-"));
  const cwd = join(root, "repo");
  const claudeHome = join(root, ".claude");
  const sessionDir = join(claudeHome, "projects", "-tmp-handoff-session-repo");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  process.env.HANDOFF_DB = join(root, "handoff.sqlite");
  process.env.HANDOFF_CLAUDE_HOME = claudeHome;

  writeFileSync(
    join(sessionDir, "active-session.jsonl"),
    [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "分析工单过滤异常并给出修复方案" },
        timestamp: "2026-06-01T08:00:00.000Z",
        cwd,
        sessionId: "active-session"
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "定位到 query_super_ticket_list 缺少 vid 过滤。" }] },
        timestamp: "2026-06-01T08:03:00.000Z",
        cwd,
        sessionId: "active-session"
      })
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    join(sessionDir, "old-session.jsonl"),
    `${JSON.stringify({
      type: "user",
      message: { role: "user", content: "超过一天的会话" },
      timestamp: "2026-05-30T08:00:00.000Z",
      cwd,
      sessionId: "old-session"
    })}\n`,
    "utf8"
  );

  const sessions = listActiveSessions(cwd, { claudeHome, now: "2026-06-01T09:00:00.000Z" });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].type, "session");
  assert.match(sessions[0].summary, /query_super_ticket_list/);

  const dashboard = getDashboard(cwd, { activeSessions: { claudeHome, now: "2026-06-01T09:00:00.000Z" } });
  assert.equal(dashboard.totals.activeSessions, 1);
  assert.ok(dashboard.projects[0].assets.some((asset) => asset.type === "session"));
  assert.match(importAssetContext(cwd, sessions[0].id), /Handoff Active Session Import/);

  const converted = convertAsset(cwd, sessions[0].id, "knowledge");
  assert.equal(converted.source.type, "session");
  assert.equal(converted.target.type, "knowledge");
  assert.equal(converted.capsule.source.sessionId, "active-session");
});
