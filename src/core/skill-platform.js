import { createHash } from "node:crypto";
import { compact, nowIso, randomToken, slugify, parseDurationDays, unique } from "./utils.js";
import { readCapsule } from "./store.js";
import {
  ensureWorkspace,
  listSkillAssets,
  loadConfig,
  readKnowledgeCapsule,
  readSkillAsset,
  saveAssetShare,
  saveSkillAsset
} from "./store.js";

function hashText(value, length = 14) {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, length);
}

function assetId(projectId, type, title, content) {
  return `sk_${hashText(`${projectId}:${type}:${title}:${compact(content, 500)}`)}_${slugify(title).slice(0, 48)}`;
}

function normalizeType(type) {
  const value = String(type || "skill").trim().toLowerCase();
  return ["skill", "knowledge", "experience", "connector", "sop"].includes(value) ? value : "skill";
}

function normalizeStatus(status) {
  const value = String(status || "draft").trim().toLowerCase();
  return ["draft", "submitted", "approved", "rejected", "published"].includes(value) ? value : "draft";
}

function titleFromContent(content) {
  const heading = String(content || "").match(/^#{1,6}\s+(.+?)\s*$/m);
  if (heading) return heading[1].trim();
  return compact(content, 48) || "未命名 Skill 资产";
}

function listSection(title, values = []) {
  return [
    `## ${title}`,
    "",
    ...(values.length ? values.map((item, index) => `${index + 1}. ${item}`) : ["暂无记录"]),
    ""
  ].join("\n");
}

function cleanList(values = [], max = 80) {
  return unique(values.map((value) => String(value || "").trim()).filter(Boolean)).slice(0, max);
}

function sectionBody(content, heading) {
  const lines = String(content || "").split(/\r?\n/);
  const expected = String(heading || "").trim().toLowerCase();
  const collected = [];
  let inside = false;
  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      if (inside) break;
      inside = match[1].trim().toLowerCase() === expected;
      continue;
    }
    if (inside) collected.push(line);
  }
  return collected.join("\n").trim();
}

function sectionItems(content, heading, fallback = []) {
  const body = sectionBody(content, heading);
  const values = body
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));
  return cleanList(values.length ? values : fallback, 12);
}

export function skillAssetManifest(asset) {
  const content = asset?.content || asset?.markdown || "";
  const whenToUse = sectionItems(content, "When to use", []);
  const requiredInputs = sectionItems(content, "Inputs", []);
  const rawSummary = String(asset?.summary || "").trim();
  const description = rawSummary && !rawSummary.includes("#")
    ? compact(rawSummary, 220)
    : compact(whenToUse[0] || asset?.title || content, 220);
  return {
    id: asset?.id || "",
    title: asset?.title || "未命名 Skill",
    type: asset?.type || "skill",
    status: asset?.status || "draft",
    description,
    whenToUse: whenToUse.length ? whenToUse : (description ? [description] : []),
    requiredInputs,
    source: asset?.source || {},
    updatedAt: asset?.updatedAt || asset?.createdAt || ""
  };
}

export function formatSkillManifestImport(asset) {
  const manifest = skillAssetManifest(asset);
  return [
    `# Handoff Skill Manifest: ${manifest.title}`,
    "",
    `Asset: ${manifest.id}`,
    `Type: ${manifest.type}`,
    `Status: ${manifest.status}`,
    `Load State: reference`,
    "",
    "当前只加载 Skill 描述，用于判断是否适合当前任务。",
    "需要完整 Skill 内容时运行：",
    "",
    `handoff skill import "${manifest.id}" --activate`,
    "",
    "## Description",
    "",
    manifest.description || "暂无描述。",
    "",
    "## When to use",
    "",
    ...(manifest.whenToUse.length ? manifest.whenToUse.map((item, index) => `${index + 1}. ${item}`) : ["暂无记录"]),
    "",
    "## Required inputs",
    "",
    ...(manifest.requiredInputs.length ? manifest.requiredInputs.map((item, index) => `${index + 1}. ${item}`) : ["暂无记录"]),
    ""
  ].join("\n");
}

export function formatSkillAssetMarkdown(asset) {
  return [
    `# ${asset.title}`,
    "",
    `Skill Asset: ${asset.id}`,
    `Type: ${asset.type}`,
    `Status: ${asset.status}`,
    `Source: ${asset.source?.type || "manual"}${asset.source?.id ? ` ${asset.source.id}` : ""}`,
    `Project: ${asset.project?.name || asset.projectId || "unknown"}`,
    "",
    "## Summary",
    "",
    asset.summary || "暂无摘要。",
    "",
    "## Content",
    "",
    asset.content || "暂无内容。",
    ""
  ].join("\n");
}

function createBaseAsset(cwd, input, options = {}) {
  const paths = ensureWorkspace(cwd, { projectId: options.projectId });
  const config = loadConfig(cwd);
  const content = String(input || "").trim();
  if (!content) throw new Error("Skill asset content is required");
  const title = options.title || titleFromContent(content);
  const type = normalizeType(options.type);
  const createdAt = nowIso();
  const projectId = options.projectId || config.projectId;
  const asset = {
    schemaVersion: 1,
    id: options.id || assetId(projectId, type, title, content),
    projectId,
    type,
    title,
    summary: compact(options.summary || content, 800),
    status: normalizeStatus(options.status || "submitted"),
    source: {
      type: options.sourceType || "manual",
      id: options.sourceId || ""
    },
    project: {
      id: projectId,
      name: config.projectName || projectId,
      root: paths.root
    },
    content,
    reviewer: options.reviewer || "",
    reviewNotes: options.reviewNotes || "",
    createdAt,
    updatedAt: createdAt,
    markdown: ""
  };
  asset.markdown = formatSkillAssetMarkdown(asset);
  asset.storage = saveSkillAsset(cwd, asset);
  return asset;
}

