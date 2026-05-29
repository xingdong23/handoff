import { execFileSync } from "node:child_process";
import { ensureWorkspace, loadConfig, loadGitLabState as loadStoredGitLabState, loadGitLabToken, saveGitLabState } from "./store.js";
import { nowIso } from "./utils.js";

function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function gitlabUrl(baseUrl, projectId, path) {
  const base = String(baseUrl || "https://gitlab.com").replace(/\/$/, "");
  const encodedProjectId = encodeURIComponent(projectId);
  return `${base}/api/v4/projects/${encodedProjectId}${path}`;
}

function apiUrl(baseUrl, path) {
  const base = String(baseUrl || "https://gitlab.com").replace(/\/$/, "");
  return `${base}/api/v4${path}`;
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: token ? { "PRIVATE-TOKEN": token } : {}
  });
  if (!response.ok) {
    throw new Error(`GitLab API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function normalizeProjectId(path) {
  return String(path || "").replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
}

export function parseGitLabRemote(remote) {
  const value = String(remote || "").trim();
  if (!value) return null;

  const scpLike = value.match(/^git@([^:]+):(.+)$/);
  if (scpLike) {
    return {
      baseUrl: `https://${scpLike[1]}`,
      projectId: normalizeProjectId(scpLike[2])
    };
  }

  const sshLike = value.match(/^ssh:\/\/git@([^/]+)\/(.+)$/);
  if (sshLike) {
    return {
      baseUrl: `https://${sshLike[1]}`,
      projectId: normalizeProjectId(sshLike[2])
    };
  }

  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    return {
      baseUrl: `${url.protocol}//${url.host}`,
      projectId: normalizeProjectId(decodeURIComponent(url.pathname))
    };
  } catch {
    return null;
  }
}

export function inferGitLabConfig(cwd) {
  const remote = git(cwd, ["remote", "get-url", "origin"]);
  return parseGitLabRemote(remote);
}

function countDiffLines(diff) {
  const lines = String(diff || "").split("\n");
  return lines.reduce(
    (acc, line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return acc;
      if (line.startsWith("+")) acc.additions += 1;
      if (line.startsWith("-")) acc.deletions += 1;
      return acc;
    },
    { additions: 0, deletions: 0 }
  );
}

function diffFile(item) {
  const counts = countDiffLines(item.diff);
  return {
    oldPath: item.old_path,
    newPath: item.new_path,
    path: item.new_path || item.old_path,
    newFile: Boolean(item.new_file),
    renamedFile: Boolean(item.renamed_file),
    deletedFile: Boolean(item.deleted_file),
    additions: counts.additions,
    deletions: counts.deletions
  };
}

function commitSummary(commit) {
  return {
    id: commit.id,
    shortId: commit.short_id || String(commit.id || "").slice(0, 12),
    title: commit.title,
    message: commit.message,
    authorName: commit.author_name,
    committedDate: commit.committed_date || commit.created_at,
    webUrl: commit.web_url
  };
}

async function fetchOptionalJson(url, token, fallback) {
  try {
    return await fetchJson(url, token);
  } catch {
    return fallback;
  }
}

