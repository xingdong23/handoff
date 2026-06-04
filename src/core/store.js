import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { ensureDir, nowIso, slugify } from "./utils.js";
import { findProjectRoot } from "./git.js";
import { deriveTitle } from "./titles.js";

const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  const type = typeof args[0] === "string" ? args[0] : args[0]?.type;
  if (type === "ExperimentalWarning") return;
  return originalEmitWarning.call(process, warning, ...args);
};

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} finally {
  process.emitWarning = originalEmitWarning;
}

const dbCache = new Map();

function dbPath() {
  return resolve(process.env.HANDOFF_DB || join(homedir(), ".handoff", "handoff.sqlite"));
}

function openDb() {
  const path = dbPath();
  const cached = dbCache.get(path);
  if (cached) return cached;

  ensureDir(dirname(path));
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  dbCache.set(path, db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root TEXT NOT NULL UNIQUE,
      gitlab_base_url TEXT NOT NULL DEFAULT 'https://gitlab.com',
      gitlab_project_id TEXT NOT NULL DEFAULT '',
      gitlab_token TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS capsules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      progress_percent INTEGER NOT NULL DEFAULT 0,
      source_app TEXT NOT NULL,
      source_chat_name TEXT NOT NULL DEFAULT '',
      source_session_id TEXT NOT NULL DEFAULT '',
      conversation_key TEXT NOT NULL DEFAULT '',
      capsule_json TEXT NOT NULL,
      transcript_md TEXT NOT NULL,
      context_pack_md TEXT NOT NULL,
      share_pack_md TEXT NOT NULL,
      recovery_prompt_md TEXT NOT NULL,
      files_json TEXT NOT NULL,
      gitlab_links_json TEXT NOT NULL,
      decisions_md TEXT NOT NULL,
      next_actions_md TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shares (
      token TEXT PRIMARY KEY,
      capsule_id TEXT NOT NULL REFERENCES capsules(id) ON DELETE CASCADE ON UPDATE CASCADE,
      artifact_type TEXT NOT NULL DEFAULT 'capsule',
      artifact_id TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL,
      expires_at TEXT,
      ack INTEGER NOT NULL DEFAULT 0,
      share_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gitlab_states (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
      state_json TEXT NOT NULL,
      scanned_at TEXT
    );

    CREATE TABLE IF NOT EXISTS attention_states (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
      payload_json TEXT NOT NULL,
      scanned_at TEXT
    );

    CREATE TABLE IF NOT EXISTS requirement_capsules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      requirement_json TEXT NOT NULL,
      requirement_md TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_capsules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
      capsule_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      topics_json TEXT NOT NULL,
      facts_json TEXT NOT NULL,
      decisions_json TEXT NOT NULL,
      files_json TEXT NOT NULL,
      commands_json TEXT NOT NULL,
      knowledge_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, capsule_id)
    );

    CREATE TABLE IF NOT EXISTS team_memory_snapshots (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      scope TEXT NOT NULL,
      memory_json TEXT NOT NULL,
      memory_md TEXT NOT NULL,
      source_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_id TEXT NOT NULL DEFAULT '',
      content_md TEXT NOT NULL,
      asset_json TEXT NOT NULL,
      reviewer TEXT NOT NULL DEFAULT '',
      review_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_shares (
      token TEXT PRIMARY KEY,
      artifact_type TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      visibility TEXT NOT NULL,
      expires_at TEXT,
      ack INTEGER NOT NULL DEFAULT 0,
      share_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mode_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
      mode_id TEXT NOT NULL,
      status TEXT NOT NULL,
      engine TEXT NOT NULL DEFAULT '',
      harness_root TEXT NOT NULL DEFAULT '',
      harness_phase TEXT NOT NULL DEFAULT '',
      session_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS mode_session_assets (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES mode_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
      asset_id TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      load_state TEXT NOT NULL,
      title TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      activated_at TEXT,
      UNIQUE(session_id, asset_id)
    );
  `);
  ensureColumn(db, "projects", "gitlab_token", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "capsules", "conversation_key", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "shares", "artifact_type", "TEXT NOT NULL DEFAULT 'capsule'");
  ensureColumn(db, "shares", "artifact_id", "TEXT NOT NULL DEFAULT ''");
  db.exec("CREATE INDEX IF NOT EXISTS idx_capsules_conversation_key ON capsules(project_id, conversation_key);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_requirement_capsules_project ON requirement_capsules(project_id, updated_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_knowledge_capsules_capsule ON knowledge_capsules(project_id, capsule_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_team_memory_created ON team_memory_snapshots(created_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_skill_assets_project_status ON skill_assets(project_id, status, updated_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_skill_assets_status ON skill_assets(status, updated_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_asset_shares_artifact ON asset_shares(artifact_type, artifact_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mode_sessions_project_status ON mode_sessions(project_id, status, updated_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mode_session_assets_session ON mode_session_assets(session_id, updated_at DESC);");
  dropKnowledgeCapsuleCascade(db);
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', '7')").run();
}

// Knowledge capsules are a distilled, long-lived asset; they must survive the
// deletion of the source capsule (a capsule can be removed as a "conversation
// peer"). Older DBs declared capsule_id with ON DELETE CASCADE, which silently
// dropped knowledge. Rebuild the table without that cascade when present.
function dropKnowledgeCapsuleCascade(db) {
  const hasCascade = db
    .prepare("PRAGMA foreign_key_list(knowledge_capsules)")
    .all()
    .some((fk) => fk.table === "capsules" && fk.on_delete === "CASCADE");
  if (!hasCascade) return;
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec(`
    CREATE TABLE knowledge_capsules_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
      capsule_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      topics_json TEXT NOT NULL,
      facts_json TEXT NOT NULL,
      decisions_json TEXT NOT NULL,
      files_json TEXT NOT NULL,
      commands_json TEXT NOT NULL,
      knowledge_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, capsule_id)
    );
    INSERT INTO knowledge_capsules_new SELECT
      id, project_id, capsule_id, title, summary, topics_json,
      facts_json, decisions_json, files_json, commands_json,
      knowledge_json, created_at, updated_at
    FROM knowledge_capsules;
    DROP TABLE knowledge_capsules;
    ALTER TABLE knowledge_capsules_new RENAME TO knowledge_capsules;
    CREATE INDEX IF NOT EXISTS idx_knowledge_capsules_capsule ON knowledge_capsules(project_id, capsule_id);
  `);
  db.exec("PRAGMA foreign_keys = ON;");
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonText(value) {
  return `${JSON.stringify(value ?? null, null, 2)}\n`;
}

function metaValue(key) {
  return openDb().prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value || "";
}

function setMetaValue(key, value) {
  openDb().prepare("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)").run(key, String(value || ""));
}

export function loadGitLabToken() {
  const token = metaValue("gitlab_token");
  if (token) return token;
  return openDb().prepare("SELECT gitlab_token FROM projects WHERE gitlab_token <> '' ORDER BY updated_at DESC LIMIT 1").get()?.gitlab_token || "";
}

export function saveGitLabToken(token) {
  setMetaValue("gitlab_token", token);
  return { tokenConfigured: Boolean(token) };
}

export function gitLabTokenConfigured() {
  return Boolean(loadGitLabToken());
}

function normalizedText(value) {
  const text = String(value ?? "");
  return text.endsWith("\n") ? text : `${text}\n`;
}

function rootHash(root) {
  return createHash("sha1").update(root).digest("hex").slice(0, 8);
}

function uniqueProjectId(db, requested, root) {
  const base = slugify(requested || basename(root) || "project");
  const existing = db.prepare("SELECT root FROM projects WHERE id = ?").get(base);
  if (!existing || existing.root === root) return base;
  return `${base}-${rootHash(root)}`;
}

function pick(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

function changedProjectFields(existing, next) {
  return existing.id !== next.id ||
    existing.name !== next.name ||
    existing.gitlab_base_url !== next.gitlabBaseUrl ||
    existing.gitlab_project_id !== next.gitlabProjectId ||
    existing.gitlab_token !== next.gitlabToken;
}

function rowToProject(row) {
  return {
    id: row.id,
    name: row.name,
    root: row.root,
    gitlab: {
      baseUrl: row.gitlab_base_url || "https://gitlab.com",
      projectId: row.gitlab_project_id || "",
      tokenConfigured: gitLabTokenConfigured()
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToConfig(row) {
  return {
    projectId: row.id,
    projectName: row.name,
    gitlab: {
      baseUrl: row.gitlab_base_url || "https://gitlab.com",
      projectId: row.gitlab_project_id || "",
      token: row.gitlab_token || ""
    }
  };
}

function storageRef(id) {
  return `sqlite:${dbPath()}#capsules/${encodeURIComponent(id)}`;
}

