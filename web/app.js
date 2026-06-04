const state = {
  dashboard: null,
  selectedCapsule: null,
  query: "",
  project: "all",
  assetTab: "capsule",
  sideOpen: false
};

const fallbackFiles = ["raw.json", "transcript.md", "context-pack.md", "gitlab-links.json"];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function percent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function compact(value, max = 90) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function normalizeStatus(value) {
  return String(value || "unknown").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
}

function statusLabel(value) {
  const labels = {
    active: "活跃",
    approved: "已审核",
    available: "可用",
    draft: "草稿",
    in_progress: "进行中",
    opened: "已打开",
    published: "已发布",
    rejected: "已驳回",
    submitted: "待审核",
    failed: "失败",
    success: "通过",
    running: "运行中",
    merged: "已合并",
    can_be_merged: "可合并",
    no_pipeline: "无 CI",
    unknown: "未知"
  };
  return labels[value] || labels[normalizeStatus(value)] || String(value || "未知");
}

function badge(value, label = statusLabel(value)) {
  return el("span", `badge ${normalizeStatus(value)}`, label);
}

function gitRequirementRepo(capsule) {
  return capsule.git?.requirement?.repos?.[0] || null;
}

function gitStatusValue(value) {
  if (value === "yes") return "已提交";
  if (value === "no") return "未提交";
  return "提交未知";
}

function pushStatusValue(value) {
  if (value === "yes") return "已推送";
  if (value === "no") return "未推送";
  return "推送未知";
}

function gitRequirementText(requirement) {
  const repo = requirement?.repos?.[0];
  if (!repo) {
    return [
      "Git requirement status:",
      "Scope: unknown",
      "Branch: none",
      "Committed to Git: unknown",
      "Pushed to remote: unknown"
    ].join("\n");
  }
  return [
    "Git requirement status:",
    `Repo: ${repo.root || "unknown"}`,
    `Branch: ${repo.branch || "none"}`,
    `Upstream: ${repo.upstream || "none"}`,
    `Scope files: ${repo.scopeFiles?.length ? repo.scopeFiles.join(", ") : "unknown"}`,
    `Committed to Git: ${repo.committed || "unknown"}`,
    `Pushed to remote: ${repo.pushed || "unknown"}`,
    `Dirty scoped files: ${repo.dirtyFiles?.length ? repo.dirtyFiles.join(", ") : "none"}`,
    `Latest scoped commit: ${repo.latestCommit?.sha ? `${repo.latestCommit.sha.slice(0, 12)} ${repo.latestCommit.subject || ""}`.trim() : "none"}`,
    `Unpushed scoped commits: ${repo.unpushedCommits?.length ? repo.unpushedCommits.map((commit) => `${commit.sha.slice(0, 12)} ${commit.subject || ""}`.trim()).join("; ") : "none"}`
  ].join("\n");
}

function progressBar(value) {
  const wrap = el("div", "progress");
  const fill = el("span");
  fill.style.width = `${percent(value)}%`;
  wrap.append(fill);
  return wrap;
}

function allCapsules(projects) {
  return projects.flatMap((project) =>
    project.capsules.map((capsule) => ({
      ...capsule,
      projectName: project.name,
      projectRoot: project.root
    }))
  );
}

function allAssets(projects) {
  return projects.flatMap((project) =>
    (project.assets || []).map((asset) => ({
      ...asset,
      projectName: project.name,
      projectRoot: project.root
    }))
  );
}

function allMrs(projects) {
  return projects.flatMap((project) =>
    (project.gitlab.activeMergeRequests?.length ? project.gitlab.activeMergeRequests : project.gitlab.mergeRequests || []).map((mr) => ({
      ...mr,
      projectName: project.name,
      currentBranch: project.gitlab.currentBranch || project.git.branch || ""
    }))
  );
}

function allAttention(projects) {
  return projects.flatMap((project) =>
    (project.attention || []).map((item) => ({
      ...item,
      projectName: project.name
    }))
  );
}