async function enrichMergeRequest(baseUrl, projectId, token, mr) {
  const [diffs, commits, pipelines] = await Promise.all([
    fetchOptionalJson(gitlabUrl(baseUrl, projectId, `/merge_requests/${mr.iid}/diffs?per_page=100`), token, []),
    fetchOptionalJson(gitlabUrl(baseUrl, projectId, `/merge_requests/${mr.iid}/commits?per_page=30`), token, []),
    fetchOptionalJson(gitlabUrl(baseUrl, projectId, `/merge_requests/${mr.iid}/pipelines?per_page=10`), token, [])
  ]);
  const changedFiles = Array.isArray(diffs) ? diffs.map(diffFile) : [];
  const changes = changedFiles.reduce(
    (acc, file) => {
      acc.files += 1;
      acc.additions += file.additions;
      acc.deletions += file.deletions;
      return acc;
    },
    { files: 0, additions: 0, deletions: 0 }
  );

  return {
    iid: mr.iid,
    title: mr.title,
    description: mr.description || "",
    state: mr.state,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
    mergeStatus: mr.detailed_merge_status || mr.merge_status,
    webUrl: mr.web_url,
    updatedAt: mr.updated_at,
    createdAt: mr.created_at,
    author: mr.author?.name || mr.author?.username || "",
    reviewers: (mr.reviewers || []).map((item) => item.name || item.username),
    labels: mr.labels || [],
    draft: Boolean(mr.draft || mr.work_in_progress),
    changesCount: mr.changes_count || "",
    userNotesCount: mr.user_notes_count || 0,
    hasConflicts: Boolean(mr.has_conflicts),
    blockingDiscussionsResolved: mr.blocking_discussions_resolved ?? null,
    changes,
    changedFiles,
    commits: Array.isArray(commits) ? commits.map(commitSummary) : [],
    pipelines: Array.isArray(pipelines) ? pipelines.map((pipeline) => ({
      id: pipeline.id,
      iid: pipeline.iid,
      status: pipeline.status,
      ref: pipeline.ref,
      sha: pipeline.sha,
      webUrl: pipeline.web_url,
      updatedAt: pipeline.updated_at,
      createdAt: pipeline.created_at
    })) : [],
    pipeline: mr.head_pipeline
      ? {
          id: mr.head_pipeline.id,
          status: mr.head_pipeline.status,
          webUrl: mr.head_pipeline.web_url
        }
      : null
  };
}

export async function scanGitLab(cwd, options = {}) {
  ensureWorkspace(cwd);
  const config = loadConfig(cwd);
  const inferred = inferGitLabConfig(cwd) || {};
  const projectId = options.projectId || process.env.GITLAB_PROJECT_ID || config.gitlab?.projectId || inferred.projectId;
  const configuredBaseUrl = config.gitlab?.baseUrl || "";
  const shouldPreferInferredBase = !options.baseUrl &&
    !process.env.GITLAB_BASE_URL &&
    !config.gitlab?.projectId &&
    inferred.baseUrl;
  const baseUrl = options.baseUrl ||
    process.env.GITLAB_BASE_URL ||
    (shouldPreferInferredBase ? inferred.baseUrl : configuredBaseUrl) ||
    inferred.baseUrl ||
    "https://gitlab.com";
  const token = options.token || process.env.GITLAB_TOKEN || loadGitLabToken() || config.gitlab?.token;
  if (!projectId) throw new Error("GitLab project id is required");
  if (!token) throw new Error("GitLab token is required to scan your merge requests");

  const user = await fetchJson(apiUrl(baseUrl, "/user"), token);

  const mergeRequests = await fetchJson(
    gitlabUrl(baseUrl, projectId, "/merge_requests?state=opened&scope=created_by_me&per_page=50&order_by=updated_at&sort=desc"),
    token
  );
  const ownMergeRequests = mergeRequests.filter((mr) =>
    !user?.id ||
    mr.author?.id === user.id ||
    mr.author?.username === user.username
  );

  const enrichedMergeRequests = await Promise.all(
    ownMergeRequests.map((mr) => enrichMergeRequest(baseUrl, projectId, token, mr))
  );
  const ownPipelines = enrichedMergeRequests.flatMap((mr) =>
    mr.pipeline ? [mr.pipeline] : mr.pipelines || []
  );

  const state = {
    scannedAt: nowIso(),
    baseUrl,
    projectId,
    user: {
      id: user?.id,
      username: user?.username,
      name: user?.name
    },
    mergeRequests: enrichedMergeRequests,
    pipelines: ownPipelines.map((pipeline) => ({
      id: pipeline.id,
      iid: pipeline.iid,
      status: pipeline.status,
      ref: pipeline.ref,
      sha: pipeline.sha,
      webUrl: pipeline.web_url,
      updatedAt: pipeline.updated_at || pipeline.updatedAt,
      createdAt: pipeline.created_at || pipeline.createdAt
    })),
    issues: []
  };

  return saveGitLabState(cwd, state);
}

export function loadGitLabState(cwd) {
  return loadStoredGitLabState(cwd);
}
