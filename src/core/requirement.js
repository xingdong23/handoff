import { createHash } from "node:crypto";
import { compact, nowIso, slugify, unique } from "./utils.js";
import { fieldLine, firstParagraph, sectionList } from "./markdown.js";
import {
  ensureWorkspace,
  listRequirementCapsules,
  loadConfig,
  readRequirementCapsule,
  saveRequirementCapsule
} from "./store.js";

function hashText(value, length = 14) {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, length);
}

function requirementId(projectId, title, input) {
  return `req_${hashText(`${projectId}:${title}:${compact(input, 240)}`)}_${slugify(title).slice(0, 48)}`;
}

function cleanList(values = [], max = 50) {
  const items = Array.isArray(values) ? values : String(values || "").split(/\r?\n|[,，；;]/);
  return unique(items.map((value) => String(value || "").trim()).filter(Boolean)).slice(0, max);
}

function normalizeInput(input) {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    return null;
  }
  return null;
}

function firstHeading(text) {
  const match = String(text || "").match(/^#{1,6}\s+(.+?)\s*$/m);
  return match ? match[1].trim() : "";
}

function sectionText(text, names) {
  const lines = String(text || "").split(/\r?\n/);
  const wanted = names.map((name) => name.toLowerCase());
  const values = [];
  let collecting = false;

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      const title = heading[1].replace(/[:：]$/, "").toLowerCase();
      collecting = wanted.some((name) => title.includes(name));
      continue;
    }
    if (collecting) values.push(line);
  }

  return values.join("\n").trim();
}

function listFromMarkdown(text, names, fallbackNames = []) {
  return cleanList([
    ...sectionList(text, names),
    ...fallbackNames.map((name) => fieldLine(text, [name])).filter(Boolean)
  ]);
}

function extractFromJson(json) {
  return {
    title: json.title || json.name || json.subject || "",
    summary: json.summary || json.description || json.background || "",
    status: json.status || "draft",
    background: json.background || "",
    goals: cleanList(json.goals || json.objectives || []),
    scope: cleanList(json.scope || json.inScope || []),
    nonGoals: cleanList(json.nonGoals || json.outOfScope || []),
    personas: cleanList(json.personas || json.users || json.roles || []),
    flows: cleanList(json.flows || json.userFlows || []),
    acceptanceCriteria: cleanList(json.acceptanceCriteria || json.acceptance || []),
    openQuestions: cleanList(json.openQuestions || json.questions || []),
    systems: cleanList(json.systems || json.dependencies || []),
    files: cleanList(json.files || []),
    impacts: cleanList(json.impacts || []),
    tasks: cleanList(json.tasks || json.nextActions || [])
  };
}

function extractFromMarkdown(input) {
  return {
    title: fieldLine(input, ["title", "标题", "需求标题", "name"]) || firstHeading(input),
    summary: fieldLine(input, ["summary", "摘要", "description", "描述"]) || firstParagraph(input),
    status: fieldLine(input, ["status", "状态"]) || "draft",
    background: sectionText(input, ["background", "业务背景", "背景"]) || fieldLine(input, ["background", "背景"]),
    goals: listFromMarkdown(input, ["goals", "objectives", "目标", "业务目标"], ["goal", "目标"]),
    scope: listFromMarkdown(input, ["scope", "in scope", "范围", "需求范围"], ["scope", "范围"]),
    nonGoals: listFromMarkdown(input, ["non goals", "out of scope", "非范围", "暂不包含"], ["non-goals", "非范围"]),
    personas: listFromMarkdown(input, ["personas", "roles", "users", "用户角色", "角色"], ["persona", "用户角色"]),
    flows: listFromMarkdown(input, ["flows", "user flows", "流程", "核心流程"], ["flow", "流程"]),
    acceptanceCriteria: listFromMarkdown(input, ["acceptance", "acceptance criteria", "验收标准", "验收项"], ["acceptance", "验收标准"]),
    openQuestions: listFromMarkdown(input, ["open questions", "questions", "开放问题", "待确认"], ["question", "开放问题"]),
    systems: listFromMarkdown(input, ["systems", "dependencies", "相关系统", "依赖系统"], ["system", "相关系统"]),
    files: listFromMarkdown(input, ["files", "相关文件", "涉及文件"], ["files", "相关文件"]),
    impacts: listFromMarkdown(input, ["impacts", "影响范围", "影响"], ["impact", "影响范围"]),
    tasks: listFromMarkdown(input, ["tasks", "suggested tasks", "建议任务", "任务拆分"], ["tasks", "建议任务"])
  };
}

