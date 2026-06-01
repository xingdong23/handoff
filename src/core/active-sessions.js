import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { compact, slugify } from "./utils.js";

const DEFAULT_HOURS = 24;
const MAX_TAIL_BYTES = 512 * 1024;

function hashText(value, length = 16) {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, length);
}

function walkJsonlFiles(root, options = {}) {
  if (!existsSync(root)) return [];
  const includeSubagents = Boolean(options.includeSubagents);
  const files = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!includeSubagents && entry.name === "subagents") continue;
        stack.push(path);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  }

  return files;
}

function readTail(path, maxBytes = MAX_TAIL_BYTES) {
  const buffer = readFileSync(path);
  if (buffer.length <= maxBytes) return buffer.toString("utf8");
  return buffer.subarray(buffer.length - maxBytes).toString("utf8");
}

function parseJsonl(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        if (item.type === "text") return item.text || "";
        if (item.type === "tool_use") return item.name ? `[tool:${item.name}]` : "[tool]";
        if (item.type === "tool_result") return typeof item.content === "string" ? compact(item.content, 180) : "";
        return typeof item.text === "string" ? item.text : "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (content && typeof content === "object") return content.text || content.content || "";
  return "";
}

function recordRole(record) {
  return record?.message?.role || record?.role || record?.type || "";
}

function recordText(record) {
  if (!record || record.isMeta || record.type === "system") return "";
  const content = record.message?.content ?? record.content ?? record.summary;
  return compact(textFromContent(content), 420);
}

function isToolResultOnly(record) {
  const content = record?.message?.content;
  return Array.isArray(content) && content.length > 0 && content.every((item) => item?.type === "tool_result");
}

function isLowSignalText(text) {
  const value = String(text || "").trim();
  return value.startsWith("<command-message>") ||
    value.startsWith("<local-command-") ||
    value.startsWith("[tool:");
}

function isLowSignalTitle(text) {
  const value = String(text || "").replace(/\s+/g, "").replace(/[。.!！?？,，]/g, "").trim();
  return /^(好的|可以|继续|改吧|修改吧|提交|push|安装|删除了吧|刷新|好的改吧|可以这么干吧)$/.test(value);
}

function recordTimestamp(record) {
  const value = record?.timestamp || record?.message?.timestamp || record?.createdAt || record?.created_at || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function recordCwd(record) {
  return record?.cwd || record?.workspace?.root || record?.project?.root || record?.message?.cwd || "";
}

function recordSessionId(record, fallback) {
  return record?.sessionId || record?.session_id || record?.message?.sessionId || fallback;
}

function projectNameFromFile(file, cwd) {
  if (cwd) return basename(cwd);
  const encoded = basename(dirname(file));
  const decoded = encoded.startsWith("-") ? encoded.slice(1).replaceAll("-", sep) : encoded;
  return basename(decoded) || encoded || "Claude Code";
}

function lastValue(records, getter) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const value = getter(records[index]);
    if (value) return value;
  }
  return "";
}

function messageEntries(records) {
  return records
    .map((record) => {
      if (isToolResultOnly(record)) return null;
      const text = recordText(record);
      if (!text || isLowSignalText(text)) return null;
      const role = recordRole(record);
      return {
        role,
        text,
        timestamp: recordTimestamp(record)
      };
    })
    .filter(Boolean);
}

function titleFromMessages(messages, fallback) {
  const userMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user" && !isLowSignalTitle(message.text));
  return compact(userMessage?.text || messages.at(-1)?.text || fallback, 72);
}

function summaryFromMessages(messages) {
  return messages
    .slice(-4)
    .map((message) => {
      const prefix = message.role === "assistant" ? "Assistant" : message.role === "user" ? "User" : "Event";
      return `${prefix}: ${message.text}`;
    })
    .join("\n");
}

function sessionFromFile(file, sinceMs, options = {}) {
  const stat = statSync(file);
  if (!stat.isFile()) return null;

  const records = parseJsonl(readTail(file, options.maxTailBytes || MAX_TAIL_BYTES));
  const timestamps = records.map(recordTimestamp).filter(Boolean);
  const updatedAtMs = timestamps.length ? Math.max(...timestamps) : stat.mtimeMs;
  if (updatedAtMs < sinceMs) return null;

  const sessionId = lastValue(records, (record) => recordSessionId(record, basename(file, ".jsonl"))) || basename(file, ".jsonl");
  const cwd = lastValue(records, recordCwd);
  const projectName = projectNameFromFile(file, cwd);
  const messages = messageEntries(records);
  const title = titleFromMessages(messages, basename(file, ".jsonl"));
  const summary = summaryFromMessages(messages) || "最近 24 小时内存在 Claude Code 会话活动。";
  const createdAtMs = timestamps.length ? Math.min(...timestamps) : stat.birthtimeMs || updatedAtMs;

  return {
    id: `session_${hashText(`${file}:${sessionId}`)}`,
    type: "session",
    scope: "personal",
    status: "active",
    title,
    summary,
    source: {
      app: "claude-code",
      type: "local-session",
      storage: file
    },
    project: {
      id: slugify(projectName),
      name: projectName,
      root: cwd
    },
    storage: file,
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date(updatedAtMs).toISOString(),
    payload: {
      sessionId,
      messageCount: messages.length,
      cwd,
      storage: file,
      recentMessages: messages.slice(-8)
    }
  };
}

export function listActiveSessions(_cwd = process.cwd(), options = {}) {
  const nowMs = options.now ? new Date(options.now).getTime() : Date.now();
  const hours = Number(options.hours || DEFAULT_HOURS);
  const sinceMs = nowMs - Math.max(1, hours) * 60 * 60 * 1000;
  const claudeHome = options.claudeHome || process.env.HANDOFF_CLAUDE_HOME || process.env.CLAUDE_HOME || join(homedir(), ".claude");
  const projectsDir = options.projectsDir || join(claudeHome, "projects");

  return walkJsonlFiles(projectsDir, options)
    .map((file) => {
      try {
        return sessionFromFile(file, sinceMs, options);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, Math.max(1, Math.min(Number(options.limit || 50), 200)));
}

export function readActiveSession(cwd = process.cwd(), ref, options = {}) {
  const id = String(ref || "");
  if (!id) return null;
  return listActiveSessions(cwd, options).find((session) => session.id === id || session.payload?.sessionId === id) || null;
}

export function sessionImportText(session) {
  const messages = session?.payload?.recentMessages || [];
  return [
    `# Handoff Active Session Import: ${session?.title || "Claude Code Session"}`,
    "",
    `Session: ${session?.payload?.sessionId || session?.id || ""}`,
    `Source: ${session?.source?.storage || ""}`,
    `Updated: ${session?.updatedAt || ""}`,
    "",
    "请把以下内容作为当前 AI 对话的参考上下文：",
    "",
    session?.summary || "",
    "",
    "## Recent Messages",
    "",
    ...(messages.length ? messages.map((message) => `- ${message.role}: ${message.text}`) : ["- 暂无最近消息摘要。"])
  ].join("\n");
}
