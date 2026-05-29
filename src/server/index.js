import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCapsule } from "../core/capsule.js";
import { createShare } from "../core/share.js";
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

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type });
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
  send(res, 200, readFileSync(file), contentTypes[extname(file)] || "application/octet-stream");
  return true;
}

function sharePage(share) {
  const capsule = share.capsule;
  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>${capsule.title} - Handoff</title>`,
    "<link rel=\"stylesheet\" href=\"/styles.css\">",
    "</head>",
    "<body>",
    "<main class=\"share-page\">",
    "<section class=\"share-hero\">",
    "<p class=\"eyebrow\">Handoff Share Pack</p>",
    `<h1>${capsule.title}</h1>`,
    `<p>${capsule.summary}</p>`,
    "</section>",
    "<section class=\"panel\">",
    "<h2>Recovery Prompt</h2>",
    `<pre>${capsule.contextPack.recoveryPrompt.replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[ch])}</pre>`,
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
        const share = createShare(workspace, body.capsuleId, body);
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
