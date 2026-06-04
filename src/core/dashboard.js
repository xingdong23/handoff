import { getGitSnapshot } from "./git.js";
import { inferGitLabConfig } from "./gitlab.js";
import {
  ensureWorkspace,
  listCapsulesForProject,
  listProjects,
  listRequirementCapsules,
  listSkillAssets,
  loadGitLabStateForProject,
  readCurrentModeSessionForProject
} from "./store.js";
import { computeAttention } from "./reminders.js";
import { listAssets } from "./assets.js";
import { listActiveSessions } from "./active-sessions.js";
import { slugify } from "./utils.js";

function sameOrInside(parent, child) {
  if (!parent || !child) return false;
  const root = parent.endsWith("/") ? parent : `${parent}/`;
  return child === parent || child.startsWith(root);
}

function summarizeProject(project) {
  const requirements = listRequirementCapsules(project.root);
  const skillAssets = listSkillAssets(project.root);
  const assets = listAssets(project.root);
  const capsules = listCapsulesForProject(project.id);
  const git = getGitSnapshot(project.root);
  const gitlab = loadGitLabStateForProject(project.id);
  const detectedGitLab = inferGitLabConfig(project.root);
  const currentBranch = git.branch || "";
  const visibleMergeRequests = gitlab.user ? gitlab.mergeRequests || [] : [];
  const activeMergeRequests = visibleMergeRequests.filter((mr) =>
    mr.state === "opened" && (!currentBranch || mr.sourceBranch === currentBranch)
  );
  const attention = computeAttention({ capsules, gitlab, git });
  const openMrs = visibleMergeRequests.filter((mr) => mr.state === "opened").length;
  const failedPipelines = gitlab.user ? gitlab.pipelines?.filter((pipeline) => pipeline.status === "failed").length || 0 : 0;
  const activeCapsules = capsules.filter((capsule) => capsule.progress?.status === "in_progress").length;
  const modeSession = readCurrentModeSessionForProject(project.id);

  return {
    id: project.id,
    name: project.name,
    root: project.root,
    gitlabConfig: {
      ...project.gitlab,
      detected: detectedGitLab
    },
    metrics: {
      requirements: requirements.length,
      assets: assets.length,
      skillAssets: skillAssets.length,
      capsules: capsules.length,
      activeCapsules,
      openMrs,
      failedPipelines,
      dirtyFiles: git.dirtyFiles.length,
      attention: attention.length
    },
    requirements,
    assets,
    skillAssets,
    capsules,
    git,
    gitlab: {
      ...gitlab,
      mergeRequests: visibleMergeRequests,
      pipelines: gitlab.user ? gitlab.pipelines || [] : [],
      config: {
        ...project.gitlab,
        detected: detectedGitLab
      },
      currentBranch,
      activeMergeRequests
    },
    modeSession,
    attention
  };
}

function emptySessionProject(session) {
  const name = session.project?.name || "Claude Code";
  const root = session.project?.root || "";
  return {
    id: `session-${slugify(name)}`,
    name,
    root,
    gitlabConfig: {
      baseUrl: "https://gitlab.com",
      projectId: "",
      detected: null,
      tokenConfigured: false
    },
    metrics: {
      requirements: 0,
      assets: 0,
      skillAssets: 0,
      capsules: 0,
      activeCapsules: 0,
      activeSessions: 0,
      openMrs: 0,
      failedPipelines: 0,
      dirtyFiles: 0,
      attention: 0
    },
    requirements: [],
    assets: [],
    skillAssets: [],
    capsules: [],
    git: {
      branch: "",
      upstream: "",
      dirtyFiles: [],
      ahead: 0,
      behind: 0
    },
    gitlab: {
      mergeRequests: [],
      pipelines: [],
      config: {
        baseUrl: "https://gitlab.com",
        projectId: "",
        detected: null
      },
      currentBranch: "",
      activeMergeRequests: []
    },
    modeSession: null,
    attention: []
  };
}

function projectForSession(projects, session) {
  const root = session.project?.root || "";
  if (!root) return null;
  return projects
    .filter((project) => sameOrInside(project.root, root))
    .sort((a, b) => b.root.length - a.root.length)[0] || null;
}

function attachActiveSessions(projects, baseDir, options = {}) {
  const sessions = listActiveSessions(baseDir, options);
  if (!sessions.length) return projects;

  const bySessionRoot = new Map();
  const next = [...projects];
  for (const session of sessions) {
    let project = projectForSession(next, session);
    if (!project) {
      const key = session.project?.root || session.project?.name || session.id;
      project = bySessionRoot.get(key);
      if (!project) {
        project = emptySessionProject(session);
        bySessionRoot.set(key, project);
        next.push(project);
      }
    }
    project.assets = [session, ...(project.assets || [])];
    project.metrics.assets += 1;
    project.metrics.activeSessions = (project.metrics.activeSessions || 0) + 1;
  }
  return next;
}

export function getDashboard(baseDir = process.cwd(), options = {}) {
  if (!listProjects().length) ensureWorkspace(baseDir);
  const projects = attachActiveSessions(
    listProjects().map((project) => summarizeProject(project)),
    baseDir,
    options.activeSessions || {}
  );
  const totals = projects.reduce(
    (acc, item) => {
      acc.projects += 1;
      acc.requirements += item.metrics.requirements;
      acc.assets += item.metrics.assets;
      acc.skillAssets += item.metrics.skillAssets;
      acc.capsules += item.metrics.capsules;
      acc.activeCapsules += item.metrics.activeCapsules;
      acc.activeSessions += item.metrics.activeSessions || 0;
      acc.modeSessions += item.modeSession ? 1 : 0;
      acc.openMrs += item.metrics.openMrs;
      acc.failedPipelines += item.metrics.failedPipelines;
      acc.attention += item.metrics.attention;
      acc.dirtyFiles += item.metrics.dirtyFiles;
      return acc;
    },
    {
      projects: 0,
      requirements: 0,
      assets: 0,
      skillAssets: 0,
      capsules: 0,
      activeCapsules: 0,
      activeSessions: 0,
      modeSessions: 0,
      openMrs: 0,
      failedPipelines: 0,
      attention: 0,
      dirtyFiles: 0
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    totals,
    projects
  };
}