function requirementStorageRef(id) {
  return `sqlite:${dbPath()}#requirements/${encodeURIComponent(id)}`;
}

function knowledgeStorageRef(id) {
  return `sqlite:${dbPath()}#knowledge/${encodeURIComponent(id)}`;
}

function memoryStorageRef(id) {
  return `sqlite:${dbPath()}#team-memory/${encodeURIComponent(id)}`;
}

function skillAssetStorageRef(id) {
  return `sqlite:${dbPath()}#skill-assets/${encodeURIComponent(id)}`;
}

function capsuleConversationKey(capsule) {
  const source = capsule?.source || {};
  // Only an explicitly anchored conversation may replace its peers. An ambient
  // session/chat picked up from the environment tags the source but does not
  // anchor a conversation, so it yields no key (no destructive replacement).
  if (source.conversationAnchored === false) return "";
  const app = slugify(source.app || "manual");
  const sessionId = String(source.sessionId || "").trim();
  if (sessionId) return `session:${app}:${sessionId}`;
  const chatName = String(source.chatName || "").trim();
  if (chatName) return `chat:${app}:${chatName}`;
  return "";
}

function deleteConversationPeers(db, projectId, capsule, conversationKey) {
  if (!conversationKey) return;
  const source = capsule.source || {};
  const app = source.app || "manual";
  const sessionId = String(source.sessionId || "").trim();
  const chatName = String(source.chatName || "").trim();

  if (sessionId) {
    db.prepare(`
      DELETE FROM capsules
      WHERE project_id = ? AND id <> ? AND (
        conversation_key = ? OR
        (source_app = ? AND source_session_id = ?)
      )
    `).run(projectId, capsule.id, conversationKey, app, sessionId);
    return;
  }

  db.prepare(`
    DELETE FROM capsules
    WHERE project_id = ? AND id <> ? AND (
      conversation_key = ? OR
      (source_app = ? AND source_chat_name = ? AND source_session_id = '')
    )
  `).run(projectId, capsule.id, conversationKey, app, chatName);
}