function coverageScore(requirement) {
  const fields = [
    requirement.summary,
    requirement.background,
    requirement.goals?.length,
    requirement.scope?.length,
    requirement.acceptanceCriteria?.length,
    requirement.openQuestions?.length,
    requirement.systems?.length,
    requirement.tasks?.length
  ];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

function listBlock(title, values) {
  return [
    `## ${title}`,
    "",
    ...(values?.length ? values.map((item, index) => `${index + 1}. ${item}`) : ["暂无记录"]),
    ""
  ].join("\n");
}

export function formatRequirementMarkdown(requirement) {
  return [
    `# ${requirement.title}`,
    "",
    `Requirement Capsule: ${requirement.id}`,
    `Project: ${requirement.project?.name || requirement.projectId || "unknown"}`,
    `Status: ${requirement.status}`,
    `Coverage Score: ${requirement.coverage?.score ?? 0}`,
    "",
    "## Summary",
    "",
    requirement.summary || "暂无摘要。",
    "",
    "## Background",
    "",
    requirement.background || "暂无记录。",
    "",
    listBlock("Goals", requirement.goals),
    listBlock("Scope", requirement.scope),
    listBlock("Non Goals", requirement.nonGoals),
    listBlock("Personas", requirement.personas),
    listBlock("Flows", requirement.flows),
    listBlock("Acceptance Criteria", requirement.acceptanceCriteria),
    listBlock("Open Questions", requirement.openQuestions),
    listBlock("Systems", requirement.systems),
    listBlock("Files", requirement.files),
    listBlock("Impacts", requirement.impacts),
    listBlock("Suggested Tasks", requirement.tasks)
  ].join("\n");
}

export function analyzeRequirement(cwd = process.cwd(), input = "", options = {}) {
  const paths = ensureWorkspace(cwd, { projectId: options.projectId });
  const config = loadConfig(cwd);
  const parsed = normalizeInput(input);
  const extracted = parsed ? extractFromJson(parsed) : extractFromMarkdown(input);
  const title = options.title || extracted.title || "未命名需求";
  const createdAt = nowIso();
  const projectId = options.projectId || config.projectId;
  const requirement = {
    schemaVersion: 1,
    id: options.id || requirementId(projectId, title, input),
    projectId,
    title,
    summary: compact(options.summary || extracted.summary || input, 1000),
    status: options.status || extracted.status || "draft",
    background: extracted.background || "",
    goals: extracted.goals || [],
    scope: extracted.scope || [],
    nonGoals: extracted.nonGoals || [],
    personas: extracted.personas || [],
    flows: extracted.flows || [],
    acceptanceCriteria: extracted.acceptanceCriteria || [],
    openQuestions: extracted.openQuestions || [],
    systems: extracted.systems || [],
    files: extracted.files || [],
    impacts: extracted.impacts || [],
    tasks: extracted.tasks || [],
    source: {
      kind: options.source || "manual",
      inputSize: String(input || "").length
    },
    project: {
      id: projectId,
      name: config.projectName || projectId,
      root: paths.root
    },
    coverage: {
      score: 0
    },
    createdAt,
    updatedAt: createdAt,
    markdown: ""
  };
  requirement.coverage.score = coverageScore(requirement);
  requirement.markdown = formatRequirementMarkdown(requirement);
  requirement.storage = saveRequirementCapsule(cwd, requirement);
  return requirement;
}

export {
  listRequirementCapsules,
  readRequirementCapsule
};
