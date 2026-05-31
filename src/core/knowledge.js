import { createHash } from "node:crypto";
import { compact, nowIso, slugify, unique } from "./utils.js";
import {
  listKnowledgeCapsules,
  listTeamMemorySnapshots,
  readCapsule,
  readKnowledgeCapsule,
  readTeamMemorySnapshot,
  saveKnowledgeCapsule,
  saveTeamMemorySnapshot
} from "./store.js";

function hashText(value, length = 12) {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, length);
}

function knowledgeId(projectId, capsuleId) {
  return `kc_${hashText(`${projectId}:${capsuleId}`, 16)}`;
}

function memoryId(scope, createdAt) {
  const stamp = createdAt.replace(/[-:]/g, "").replace(".", "");
  return `tm_${stamp}_${slugify(scope || "team")}`;
}

function cleanList(values = [], max = 40) {
  return unique(values.map((value) => String(value || "").trim()).filter(Boolean)).slice(0, max);
}

function fileTopics(files = []) {
  return files
    .map((file) => String(file || "").split("/").filter(Boolean)[0])
    .filter((part) => part && !part.includes("."))
    .slice(0, 5);
}

function inferTopics(capsule, explicitTopics = []) {
  const context = capsule.contextPack || {};
  return cleanList([
    ...explicitTopics,
    capsule.title,
    capsule.project?.name,
    ...fileTopics(context.files || [])
  ], 8);
}

function qualitySignals(capsule) {
  const context = capsule.contextPack || {};
  const signals = [];
  if (capsule.summary) signals.push("summary");
  if (context.facts?.length) signals.push("facts");
  if (context.decisions?.length) signals.push("decisions");
  if (context.files?.length) signals.push("files");
  if (context.commands?.length) signals.push("commands");
  if (context.nextActions?.length) signals.push("nextActions");
  return signals;
}

function qualityScore(capsule) {
  const weights = {
    summary: 20,
    facts: 20,
    decisions: 25,
    files: 10,
    commands: 10,
    nextActions: 15
  };
  return qualitySignals(capsule).reduce((total, signal) => total + weights[signal], 0);
}

export function formatKnowledgeMarkdown(knowledge) {
  const list = (title, values) => [
    `## ${title}`,
    "",
    ...(values?.length ? values.map((item, index) => `${index + 1}. ${item}`) : ["暂无记录"]),
    ""
  ].join("\n");

  return [
    `# ${knowledge.title}`,
    "",
    `Knowledge Capsule: ${knowledge.id}`,
    `Source Capsule: ${knowledge.capsuleId}`,
    `Project: ${knowledge.project?.name || knowledge.projectId || "unknown"}`,
    `Quality Score: ${knowledge.quality?.score ?? 0}`,
    "",
    "## Summary",
    "",
    knowledge.summary || "暂无摘要。",
    "",
    list("Topics", knowledge.topics),
    list("Facts", knowledge.facts),
    list("Decisions", knowledge.decisions),
    list("Files", knowledge.files),
    list("Commands", knowledge.commands),
    list("Next Actions", knowledge.nextActions),
    "## Source",
    "",
    knowledge.source?.storage || "",
    ""
  ].join("\n");
}

