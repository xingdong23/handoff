import { randomToken, nowIso, parseDurationDays } from "./utils.js";
import { readCapsule, saveShare } from "./store.js";

export function createShare(cwd, capsuleRef, options = {}) {
  const capsule = readCapsule(cwd, capsuleRef);
  if (!capsule) throw new Error(`Capsule not found: ${capsuleRef}`);

  const share = {
    token: options.token || randomToken(12),
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
