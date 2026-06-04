import { existsSync } from "node:fs";
import { randomToken, slugify, nowIso } from "./utils.js";
import {
  endActiveModeSessions,
  endCurrentModeSession,
  listSkillAssets,
  readCurrentModeSession,
  readSkillAsset,
  saveModeSession,
  saveModeSessionAsset
} from "./store.js";
import { importSkillAsset, skillAssetManifest } from "./skill-platform.js";

const DEFAULT_HARNESS_ROOT = "/Users/chengzheng/workspace/chuangxin/harness";

const MODE_DEFINITIONS = {
  "team-development": {
    id: "team-development",
    name: "团队开发模式",
    engine: "harness",
    harnessRoot: process.env.HANDOFF_HARNESS_ROOT || DEFAULT_HARNESS_ROOT,
    harnessPhases: ["clarify", "doc-plan", "red", "green", "review", "validate", "done", "archived"],
    skillPolicy: {
      autoLoad: "approved-only",
      defaultLoadState: "reference",
      manualImport: true
    },
    knowledgePolicy: {
      projectKnowledge: true
    },
    constraints: {
      cleanContext: true,
      recordLoadedAssets: true,
      requireSkillReview: true
    }
  }
};

function normalizeModeId(value) {
  return String(value || "team-development").trim() || "team-development";
}

export function modeDefinition(modeId = "team-development") {
  return MODE_DEFINITIONS[normalizeModeId(modeId)] || null;
}

export function listModes() {
  return Object.values(MODE_DEFINITIONS);
}

function sessionId(modeId) {
  return `mode_${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}_${slugify(modeId)}_${randomToken(4)}`;
}

function approvedSkillAssets(cwd) {
  return listSkillAssets(cwd, {
    scope: "team",
    limit: 500
  }).filter((asset) => ["approved", "published"].includes(asset.status));
}

function harnessState(definition) {
  const root = definition.harnessRoot;
  return {
    root,
    available: Boolean(root && existsSync(root)),
    workflowFile: root ? `${root}/.harness/workflow.md` : "",
    taskScript: root ? `${root}/harness_scripts/task.py` : ""
  };
}

function manifestLine(item) {
  const manifest = item.manifest || item;
  const when = (manifest.whenToUse || []).slice(0, 3).join("；") || manifest.description || "";
  return `- ${manifest.id} | ${manifest.title} | ${when}`;
}

export function formatModePrompt(session) {
  const phases = session.harnessPhases || [];
  const assets = session.loadedAssets || [];
  const references = assets.filter((asset) => asset.loadState === "reference");
  const active = assets.filter((asset) => ["active", "pinned"].includes(asset.loadState));
  return [
    `# Handoff Mode: ${session.name}`,
    "",
    `Mode Session: ${session.id}`,
    `Mode Id: ${session.modeId}`,
    `Engine: ${session.engine}`,
    `Harness Root: ${session.harnessRoot}`,
    `Harness Available: ${session.harness?.available ? "yes" : "no"}`,
    `Current Phase: ${session.harnessPhase || "clarify"}`,
    "",
    "## Harness 阶段",
    "",
    phases.join(" -> "),
    "",
    "## 当前会话规则",
    "",
    "1. 当前会话处于干净模式，优先使用 Handoff 注入的模式规则和资产。",
    "2. 团队开发模式使用 Harness 的需求确认、计划、RED、GREEN、评审和验证阶段。",
    "3. Skill 默认只作为 Manifest 候选能力，完整内容在激活时加载。",
    "4. 需要使用某个 Skill 时，运行 `handoff mode import <skill-id> --activate` 或 `handoff skill import <skill-id> --activate`。",
    "5. 任务结束后使用 `handoff capture` 保存 Capsule，再按需要转换为知识胶囊或团队 Skill。",
    "",
    "## 已引用 Skill Manifest",
    "",
    ...(references.length ? references.map(manifestLine) : ["暂无引用 Skill。"]),
    "",
    "## 已激活 Skill",
    "",
    ...(active.length ? active.map(manifestLine) : ["暂无激活 Skill。"]),
    ""
  ].join("\n");
}

export function enterMode(cwd = process.cwd(), modeId = "team-development", options = {}) {
  const definition = modeDefinition(modeId);
  if (!definition) throw new Error(`Mode not found: ${modeId}`);
  if (!options.keepExisting) endActiveModeSessions(cwd);
  const skills = approvedSkillAssets(cwd);
  const now = nowIso();
  const session = saveModeSession(cwd, {
    id: options.sessionId || sessionId(definition.id),
    modeId: definition.id,
    name: definition.name,
    status: "active",
    engine: definition.engine,
    harnessRoot: options.harnessRoot || definition.harnessRoot,
    harnessPhase: options.harnessPhase || "clarify",
    harnessPhases: definition.harnessPhases,
    harness: harnessState({
      ...definition,
      harnessRoot: options.harnessRoot || definition.harnessRoot
    }),
    skillPolicy: definition.skillPolicy,
    knowledgePolicy: definition.knowledgePolicy,
    constraints: definition.constraints,
    createdAt: now,
    updatedAt: now
  });
  for (const skill of skills) {
    saveModeSessionAsset(cwd, session.id, {
      assetId: skill.id,
      assetType: "skill",
      loadState: "reference",
      title: skill.title,
      manifest: skillAssetManifest(skill)
    });
  }
  const updated = readCurrentModeSession(cwd);
  return {
    mode: definition,
    session: updated,
    prompt: formatModePrompt(updated)
  };
}

export function exitMode(cwd = process.cwd()) {
  return endCurrentModeSession(cwd);
}

export function modeStatus(cwd = process.cwd()) {
  const session = readCurrentModeSession(cwd);
  return session ? {
    active: true,
    session,
    prompt: formatModePrompt(session)
  } : {
    active: false,
    session: null,
    prompt: ""
  };
}

export function importModeSkill(cwd = process.cwd(), ref, options = {}) {
  const current = readCurrentModeSession(cwd);
  if (!current) throw new Error("No active Handoff mode session");
  const skill = readSkillAsset(cwd, ref);
  if (!skill) throw new Error(`Skill asset not found: ${ref}`);
  if (!["approved", "published"].includes(skill.status) && !options.force) {
    throw new Error(`Skill asset must be approved before mode import: ${skill.id}`);
  }
  const loadState = options.pin ? "pinned" : options.activate ? "active" : "reference";
  saveModeSessionAsset(cwd, current.id, {
    assetId: skill.id,
    assetType: "skill",
    loadState,
    title: skill.title,
    manifest: skillAssetManifest(skill),
    activatedAt: options.activate || options.pin ? nowIso() : null
  });
  const text = importSkillAsset(cwd, skill, {
    activate: Boolean(options.activate || options.pin)
  });
  return {
    session: readCurrentModeSession(cwd),
    asset: skill,
    loadState,
    text
  };
}