function filteredProjects() {
  if (!state.dashboard) return [];
  const query = state.query.toLowerCase();
  return state.dashboard.projects.filter((project) => {
    const projectMatch = state.project === "all" || project.id === state.project;
    const queryMatch =
      !query ||
      project.name.toLowerCase().includes(query) ||
      (project.assets || []).some((asset) => `${asset.title} ${asset.summary}`.toLowerCase().includes(query)) ||
      project.capsules.some((capsule) => `${capsule.title} ${capsule.summary}`.toLowerCase().includes(query)) ||
      (project.skillAssets || []).some((asset) => `${asset.title} ${asset.summary}`.toLowerCase().includes(query)) ||
      (project.gitlab.mergeRequests || []).some((mr) => `${mr.title} ${mr.iid}`.toLowerCase().includes(query));
    return projectMatch && queryMatch;
  });
}

function renderProjectFilter(projects) {
  const filter = document.querySelector("#project-filter");
  const current = filter.value || "all";
  filter.replaceChildren(el("option", "", "全部项目"));
  filter.firstChild.value = "all";
  for (const project of projects) {
    const option = el("option", "", project.name);
    option.value = project.id;
    filter.append(option);
  }
  filter.value = [...filter.options].some((option) => option.value === current) ? current : "all";
  state.project = filter.value;
}

function selectedProject() {
  const projects = filteredProjects();
  if (state.project !== "all") return state.dashboard.projects.find((project) => project.id === state.project) || null;
  return projects[0] || state.dashboard.projects[0] || null;
}

function renderModeStatus(projects) {
  document.querySelector(".mode-chip")?.remove();
  const project = state.project !== "all"
    ? selectedProject()
    : projects.find((item) => item.modeSession) || selectedProject();
  if (!project?.modeSession) return;
  const chip = el("div", "mode-chip");
  chip.append(
    el("span", "", "Mode"),
    el("strong", "", project.modeSession.name || project.modeSession.modeId),
    el("em", "", `${project.modeSession.loadedAssets?.length || 0} skills`)
  );
  document.querySelector(".header-left").append(chip);
}

function effectiveGitLab(project) {
  const configured = project?.gitlabConfig || project?.gitlab?.config || project?.gitlab || {};
  const detected = configured.detected || project?.gitlab?.config?.detected || null;
  const hasConfiguredProject = Boolean(configured.projectId);
  return {
    baseUrl: hasConfiguredProject ? configured.baseUrl : detected?.baseUrl || configured.baseUrl || "https://gitlab.com",
    projectId: configured.projectId || detected?.projectId || "",
    detected,
    tokenConfigured: Boolean(configured.tokenConfigured)
  };
}

function fillSettingsForm(projectId = selectedProject()?.id) {
  const select = document.querySelector("#settings-project");
  select.replaceChildren();
  for (const project of state.dashboard.projects) {
    const option = el("option", "", project.name);
    option.value = project.id;
    select.append(option);
  }
  select.value = projectId || state.dashboard.projects[0]?.id || "";
  const project = state.dashboard.projects.find((item) => item.id === select.value);
  const gitlab = effectiveGitLab(project);
  document.querySelector("#settings-detected-title").textContent = gitlab.projectId
    ? `${gitlab.baseUrl} / ${gitlab.projectId}`
    : "未识别";
  document.querySelector("#settings-detected").textContent = gitlab.detected
    ? "来自本地 origin remote，保存 token 后即可扫描当前用户创建的 MR。"
    : "未从 origin remote 识别到 GitLab 项目。";
  document.querySelector("#settings-token").value = "";
  document.querySelector("#settings-token-state").textContent = gitlab.tokenConfigured
    ? "已保存 token。留空保存会保留当前 token，填入新 token 会覆盖。"
    : "尚未保存 token。私有项目需要填入 GitLab Personal Access Token。";
  document.querySelector("#settings-message").textContent = "";
}

function openSettingsDialog() {
  fillSettingsForm();
  document.querySelector("#settings-dialog").showModal();
}

