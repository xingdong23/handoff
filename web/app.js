const state = {
  dashboard: null,
  selectedCapsule: null,
  query: "",
  project: "all",
  sideOpen: false
};

const fallbackFiles = ["raw.json", "transcript.md", "context-pack.md", "gitlab-links.json"];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(className) {
  return el("span", `glyph ${className}`);
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

function metric({ label, value, detail, tone, iconName }) {
  const node = el("article", `metric ${tone}`);
  const top = el("div", "metric-top");
  top.append(icon(iconName), el("span", "", label));
  node.append(top, el("strong", "", String(value)), el("small", "", detail));
  return node;
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

function renderMetrics(totals) {
  const root = document.querySelector("#overview");
  root.replaceChildren(
    metric({ label: "项目", value: totals.projects, detail: "已接入 Handoff", tone: "blue", iconName: "project" }),
    metric({ label: "需求", value: totals.requirements || 0, detail: "Requirement", tone: "slate", iconName: "project" }),
    metric({ label: "资产", value: totals.assets || 0, detail: "Capsule / Knowledge / Skill", tone: "green", iconName: "capsule" }),
    metric({ label: "进行中", value: totals.activeCapsules, detail: "可继续处理", tone: "green", iconName: "active" }),
    metric({ label: "Capsule", value: totals.capsules, detail: "会话资产", tone: "violet", iconName: "capsule" }),
    metric({ label: "未合并 MR", value: totals.openMrs, detail: "GitLab 扫描", tone: "amber", iconName: "merge" }),
    metric({ label: "CI 异常", value: totals.failedPipelines, detail: "需要处理", tone: "red", iconName: "ci" }),
    metric({ label: "提醒", value: totals.attention, detail: "关注队列", tone: "slate", iconName: "bell" })
  );
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
  toggle.textContent = state.sideOpen ? "收起" : "展开";
  toggle.setAttribute("aria-expanded", String(state.sideOpen));
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
  return asset.type || "Asset";
}

function assetImportTitle(asset) {
  if (asset.type === "capsule") return "接续完整会话";
  if (asset.type === "knowledge") return "导入项目知识";
  if (asset.type === "skill") return "导入团队 Skill";
  return "导入资产上下文";
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
    return [
      `# Handoff Skill Import: ${asset.title}`,
      "",
      `Asset: ${asset.id}`,
      `Type: ${asset.assetType || "skill"}`,
      `Status: ${asset.status}`,
      "",
      "请把以下内容作为当前 AI 对话的可用 Skill 或经验上下文：",
      "",
      payload.content || payload.markdown || asset.summary || ""
    ].join("\n");
  }
  return asset.summary || "";
}

function assetFiles(asset) {
  const payload = asset.payload || {};
  if (asset.type === "capsule") return payload.contextPack?.files || [];
  if (asset.type === "knowledge") return payload.files || [];
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

function conversionButtons(asset) {
  const buttons = [];
  const addButton = (label, target) => {
    const button = el("button", "mini-button", label);
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
  return buttons;
}

function renderAssets(projects) {
  const assets = allAssets(projects);
  const list = document.querySelector("#capsule-list");
  document.querySelector("#capsule-count").textContent = `${assets.length} 个`;
  if (!assets.length) {
    list.replaceChildren(emptyState("暂无 AI 资产", "使用 /handoff:capture、/handoff:knowledge-ingest 或 /handoff:skill-ingest 生成第一份资产。"));
    return;
  }

  list.replaceChildren(
    ...assets.map((asset) => {
      const card = el("article", "capsule-card");
      const title = el("div", "capsule-title");
      title.append(el("strong", "", asset.title), badge(asset.status || "available"));
      const summary = el("p", "", compact(asset.summary || "暂无摘要", 170));
      const meta = el("div", "capsule-meta");
      meta.append(
        el("span", "asset-type", assetTypeLabel(asset)),
        el("span", "", asset.scope || "project"),
        el("span", "", asset.projectName)
      );
      if (asset.source?.type || asset.source?.app) meta.append(el("span", "", asset.source.type || asset.source.app));
      if (asset.type === "capsule") {
        const repo = gitRequirementRepo(asset.payload || {});
        const progress = asset.payload?.progress?.percent;
        meta.append(el("span", "", `${percent(progress)}%`));
        if (repo?.branch) meta.append(el("span", "", repo.branch));
        if (repo) {
          meta.append(el("span", "", gitStatusValue(repo.committed)));
          meta.append(el("span", "", pushStatusValue(repo.pushed)));
        }
      }
      const actions = el("div", "capsule-actions");
      const importButton = el("button", "mini-button primary", "Import");
      const shareButton = el("button", "mini-button", "Share");
      importButton.addEventListener("click", () => openContextDialog({
        kicker: assetTypeLabel(asset),
        title: assetImportTitle(asset),
        text: assetImportText(asset),
        files: assetFiles(asset)
      }));
      shareButton.addEventListener("click", async () => {
        try {
          const text = await shareAsset(asset);
          openContextDialog({
            kicker: "Share",
            title: "分享资产",
            text,
            files: [asset.id]
          });
        } catch (error) {
          window.alert(error instanceof Error ? error.message : String(error));
        }
      });
      actions.append(importButton, shareButton);
      actions.append(...conversionButtons(asset));
      if (asset.type === "capsule") {
        const attachButton = el("button", "mini-button", "Attach");
        const deleteButton = el("button", "mini-button danger", "删除");
        attachButton.addEventListener("click", () => openAttachDialog(asset.payload || {}));
        deleteButton.addEventListener("click", () => deleteCapsule(asset.payload || asset));
        actions.append(attachButton, deleteButton);
      }
      if (asset.type === "skill" && !["approved", "published"].includes(asset.status)) {
        actions.append(badge("submitted", "需审核"));
      }
      card.append(title, summary);
      if (asset.type === "capsule") card.append(progressBar(asset.payload?.progress?.percent || 0));
      card.append(meta, actions);
      card.addEventListener("click", (event) => {
        if (event.target.closest("button")) return;
        openContextDialog({
          kicker: assetTypeLabel(asset),
          title: assetImportTitle(asset),
          text: assetImportText(asset),
          files: assetFiles(asset)
        });
      });
      return card;
    })
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

async function deleteCapsule(capsule) {
  if (!window.confirm(`删除 Capsule：${capsule.title}`)) return;
  const response = await fetch(`/api/capsules/${encodeURIComponent(capsule.id)}`, {
    method: "DELETE"
  });
  if (!response.ok) return;
  await loadDashboard();
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
  renderMetrics(state.dashboard.totals);
  renderSideRail(projects);
  renderAttention(projects);
  renderAssets(projects);
  renderMergeRequests(projects);
  applySideState();
}

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