export function submitSkillAsset(cwd = process.cwd(), input = "", options = {}) {
  return createBaseAsset(cwd, input, options);
}

export function createSkillAssetFromCapsule(cwd = process.cwd(), capsuleRef, options = {}) {
  const capsule = readCapsule(cwd, capsuleRef);
  if (!capsule) throw new Error(`Capsule not found: ${capsuleRef}`);
  const pack = capsule.contextPack || {};
  const facts = cleanList(pack.facts || [], 60);
  const decisions = cleanList(pack.decisions || [], 60);
  const commands = cleanList(pack.commands || [], 60);
  const files = cleanList(pack.files || [], 120);
  const nextActions = cleanList(pack.nextActions || [], 40);
  const content = [
    `# ${options.title || capsule.title}`,
    "",
    "## When to use",
    "",
    capsule.summary || "暂无摘要。",
    "",
    listSection("Inputs", [
      `Source Capsule: ${capsule.id}`,
      `Source App: ${capsule.source?.app || "manual"}`,
      `Project: ${capsule.project?.name || capsule.project?.id || "unknown"}`
    ]),
    listSection("Confirmed Facts", facts),
    listSection("Decisions", decisions),
    listSection("SOP", nextActions),
    listSection("Tools and Commands", commands),
    listSection("Files", files),
    "## Source Capsule",
    "",
    capsule.storage || capsule.id,
    ""
  ].join("\n");
  return createBaseAsset(cwd, content, {
    ...options,
    type: options.type || "skill",
    title: options.title || capsule.title,
    summary: options.summary || capsule.summary,
    sourceType: "capsule",
    sourceId: capsule.id
  });
}

export function createSkillAssetFromKnowledge(cwd = process.cwd(), knowledgeRef, options = {}) {
  const knowledge = readKnowledgeCapsule(cwd, knowledgeRef);
  if (!knowledge) throw new Error(`Knowledge capsule not found: ${knowledgeRef}`);
  const content = [
    `# ${options.title || knowledge.title}`,
    "",
    "## Summary",
    "",
    knowledge.summary || "暂无摘要。",
    "",
    listSection("Topics", cleanList(knowledge.topics || [], 20)),
    listSection("Facts", cleanList(knowledge.facts || [], 80)),
    listSection("Decisions", cleanList(knowledge.decisions || [], 80)),
    listSection("SOP", cleanList(knowledge.nextActions || [], 60)),
    listSection("Files", cleanList(knowledge.files || [], 120)),
    listSection("Commands", cleanList(knowledge.commands || [], 80)),
    "## Source Knowledge Capsule",
    "",
    knowledge.storage || knowledge.id,
    ""
  ].join("\n");
  return createBaseAsset(cwd, content, {
    ...options,
    type: options.type || "knowledge",
    title: options.title || knowledge.title,
    summary: options.summary || knowledge.summary,
    sourceType: "knowledge",
    sourceId: knowledge.id
  });
}

export function reviewSkillAsset(cwd = process.cwd(), ref, options = {}) {
  const current = readSkillAsset(cwd, ref);
  if (!current) throw new Error(`Skill asset not found: ${ref}`);
  const status = options.reject ? "rejected" : options.publish ? "published" : options.approve ? "approved" : normalizeStatus(options.status || current.status);
  const updated = {
    ...current,
    status,
    reviewer: options.reviewer || current.reviewer || "",
    reviewNotes: options.notes || current.reviewNotes || "",
    updatedAt: nowIso()
  };
  updated.markdown = formatSkillAssetMarkdown(updated);
  updated.storage = saveSkillAsset(cwd, updated);
  return updated;
}

export function createSkillAssetShare(cwd = process.cwd(), ref, options = {}) {
  const asset = readSkillAsset(cwd, ref);
  if (!asset) throw new Error(`Skill asset not found: ${ref}`);
  if (!["approved", "published"].includes(asset.status) && !options.force) {
    throw new Error(`Skill asset must be approved before sharing: ${asset.id}`);
  }
  const share = {
    token: options.token || randomToken(12),
    artifactType: "skill_asset",
    artifactId: asset.id,
    visibility: options.visibility || "team",
    createdAt: nowIso(),
    expiresAt: parseDurationDays(options.expiresInDays),
    ack: false,
    skill: {
      id: asset.id,
      type: asset.type,
      title: asset.title,
      summary: asset.summary,
      status: asset.status,
      source: asset.source,
      content: asset.content,
      markdown: asset.markdown || formatSkillAssetMarkdown(asset),
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt
    }
  };
  saveAssetShare(cwd, share);
  return share;
}

export const shareSkillAsset = createSkillAssetShare;

export function importSkillAsset(cwd = process.cwd(), refOrShare, options = {}) {
  const local = typeof refOrShare === "string" ? readSkillAsset(cwd, refOrShare) : null;
  const asset = local || refOrShare?.skill || refOrShare || null;
  if (!asset?.id) return null;
  // A user-initiated import always loads the full Skill body. Manifest-only
  // (head/description) loading belongs solely to the mode auto-load path, which
  // calls formatSkillManifestImport / skillAssetManifest directly.
  if (options.manifestOnly) return formatSkillManifestImport(asset);
  return [
    `# Handoff Skill Import: ${asset.title}`,
    "",
    `Asset: ${asset.id}`,
    `Type: ${asset.type}`,
    `Status: ${asset.status}`,
    `Load State: active`,
    "",
    "请把以下内容作为当前 AI 对话的可用 Skill 或经验上下文：",
    "",
    asset.content || asset.markdown || asset.summary || ""
  ].join("\n");
}

export {
  listSkillAssets,
  readSkillAsset
};
