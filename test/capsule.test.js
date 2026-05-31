import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCapsule } from "../src/core/capsule.js";
import { deleteCapsule, gitLabTokenConfigured, listProjects, loadGitLabToken, readCapsule, readCapsuleArtifacts, readShare, saveGitLabToken } from "../src/core/store.js";
import { createShare } from "../src/core/share.js";
import { computeAttention } from "../src/core/reminders.js";
import { getDashboard } from "../src/core/dashboard.js";
import { buildTeamMemory, createKnowledgeCapsule, listTeamMemorySnapshots, readKnowledgeCapsule } from "../src/core/knowledge.js";

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

  assert.equal(knowledge.capsuleId, capsule.id);
  assert.equal(knowledge.decisions[0], "Use exponential backoff");
  assert.match(knowledge.storage, /^sqlite:/);
  assert.equal(readKnowledgeCapsule(cwd, knowledge.id).facts[0], "RetryScheduler owns retry dispatch");

  const memory = buildTeamMemory(cwd, { scope: "team" });

  assert.equal(memory.sourceCount, 1);
  assert.match(memory.markdown, /Use exponential backoff/);
  assert.equal(listTeamMemorySnapshots({ limit: 1 })[0].id, memory.id);
});