async function saveGitLabSettings() {
  const token = document.querySelector("#settings-token").value.trim();
  const payload = {
    projectId: document.querySelector("#settings-project").value
  };
  if (token) payload.token = token;
  const response = await fetch("/api/settings/gitlab", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "GitLab 设置保存失败");
  await loadDashboard();
  fillSettingsForm(payload.projectId);
  document.querySelector("#settings-message").textContent = "GitLab 设置已保存。";
  return payload.projectId;
}

async function scanGitLab(projectId = selectedProject()?.id) {
  if (!projectId) return;
  const response = await fetch("/api/gitlab/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "GitLab 扫描失败");
  await loadDashboard();
}

async function runSettingsAction(action) {
  const message = document.querySelector("#settings-message");
  try {
    message.textContent = action === "scan" ? "正在保存并扫描..." : "正在保存...";
    const projectId = await saveGitLabSettings();
    if (action === "scan") {
      await scanGitLab(projectId);
      fillSettingsForm(projectId);
      message.textContent = "GitLab 扫描完成。";
    }
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : String(error);
  }
}

function renderAttention(projects) {
  const items = allAttention(projects);
  const list = document.querySelector("#attention-list");
  document.querySelector("#attention-count").textContent = `${items.length} 项`;
  if (!items.length) {
    list.replaceChildren(
      emptyState("当前没有待处理提醒", "MR、CI、交接确认和本地变更会在扫描后进入这里。")
    );
    return;
  }

  list.replaceChildren(
    ...items.map((item) => {
      const node = el("article", `attention-card ${item.level || "low"}`);
      const head = el("div", "attention-head");
      head.append(el("span", "severity", item.level === "high" ? "高" : item.level === "medium" ? "中" : "低"), el("strong", "", item.title));
      node.append(head, el("p", "", item.detail || item.projectName), attentionMeta(item), attentionAction(item));
      return node;
    })
  );
}

function renderSideRail(projects) {
  document.querySelector("#rail-gitlab-count").textContent = String(allMrs(projects).length);
  document.querySelector("#rail-attention-count").textContent = String(allAttention(projects).length);
}

function applySideState() {
  const grid = document.querySelector("#content-grid");
  const toggle = document.querySelector("#side-toggle");
  grid.classList.toggle("side-expanded", state.sideOpen);
  grid.classList.toggle("side-collapsed", !state.sideOpen);
  toggle.textContent = state.sideOpen ? "收起" : "";
  toggle.setAttribute("aria-expanded", String(state.sideOpen));
  toggle.setAttribute("aria-label", state.sideOpen ? "收起侧栏" : "展开侧栏");
}

function openSidePanel(targetId) {
  state.sideOpen = true;
  applySideState();
  if (targetId) document.querySelector(`#${targetId}`)?.scrollIntoView({ block: "nearest" });
}

function attentionMeta(item) {
  const meta = el("div", "attention-meta");
  meta.append(el("span", "", item.projectName || "项目"), el("span", "", item.kind || "task"));
  return meta;
}

function attentionAction(item) {
  if (!item.ref || !/^https?:/.test(item.ref)) return el("button", "mini-button", "查看");
  const link = el("a", "mini-button", "打开");
  link.href = item.ref;
  link.target = "_blank";
  link.rel = "noreferrer";
  return link;
}

function assetTypeLabel(asset) {
  if (asset.type === "capsule") return "Capsule";
  if (asset.type === "knowledge") return "Knowledge";
  if (asset.type === "skill") return asset.assetType ? `Skill / ${asset.assetType}` : "Skill";
  if (asset.type === "session") return "Session";
  return asset.type || "Asset";
}

function formatUpdated(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "-";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function assetImportTitle(asset) {
  if (asset.type === "capsule") return "接续完整会话";
  if (asset.type === "knowledge") return "导入项目知识";
  if (asset.type === "skill") return "导入团队 Skill";
  if (asset.type === "session") return "导入活跃 Session";
  return "导入资产上下文";
}

function skillImportText(asset) {
  const payload = asset.payload || {};
  return [
    `# Handoff Skill Import: ${asset.title}`,
    "",
    `Asset: ${asset.id}`,
    `Type: ${asset.assetType || payload.type || "skill"}`,
    `Status: ${asset.status}`,
    `Load State: active`,
    "",
    "请把以下内容作为当前 AI 对话的可用 Skill 或经验上下文：",
    "",
    payload.content || payload.markdown || asset.summary || ""
  ].join("\n");
}

function assetImportText(asset) {
  const payload = asset.payload || {};
  if (asset.type === "capsule") return payload.contextPack?.recoveryPrompt || "暂无恢复提示词。";
  if (asset.type === "knowledge") {
    return [
      `# Handoff Knowledge Import: ${asset.title}`,
      "",
      `Knowledge: ${asset.id}`,
      `Source Capsule: ${payload.capsuleId || asset.source?.id || ""}`,
      "",
      "请把以下内容作为当前 AI 对话的项目知识上下文：",
      "",
      payload.markdown || asset.summary || ""
    ].join("\n");
  }
  if (asset.type === "skill") {
    return skillImportText(asset);
  }
  if (asset.type === "session") {
    const messages = payload.recentMessages || [];
    return [
      `# Handoff Active Session Import: ${asset.title}`,
      "",
      `Session: ${payload.sessionId || asset.id}`,
      `Source: ${asset.storage || ""}`,
      `Updated: ${asset.updatedAt || ""}`,
      "",
      "请把以下内容作为当前 AI 对话的参考上下文：",
      "",
      asset.summary || "",
      "",
      "## Recent Messages",
      "",
      ...(messages.length ? messages.map((message) => `- ${message.role}: ${message.text}`) : ["- 暂无最近消息摘要。"])
    ].join("\n");
  }
  return asset.summary || "";
}

function assetFiles(asset) {
  const payload = asset.payload || {};
  if (asset.type === "capsule") return payload.contextPack?.files || [];
  if (asset.type === "knowledge") return payload.files || [];
  if (asset.type === "session") return [asset.storage || payload.storage || ""].filter(Boolean);
  return [];
}

async function shareAsset(asset) {
  const response = await fetch("/api/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      assetId: asset.id,
      visibility: asset.type === "capsule" ? "private" : "team"
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "分享失败");
  const base = window.location.origin;
  return [
    `token=${data.token}`,
    `url=${base}/s/${data.token}`,
    `api=${base}/api/share/${data.token}`
  ].join("\n");
}

async function convertAsset(asset, target) {
  const response = await fetch(`/api/assets/${encodeURIComponent(asset.id)}/convert`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "转换失败");
  await loadDashboard();
  return data;
}

async function loadAsset(asset) {
  const response = await fetch(`/api/assets/${encodeURIComponent(asset.id)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "资产读取失败");
  return data;
}

async function openAssetContext(asset) {
  try {
    const fullAsset = await loadAsset(asset);
    openContextDialog({
      kicker: assetTypeLabel(fullAsset),
      title: assetImportTitle(fullAsset),
      text: assetImportText(fullAsset),
      files: assetFiles(fullAsset)
    });
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
}

function removeAssetFromDashboard(assetId) {
  if (!state.dashboard) return;
  const removeFromList = (items = []) => items.filter((item) => item.id !== assetId);
  state.dashboard.projects = state.dashboard.projects.map((project) => ({
    ...project,
    assets: removeFromList(project.assets),
    capsules: removeFromList(project.capsules),
    skillAssets: removeFromList(project.skillAssets)
  }));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function deleteAsset(asset, button) {
  try {
    button.disabled = true;
    button.textContent = "删除中";
    const response = await fetchWithTimeout(`/api/assets/${encodeURIComponent(asset.id)}`, {
      method: "DELETE"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 404) throw new Error(data.error || "删除失败");
    removeAssetFromDashboard(asset.id);
    renderAll();
    loadDashboard().catch((error) => window.alert(error instanceof Error ? error.message : String(error)));
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  } finally {
    button.disabled = false;
    button.textContent = "删除";
  }
}

function conversionButtons(asset) {
  const buttons = [];
  const addButton = (label, target) => {
    const button = el("button", "row-action", label);
    button.type = "button";
    button.addEventListener("click", async () => {
      try {
        button.disabled = true;
        button.textContent = "转换中";
        const result = await convertAsset(asset, target);
        openContextDialog({
          kicker: "Convert",
          title: "资产转换完成",
          text: [
            `source=${result.source?.id || asset.id}`,
            `target=${result.target?.id || ""}`,
            `type=${result.target?.type || target}`,
            `title=${result.target?.title || ""}`
          ].join("\n"),
          files: [result.target?.id || ""]
        });
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    });
    buttons.push(button);
  };

  if (asset.type === "capsule") {
    addButton("转知识", "knowledge");
    addButton("转 Skill", "skill");
  }
  if (asset.type === "knowledge") {
    addButton("转 Skill", "skill");
  }
  if (asset.type === "session") {
    addButton("转 Capsule", "capsule");
    addButton("转知识", "knowledge");
    addButton("转 Skill", "skill");
  }
  return buttons;
}

const assetGroups = [
  {
    type: "capsule",
    kicker: "Capsule",
    title: "会话 Capsule",
    description: "已保存的 AI 对话资产，适合跨会话接续、分享和转换。",
    emptyTitle: "暂无会话 Capsule",
    emptyDetail: "当前筛选范围内没有会话资产。"
  },
  {
    type: "knowledge",
    kicker: "Knowledge",
    title: "知识胶囊",
    description: "从高质量对话中抽取的项目知识，适合导入到同项目会话。",
    emptyTitle: "暂无知识胶囊",
    emptyDetail: "当前筛选范围内没有知识资产。"
  },
  {
    type: "skill",
    kicker: "Skill",
    title: "团队 Skill",
    description: "经过审核后可供团队复用的经验、流程和操作能力。",
    emptyTitle: "暂无团队 Skill",
    emptyDetail: "当前筛选范围内没有 Skill 资产。"
  },
  {
    type: "session",
    kicker: "Session",
    title: "24h 活跃 Session",
    description: "最近 24 小时内的 Claude Code 会话，尚未保存为资产也会展示。",
    emptyTitle: "暂无活跃 Session",
    emptyDetail: "最近 24 小时内没有发现 Claude Code 会话。"
  }
];

function assetMetaItems(asset) {
  const items = [asset.projectName, asset.scope || "project"];
  if (asset.source?.type || asset.source?.app) items.push(asset.source.type || asset.source.app);
  if (asset.type === "skill" && asset.assetType) items.push(asset.assetType);
  if (asset.type === "session" && asset.payload?.messageCount) items.push(`${asset.payload.messageCount} messages`);
  if (asset.type === "capsule") {
    const repo = gitRequirementRepo(asset.payload || {});
    if (repo?.branch) items.push(repo.branch);
    if (repo) {
      items.push(gitStatusValue(repo.committed));
      items.push(pushStatusValue(repo.pushed));
    }
  }
  return items.filter(Boolean);
}

function assetProgress(asset) {
  const cell = el("div", "asset-progress-cell");
  if (asset.type !== "capsule") {
    if (asset.type === "session") {
      cell.append(el("span", "dash", "24h"));
      return cell;
    }
    cell.append(el("span", "dash", "-"));
    return cell;
  }
  const row = el("div", "asset-progress");
  row.append(progressBar(asset.payload?.progress?.percent || 0), el("span", "", `${percent(asset.payload?.progress?.percent)}%`));
  cell.append(row);
  return cell;
}

function rowAction(label, className = "") {
  const button = el("button", `row-action ${className}`.trim(), label);
  button.type = "button";
  return button;
}

function deleteAssetButton(asset) {
  const button = rowAction("删除", "danger");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    deleteAsset(asset, button);
  });
  return button;
}

function closeAllMenus(except) {
  document.querySelectorAll(".action-more.open").forEach((node) => {
    if (node !== except) node.classList.remove("open");
  });
}

function menuItem(label, handler, className = "") {
  const item = el("button", className, label);
  item.type = "button";
  item.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeAllMenus();
    handler(item);
  });
  return item;
}

async function shareAssetAction(asset) {
  try {
    const text = await shareAsset(asset);
    openContextDialog({ kicker: "Share", title: "分享资产", text, files: [asset.id] });
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
}

function buildOverflowMenu(asset) {
  const wrap = el("div", "action-more");
  const trigger = el("button", "action-more-btn", "⋯");
  trigger.type = "button";
  trigger.setAttribute("aria-label", "更多操作");
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const willOpen = !wrap.classList.contains("open");
    closeAllMenus(wrap);
    wrap.classList.toggle("open", willOpen);
  });

  const menu = el("div", "action-menu");
  menu.append(menuItem("分享", () => shareAssetAction(asset)));

  // Conversions become menu rows.
  for (const button of conversionButtons(asset)) {
    const label = button.textContent;
    menu.append(menuItem(label, () => button.click()));
  }

  if (asset.type === "capsule") {
    menu.append(menuItem("接续", async () => {
      try {
        const fullAsset = await loadAsset(asset);
        openAttachDialog(fullAsset.payload || {});
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      }
    }));
  }

  if (["capsule", "knowledge", "skill"].includes(asset.type)) {
    menu.append(el("div", "menu-sep"));
    const del = deleteAssetButton(asset);
    del.classList.remove("row-action", "danger");
    del.classList.add("danger");
    menu.append(del);
  }

  wrap.append(trigger, menu);
  return wrap;
}

function assetActions(asset) {
  const actions = el("div", "asset-actions");
  const importButton = rowAction("导入", "primary");
  importButton.addEventListener("click", () => openAssetContext(asset));
  actions.append(importButton);

  if (asset.type === "skill" && !["approved", "published"].includes(asset.status)) {
    actions.append(el("span", "row-flag", "需审核"));
  }

  actions.append(buildOverflowMenu(asset));
  return actions;
}

function assetTags(asset) {
  const tags = assetMetaItems(asset);
  const visible = tags.slice(0, 2);
  const rest = tags.length - visible.length;
  const node = el("div", "asset-tags");
  node.replaceChildren(...visible.map((item) => el("span", "", item)));
  if (rest > 0) node.append(el("span", "", `+${rest}`));
  return node;
}

function renderAssetCard(asset) {
  const row = el("article", `asset-row ${asset.type}-asset`);
  const main = el("div", "asset-main");
  main.append(el("strong", "", asset.title), el("p", "", compact(asset.summary || "暂无摘要", 120)));
  row.append(
    main,
    assetTags(asset),
    badge(asset.status || "available"),
    el("time", "asset-time", formatUpdated(asset.updatedAt || asset.createdAt)),
    assetProgress(asset),
    assetActions(asset)
  );
  row.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    if (event.target.closest("a")) return;
    openAssetContext(asset);
  });
  return row;
}

function renderAssetSection(group, assets) {
  const section = el("section", `asset-section ${group.type}-section`);
  const tableHeader = el("div", "asset-table-header");
  tableHeader.append(
    el("span", "", "名称与摘要"),
    el("span", "", "标签"),
    el("span", "", "审核状态"),
    el("span", "", "最近更新"),
    el("span", "", "进度"),
    el("span", "", "操作")
  );
  const list = el("div", "asset-section-list");
  list.replaceChildren(
    ...(assets.length
      ? assets.map(renderAssetCard)
      : [emptyState(group.emptyTitle, group.emptyDetail)])
  );
  const footer = el("div", "asset-section-footer");
  footer.append(el("span", "", `共 ${assets.length} 条`));
  section.append(tableHeader, list, footer);
  return section;
}

function assetCount(assets, type) {
  return assets.filter((asset) => asset.type === type).length;
}

function activeAssetGroup() {
  return assetGroups.find((group) => group.type === state.assetTab) || assetGroups[0];
}

function renderAssetTabs(assets) {
  const tabs = el("div", "asset-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.append(el("span", "asset-tabs-label", "资产类型"));
  for (const group of assetGroups) {
    const count = assetCount(assets, group.type);
    const button = el("button", `asset-tab ${state.assetTab === group.type ? "active" : ""}`);
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(state.assetTab === group.type));
    button.append(el("span", "", group.title), el("strong", "", String(count)));
    button.addEventListener("click", () => {
      state.assetTab = group.type;
      renderAssets(filteredProjects());
    });
    tabs.append(button);
  }
  return tabs;
}

function renderAssets(projects) {
  const assets = allAssets(projects);
  const list = document.querySelector("#capsule-list");
  const countNode = document.querySelector("#capsule-count");
  if (countNode) countNode.textContent = `${assets.length} 个资产`;
  if (!assets.length) {
    list.replaceChildren(emptyState("暂无 AI 资产", "使用 /handoff:capture、/handoff:knowledge-ingest 或 /handoff:skill-ingest 生成第一份资产。"));
    return;
  }

  const group = activeAssetGroup();
  const visibleAssets = assets.filter((asset) => asset.type === group.type);
  const assetHead = el("div", "asset-board-head");
  const title = el("div");
  title.append(el("span", "section-kicker", group.kicker), el("h3", "", group.title), el("p", "", group.description));
  const tools = el("div", "asset-board-tools");
  tools.append(el("span", "counter", `${assets.length} 个资产`));
  const newButton = el("button", "mini-button primary", "新建资产");
  newButton.type = "button";
  newButton.addEventListener("click", () => openContextDialog({
    kicker: "Create",
    title: "新建资产",
    text: [
      "可通过以下命令创建资产：",
      "",
      "/handoff:capture",
      "/handoff:knowledge-ingest",
      "/handoff:skill-ingest"
    ].join("\n"),
    files: []
  }));
  tools.append(newButton);
  assetHead.append(title, tools);
  list.replaceChildren(
    assetHead,
    renderAssetTabs(assets),
    renderAssetSection(group, visibleAssets)
  );
}

function renderMergeRequests(projects) {
  const mrs = allMrs(projects);
  const list = document.querySelector("#mr-list");
  document.querySelector("#gitlab-count").textContent = `${mrs.length} 个`;
  if (!mrs.length) {
    list.replaceChildren(emptyState("暂无当前分支 MR", "配置 GITLAB_TOKEN 后执行 handoff gitlab scan，右侧展示当前分支相关 MR 的文件、提交和 CI。"));
    return;
  }

  list.replaceChildren(
    ...mrs.slice(0, 5).map((mr) => {
      const link = el("a", "mr-row");
      link.href = mr.webUrl || "#";
      link.target = "_blank";
      link.rel = "noreferrer";
      const main = el("div");
      const change = mr.changes || {};
      const files = (mr.changedFiles || []).slice(0, 4).map((file) => file.path).join("、");
      const commits = mr.commits?.length || 0;
      main.append(
        el("strong", "", `!${mr.iid} ${mr.title}`),
        el("p", "", `${mr.sourceBranch || "branch"} -> ${mr.targetBranch || "target"}`),
        el("p", "mr-detail", `${change.files || 0} 文件 +${change.additions || 0} -${change.deletions || 0}，${commits} commits`),
        el("p", "mr-files", files || "暂无文件明细")
      );
      const meta = el("div", "mr-meta");
      meta.append(
        badge(mr.mergeStatus || mr.state),
        badge(mr.pipeline?.status || "no_pipeline"),
        badge(mr.draft ? "draft" : "ready", mr.draft ? "Draft" : "Ready")
      );
      link.append(main, meta);
      return link;
    })
  );
}

async function loadCapsule(id) {
  const response = await fetch(`/api/capsules/${encodeURIComponent(id)}`);
  if (!response.ok) return;
  state.selectedCapsule = await response.json();
  return state.selectedCapsule;
}

function attachText(capsule) {
  const facts = capsule.contextPack?.facts || [];
  const decisions = capsule.contextPack?.decisions || [];
  const actions = capsule.contextPack?.nextActions || [];
  return [
    `Attached capsule: ${capsule.title}`,
    `Summary: ${capsule.summary || "暂无摘要"}`,
    "",
    gitRequirementText(capsule.git?.requirement),
    "",
    "Facts:",
    ...(facts.length ? facts.map((item, index) => `${index + 1}. ${item}`) : ["暂无记录"]),
    "",
    "Decisions:",
    ...(decisions.length ? decisions.map((item, index) => `${index + 1}. ${item}`) : ["暂无记录"]),
    "",
    "Next actions:",
    ...(actions.length ? actions.map((item, index) => `${index + 1}. ${item}`) : ["暂无记录"])
  ].join("\n");
}

async function openImportDialog(id) {
  const capsule = await loadCapsule(id);
  if (!capsule) return;
  openContextDialog({
    kicker: "Import",
    title: "接续完整会话",
    text: capsule.contextPack?.recoveryPrompt || "暂无恢复提示词。",
    files: capsule.contextPack?.files
  });
}

function openAttachDialog(capsule) {
  openContextDialog({
    kicker: "Attach",
    title: "引用精简上下文",
    text: attachText(capsule),
    files: capsule.contextPack?.files
  });
}

function openContextDialog({ kicker, title, text, files }) {
  document.querySelector("#dialog-kicker").textContent = kicker;
  document.querySelector("#dialog-title").textContent = title;
  document.querySelector("#context-preview").textContent = text;
  renderFileChips(files);
  document.querySelector("#context-dialog").showModal();
}

function renderFileChips(files = fallbackFiles) {
  const chips = document.querySelector("#file-chips");
  const values = files?.length ? files : fallbackFiles;
  chips.replaceChildren(...values.slice(0, 8).map((file) => el("span", "file-chip", file)));
}

function emptyState(title, detail) {
  const node = el("div", "empty-state");
  node.append(el("strong", "", title), el("p", "", detail));
  return node;
}

async function loadDashboard() {
  const response = await fetch("/api/dashboard");
  state.dashboard = await response.json();
  renderProjectFilter(state.dashboard.projects);
  renderAll();
}

function renderAll() {
  const projects = filteredProjects();
  renderModeStatus(projects);
  renderSideRail(projects);
  renderAttention(projects);
  renderAssets(projects);
  renderMergeRequests(projects);
  applySideState();
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".action-more")) closeAllMenus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllMenus();
});
document.querySelector("#refresh").addEventListener("click", loadDashboard);
document.querySelector("#settings").addEventListener("click", openSettingsDialog);
document.querySelector("#side-toggle").addEventListener("click", () => {
  state.sideOpen = !state.sideOpen;
  applySideState();
});
document.querySelectorAll(".rail-item").forEach((button) => {
  button.addEventListener("click", () => {
    const panel = button.dataset.panel === "attention" ? "attention" : "gitlab";
    openSidePanel(panel);
  });
});
document.querySelector("#scan-gitlab").addEventListener("click", async () => {
  const button = document.querySelector("#scan-gitlab");
  const project = selectedProject();
  if (!project) return;
  try {
    button.textContent = "扫描中";
    button.disabled = true;
    await scanGitLab(project.id);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  } finally {
    button.textContent = "扫描";
    button.disabled = false;
  }
});
document.querySelector("#search").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderAll();
});
document.querySelector("#project-filter").addEventListener("change", (event) => {
  state.project = event.target.value;
  renderAll();
});
document.querySelector("#copy-context").addEventListener("click", async () => {
  const text = document.querySelector("#context-preview").textContent;
  await navigator.clipboard.writeText(text);
});
document.querySelector("#close-context").addEventListener("click", () => {
  document.querySelector("#context-dialog").close();
});
document.querySelector("#context-dialog").addEventListener("click", (event) => {
  if (event.target.id === "context-dialog") event.target.close();
});
document.querySelector("#settings-project").addEventListener("change", (event) => fillSettingsForm(event.target.value));
document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await runSettingsAction("save");
});
document.querySelector("#scan-settings").addEventListener("click", async () => runSettingsAction("scan"));
document.querySelector("#close-settings").addEventListener("click", () => {
  document.querySelector("#settings-dialog").close();
});
document.querySelector("#settings-dialog").addEventListener("click", (event) => {
  if (event.target.id === "settings-dialog") event.target.close();
});

loadDashboard();
