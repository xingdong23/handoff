import { createCapsule } from "./capsule.js";
import { createKnowledgeShare, createShare } from "./share.js";
import {
  formatKnowledgeMarkdown,
  createKnowledgeCapsule,
  listKnowledgeCapsules,
  readKnowledgeCapsule
} from "./knowledge.js";
import {
  createSkillAssetFromKnowledge,
  createSkillAssetShare,
  importSkillAsset,
  listSkillAssets,
  readSkillAsset
} from "./skill-platform.js";
import { listCapsules, readCapsule } from "./store.js";

function dateValue(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function capsuleAsset(capsule) {
  if (!capsule) return null;
  return {
    id: capsule.id,
    type: "capsule",
    scope: "personal",
    status: capsule.progress?.status || "unknown",
    title: capsule.title,
    summary: capsule.summary || "",
    source: capsule.source || {},
    project: capsule.project || {},
    storage: capsule.storage || "",
    createdAt: capsule.createdAt || "",
    updatedAt: capsule.updatedAt || capsule.createdAt || "",
    payload: capsule
  };
}

function knowledgeAsset(knowledge) {
  if (!knowledge) return null;
  return {
    id: knowledge.id,
    type: "knowledge",
    scope: "project",
    status: "available",
    title: knowledge.title,
    summary: knowledge.summary || "",
    source: {
      type: "capsule",
      id: knowledge.capsuleId || "",
      storage: knowledge.source?.storage || ""
    },
    project: knowledge.project || {},
    storage: knowledge.storage || "",
    createdAt: knowledge.createdAt || "",
    updatedAt: knowledge.updatedAt || knowledge.createdAt || "",
    payload: knowledge
  };
}

function skillAsset(asset) {
  if (!asset) return null;
  return {
    id: asset.id,
    type: "skill",
    assetType: asset.type || "skill",
    scope: ["approved", "published"].includes(asset.status) ? "team" : "project",
    status: asset.status || "submitted",
    title: asset.title,
    summary: asset.summary || "",
    source: asset.source || {},
    project: asset.project || {},
    storage: asset.storage || "",
    createdAt: asset.createdAt || "",
    updatedAt: asset.updatedAt || asset.createdAt || "",
    payload: asset
  };
}

export function assetFromPayload(payload) {
  if (!payload) return null;
  if (payload.contextPack) return capsuleAsset(payload);
  if (payload.capsuleId && payload.quality) return knowledgeAsset(payload);
  if (payload.content || payload.assetType || payload.type) return skillAsset(payload);
  return null;
}

export function listAssets(cwd = process.cwd(), options = {}) {
  const types = String(options.type || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const include = (type) => !types.length || types.includes(type);
  const skillOptions = { ...options, type: options.assetType };
  const items = [
    ...(include("capsule") ? listCapsules(cwd).map(capsuleAsset) : []),
    ...(include("knowledge") ? listKnowledgeCapsules(cwd, options).map(knowledgeAsset) : []),
    ...(include("skill") ? listSkillAssets(cwd, skillOptions).map(skillAsset) : [])
  ].filter(Boolean);

  return items
    .sort((a, b) => dateValue(b.updatedAt) - dateValue(a.updatedAt))
    .slice(0, Math.max(1, Math.min(Number(options.limit || 100), 500)));
}

export function readAsset(cwd = process.cwd(), ref) {
  const value = String(ref || "");
  if (!value) return null;
  if (value.startsWith("cap_") || value.includes("#capsules/")) return capsuleAsset(readCapsule(cwd, value));
  if (value.startsWith("kc_") || value.includes("#knowledge/")) return knowledgeAsset(readKnowledgeCapsule(cwd, value));
  if (value.startsWith("sk_") || value.includes("#skill-assets/")) return skillAsset(readSkillAsset(cwd, value));
  return capsuleAsset(readCapsule(cwd, value)) ||
    knowledgeAsset(readKnowledgeCapsule(cwd, value)) ||
    skillAsset(readSkillAsset(cwd, value));
}

function capsuleImportText(capsule) {
  if (!capsule) return null;
  return capsule.contextPack?.recoveryPrompt || "";
}

function knowledgeImportText(knowledge) {
  if (!knowledge) return null;
  return [
    `# Handoff Knowledge Import: ${knowledge.title}`,
    "",
    `Knowledge: ${knowledge.id}`,
    `Source Capsule: ${knowledge.capsuleId || knowledge.source?.id || ""}`,
    "",
    "请把以下内容作为当前 AI 对话的项目知识上下文：",
    "",
    knowledge.markdown || formatKnowledgeMarkdown(knowledge)
  ].join("\n");
}

export function importAssetContext(cwd = process.cwd(), refOrShare) {
  if (refOrShare?.skill) return importSkillAsset(cwd, refOrShare);
  if (refOrShare?.knowledge) return knowledgeImportText(refOrShare.knowledge);
  if (refOrShare?.capsule) return capsuleImportText(refOrShare.capsule);

  const asset = typeof refOrShare === "string" ? readAsset(cwd, refOrShare) : assetFromPayload(refOrShare);
  if (!asset) return null;
  if (asset.type === "capsule") return capsuleImportText(asset.payload);
  if (asset.type === "knowledge") return knowledgeImportText(asset.payload);
  if (asset.type === "skill") return importSkillAsset(cwd, asset.payload);
  return null;
}

export function formatAssetMarkdown(asset) {
  const item = asset?.payload ? asset : readAsset(process.cwd(), asset);
  if (!item) return "";
  return [
    `# ${item.title}`,
    "",
    `Asset: ${item.id}`,
    `Type: ${item.type}`,
    item.assetType ? `Asset Type: ${item.assetType}` : "",
    `Scope: ${item.scope}`,
    `Status: ${item.status}`,
    `Source: ${item.source?.type || item.source?.app || "manual"}${item.source?.id ? ` ${item.source.id}` : ""}`,
    `Storage: ${item.storage || ""}`,
    "",
    "## Summary",
    "",
    item.summary || "暂无摘要。",
    ""
  ].filter((line) => line !== "").join("\n");
}

export function createAssetShare(cwd = process.cwd(), ref, options = {}) {
  const asset = readAsset(cwd, ref);
  if (!asset) throw new Error(`Asset not found: ${ref}`);
  if (asset.type === "capsule") return createShare(cwd, asset.id, options);
  if (asset.type === "knowledge") return createKnowledgeShare(cwd, asset.id, options);
  if (asset.type === "skill") return createSkillAssetShare(cwd, asset.id, options);
  throw new Error(`Unsupported asset type: ${asset.type}`);
}

export function ingestKnowledgeAsset(cwd = process.cwd(), input = "", options = {}) {
  const result = createCapsule({
    cwd,
    title: options.title || "",
    input,
    source: options.source || "knowledge-ingest",
    projectId: options.projectId,
    chatName: options.chatName,
    sessionId: options.sessionId,
    summary: options.summary
  });
  const knowledge = createKnowledgeCapsule(cwd, result.capsule.id, {
    title: options.title,
    summary: options.summary,
    topics: options.topics
  });
  return {
    capsule: result.capsule,
    knowledge,
    asset: knowledgeAsset(knowledge)
  };
}

export function ingestSkillAsset(cwd = process.cwd(), input = "", options = {}) {
  const bundle = ingestKnowledgeAsset(cwd, input, {
    ...options,
    source: options.source || "skill-ingest"
  });
  const skill = createSkillAssetFromKnowledge(cwd, bundle.knowledge.id, {
    title: options.title,
    summary: options.summary,
    type: options.type || "skill",
    status: options.status || "submitted"
  });
  return {
    ...bundle,
    skill,
    asset: skillAsset(skill)
  };
}
