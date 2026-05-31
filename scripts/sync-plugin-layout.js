#!/usr/bin/env node

import { lstat, mkdir, readlink, readdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let changed = 0;

async function ensureSymlink(linkRel, targetRel, type) {
  const link = path.join(root, linkRel);
  await mkdir(path.dirname(link), { recursive: true });

  try {
    const stat = await lstat(link);
    if (!stat.isSymbolicLink()) {
      throw new Error(`${linkRel} exists and is not a symlink`);
    }

    const current = await readlink(link);
    if (current === targetRel) {
      return;
    }

    await rm(link);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  await symlink(targetRel, link, type);
  changed += 1;
}

async function main() {
  const commandSource = "plugins/vertical-plugins/handoff-core/commands/handoff";
  const commandFiles = (await readdir(path.join(root, commandSource)))
    .filter((name) => name.endsWith(".md"))
    .sort();

  await ensureSymlink("commands/handoff", "../plugins/vertical-plugins/handoff-core/commands/handoff", "dir");
  await ensureSymlink("plugins/handoff", "agent-plugins/handoff", "dir");
  await ensureSymlink(
    "plugins/agent-plugins/handoff/.claude-plugin/plugin.json",
    "../../../../.claude-plugin/plugin.json",
    "file"
  );
  await ensureSymlink("plugins/agent-plugins/handoff/bin/handoff", "../../../../bin/handoff", "file");
  await ensureSymlink("plugins/agent-plugins/handoff/bin/handoff.js", "../../../../bin/handoff.js", "file");
  await ensureSymlink("plugins/agent-plugins/handoff/package.json", "../../../package.json", "file");
  await ensureSymlink("plugins/agent-plugins/handoff/src", "../../../src", "dir");
  await ensureSymlink("plugins/agent-plugins/handoff/web", "../../../web", "dir");
  await ensureSymlink(
    "plugins/agent-plugins/handoff/skills/handoff-capsule",
    "../../../vertical-plugins/handoff-core/skills/handoff-capsule",
    "dir"
  );

  for (const fileName of commandFiles) {
    await ensureSymlink(
      `plugins/agent-plugins/handoff/commands/${fileName}`,
      `../../../vertical-plugins/handoff-core/commands/handoff/${fileName}`,
      "file"
    );
  }

  console.log(`plugin layout synchronized${changed ? `: ${changed} link(s) updated` : ""}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
