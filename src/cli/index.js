import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { createCapsule, formatGitRequirementStatus } from "../core/capsule.js";
import { createShare } from "../core/share.js";
import { getDashboard } from "../core/dashboard.js";
import { deleteCapsule, readCapsule, readShare, ensureWorkspace, loadConfig, saveConfig, listCapsules } from "../core/store.js";
import { scanGitLab } from "../core/gitlab.js";
import { syncCapsuleToGit } from "../core/git-sync.js";
import { computeAttention, saveAttention } from "../core/reminders.js";
import { getGitSnapshot } from "../core/git.js";
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
    "  handoff import <capsule-id-or-share-url>",
    "  handoff attach <capsule-id>",
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
  if (!ref) throw new Error("Capsule id, token, or share API URL is required");
  const capsule = await loadRef(process.cwd(), ref);
  if (!capsule) throw new Error(`Capsule not found: ${ref}`);
  if (args.json) return printJson(capsule);
  process.stdout.write(`${capsule.contextPack?.recoveryPrompt || ""}\n`);
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
  if (command === "attach") return commandAttach(args);
  if (command === "status") return commandStatus(args);
  if (command === "open") return commandOpen(args);
  if (command === "dashboard") return commandDashboard(args);
  if (command === "git") return commandGit(args);
  if (command === "gitlab") return commandGitLab(args);
  if (command === "reminders") return commandReminders(args);

  throw new Error(`Unknown command: ${command}\n${usage()}`);
}