export function createKnowledgeCapsule(cwd = process.cwd(), capsuleRef, options = {}) {
  const capsule = readCapsule(cwd, capsuleRef);
  if (!capsule) throw new Error(`Capsule not found: ${capsuleRef}`);
  const context = capsule.contextPack || {};
  const createdAt = nowIso();
  const explicitTopics = String(options.topics || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const knowledge = {
    schemaVersion: 1,
    id: knowledgeId(capsule.project?.id || "", capsule.id),
    projectId: capsule.project?.id || "",
    capsuleId: capsule.id,
    title: options.title || capsule.title,
    summary: compact(options.summary || capsule.summary || "", 900),
    topics: inferTopics(capsule, explicitTopics),
    facts: cleanList(context.facts || [], 60),
    decisions: cleanList(context.decisions || [], 60),
    files: cleanList(context.files || [], 120),
    commands: cleanList(context.commands || [], 60),
    nextActions: cleanList(context.nextActions || [], 40),
    openQuestions: cleanList(context.openQuestions || [], 40),
    quality: {
      score: qualityScore(capsule),
      signals: qualitySignals(capsule)
    },
    project: capsule.project || {},
    source: {
      app: capsule.source?.app || "",
      chatName: capsule.source?.chatName || "",
      sessionId: capsule.source?.sessionId || "",
      storage: capsule.storage || ""
    },
    createdAt,
    updatedAt: createdAt,
    markdown: ""
  };
  knowledge.markdown = formatKnowledgeMarkdown(knowledge);
  knowledge.storage = saveKnowledgeCapsule(cwd, knowledge);
  return knowledge;
}

function addToGroup(groups, topic, entry) {
  const key = topic || "general";
  if (!groups[key]) groups[key] = [];
  groups[key].push(entry);
}

function markdownGroup(title, values) {
  return [
    `## ${title}`,
    "",
    ...(values.length ? values.map((item, index) => `${index + 1}. ${item}`) : ["暂无记录"]),
    ""
  ].join("\n");
}

function buildMemoryMarkdown(memory) {
  const topicSections = Object.entries(memory.topics)
    .map(([topic, entries]) => [
      `## ${topic}`,
      "",
      ...entries.map((entry, index) => `${index + 1}. ${entry.title}：${entry.summary}`),
      ""
    ].join("\n"));

  return [
    `# ${memory.title}`,
    "",
    `Scope: ${memory.scope}`,
    `Source Count: ${memory.sourceCount}`,
    `Created At: ${memory.createdAt}`,
    "",
    ...topicSections,
    markdownGroup("Facts", memory.facts),
    markdownGroup("Decisions", memory.decisions),
    markdownGroup("Files", memory.files),
    markdownGroup("Commands", memory.commands),
    markdownGroup("Sources", memory.sources.map((source) => `${source.title} ${source.storage}`))
  ].join("\n");
}

export function buildTeamMemory(cwd = process.cwd(), options = {}) {
  const scope = options.scope || "team";
  const minScore = Math.max(0, Math.min(Number(options.minScore || 0), 100));
  const sources = listKnowledgeCapsules(cwd, {
    scope,
    allProjects: scope === "team",
    limit: options.limit || 200
  }).filter((source) => Number(source.quality?.score || 0) >= minScore);
  const createdAt = nowIso();
  const topics = {};

  for (const source of sources) {
    const entry = {
      id: source.id,
      capsuleId: source.capsuleId,
      title: source.title,
      summary: source.summary
    };
    const sourceTopics = source.topics?.length ? source.topics : ["general"];
    for (const topic of sourceTopics.slice(0, 4)) addToGroup(topics, topic, entry);
  }

  const memory = {
    schemaVersion: 1,
    id: memoryId(scope, createdAt),
    title: scope === "team" ? "团队知识记忆" : "项目知识记忆",
    scope,
    sourceCount: sources.length,
    topics,
    facts: cleanList(sources.flatMap((item) => item.facts || []), 200),
    decisions: cleanList(sources.flatMap((item) => item.decisions || []), 200),
    files: cleanList(sources.flatMap((item) => item.files || []), 200),
    commands: cleanList(sources.flatMap((item) => item.commands || []), 120),
    sources: sources.map((source) => ({
      id: source.id,
      capsuleId: source.capsuleId,
      title: source.title,
      storage: source.storage
    })),
    createdAt,
    updatedAt: createdAt,
    markdown: ""
  };
  memory.markdown = buildMemoryMarkdown(memory);
  memory.storage = saveTeamMemorySnapshot(memory);
  return memory;
}

export {
  listKnowledgeCapsules,
  listTeamMemorySnapshots,
  readKnowledgeCapsule,
  readTeamMemorySnapshot
};
