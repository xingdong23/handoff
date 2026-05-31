import { randomToken, nowIso, parseDurationDays } from "./utils.js";
import { readCapsule, readKnowledgeCapsule, saveShare } from "./store.js";

export function createShare(cwd, capsuleRef, options = {}) {
  const capsule = readCapsule(cwd, capsuleRef);
  if (!capsule) throw new Error(`Capsule not found: ${capsuleRef}`);

  const share = {
    token: options.token || randomToken(12),
    artifactType: "capsule",
    artifactId: capsule.id,
    capsuleId: capsule.id,
    visibility: options.visibility || "private",
    createdAt: nowIso(),
    expiresAt: parseDurationDays(options.expiresInDays),
    ack: false,
    capsule: {
      id: capsule.id,
      title: capsule.title,
      summary: capsule.summary,
      progress: capsule.progress,
      contextPack: capsule.contextPack,
      git: capsule.git,
      gitlab: capsule.gitlab,
      createdAt: capsule.createdAt
    }
  };

  saveShare(cwd, share);
  return share;
}

export function createKnowledgeShare(cwd, knowledgeRef, options = {}) {
  const knowledge = readKnowledgeCapsule(cwd, knowledgeRef);
  if (!knowledge) throw new Error(`Knowledge capsule not found: ${knowledgeRef}`);

  const share = {
    token: options.token || randomToken(12),
    artifactType: "knowledge",
    artifactId: knowledge.id,
    capsuleId: knowledge.capsuleId,
    visibility: options.visibility || "team",
    createdAt: nowIso(),
    expiresAt: parseDurationDays(options.expiresInDays),
    ack: false,
    knowledge: {
      id: knowledge.id,
      capsuleId: knowledge.capsuleId,
      title: knowledge.title,
      summary: knowledge.summary,
      topics: knowledge.topics,
      facts: knowledge.facts,
      decisions: knowledge.decisions,
      files: knowledge.files,
      commands: knowledge.commands,
      nextActions: knowledge.nextActions,
      quality: knowledge.quality,
      markdown: knowledge.markdown,
      createdAt: knowledge.createdAt,
      updatedAt: knowledge.updatedAt
    }
  };

  saveShare(cwd, share);
  return share;
}
