import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function gitStatus(cwd, args) {
  try {
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch {
    return false;
  }
}

export function findGitRoot(cwd = process.cwd()) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  return root ? resolve(root) : null;
}

export function findProjectRoot(cwd = process.cwd()) {
  return findGitRoot(cwd) || resolve(cwd);
}

export function getGitSnapshot(cwd = process.cwd()) {
  const root = findGitRoot(cwd);
  if (!root) {
    return {
      isRepo: false,
      root: resolve(cwd),
      branch: null,
      status: [],
      dirtyFiles: [],
      diffStat: [],
      lastCommit: null
    };
  }

  const branch = git(root, ["branch", "--show-current"]) || "detached";
  const status = (git(root, ["status", "--short"]) || "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const dirtyFiles = status.map(statusPath).filter(Boolean);
  const diffStat = (git(root, ["diff", "--stat"]) || "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const lastCommitRaw = git(root, ["log", "-1", "--pretty=format:%H%x09%s%x09%ci"]);
  const lastCommit = lastCommitRaw
    ? (() => {
        const [sha, subject, date] = lastCommitRaw.split("\t");
        return { sha, subject, date };
      })()
    : null;

  return {
    isRepo: true,
    root,
    branch,
    status,
    dirtyFiles,
    diffStat,
    lastCommit
  };
}

function pathInside(root, path) {
  const rel = relative(root, path);
  return rel && !rel.startsWith("..") && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel);
}

function ancestors(path) {
  const values = [];
  let current = resolve(path);
  while (!values.includes(current)) {
    values.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return values;
}

function candidatePaths(cwd, file) {
  const text = String(file || "").trim();
  if (!text) return [];
  if (isAbsolute(text)) return [resolve(text)];

  const candidates = [];
  for (const base of ancestors(cwd)) {
    candidates.push(resolve(base, text));
  }
  return candidates;
}

function resolveScopedFile(cwd, file) {
  for (const candidate of candidatePaths(cwd, file)) {
    const absolute = realPathOrResolved(candidate);
    const existing = nearestExistingDirectory(absolute);
    const root = findGitRoot(existing);
    if (!root || !pathInside(root, absolute)) continue;
    return {
      input: String(file),
      absolute,
      root,
      relative: relative(root, absolute)
    };
  }
  return null;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const values = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(item);
  }
  return values;
}

function parseCommitLines(output) {
  return (output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, date] = line.split("\t");
      return { sha, subject, date };
    })
    .filter((item) => item.sha);
}

function statusPath(line) {
  return String(line || "").replace(/^.{1,2}\s+/, "").trim();
}

function aheadBehind(root, upstream) {
  if (!upstream) return { ahead: null, behind: null };
  const raw = git(root, ["rev-list", "--left-right", "--count", `${upstream}...HEAD`]);
  if (!raw) return { ahead: null, behind: null };
  const [behind, ahead] = raw.split(/\s+/).map((item) => Number(item));
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null
  };
}

function remoteContains(root, sha, upstream) {
  if (!sha) return "unknown";
  if (upstream && gitStatus(root, ["merge-base", "--is-ancestor", sha, upstream])) return "yes";
  const branches = git(root, ["branch", "-r", "--contains", sha]);
  if (!branches) return upstream ? "no" : "unknown";
  const remoteBranches = branches
    .split("\n")
    .map((line) => line.replace(/^[* ]+/, "").trim())
    .filter((line) => line && !line.includes(" -> "));
  return remoteBranches.length ? "yes" : upstream ? "no" : "unknown";
}

function scopedRepoStatus(root, files) {
  const paths = uniqueBy(files, (file) => file.relative).map((file) => file.relative);
  const branch = git(root, ["branch", "--show-current"]) || "detached";
  const upstream = git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const statusArgs = paths.length ? ["status", "--short", "--", ...paths] : ["status", "--short"];
  const status = (git(root, statusArgs) || "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const commits = parseCommitLines(git(root, ["log", "-8", "--pretty=format:%H%x09%s%x09%ci", "--", ...paths]));
  const latestCommit = commits[0] || null;
  const ahead = upstream
    ? parseCommitLines(git(root, ["log", "-8", "--pretty=format:%H%x09%s%x09%ci", `${upstream}..HEAD`, "--", ...paths]))
    : commits.slice(0, 1);
  const counters = aheadBehind(root, upstream);
  const committed = status.length ? "no" : latestCommit ? "yes" : "unknown";
  const pushed = status.length ? "no" : remoteContains(root, latestCommit?.sha, upstream);

  return {
    root,
    branch,
    upstream: upstream || "",
    ahead: counters.ahead,
    behind: counters.behind,
    scopeFiles: paths,
    dirtyFiles: status.map(statusPath).filter(Boolean),
    status,
    latestCommit,
    unpushedCommits: ahead,
    committed,
    pushed
  };
}

export function getGitRequirementStatus(cwd = process.cwd(), files = []) {
  const scopedFiles = uniqueBy(
    files.map((file) => resolveScopedFile(cwd, file)).filter(Boolean),
    (file) => `${file.root}:${file.relative}`
  );

  if (!scopedFiles.length) {
    const snapshot = getGitSnapshot(cwd);
    return {
      scoped: false,
      reason: files.length ? "no_matching_git_files" : "no_files",
      repos: snapshot.isRepo ? [{
        root: snapshot.root,
        branch: snapshot.branch,
        upstream: "",
        ahead: null,
        behind: null,
        scopeFiles: [],
        dirtyFiles: [],
        status: [],
        latestCommit: snapshot.lastCommit,
        unpushedCommits: [],
        committed: "unknown",
        pushed: "unknown"
      }] : []
    };
  }

  const byRoot = new Map();
  for (const file of scopedFiles) {
    const list = byRoot.get(file.root) || [];
    list.push(file);
    byRoot.set(file.root, list);
  }

  return {
    scoped: true,
    reason: "",
    repos: [...byRoot.entries()].map(([root, rootFiles]) => scopedRepoStatus(root, rootFiles))
  };
}

export function runGitOrThrow(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function nearestExistingDirectory(path) {
  let current = resolve(path);
  while (!existsSync(current)) current = dirname(current);
  if (!statSync(current).isDirectory()) return dirname(current);
  return current;
}

function realPathOrResolved(path) {
  const current = resolve(path);
  if (existsSync(current)) return realpathSync(current);
  const existing = nearestExistingDirectory(current);
  const realExisting = realpathSync(existing);
  return resolve(realExisting, relative(existing, current));
}
