import { join } from "node:path";
import { ensureWorkspace, loadConfig, loadIndex, readCapsule, readCapsuleArtifacts, workspacePaths } from "./store.js";
import { findGitRoot, runGitOrThrow } from "./git.js";
import { ensureDir, writeJson, writeText } from "./utils.js";

function exportCapsuleFiles(cwd, capsule) {
  const paths = workspacePaths(cwd);
  const artifacts = readCapsuleArtifacts(cwd, capsule.id);
  if (!artifacts) throw new Error(`Capsule artifacts not found: ${capsule.id}`);

  const capsuleDir = join(paths.capsulesDir, capsule.id);
  ensureDir(capsuleDir);
  for (const [name, value] of Object.entries(artifacts)) {
    writeText(join(capsuleDir, name), value);
  }
  writeJson(paths.configPath, loadConfig(cwd));
  writeJson(paths.indexPath, loadIndex(cwd));

  return paths;
}

export function syncCapsuleToGit(cwd, capsuleRef, options = {}) {
  const capsule = readCapsule(cwd, capsuleRef);
  if (!capsule) throw new Error(`Capsule not found: ${capsuleRef}`);
  const root = findGitRoot(cwd);
  if (!root) throw new Error("Git repository not found");

  ensureWorkspace(cwd);
  const paths = exportCapsuleFiles(cwd, capsule);
  const relCapsuleDir = join(".handoff", "capsules", capsule.id);
  const relIndex = join(".handoff", "index.json");
  const relConfig = join(".handoff", "config.json");
  const outputs = [];

  runGitOrThrow(root, ["add", relCapsuleDir, relIndex, relConfig]);
  outputs.push(`staged ${relCapsuleDir}`);

  if (options.commit) {
    const status = runGitOrThrow(root, ["status", "--short", relCapsuleDir, relIndex, relConfig]);
    if (status) {
      runGitOrThrow(root, ["commit", "-m", `handoff: capture ${capsule.id}`]);
      outputs.push("commit created");
    } else {
      outputs.push("nothing to commit");
    }
  }

  if (options.push) {
    const branch = runGitOrThrow(root, ["branch", "--show-current"]);
    runGitOrThrow(root, ["push", "-u", "origin", branch]);
    outputs.push(`pushed ${branch}`);
  }

  return {
    root,
    capsuleId: capsule.id,
    handoffDir: paths.handoffDir,
    outputs
  };
}
