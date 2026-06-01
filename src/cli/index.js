import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { createCapsule, formatGitRequirementStatus } from "../core/capsule.js";
import { createKnowledgeShare, createShare } from "../core/share.js";
import { getDashboard } from "../core/dashboard.js";
import { deleteCapsule, readCapsule, readShare, ensureWorkspace, loadConfig, saveConfig, listCapsules } from "../core/store.js";
import { scanGitLab } from "../core/gitlab.js";
import { syncCapsuleToGit } from "../core/git-sync.js";
import { computeAttention, saveAttention } from "../core/reminders.js";
import { getGitSnapshot } from "../core/git.js";
import {
  buildTeamMemory,
  createKnowledgeCapsule,
  formatKnowledgeMarkdown,
  listKnowledgeCapsules,
  listTeamMemorySnapshots,
  readKnowledgeCapsule,
  readTeamMemorySnapshot
} from "../core/knowledge.js";
import {
  analyzeRequirement,
  formatRequirementMarkdown,
  listRequirementCapsules,
  readRequirementCapsule
} from "../core/requirement.js";
import {
  createSkillAssetFromCapsule,
  createSkillAssetFromKnowledge,
  createSkillAssetShare,
  formatSkillAssetMarkdown,
  importSkillAsset,
  listSkillAssets,
  readSkillAsset,
  reviewSkillAsset,
  submitSkillAsset
} from "../core/skill-platform.js";
import {
  createAssetShare,
  formatAssetMarkdown,
  importAssetContext,
  ingestKnowledgeAsset,
  ingestSkillAsset,
  listAssets,
  readAsset
} from "../core/assets.js";
import { startServer } from "../server/index.js";

const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
const packageInfo = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const cliEntrypointPath = join(dirname(fileURLToPath(import.meta.url)), "../../bin/handoff.js");