function artifactMap(files = []) {
  const artifacts = {};
  for (const file of files) {
    if (file.kind === "json") artifacts[file.name] = jsonText(file.value);
    if (file.kind === "text") artifacts[file.name] = normalizedText(file.value);
  }
  return artifacts;
}

function ensureProject(cwd = process.cwd(), init = {}) {
  const root = findProjectRoot(cwd);
  const db = openDb();
  const existing = db.prepare("SELECT * FROM projects WHERE root = ?").get(root);
  const now = nowIso();

  if (existing) {
    const next = {
      id: init.projectId ? uniqueProjectId(db, init.projectId, root) : existing.id,
      name: pick(init.projectName, existing.name || basename(root)),
      gitlabBaseUrl: pick(init.gitlabBaseUrl, existing.gitlab_base_url || "https://gitlab.com"),
      gitlabProjectId: pick(init.gitlabProjectId, existing.gitlab_project_id || ""),
      gitlabToken: pick(init.gitlabToken, existing.gitlab_token || "")
    };
    if (changedProjectFields(existing, next)) {
      db.prepare(`
        UPDATE projects
        SET id = ?, name = ?, gitlab_base_url = ?, gitlab_project_id = ?, gitlab_token = ?, updated_at = ?
        WHERE root = ?
      `).run(
        next.id,
        next.name,
        next.gitlabBaseUrl,
        next.gitlabProjectId,
        next.gitlabToken,
        now,
        root
      );
    }
    const row = changedProjectFields(existing, next)
      ? db.prepare("SELECT * FROM projects WHERE root = ?").get(root)
      : existing;
    return row;
  }

  const id = uniqueProjectId(db, init.projectId || basename(root), root);
  db.prepare(`
    INSERT INTO projects(id, name, root, gitlab_base_url, gitlab_project_id, gitlab_token, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    init.projectName || basename(root),
    root,
    init.gitlabBaseUrl || "https://gitlab.com",
    pick(init.gitlabProjectId, ""),
    init.gitlabToken || "",
    now,
    now
  );
  return db.prepare("SELECT * FROM projects WHERE root = ?").get(root);
}

function capsuleSummary(row) {
  const capsule = hydrateCapsule(row) || {};
  return {
    id: row.id,
    title: capsule.title || row.title,
    summary: row.summary,
    source: capsule.source || {
      app: row.source_app,
      chatName: row.source_chat_name,
      sessionId: row.source_session_id
    },
    progress: capsule.progress || {
      status: row.status,
      percent: row.progress_percent,
      currentStep: "",
      nextStep: ""
    },
    git: capsule.git ? {
      branch: capsule.git.branch || null,
      requirement: capsule.git.requirement || null
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    conversationKey: row.conversation_key || "",
    storage: storageRef(row.id),
    dir: storageRef(row.id)
  };
}

function capsuleTitle(row, capsule) {
  return deriveTitle({
    optionTitle: capsule?.title || row.title,
    context: {
      title: capsule?.contextPack?.title || "",
      summary: capsule?.summary || row.summary,
      currentStep: capsule?.progress?.currentStep || "",
      nextStep: capsule?.progress?.nextStep || ""
    },
    input: row.transcript_md || ""
  });
}

function hydrateCapsule(row) {
  const capsule = parseJson(row.capsule_json, null);
  if (!capsule) return null;
  const title = capsuleTitle(row, capsule);
  const hydrated = title && title !== capsule.title ? { ...capsule, title } : capsule;
  return {
    ...hydrated,
    storage: storageRef(row.id),
    dir: storageRef(row.id)
  };
}

function rowToRequirement(row) {
  const requirement = parseJson(row.requirement_json, null) || {};
  return {
    ...requirement,
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    markdown: row.requirement_md,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    storage: requirementStorageRef(row.id)
  };
}

function rowToKnowledge(row) {
  const knowledge = parseJson(row.knowledge_json, null) || {};
  return {
    ...knowledge,
    id: row.id,
    projectId: row.project_id,
    capsuleId: row.capsule_id,
    title: row.title,
    summary: row.summary,
    topics: parseJson(row.topics_json, knowledge.topics || []),
    facts: parseJson(row.facts_json, knowledge.facts || []),
    decisions: parseJson(row.decisions_json, knowledge.decisions || []),
    files: parseJson(row.files_json, knowledge.files || []),
    commands: parseJson(row.commands_json, knowledge.commands || []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    storage: knowledgeStorageRef(row.id)
  };
}

function rowToTeamMemory(row) {
  const memory = parseJson(row.memory_json, null) || {};
  return {
    ...memory,
    id: row.id,
    title: row.title,
    scope: row.scope,
    markdown: row.memory_md,
    sourceCount: row.source_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    storage: memoryStorageRef(row.id)
  };
}

function rowToSkillAsset(row) {
  const asset = parseJson(row.asset_json, null) || {};
  return {
    ...asset,
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    title: row.title,
    summary: row.summary,
    status: row.status,
    source: {
      ...(asset.source || {}),
      type: row.source_type || asset.source?.type || "manual",
      id: row.source_id || asset.source?.id || ""
    },
    content: row.content_md,
    reviewer: row.reviewer,
    reviewNotes: row.review_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    storage: skillAssetStorageRef(row.id)
  };
}

function rowToModeAsset(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    assetId: row.asset_id,
    assetType: row.asset_type,
    loadState: row.load_state,
    title: row.title,
    manifest: parseJson(row.manifest_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at
  };
}

function rowToModeSession(row, assets = []) {
  const session = parseJson(row.session_json, null) || {};
  return {
    ...session,
    id: row.id,
    projectId: row.project_id,
    modeId: row.mode_id,
    status: row.status,
    engine: row.engine,
    harnessRoot: row.harness_root,
    harnessPhase: row.harness_phase,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    loadedAssets: assets
  };
}

function knowledgeRefValue(ref) {
  const value = String(ref || "");
  const match = value.match(/#knowledge\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : value;
}

function memoryRefValue(ref) {
  const value = String(ref || "");
  const match = value.match(/#team-memory\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : value;
}

function requirementRefValue(ref) {
  const value = String(ref || "");
  const match = value.match(/#requirements\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : value;
}

function skillAssetRefValue(ref) {
  const value = String(ref || "");
  const match = value.match(/#skill-assets\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : value;
}

function capsuleRefValue(ref) {
  const value = String(ref || "");
  const match = value.match(/#capsules\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : value;
}

function capsuleRowByRef(cwd, ref) {
  const value = capsuleRefValue(ref);
  if (!value) return null;

  const db = openDb();
  const project = ensureProject(cwd);
  return db.prepare(`
    SELECT * FROM capsules
    WHERE project_id = ? AND (id = ? OR title = ?)
    ORDER BY created_at DESC
    LIMIT 1
  `).get(project.id, value, value) || db.prepare(`
    SELECT * FROM capsules
    WHERE id = ? OR title = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(value, value);
}

export function workspacePaths(cwd = process.cwd()) {
  const root = findProjectRoot(cwd);
  return {
    root,
    dbPath: dbPath(),
    handoffHome: dirname(dbPath())
  };
}

export function ensureWorkspace(cwd = process.cwd(), init = {}) {
  const project = ensureProject(cwd, init);
  return {
    ...workspacePaths(project.root),
    project: rowToProject(project)
  };
}

export function loadConfig(cwd = process.cwd()) {
  return rowToConfig(ensureProject(cwd));
}

export function saveConfig(cwd, config) {
  ensureProject(cwd, {
    projectId: config.projectId,
    projectName: config.projectName,
    gitlabBaseUrl: config.gitlab?.baseUrl,
    gitlabProjectId: config.gitlab?.projectId,
    gitlabToken: config.gitlab?.token
  });
}

export function listProjects() {
  return openDb()
    .prepare("SELECT * FROM projects ORDER BY updated_at DESC, name ASC")
    .all()
    .map(rowToProject);
}

export function getProject(projectId) {
  const row = openDb().prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  return row ? rowToProject(row) : null;
}

export function updateProjectGitLab(projectId, settings = {}) {
  const db = openDb();
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!row) return null;
  const next = {
    baseUrl: pick(settings.baseUrl, row.gitlab_base_url || "https://gitlab.com"),
    projectId: pick(settings.gitlabProjectId, row.gitlab_project_id || ""),
    token: settings.token === undefined ? row.gitlab_token || "" : String(settings.token || "")
  };
  const now = nowIso();
  db.prepare(`
    UPDATE projects
    SET gitlab_base_url = ?, gitlab_project_id = ?, gitlab_token = ?, updated_at = ?
    WHERE id = ?
  `).run(next.baseUrl, next.projectId, next.token, now, projectId);
  return rowToProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId));
}

