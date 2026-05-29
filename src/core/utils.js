import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(value) {
  return String(value || "capsule")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s._-]/gu, "")
    .trim()
    .replace(/[\s_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 80) || "capsule";
}

export function capsuleId(title, date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `cap_${stamp}_${slugify(title)}`;
}

export function randomToken(bytes = 16) {
  return randomBytes(bytes).toString("hex");
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readJson(path, fallback = undefined) {
  if (!existsSync(path)) return fallback;
  try {
    if (!statSync(path).isFile()) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeText(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

export function readText(path, fallback = "") {
  if (!existsSync(path)) return fallback;
  return readFileSync(path, "utf8");
}

export function listDirectories(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .map((name) => join(path, name))
    .filter((entry) => statSync(entry).isDirectory());
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function compact(value, max = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

export function parseDurationDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

export function isInside(parent, child) {
  const normalizedParent = parent.endsWith("/") ? parent : `${parent}/`;
  return child === parent || child.startsWith(normalizedParent);
}
