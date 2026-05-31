import { getGitSnapshot } from "./git.js";
import { inferGitLabConfig } from "./gitlab.js";
import { ensureWorkspace, listCapsulesForProject, listProjects, listRequirementCapsules, loadGitLabStateForProject } from "./store.js";
import { computeAttention } from "./reminders.js";

function summarizeProject(project) {
  const requirements = listRequirementCapsules(project.root);
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
      capsules: capsules.length,
      activeCapsules,
      openMrs,
      failedPipelines,
      dirtyFiles: git.dirtyFiles.length,
      attention: attention.length
    },
    requirements,
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
    attention
  };
}

export function getDashboard(baseDir = process.cwd()) {
  if (!listProjects().length) ensureWorkspace(baseDir);
  const projects = listProjects().map((project) => summarizeProject(project));
  const totals = projects.reduce(
    (acc, item) => {
      acc.projects += 1;
      acc.requirements += item.metrics.requirements;
      acc.capsules += item.metrics.capsules;
      acc.activeCapsules += item.metrics.activeCapsules;
      acc.openMrs += item.metrics.openMrs;
      acc.failedPipelines += item.metrics.failedPipelines;
      acc.attention += item.metrics.attention;
      acc.dirtyFiles += item.metrics.dirtyFiles;
      return acc;
    },
    {
      projects: 0,
      requirements: 0,
      capsules: 0,
      activeCapsules: 0,
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