export function listCapsules(cwd = process.cwd()) {
  const project = ensureProject(cwd);
  return listCapsulesForProject(project.id);
}

export function listCapsulesForProject(projectId) {
  return openDb()
    .prepare("SELECT * FROM capsules WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId)
    .map(capsuleSummary);
}

export function loadIndex(cwd = process.cwd()) {
  const project = ensureProject(cwd);
  const shares = openDb().prepare(`
    SELECT shares.token, shares.capsule_id, shares.artifact_type, shares.artifact_id, shares.created_at, shares.expires_at, shares.visibility
    FROM shares
    JOIN capsules ON capsules.id = shares.capsule_id
    WHERE capsules.project_id = ?
    ORDER BY shares.created_at DESC
  `).all(project.id);

  return {
    version: 1,
    capsules: listCapsulesForProject(project.id),
    shares: shares.map((share) => ({
      token: share.token,
      capsuleId: share.capsule_id,
      artifactType: share.artifact_type || "capsule",
      artifactId: share.artifact_id || share.capsule_id,
      createdAt: share.created_at,
      expiresAt: share.expires_at,
      visibility: share.visibility
    })),
    updatedAt: nowIso()
  };
}

export function saveIndex(cwd = process.cwd()) {
  return loadIndex(cwd);
}

export function saveCapsule(cwd, capsule, files) {
  const project = ensureProject(cwd, {
    projectId: capsule.project?.id,
    projectName: capsule.project?.name
  });
  const artifacts = artifactMap(files);
  const createdAt = capsule.createdAt || nowIso();
  const updatedAt = capsule.updatedAt || createdAt;
  const conversationKey = capsuleConversationKey(capsule);
  const db = openDb();

  deleteConversationPeers(db, project.id, capsule, conversationKey);

  db.prepare(`
    INSERT INTO capsules(
      id, project_id, title, summary, status, progress_percent,
      source_app, source_chat_name, source_session_id, conversation_key,
      capsule_json, transcript_md, context_pack_md, share_pack_md, recovery_prompt_md,
      files_json, gitlab_links_json, decisions_md, next_actions_md,
      created_at, updated_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      title = excluded.title,
      summary = excluded.summary,
      status = excluded.status,
      progress_percent = excluded.progress_percent,
      source_app = excluded.source_app,
      source_chat_name = excluded.source_chat_name,
      source_session_id = excluded.source_session_id,
      conversation_key = excluded.conversation_key,
      capsule_json = excluded.capsule_json,
      transcript_md = excluded.transcript_md,
      context_pack_md = excluded.context_pack_md,
      share_pack_md = excluded.share_pack_md,
      recovery_prompt_md = excluded.recovery_prompt_md,
      files_json = excluded.files_json,
      gitlab_links_json = excluded.gitlab_links_json,
      decisions_md = excluded.decisions_md,
      next_actions_md = excluded.next_actions_md,
      updated_at = excluded.updated_at
  `).run(
    capsule.id,
    project.id,
    capsule.title,
    capsule.summary || "",
    capsule.progress?.status || "unknown",
    Number(capsule.progress?.percent || 0),
    capsule.source?.app || "manual",
    capsule.source?.chatName || "",
    capsule.source?.sessionId || "",
    conversationKey,
    artifacts["capsule.json"] || jsonText(capsule),
    artifacts["transcript.md"] || "",
    artifacts["context-pack.md"] || "",
    artifacts["share-pack.md"] || "",
    artifacts["recovery-prompt.md"] || normalizedText(capsule.contextPack?.recoveryPrompt || ""),
    artifacts["files.json"] || jsonText({ files: capsule.contextPack?.files || [] }),
    artifacts["gitlab-links.json"] || jsonText(capsule.gitlab || {}),
    artifacts["decisions.md"] || "",
    artifacts["next-actions.md"] || "",
    createdAt,
    updatedAt
  );

  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(updatedAt, project.id);
  return storageRef(capsule.id);
}

export function deleteCapsule(cwd = process.cwd(), ref) {
  const row = capsuleRowByRef(cwd, ref);
  if (!row) return { deleted: false, capsuleId: ref || "", title: "" };
  const capsule = hydrateCapsule(row);
  const db = openDb();
  const result = db.prepare("DELETE FROM capsules WHERE id = ?").run(row.id);
  if (result.changes) db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(nowIso(), row.project_id);
  return {
    deleted: Boolean(result.changes),
    capsuleId: row.id,
    title: capsule?.title || row.title
  };
}

export function readCapsule(cwd = process.cwd(), ref) {
  const row = capsuleRowByRef(cwd, ref);
  return row ? hydrateCapsule(row) : null;
}

export function readCapsuleArtifacts(cwd = process.cwd(), ref) {
  const row = capsuleRowByRef(cwd, ref);
  if (!row) return null;
  return {
    "capsule.json": normalizedText(row.capsule_json),
    "transcript.md": normalizedText(row.transcript_md),
    "context-pack.md": normalizedText(row.context_pack_md),
    "share-pack.md": normalizedText(row.share_pack_md),
    "recovery-prompt.md": normalizedText(row.recovery_prompt_md),
    "files.json": normalizedText(row.files_json),
    "gitlab-links.json": normalizedText(row.gitlab_links_json),
    "decisions.md": normalizedText(row.decisions_md),
    "next-actions.md": normalizedText(row.next_actions_md)
  };
}

export function saveRequirementCapsule(cwd, requirement) {
  const project = ensureProject(cwd);
  const projectId = requirement.projectId || requirement.project?.id || project.id;
  const now = nowIso();
  const createdAt = requirement.createdAt || now;
  const updatedAt = requirement.updatedAt || now;
  const payload = {
    ...requirement,
    projectId,
    createdAt,
    updatedAt
  };

  openDb().prepare(`
    INSERT INTO requirement_capsules(
      id, project_id, title, summary, status, requirement_json, requirement_md, created_at, updated_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      title = excluded.title,
      summary = excluded.summary,
      status = excluded.status,
      requirement_json = excluded.requirement_json,
      requirement_md = excluded.requirement_md,
      updated_at = excluded.updated_at
  `).run(
    payload.id,
    projectId,
    payload.title,
    payload.summary || "",
    payload.status || "draft",
    jsonText(payload),
    payload.markdown || "",
    createdAt,
    updatedAt
  );
  openDb().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(updatedAt, projectId);
  return requirementStorageRef(payload.id);
}

export function readRequirementCapsule(cwd = process.cwd(), ref) {
  const value = requirementRefValue(ref);
  if (!value) return null;
  const project = ensureProject(cwd);
  const row = openDb().prepare(`
    SELECT * FROM requirement_capsules
    WHERE project_id = ? AND (id = ? OR title = ?)
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(project.id, value, value) || openDb().prepare(`
    SELECT * FROM requirement_capsules
    WHERE id = ? OR title = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(value, value);
  return row ? rowToRequirement(row) : null;
}

export function listRequirementCapsules(cwd = process.cwd(), options = {}) {
  const db = openDb();
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
  if (options.scope === "team" || options.allProjects) {
    return db.prepare("SELECT * FROM requirement_capsules ORDER BY updated_at DESC LIMIT ?")
      .all(limit)
      .map(rowToRequirement);
  }
  const project = ensureProject(cwd);
  return db.prepare(`
    SELECT * FROM requirement_capsules
    WHERE project_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(project.id, limit).map(rowToRequirement);
}

export function saveKnowledgeCapsule(cwd, knowledge) {
  const project = ensureProject(cwd);
  const projectId = knowledge.projectId || knowledge.project?.id || project.id;
  const now = nowIso();
  const existing = openDb().prepare(`
    SELECT id, created_at FROM knowledge_capsules
    WHERE project_id = ? AND capsule_id = ?
  `).get(projectId, knowledge.capsuleId);
  const id = existing?.id || knowledge.id;
  const createdAt = existing?.created_at || knowledge.createdAt || now;
  const updatedAt = knowledge.updatedAt || now;
  const payload = {
    ...knowledge,
    id,
    projectId,
    createdAt,
    updatedAt
  };

  openDb().prepare(`
    INSERT INTO knowledge_capsules(
      id, project_id, capsule_id, title, summary, topics_json,
      facts_json, decisions_json, files_json, commands_json,
      knowledge_json, created_at, updated_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, capsule_id) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      topics_json = excluded.topics_json,
      facts_json = excluded.facts_json,
      decisions_json = excluded.decisions_json,
      files_json = excluded.files_json,
      commands_json = excluded.commands_json,
      knowledge_json = excluded.knowledge_json,
      updated_at = excluded.updated_at
  `).run(
    id,
    projectId,
    payload.capsuleId,
    payload.title,
    payload.summary || "",
    jsonText(payload.topics || []),
    jsonText(payload.facts || []),
    jsonText(payload.decisions || []),
    jsonText(payload.files || []),
    jsonText(payload.commands || []),
    jsonText(payload),
    createdAt,
    updatedAt
  );
  openDb().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(updatedAt, projectId);
  return knowledgeStorageRef(id);
}

export function readKnowledgeCapsule(cwd = process.cwd(), ref) {
  const value = knowledgeRefValue(ref);
  if (!value) return null;
  const project = ensureProject(cwd);
  const row = openDb().prepare(`
    SELECT * FROM knowledge_capsules
    WHERE project_id = ? AND (id = ? OR capsule_id = ? OR title = ?)
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(project.id, value, value, value) || openDb().prepare(`
    SELECT * FROM knowledge_capsules
    WHERE id = ? OR capsule_id = ? OR title = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(value, value, value);
  return row ? rowToKnowledge(row) : null;
}

export function deleteKnowledgeCapsule(cwd = process.cwd(), ref) {
  const knowledge = readKnowledgeCapsule(cwd, ref);
  if (!knowledge) return { deleted: false, knowledgeId: ref || "", title: "" };
  const result = openDb().prepare("DELETE FROM knowledge_capsules WHERE id = ?").run(knowledge.id);
  return {
    deleted: Boolean(result.changes),
    knowledgeId: knowledge.id,
    title: knowledge.title
  };
}

export function listKnowledgeCapsules(cwd = process.cwd(), options = {}) {
  const db = openDb();
  const limit = Math.max(1, Math.min(Number(options.limit || 200), 1000));
  if (options.scope === "team" || options.allProjects) {
    return db.prepare("SELECT * FROM knowledge_capsules ORDER BY updated_at DESC LIMIT ?")
      .all(limit)
      .map(rowToKnowledge);
  }
  const project = ensureProject(cwd);
  return db.prepare(`
    SELECT * FROM knowledge_capsules
    WHERE project_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(project.id, limit).map(rowToKnowledge);
}

export function saveTeamMemorySnapshot(memory) {
  const now = nowIso();
  const createdAt = memory.createdAt || now;
  const updatedAt = memory.updatedAt || now;
  const payload = {
    ...memory,
    createdAt,
    updatedAt
  };
  openDb().prepare(`
    INSERT INTO team_memory_snapshots(
      id, title, scope, memory_json, memory_md, source_count, created_at, updated_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      scope = excluded.scope,
      memory_json = excluded.memory_json,
      memory_md = excluded.memory_md,
      source_count = excluded.source_count,
      updated_at = excluded.updated_at
  `).run(
    payload.id,
    payload.title,
    payload.scope,
    jsonText(payload),
    payload.markdown || "",
    Number(payload.sourceCount || 0),
    createdAt,
    updatedAt
  );
  return memoryStorageRef(payload.id);
}

export function readTeamMemorySnapshot(ref) {
  const value = memoryRefValue(ref);
  if (!value) return null;
  const row = openDb().prepare(`
    SELECT * FROM team_memory_snapshots
    WHERE id = ? OR title = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(value, value);
  return row ? rowToTeamMemory(row) : null;
}

export function listTeamMemorySnapshots(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 20), 200));
  return openDb()
    .prepare("SELECT * FROM team_memory_snapshots ORDER BY created_at DESC LIMIT ?")
    .all(limit)
    .map(rowToTeamMemory);
}

export function saveSkillAsset(cwd, asset) {
  const project = ensureProject(cwd);
  const projectId = asset.projectId || asset.project?.id || project.id;
  const now = nowIso();
  const createdAt = asset.createdAt || now;
  const updatedAt = asset.updatedAt || now;
  const payload = {
    ...asset,
    projectId,
    createdAt,
    updatedAt
  };
  openDb().prepare(`
    INSERT INTO skill_assets(
      id, project_id, type, title, summary, status, source_type, source_id,
      content_md, asset_json, reviewer, review_notes, created_at, updated_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      type = excluded.type,
      title = excluded.title,
      summary = excluded.summary,
      status = excluded.status,
      source_type = excluded.source_type,
      source_id = excluded.source_id,
      content_md = excluded.content_md,
      asset_json = excluded.asset_json,
      reviewer = excluded.reviewer,
      review_notes = excluded.review_notes,
      updated_at = excluded.updated_at
  `).run(
    payload.id,
    projectId,
    payload.type || "skill",
    payload.title,
    payload.summary || "",
    payload.status || "draft",
    payload.source?.type || payload.sourceType || "manual",
    payload.source?.id || payload.sourceId || "",
    payload.content || payload.markdown || "",
    jsonText(payload),
    payload.reviewer || "",
    payload.reviewNotes || "",
    createdAt,
    updatedAt
  );
  openDb().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(updatedAt, projectId);
  return skillAssetStorageRef(payload.id);
}

export function readSkillAsset(cwd = process.cwd(), ref) {
  const value = skillAssetRefValue(ref);
  if (!value) return null;
  const project = ensureProject(cwd);
  const row = openDb().prepare(`
    SELECT * FROM skill_assets
    WHERE project_id = ? AND (id = ? OR title = ?)
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(project.id, value, value) || openDb().prepare(`
    SELECT * FROM skill_assets
    WHERE id = ? OR title = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(value, value);
  return row ? rowToSkillAsset(row) : null;
}

export function deleteSkillAsset(cwd = process.cwd(), ref) {
  const asset = readSkillAsset(cwd, ref);
  if (!asset) return { deleted: false, skillId: ref || "", title: "" };
  const result = openDb().prepare("DELETE FROM skill_assets WHERE id = ?").run(asset.id);
  return {
    deleted: Boolean(result.changes),
    skillId: asset.id,
    title: asset.title
  };
}

export function listSkillAssets(cwd = process.cwd(), options = {}) {
  const db = openDb();
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
  const clauses = [];
  const params = [];
  if (!(options.scope === "team" || options.allProjects)) {
    const project = ensureProject(cwd);
    clauses.push("project_id = ?");
    params.push(project.id);
  }
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  if (options.type) {
    clauses.push("type = ?");
    params.push(options.type);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT * FROM skill_assets
    ${where}
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(...params, limit).map(rowToSkillAsset);
}

export function reviewSkillAsset(cwd = process.cwd(), ref, review = {}) {
  const current = readSkillAsset(cwd, ref);
  if (!current) return null;
  const status = review.status || current.status || "submitted";
  const updated = {
    ...current,
    status,
    reviewer: review.reviewer || current.reviewer || "",
    reviewNotes: review.notes || review.reviewNotes || current.reviewNotes || "",
    updatedAt: nowIso()
  };
  updated.storage = saveSkillAsset(cwd, updated);
  return updated;
}

export function saveAssetShare(cwd = process.cwd(), share) {
  ensureProject(cwd);
  openDb().prepare(`
    INSERT INTO asset_shares(token, artifact_type, artifact_id, visibility, expires_at, ack, share_json, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET
      artifact_type = excluded.artifact_type,
      artifact_id = excluded.artifact_id,
      visibility = excluded.visibility,
      expires_at = excluded.expires_at,
      ack = excluded.ack,
      share_json = excluded.share_json
  `).run(
    share.token,
    share.artifactType,
    share.artifactId,
    share.visibility || "team",
    share.expiresAt || null,
    share.ack ? 1 : 0,
    jsonText(share),
    share.createdAt || nowIso()
  );
}

export function saveShare(cwd, share) {
  ensureProject(cwd);
  const db = openDb();
  db.prepare(`
    INSERT INTO shares(token, capsule_id, artifact_type, artifact_id, visibility, expires_at, ack, share_json, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET
      capsule_id = excluded.capsule_id,
      artifact_type = excluded.artifact_type,
      artifact_id = excluded.artifact_id,
      visibility = excluded.visibility,
      expires_at = excluded.expires_at,
      ack = excluded.ack,
      share_json = excluded.share_json
  `).run(
    share.token,
    share.capsuleId,
    share.artifactType || "capsule",
    share.artifactId || share.capsuleId,
    share.visibility || "private",
    share.expiresAt || null,
    share.ack ? 1 : 0,
    jsonText(share),
    share.createdAt || nowIso()
  );
}

export function readShare(cwd = process.cwd(), token) {
  ensureProject(cwd);
  const row = openDb().prepare("SELECT share_json FROM shares WHERE token = ?").get(token);
  if (row) return parseJson(row.share_json, null);
  const assetRow = openDb().prepare("SELECT share_json FROM asset_shares WHERE token = ?").get(token);
  return assetRow ? parseJson(assetRow.share_json, null) : null;
}

export function saveModeSession(cwd = process.cwd(), session = {}) {
  const project = ensureProject(cwd);
  const now = nowIso();
  const createdAt = session.createdAt || now;
  const updatedAt = session.updatedAt || now;
  const payload = {
    ...session,
    projectId: project.id,
    createdAt,
    updatedAt
  };
  openDb().prepare(`
    INSERT INTO mode_sessions(
      id, project_id, mode_id, status, engine, harness_root, harness_phase,
      session_json, created_at, updated_at, ended_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      engine = excluded.engine,
      harness_root = excluded.harness_root,
      harness_phase = excluded.harness_phase,
      session_json = excluded.session_json,
      updated_at = excluded.updated_at,
      ended_at = excluded.ended_at
  `).run(
    payload.id,
    project.id,
    payload.modeId,
    payload.status || "active",
    payload.engine || "",
    payload.harnessRoot || "",
    payload.harnessPhase || "",
    jsonText(payload),
    createdAt,
    updatedAt,
    payload.endedAt || null
  );
  openDb().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(updatedAt, project.id);
  return readModeSession(cwd, payload.id);
}

export function saveModeSessionAsset(cwd = process.cwd(), sessionId, asset = {}) {
  const project = ensureProject(cwd);
  const now = nowIso();
  const createdAt = asset.createdAt || now;
  const updatedAt = asset.updatedAt || now;
  const id = asset.id || `${sessionId}:${asset.assetId}`;
  openDb().prepare(`
    INSERT INTO mode_session_assets(
      id, session_id, project_id, asset_id, asset_type, load_state, title,
      manifest_json, created_at, updated_at, activated_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, asset_id) DO UPDATE SET
      load_state = excluded.load_state,
      title = excluded.title,
      manifest_json = excluded.manifest_json,
      updated_at = excluded.updated_at,
      activated_at = COALESCE(excluded.activated_at, mode_session_assets.activated_at)
  `).run(
    id,
    sessionId,
    project.id,
    asset.assetId,
    asset.assetType || "skill",
    asset.loadState || "reference",
    asset.title || "",
    jsonText(asset.manifest || {}),
    createdAt,
    updatedAt,
    asset.activatedAt || null
  );
  openDb().prepare("UPDATE mode_sessions SET updated_at = ? WHERE id = ?").run(updatedAt, sessionId);
  return readModeSessionAsset(sessionId, asset.assetId);
}

export function listModeSessionAssets(sessionId) {
  if (!sessionId) return [];
  return openDb().prepare(`
    SELECT * FROM mode_session_assets
    WHERE session_id = ?
    ORDER BY updated_at DESC, title ASC
  `).all(sessionId).map(rowToModeAsset);
}

export function readModeSessionAsset(sessionId, assetId) {
  if (!sessionId || !assetId) return null;
  const row = openDb().prepare(`
    SELECT * FROM mode_session_assets
    WHERE session_id = ? AND asset_id = ?
    LIMIT 1
  `).get(sessionId, assetId);
  return row ? rowToModeAsset(row) : null;
}

export function readModeSession(cwd = process.cwd(), sessionId) {
  if (!sessionId) return null;
  ensureProject(cwd);
  const row = openDb().prepare(`
    SELECT * FROM mode_sessions
    WHERE id = ?
    LIMIT 1
  `).get(sessionId);
  return row ? rowToModeSession(row, listModeSessionAssets(row.id)) : null;
}

export function readCurrentModeSession(cwd = process.cwd()) {
  const project = ensureProject(cwd);
  return readCurrentModeSessionForProject(project.id);
}

export function readCurrentModeSessionForProject(projectId) {
  const row = openDb().prepare(`
    SELECT * FROM mode_sessions
    WHERE project_id = ? AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(projectId);
  return row ? rowToModeSession(row, listModeSessionAssets(row.id)) : null;
}

export function endCurrentModeSession(cwd = process.cwd()) {
  const current = readCurrentModeSession(cwd);
  if (!current) return null;
  const now = nowIso();
  openDb().prepare(`
    UPDATE mode_sessions
    SET status = 'ended', updated_at = ?, ended_at = ?
    WHERE id = ?
  `).run(now, now, current.id);
  return readModeSession(cwd, current.id);
}

export function endActiveModeSessions(cwd = process.cwd()) {
  const project = ensureProject(cwd);
  const now = nowIso();
  openDb().prepare(`
    UPDATE mode_sessions
    SET status = 'ended', updated_at = ?, ended_at = ?
    WHERE project_id = ? AND status = 'active'
  `).run(now, now, project.id);
}

export function saveGitLabState(cwd, state) {
  const project = ensureProject(cwd);
  const scannedAt = state?.scannedAt || nowIso();
  openDb().prepare(`
    INSERT INTO gitlab_states(project_id, state_json, scanned_at)
    VALUES(?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      state_json = excluded.state_json,
      scanned_at = excluded.scanned_at
  `).run(project.id, jsonText(state), scannedAt);
  openDb().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(scannedAt, project.id);
  return state;
}

export function loadGitLabState(cwd = process.cwd()) {
  const project = ensureProject(cwd);
  return loadGitLabStateForProject(project.id);
}

export function loadGitLabStateForProject(projectId) {
  const row = openDb().prepare("SELECT state_json FROM gitlab_states WHERE project_id = ?").get(projectId);
  return row ? parseJson(row.state_json, emptyGitLabState()) : emptyGitLabState();
}

export function saveAttentionState(cwd, payload) {
  const project = ensureProject(cwd);
  const scannedAt = payload?.scannedAt || nowIso();
  openDb().prepare(`
    INSERT INTO attention_states(project_id, payload_json, scanned_at)
    VALUES(?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      scanned_at = excluded.scanned_at
  `).run(project.id, jsonText(payload), scannedAt);
  openDb().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(scannedAt, project.id);
  return payload;
}

export function loadAttentionState(cwd = process.cwd()) {
  const project = ensureProject(cwd);
  const row = openDb().prepare("SELECT payload_json FROM attention_states WHERE project_id = ?").get(project.id);
  return row ? parseJson(row.payload_json, emptyAttentionState()) : emptyAttentionState();
}

export function findHandoffWorkspaces(baseDir) {
  const projects = listProjects();
  return projects.length ? projects.map((project) => project.root) : [resolve(baseDir)];
}

function emptyGitLabState() {
  return {
    scannedAt: null,
    mergeRequests: [],
    pipelines: [],
    issues: []
  };
}

function emptyAttentionState() {
  return {
    scannedAt: null,
    items: []
  };
}