function usage() {
  return [
    "Handoff",
    "",
    "Commands:",
    "  handoff init --project <id>",
    "  handoff capture <name> --from <file> --source claude-code",
    "  handoff capture <name> --stdin",
    "  handoff share <capsule-id> --port 7349",
    "  handoff delete <capsule-id>",
    "  handoff import <asset-id-or-share-url>",
    "  handoff asset list --json",
    "  handoff asset show <asset-id>",
    "  handoff asset share <asset-id>",
    "  handoff asset import <asset-id-or-token-or-url>",
    "  handoff attach <capsule-id>",
    "  handoff requirement analyze <title> --from <file> --json",
    "  handoff requirement analyze <title> --stdin",
    "  handoff requirement list --json",
    "  handoff knowledge extract <capsule-id> --json",
    "  handoff knowledge ingest <title> --from <file> --json",
    "  handoff knowledge share <knowledge-id>",
    "  handoff knowledge list --scope team --json",
    "  handoff memory build --scope team --min-score 70 --json",
    "  handoff memory latest --json",
    "  handoff skill submit <title> --from <file> --type skill --json",
    "  handoff skill ingest <title> --from <file> --json",
    "  handoff skill from-capsule <capsule-id> --json",
    "  handoff skill from-knowledge <knowledge-id> --json",
    "  handoff skill review <asset-id> --approve --reviewer <name>",
    "  handoff skill share <asset-id>",
    "  handoff skill import <asset-id-or-token-or-url>",
    "  handoff status --json",
    "  handoff open --port 7349 --workspace <dir>",
    "  handoff dashboard --port 7349 --workspace <dir>",
    "  handoff git sync <capsule-id> --commit --push",
    "  handoff gitlab scan --project-id <group/project>",
    "  handoff reminders scan",
    ""
  ].join("\n");
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function readInput(args) {
  if (args.from) return readFileSync(args.from, "utf8");
  if (args.stdin) return readStdin();
  return args.content || await readStdin();
}

async function loadRef(cwd, ref) {
  if (/^https?:\/\//.test(ref)) {
    const response = await fetch(ref);
    if (!response.ok) throw new Error(`Share fetch failed: ${response.status}`);
    const data = await response.json();
    return data.capsule || data;
  }
  const share = readShare(cwd, ref);
  if (share?.capsule) return share.capsule;
  return readCapsule(cwd, ref);
}

function shareApiUrl(ref) {
  const url = new URL(ref);
  if (url.pathname.startsWith("/s/")) {
    const token = url.pathname.split("/").pop() || "";
    url.pathname = `/api/share/${encodeURIComponent(token)}`;
  }
  return url.toString();
}

async function loadSharePayload(cwd, ref) {
  if (/^https?:\/\//.test(ref)) {
    const response = await fetch(shareApiUrl(ref));
    if (!response.ok) throw new Error(`Share fetch failed: ${response.status}`);
    return response.json();
  }
  return readShare(cwd, ref);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printStatus(dashboard) {
  const totals = dashboard.totals;
  process.stdout.write(
    [
      `Projects: ${totals.projects}`,
      `Capsules: ${totals.capsules}`,
      `Active: ${totals.activeCapsules}`,
      `Open MR: ${totals.openMrs}`,
      `Failed CI: ${totals.failedPipelines}`,
      `Attention: ${totals.attention}`,
      ""
    ].join("\n")
  );

  for (const project of dashboard.projects) {
    process.stdout.write(`${project.name}  capsules=${project.metrics.capsules}  mr=${project.metrics.openMrs}  attention=${project.metrics.attention}\n`);
    for (const capsule of project.capsules.slice(0, 5)) {
      process.stdout.write(`  ${capsule.id}  ${capsule.progress?.status || "unknown"}  ${capsule.title}\n`);
    }
  }
}

function dashboardUrl(host, port) {
  const browserHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  return `http://${browserHost}:${port}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isDashboardReady(url) {
  try {
    const response = await fetch(`${url}/api/dashboard`, {
      signal: AbortSignal.timeout(800)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDashboard(url, attempts = 30) {
  for (let index = 0; index < attempts; index += 1) {
    if (await isDashboardReady(url)) return true;
    await sleep(150);
  }
  return false;
}

function startDashboardProcess({ host, port, workspace }) {
  const child = spawn(process.execPath, [
    cliEntrypointPath,
    "dashboard",
    "--port",
    String(port),
    "--host",
    host,
    "--workspace",
    workspace
  ], {
    cwd: workspace,
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.unref();
  return child.pid;
}

function openBrowser(url) {
  if (process.platform === "darwin") {
    return spawnSync("open", [url], { stdio: "ignore" }).status === 0;
  }
  if (process.platform === "win32") {
    return spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore" }).status === 0;
  }
  return spawnSync("xdg-open", [url], { stdio: "ignore" }).status === 0;
}

async function commandInit(args) {
  const cwd = process.cwd();
  const paths = ensureWorkspace(cwd, {
    projectId: args.project,
    projectName: args.name,
    gitlabBaseUrl: args["gitlab-url"],
    gitlabProjectId: args["gitlab-project"]
  });
  const config = loadConfig(cwd);
  saveConfig(cwd, {
    ...config,
    projectId: args.project || config.projectId,
    projectName: args.name || config.projectName,
    gitlab: {
      baseUrl: args["gitlab-url"] || config.gitlab?.baseUrl || "https://gitlab.com",
      projectId: args["gitlab-project"] || config.gitlab?.projectId || ""
    }
  });
  process.stdout.write(`initialized ${paths.dbPath}\n`);
}

async function commandCapture(args) {
  const title = args._[1] || args.name || "";
  const input = args.from
    ? readFileSync(args.from, "utf8")
    : args.stdin
      ? await readStdin()
      : await readStdin();
  const result = createCapsule({
    cwd: process.cwd(),
    title,
    input,
    source: args.source || "manual",
    projectId: args.project,
    chatName: args.chat,
    sessionId: args.session,
    summary: args.summary
  });
  process.stdout.write(`${result.capsule.id}\n${result.capsuleDir}\n`);
}

async function commandShare(args) {
  const ref = args._[1];
  if (!ref) throw new Error("Capsule id is required");
  const share = createShare(process.cwd(), ref, {
    visibility: args.visibility || "private",
    expiresInDays: args["expires-days"]
  });
  const port = args.port || process.env.HANDOFF_PORT || 7349;
  process.stdout.write(`token=${share.token}\n`);
  process.stdout.write(`url=http://localhost:${port}/s/${share.token}\n`);
  process.stdout.write(`api=http://localhost:${port}/api/share/${share.token}\n`);
}

async function commandDelete(args) {
  const ref = args._[1];
  if (!ref) throw new Error("Capsule id is required");
  const result = deleteCapsule(process.cwd(), ref);
  if (!result.deleted) throw new Error(`Capsule not found: ${ref}`);
  if (args.json) return printJson(result);
  process.stdout.write(`deleted ${result.capsuleId} ${result.title}\n`);
}

async function commandImport(args) {
  const ref = args._[1];
  if (!ref) throw new Error("Asset id, token, or share API URL is required");
  const share = await loadSharePayload(process.cwd(), ref);
  const text = importAssetContext(process.cwd(), share || ref);
  if (!text) throw new Error(`Asset not found: ${ref}`);
  if (args.json) return printJson(share || readAsset(process.cwd(), ref));
  process.stdout.write(`${text}\n`);
}

async function commandAttach(args) {
  const ref = args._[1];
  if (!ref) throw new Error("Capsule id is required");
  const capsule = await loadRef(process.cwd(), ref);
  if (!capsule) throw new Error(`Capsule not found: ${ref}`);
  const pack = capsule.contextPack || {};
  const lines = [
    `Attached capsule: ${capsule.title}`,
    `Summary: ${capsule.summary}`,
    "",
    "Git requirement status:",
    formatGitRequirementStatus(capsule.git?.requirement),
    "",
    "Facts:",
    ...(pack.facts || []).map((item, index) => `${index + 1}. ${item}`),
    "",
    "Decisions:",
    ...(pack.decisions || []).map((item, index) => `${index + 1}. ${item}`),
    "",
    "Next actions:",
    ...(pack.nextActions || []).map((item, index) => `${index + 1}. ${item}`)
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function commandRequirement(args) {
  const sub = args._[1];
  if (sub === "analyze") {
    const title = args._[2] || args.title || "";
    const input = args.from
      ? readFileSync(args.from, "utf8")
      : args.stdin
        ? await readStdin()
        : await readStdin();
    const requirement = analyzeRequirement(process.cwd(), input, {
      title,
      summary: args.summary,
      status: args.status,
      source: args.source || (args.from ? "file" : "manual"),
      projectId: args.project
    });
    if (args.json) return printJson(requirement);
    process.stdout.write(`${requirement.id}\n${requirement.storage}\n`);
    return;
  }

  if (sub === "show") {
    const ref = args._[2];
    if (!ref) throw new Error("Requirement capsule id is required");
    const requirement = readRequirementCapsule(process.cwd(), ref);
    if (!requirement) throw new Error(`Requirement capsule not found: ${ref}`);
    if (args.json) return printJson(requirement);
    process.stdout.write(`${requirement.markdown || formatRequirementMarkdown(requirement)}\n`);
    return;
  }

  if (sub === "list" || !sub) {
    const items = listRequirementCapsules(process.cwd(), {
      scope: args.scope || "project",
      limit: args.limit
    });
    if (args.json) return printJson(items);
    for (const item of items) {
      process.stdout.write(`${item.id}  ${item.status}  ${item.title}\n`);
    }
    return;
  }

  throw new Error("Supported requirement commands: handoff requirement analyze <title>, handoff requirement list, handoff requirement show <requirement-id>");
}

async function commandKnowledge(args) {
  const sub = args._[1];
  if (sub === "ingest") {
    const title = args._[2] || args.title || "";
    const input = await readInput(args);
    const bundle = ingestKnowledgeAsset(process.cwd(), input, {
      title,
      summary: args.summary,
      topics: args.topics,
      projectId: args.project,
      source: args.source || (args.from ? "file" : "knowledge-ingest")
    });
    if (args.json) return printJson(bundle);
    process.stdout.write(`${bundle.knowledge.id}\n${bundle.knowledge.storage}\n`);
    return;
  }

  if (sub === "extract") {
    const ref = args._[2];
    if (!ref) throw new Error("Capsule id is required");
    const knowledge = createKnowledgeCapsule(process.cwd(), ref, {
      title: args.title,
      summary: args.summary,
      topics: args.topics
    });
    if (args.json) return printJson(knowledge);
    process.stdout.write(`${knowledge.id}\n${knowledge.storage}\n`);
    return;
  }

  if (sub === "show") {
    const ref = args._[2];
    if (!ref) throw new Error("Knowledge capsule id is required");
    const knowledge = readKnowledgeCapsule(process.cwd(), ref);
    if (!knowledge) throw new Error(`Knowledge capsule not found: ${ref}`);
    if (args.json) return printJson(knowledge);
    process.stdout.write(`${knowledge.markdown || formatKnowledgeMarkdown(knowledge)}\n`);
    return;
  }

  if (sub === "share") {
    const ref = args._[2];
    if (!ref) throw new Error("Knowledge capsule id is required");
    const share = createKnowledgeShare(process.cwd(), ref, {
      visibility: args.visibility || "team",
      expiresInDays: args["expires-days"]
    });
    const port = args.port || process.env.HANDOFF_PORT || 7349;
    process.stdout.write(`token=${share.token}\n`);
    process.stdout.write(`url=http://localhost:${port}/s/${share.token}\n`);
    process.stdout.write(`api=http://localhost:${port}/api/share/${share.token}\n`);
    return;
  }

  if (sub === "list" || !sub) {
    const items = listKnowledgeCapsules(process.cwd(), {
      scope: args.scope || "project",
      limit: args.limit
    });
    if (args.json) return printJson(items);
    for (const item of items) {
      process.stdout.write(`${item.id}  ${item.title}\n`);
    }
    return;
  }

  throw new Error("Supported knowledge commands: handoff knowledge ingest <title>, handoff knowledge extract <capsule-id>, handoff knowledge share <knowledge-id>, handoff knowledge list, handoff knowledge show <knowledge-id>");
}

async function commandMemory(args) {
  const sub = args._[1];
  if (sub === "build") {
    const memory = buildTeamMemory(process.cwd(), {
      scope: args.scope || "team",
      limit: args.limit,
      minScore: args["min-score"]
    });
    if (args.json) return printJson(memory);
    process.stdout.write(`${memory.id}\n${memory.storage}\n`);
    return;
  }

  if (sub === "show") {
    const ref = args._[2];
    if (!ref) throw new Error("Team memory id is required");
    const memory = readTeamMemorySnapshot(ref);
    if (!memory) throw new Error(`Team memory not found: ${ref}`);
    if (args.json) return printJson(memory);
    process.stdout.write(`${memory.markdown || ""}\n`);
    return;
  }

  if (sub === "latest") {
    const memory = listTeamMemorySnapshots({ limit: 1 })[0] || null;
    if (!memory) throw new Error("Team memory not found");
    if (args.json) return printJson(memory);
    process.stdout.write(`${memory.markdown || ""}\n`);
    return;
  }

  if (sub === "list" || !sub) {
    const items = listTeamMemorySnapshots({ limit: args.limit || 20 });
    if (args.json) return printJson(items);
    for (const item of items) {
      process.stdout.write(`${item.id}  ${item.scope}  sources=${item.sourceCount}  ${item.title}\n`);
    }
    return;
  }

  throw new Error("Supported memory commands: handoff memory build, handoff memory list, handoff memory latest, handoff memory show <memory-id>");
}

async function commandSkill(args) {
  const sub = args._[1];
  if (sub === "ingest") {
    const title = args._[2] || args.title || "";
    const input = await readInput(args);
    const bundle = ingestSkillAsset(process.cwd(), input, {
      title,
      summary: args.summary,
      topics: args.topics,
      type: args.type || "skill",
      status: args.draft ? "draft" : args.status || "submitted",
      projectId: args.project,
      source: args.source || (args.from ? "file" : "skill-ingest")
    });
    if (args.json) return printJson(bundle);
    process.stdout.write(`${bundle.skill.id}\n${bundle.skill.storage}\n`);
    return;
  }

  if (sub === "submit") {
    const title = args._[2] || args.title || "";
    const input = await readInput(args);
    const asset = submitSkillAsset(process.cwd(), input, {
      title,
      type: args.type || "skill",
      summary: args.summary,
      status: args.draft ? "draft" : args.status || "submitted",
      sourceType: args.from ? "file" : "manual",
      sourceId: args.from || ""
    });
    if (args.json) return printJson(asset);
    process.stdout.write(`${asset.id}\n${asset.storage}\n`);
    return;
  }

  if (sub === "from-capsule") {
    const ref = args._[2];
    if (!ref) throw new Error("Capsule id is required");
    const asset = createSkillAssetFromCapsule(process.cwd(), ref, {
      title: args.title,
      summary: args.summary,
      type: args.type || "skill",
      status: args.draft ? "draft" : args.status || "submitted"
    });
    if (args.json) return printJson(asset);
    process.stdout.write(`${asset.id}\n${asset.storage}\n`);
    return;
  }

  if (sub === "from-knowledge") {
    const ref = args._[2];
    if (!ref) throw new Error("Knowledge capsule id is required");
    const asset = createSkillAssetFromKnowledge(process.cwd(), ref, {
      title: args.title,
      summary: args.summary,
      type: args.type || "knowledge",
      status: args.draft ? "draft" : args.status || "submitted"
    });
    if (args.json) return printJson(asset);
    process.stdout.write(`${asset.id}\n${asset.storage}\n`);
    return;
  }

  if (sub === "review") {
    const ref = args._[2];
    if (!ref) throw new Error("Skill asset id is required");
    const asset = reviewSkillAsset(process.cwd(), ref, {
      approve: Boolean(args.approve) || (!args.reject && !args.status),
      reject: Boolean(args.reject),
      publish: Boolean(args.publish),
      status: args.status,
      reviewer: args.reviewer,
      notes: args.notes || args["review-notes"]
    });
    if (args.json) return printJson(asset);
    process.stdout.write(`${asset.id}  ${asset.status}\n`);
    return;
  }

  if (sub === "share") {
    const ref = args._[2];
    if (!ref) throw new Error("Skill asset id is required");
    const share = createSkillAssetShare(process.cwd(), ref, {
      visibility: args.visibility || "team",
      expiresInDays: args["expires-days"]
    });
    if (args.json) return printJson(share);
    const port = args.port || process.env.HANDOFF_PORT || 7349;
    process.stdout.write(`token=${share.token}\n`);
    process.stdout.write(`url=http://localhost:${port}/s/${share.token}\n`);
    process.stdout.write(`api=http://localhost:${port}/api/share/${share.token}\n`);
    return;
  }

  if (sub === "import") {
    const ref = args._[2];
    if (!ref) throw new Error("Skill asset id, token, or share URL is required");
    const share = await loadSharePayload(process.cwd(), ref);
    const text = share?.skill
      ? importSkillAsset(process.cwd(), share)
      : importSkillAsset(process.cwd(), ref);
    if (!text) throw new Error(`Skill asset not found: ${ref}`);
    if (args.json) return printJson(share?.skill || readSkillAsset(process.cwd(), ref));
    process.stdout.write(`${text}\n`);
    return;
  }

  if (sub === "show") {
    const ref = args._[2];
    if (!ref) throw new Error("Skill asset id is required");
    const asset = readSkillAsset(process.cwd(), ref);
    if (!asset) throw new Error(`Skill asset not found: ${ref}`);
    if (args.json) return printJson(asset);
    process.stdout.write(`${asset.markdown || formatSkillAssetMarkdown(asset)}\n`);
    return;
  }

  if (sub === "list" || !sub) {
    const items = listSkillAssets(process.cwd(), {
      scope: args.scope || "project",
      status: args.status,
      type: args.type,
      limit: args.limit
    });
    if (args.json) return printJson(items);
    for (const item of items) {
      process.stdout.write(`${item.id}  ${item.status}  ${item.type}  ${item.title}\n`);
    }
    return;
  }

  throw new Error("Supported skill commands: handoff skill ingest <title>, handoff skill submit <title>, handoff skill from-capsule <capsule-id>, handoff skill from-knowledge <knowledge-id>, handoff skill review <asset-id>, handoff skill share <asset-id>, handoff skill import <asset-id-or-token-or-url>, handoff skill list, handoff skill show <asset-id>");
}

async function commandAsset(args) {
  const sub = args._[1];

  if (sub === "list" || !sub) {
    const items = listAssets(process.cwd(), {
      scope: args.scope || "project",
      type: args.type,
      assetType: args["asset-type"],
      status: args.status,
      limit: args.limit
    });
    if (args.json) return printJson(items);
    for (const item of items) {
      const detail = item.assetType ? `${item.type}:${item.assetType}` : item.type;
      process.stdout.write(`${item.id}  ${detail}  ${item.scope}  ${item.status}  ${item.title}\n`);
    }
    return;
  }

  if (sub === "show") {
    const ref = args._[2];
    if (!ref) throw new Error("Asset id is required");
    const asset = readAsset(process.cwd(), ref);
    if (!asset) throw new Error(`Asset not found: ${ref}`);
    if (args.json) return printJson(asset);
    process.stdout.write(`${formatAssetMarkdown(asset)}\n`);
    return;
  }

  if (sub === "share") {
    const ref = args._[2];
    if (!ref) throw new Error("Asset id is required");
    const share = createAssetShare(process.cwd(), ref, {
      visibility: args.visibility || "team",
      expiresInDays: args["expires-days"],
      force: Boolean(args.force)
    });
    if (args.json) return printJson(share);
    const port = args.port || process.env.HANDOFF_PORT || 7349;
    process.stdout.write(`token=${share.token}\n`);
    process.stdout.write(`url=http://localhost:${port}/s/${share.token}\n`);
    process.stdout.write(`api=http://localhost:${port}/api/share/${share.token}\n`);
    return;
  }

  if (sub === "import") {
    const ref = args._[2];
    if (!ref) throw new Error("Asset id, token, or share URL is required");
    const share = await loadSharePayload(process.cwd(), ref);
    const text = importAssetContext(process.cwd(), share || ref);
    if (!text) throw new Error(`Asset not found: ${ref}`);
    if (args.json) return printJson(share || readAsset(process.cwd(), ref));
    process.stdout.write(`${text}\n`);
    return;
  }

  throw new Error("Supported asset commands: handoff asset list, handoff asset show <asset-id>, handoff asset share <asset-id>, handoff asset import <asset-id-or-token-or-url>");
}

async function commandStatus(args) {
  const dashboard = getDashboard(args.workspace || process.cwd());
  if (args.json) return printJson(dashboard);
  printStatus(dashboard);
}

async function commandDashboard(args) {
  const port = Number(args.port || process.env.HANDOFF_PORT || 7349);
  const host = args.host || "127.0.0.1";
  const workspace = args.workspace || process.cwd();
  await startServer({ host, port, workspace });
}

async function commandOpen(args) {
  const port = Number(args.port || process.env.HANDOFF_PORT || 7349);
  const host = args.host || "127.0.0.1";
  const workspace = args.workspace || process.cwd();
  const url = dashboardUrl(host, port);
  let started = false;
  let pid = null;

  if (!(await isDashboardReady(url))) {
    pid = startDashboardProcess({ host, port, workspace });
    started = true;
  }

  const ready = await waitForDashboard(url);
  if (!ready) throw new Error(`Dashboard did not become ready at ${url}`);

  let browserOpened = false;
  if (!args["no-browser"]) browserOpened = openBrowser(url);

  process.stdout.write(`url=${url}\n`);
  process.stdout.write(`started=${started}\n`);
  if (pid) process.stdout.write(`pid=${pid}\n`);
  if (!args["no-browser"]) process.stdout.write(`browser=${browserOpened ? "opened" : "failed"}\n`);
}

async function commandGit(args) {
  const sub = args._[1];
  if (sub !== "sync") throw new Error("Supported git command: handoff git sync <capsule-id>");
  const ref = args._[2];
  if (!ref) throw new Error("Capsule id is required");
  const result = syncCapsuleToGit(process.cwd(), ref, {
    commit: Boolean(args.commit),
    push: Boolean(args.push)
  });
  printJson(result);
}

async function commandGitLab(args) {
  const sub = args._[1];
  if (sub !== "scan") throw new Error("Supported gitlab command: handoff gitlab scan");
  const state = await scanGitLab(process.cwd(), {
    baseUrl: args["base-url"],
    projectId: args["project-id"],
    token: args.token
  });
  printJson(state);
}

async function commandReminders(args) {
  const sub = args._[1];
  if (sub !== "scan") throw new Error("Supported reminders command: handoff reminders scan");
  const capsules = listCapsules(process.cwd());
  const { loadGitLabState } = await import("../core/gitlab.js");
  const gitlab = loadGitLabState(process.cwd());
  const git = getGitSnapshot(process.cwd());
  const items = computeAttention({ capsules, gitlab, git });
  const payload = saveAttention(process.cwd(), items);
  printJson(payload);
}

export async function runCli(argv) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (args.version || command === "version" || command === "--version" || command === "-v") {
    process.stdout.write(`${packageInfo.name} ${packageInfo.version}\n`);
    return;
  }
  if (!command || command === "help" || args.help) {
    process.stdout.write(usage());
    return;
  }

  if (command === "init") return commandInit(args);
  if (command === "capture") return commandCapture(args);
  if (command === "share") return commandShare(args);
  if (command === "delete" || command === "rm") return commandDelete(args);
  if (command === "import") return commandImport(args);
  if (command === "asset") return commandAsset(args);
  if (command === "attach") return commandAttach(args);
  if (command === "requirement") return commandRequirement(args);
  if (command === "knowledge") return commandKnowledge(args);
  if (command === "memory") return commandMemory(args);
  if (command === "skill") return commandSkill(args);
  if (command === "status") return commandStatus(args);
  if (command === "open") return commandOpen(args);
  if (command === "dashboard") return commandDashboard(args);
  if (command === "git") return commandGit(args);
  if (command === "gitlab") return commandGitLab(args);
  if (command === "reminders") return commandReminders(args);

  throw new Error(`Unknown command: ${command}\n${usage()}`);
}
