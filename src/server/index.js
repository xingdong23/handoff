import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCapsule } from "../core/capsule.js";
import { createKnowledgeShare, createShare } from "../core/share.js";
import { createSkillAssetShare } from "../core/skill-platform.js";
import { convertAsset, createAssetShare, deleteAsset, listAssets, readAsset } from "../core/assets.js";
import { getDashboard } from "../core/dashboard.js";
import { inferGitLabConfig, scanGitLab } from "../core/gitlab.js";
import { deleteCapsule, getProject, gitLabTokenConfigured, listProjects, readCapsule, readShare, saveGitLabToken, updateProjectGitLab } from "../core/store.js";

const rootDir = fileURLToPath(new URL("../..", import.meta.url));
const webDir = join(rootDir, "web");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function send(res, status, body, type = "application/json; charset=utf-8", headers = {}) {
  res.writeHead(status, { "content-type": type, ...headers });
  res.end(body);
}

function sendJson(res, value, status = 200) {
  send(res, status, JSON.stringify(value, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function serveStatic(res, pathname) {
  const file = pathname === "/" ? join(webDir, "index.html") : join(webDir, pathname);
  if (!file.startsWith(webDir) || !existsSync(file)) return false;
  send(res, 200, readFileSync(file), contentTypes[extname(file)] || "application/octet-stream", {
    "cache-control": "no-store, max-age=0"
  });
  return true;
}

function escapeHtml(value) {
  return String(value || "").replace(/[<>&"]/g, (ch) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;"
  })[ch]);
}

function sharePage(share) {
  const item = share.skill || share.knowledge || share.capsule || {};
  const body = share.skill
    ? share.skill.markdown || share.skill.content || share.skill.summary || ""
    : share.knowledge
      ? share.knowledge.markdown || share.knowledge.summary || ""
      : share.capsule?.contextPack?.recoveryPrompt || "";
  const eyebrow = share.skill
    ? "Handoff Skill Asset"
    : share.knowledge ? "Handoff Knowledge Capsule" : "Handoff Share Pack";
  const sectionTitle = share.skill
    ? "Skill Asset"
    : share.knowledge ? "Knowledge Capsule" : "Recovery Prompt";
  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>${escapeHtml(item.title)} - Handoff</title>`,
    "<link rel=\"stylesheet\" href=\"/styles.css\">",
    "</head>",
    "<body>",
    "<main class=\"share-page\">",
    "<section class=\"share-hero\">",
    `<p class=\"eyebrow\">${eyebrow}</p>`,
    `<h1>${escapeHtml(item.title)}</h1>`,
    `<p>${escapeHtml(item.summary)}</p>`,
    "</section>",
    "<section class=\"panel\">",
    `<h2>${sectionTitle}</h2>`,
    `<pre>${escapeHtml(body)}</pre>`,
    "</section>",
    "</main>",
    "</body>",
    "</html>"
  ].join("");
}

export function createHandoffServer({ workspace }) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const pathname = url.pathname;

      if (req.method === "GET" && pathname === "/api/dashboard") {
        return sendJson(res, getDashboard(workspace));
      }

      if (req.method === "GET" && pathname === "/api/settings/gitlab") {
        return sendJson(res, {
          projects: listProjects().map((project) => ({
            ...project,
            gitlab: {
              ...project.gitlab,
              detected: inferGitLabConfig(project.root)
            }
          }))
        });
      }

      if (req.method === "POST" && pathname === "/api/settings/gitlab") {
        const body = await readBody(req);
        if (body.token) saveGitLabToken(body.token);
        let project = null;
        if (body.projectId && (body.baseUrl || body.gitlabProjectId)) {
          project = updateProjectGitLab(body.projectId, {
            baseUrl: body.baseUrl,
            gitlabProjectId: body.gitlabProjectId
          });
        } else if (body.projectId) {
          project = getProject(body.projectId);
        }
        return sendJson(res, {
          tokenConfigured: gitLabTokenConfigured(),
          project
        });
      }

      if (req.method === "POST" && pathname === "/api/gitlab/scan") {
        const body = await readBody(req);
        if (!body.projectId) return sendJson(res, { error: "projectId is required" }, 400);
        const project = getProject(body.projectId);
        if (!project) return sendJson(res, { error: "project not found" }, 404);
        const state = await scanGitLab(project.root, {
          baseUrl: body.baseUrl,
          projectId: body.gitlabProjectId,
          token: body.token
        });
        return sendJson(res, state);
      }

      if (req.method === "GET" && pathname.startsWith("/api/capsules/")) {
        const id = decodeURIComponent(pathname.split("/").pop() || "");
        const capsule = readCapsule(workspace, id);
        return capsule ? sendJson(res, capsule) : sendJson(res, { error: "not found" }, 404);
      }

      if (req.method === "GET" && pathname === "/api/assets") {
        return sendJson(res, listAssets(workspace, {
          scope: url.searchParams.get("scope") || "project",
          type: url.searchParams.get("type") || "",
          assetType: url.searchParams.get("assetType") || "",
          status: url.searchParams.get("status") || "",
          limit: url.searchParams.get("limit") || 100
        }));
      }

      if (req.method === "DELETE" && pathname.startsWith("/api/assets/")) {
        const id = decodeURIComponent(pathname.split("/").pop() || "");
        const result = deleteAsset(workspace, id);
        return result.deleted ? sendJson(res, result) : sendJson(res, { error: "not found" }, 404);
      }

      if (req.method === "GET" && pathname.startsWith("/api/assets/")) {
        const id = decodeURIComponent(pathname.split("/").pop() || "");
        const asset = readAsset(workspace, id);
        return asset ? sendJson(res, asset) : sendJson(res, { error: "not found" }, 404);
      }

      if (req.method === "POST" && pathname.startsWith("/api/assets/") && pathname.endsWith("/convert")) {
        const parts = pathname.split("/");
        const id = decodeURIComponent(parts[3] || "");
        const body = await readBody(req);
        if (!body.target) return sendJson(res, { error: "target is required" }, 400);
        const result = convertAsset(workspace, id, body.target, body);
        return sendJson(res, result, 201);
      }

      if (req.method === "DELETE" && pathname.startsWith("/api/capsules/")) {
        const id = decodeURIComponent(pathname.split("/").pop() || "");
        const result = deleteCapsule(workspace, id);
        return result.deleted ? sendJson(res, result) : sendJson(res, { error: "not found" }, 404);
      }

      if (req.method === "GET" && pathname.startsWith("/api/share/")) {
        const token = decodeURIComponent(pathname.split("/").pop() || "");
        const share = readShare(workspace, token);
        return share ? sendJson(res, share) : sendJson(res, { error: "not found" }, 404);
      }

      if (req.method === "POST" && pathname === "/api/capture") {
        const body = await readBody(req);
        const result = createCapsule({
          cwd: workspace,
          title: body.title,
          input: body.input,
          source: body.source || "web",
          chatName: body.chatName,
          sessionId: body.sessionId,
          projectId: body.projectId
        });
        return sendJson(res, result.capsule, 201);
      }

      if (req.method === "POST" && pathname === "/api/share") {
        const body = await readBody(req);
        const share = body.assetId
          ? createAssetShare(workspace, body.assetId, body)
          : body.skillId
          ? createSkillAssetShare(workspace, body.skillId, body)
          : body.knowledgeId
          ? createKnowledgeShare(workspace, body.knowledgeId, body)
          : createShare(workspace, body.capsuleId, body);
        return sendJson(res, share, 201);
      }

      if (req.method === "GET" && pathname.startsWith("/s/")) {
        const token = decodeURIComponent(pathname.split("/").pop() || "");
        const share = readShare(workspace, token);
        return share ? send(res, 200, sharePage(share), "text/html; charset=utf-8") : sendJson(res, { error: "not found" }, 404);
      }

      if (req.method === "GET" && serveStatic(res, pathname)) return;

      sendJson(res, { error: "not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, { error: message }, 500);
    }
  });
}

export async function startServer({ host = "127.0.0.1", port = 7349, workspace = process.cwd() } = {}) {
  const server = createHandoffServer({ workspace });
  await new Promise((resolve) => server.listen(port, host, resolve));
  process.stdout.write(`Handoff dashboard: http://${host}:${port}\n`);
  process.stdout.write(`Workspace: ${workspace}\n`);
  return server;
}
