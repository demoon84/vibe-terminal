const DEFAULT_PRESET_LAYOUTS = Object.freeze({
  "1x2": { id: "1x2", columns: 2, rows: 1, panelCount: 2 },
  "1x4": { id: "1x4", columns: 2, rows: 2, panelCount: 4 },
  "2x6": { id: "2x6", columns: 3, rows: 2, panelCount: 6 },
  "2x8": { id: "2x8", columns: 4, rows: 2, panelCount: 8 },

});

const runtimeWindow = /** @type {any} */ (window);
const api = runtimeWindow.multiTerminal;
const TerminalCtor = runtimeWindow.Terminal;
const FitAddonCtor = runtimeWindow.FitAddon?.FitAddon;
const TERMINAL_SCROLLBACK = 50000;
const INITIAL_PRESET_ID = "1x2";
const CTRL_C_CONFIRM_WINDOW_MS = 1200;
const TERMINAL_FIT_DEBOUNCE_MS = 50;
const TERMINAL_SNAPSHOT_MAX_LINES = 1000;
const DEFAULT_TERMINAL_FONT_FAMILY =
  '"D2Coding", "Cascadia Mono", "Consolas", "Courier New", monospace';
const DEFAULT_TERMINAL_FONT_SIZE = 12;
const TERMINAL_FONT_SIZE_MIN = 10;
const TERMINAL_FONT_SIZE_MAX = 24;
const TERMINAL_FONT_STORAGE_KEY = "vibe-terminal.terminal-font-family";
const TERMINAL_FONT_SIZE_STORAGE_KEY = "vibe-terminal.terminal-font-size";
const AGENT_AUTO_INSTALL_SKIP_STORAGE_KEY = "vibe-terminal.agent-auto-install-skip";
const SKILL_MANAGER_DEFAULT_DESCRIPTION = "설명이 등록되지 않은 스킬";
const SKILL_MANAGER_REMOTE_QUERY_MIN = 2;
const SKILL_MANAGER_SEARCH_DEBOUNCE_MS = 260;
const EDITOR_QUERY_TIMEOUT_MS = 1500;
const TERMINAL_FONT_OPTIONS = Object.freeze([
  Object.freeze({
    label: "D2Coding (기본)",
    value: DEFAULT_TERMINAL_FONT_FAMILY,
  }),
  Object.freeze({
    label: "Cascadia Mono",
    value: '"Cascadia Mono", "D2Coding", "Consolas", "Courier New", monospace',
  }),
  Object.freeze({
    label: "Consolas",
    value: '"Consolas", "D2Coding", "Cascadia Mono", "Courier New", monospace',
  }),
  Object.freeze({
    label: "JetBrains Mono",
    value: '"JetBrains Mono", "D2Coding", "Cascadia Mono", "Consolas", "Courier New", monospace',
  }),
  Object.freeze({
    label: "Fira Code",
    value: '"Fira Code", "D2Coding", "Cascadia Mono", "Consolas", "Courier New", monospace',
  }),
  Object.freeze({
    label: "Source Code Pro",
    value: '"Source Code Pro", "D2Coding", "Cascadia Mono", "Consolas", "Courier New", monospace',
  }),
]);
const DEFAULT_FULL_ACCESS_ENABLED = true;
const FULL_ACCESS_AGENT_COMMANDS = Object.freeze({
  codex: {
    normal: "codex",
    fullAccess: "codex --dangerously-bypass-approvals-and-sandbox",
  },
  claude: {
    normal: "claude",
    fullAccess: "claude --dangerously-skip-permissions",
  },
  gemini: {
    normal: "gemini",
    fullAccess: "gemini --sandbox=false",
  },
});
const AGENT_COMMAND_LABELS = Object.freeze({
  codex: "Codex",
  claude: "Claude",
  gemini: "Gemini",
});
const REQUIRED_AGENT_COMMANDS = Object.freeze(["codex", "claude", "gemini"]);

const ui = {
  grid: document.getElementById("pane-grid"),
  statusLine: document.getElementById("status-line"),
  shutdownOverlay: document.getElementById("shutdown-overlay"),
  dragRegion: document.getElementById("window-drag-region"),
  windowMinimizeButton: document.getElementById("window-minimize-btn"),
  windowMaximizeButton: document.getElementById("window-maximize-btn"),
  windowCloseButton: document.getElementById("window-close-btn"),
  presetButtons: /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-preset-button]")),
  titlebarPathDivider: document.getElementById("titlebar-path-divider"),
  titlebarPathSettingButton: document.getElementById("titlebar-path-setting-btn"),
  titlebarFontSettingButton: document.getElementById("titlebar-font-setting-btn"),
  titlebarSkillManagerButton: document.getElementById("titlebar-skill-manager-btn"),
  titlebarEditAgentsButton: document.getElementById("titlebar-edit-agents-btn"),
  titlebarMountCodexButton: document.getElementById("titlebar-mount-codex-btn"),
  titlebarMountClaudeButton: document.getElementById("titlebar-mount-claude-btn"),
  titlebarMountGeminiButton: document.getElementById("titlebar-mount-gemini-btn"),
  titlebarAllExitButton: document.getElementById("titlebar-all-exit-btn"),
  terminalFontOverlay: document.getElementById("terminal-font-overlay"),
  terminalFontSelect: /** @type {HTMLSelectElement | null} */ (document.getElementById("terminal-font-select")),
  terminalFontSizeRange: /** @type {HTMLInputElement | null} */ (document.getElementById("terminal-font-size-range")),
  terminalFontSizeDisplay: /** @type {HTMLElement | null} */ (document.getElementById("terminal-font-size-display")),
  terminalFontPreview: document.getElementById("terminal-font-preview"),
  terminalFontCancelButton: /** @type {HTMLButtonElement | null} */ (document.getElementById("terminal-font-cancel-btn")),
  skillManagerOverlay: document.getElementById("skill-manager-overlay"),
  skillManagerInstalledList: document.getElementById("skill-manager-installed-list"),
  skillManagerRecommendedList: document.getElementById("skill-manager-recommended-list"),
  skillManagerSearchInput: /** @type {HTMLInputElement | null} */ (document.getElementById("skill-manager-search-input")),
  skillManagerUpdatedAt: document.getElementById("skill-manager-updated-at"),
  skillManagerCancelButton: /** @type {HTMLButtonElement | null} */ (document.getElementById("skill-manager-cancel-btn")),
  agentsPolicyOverlay: document.getElementById("agents-policy-overlay"),
  agentsPolicyPath: document.getElementById("agents-policy-path"),
  agentsPolicyEditor: /** @type {HTMLTextAreaElement | null} */ (document.getElementById("agents-policy-editor")),
  agentsPolicyCancelButton: /** @type {HTMLButtonElement | null} */ (document.getElementById("agents-policy-cancel-btn")),
  agentsPolicySaveButton: /** @type {HTMLButtonElement | null} */ (document.getElementById("agents-policy-save-btn")),
  agentsPolicyReloadButton: /** @type {HTMLButtonElement | null} */ (document.getElementById("agents-policy-reload-btn")),
  agentsPolicyOpenEditorButton: /** @type {HTMLButtonElement | null} */ (document.getElementById("agents-policy-open-editor-btn")),

};

const state = {
  layout: null,
  paneViews: new Map(),
  sessionToPaneId: new Map(),
  sessionCapabilityBySessionId: new Map(),
  sessionSnapshotBySessionId: new Map(),
  selectedAgentBySessionId: new Map(),
  autoInstallSkippedAgents: new Set(),
  eventUnsubscribers: [],
  isMaximized: false,
  isWindowClosing: false,
  isStoppingAllAgents: false,
  isInstallingAgentCommand: null,
  isSkillManagerRunning: false,
  skillManagerBusySkillKey: "",
  skillCatalog: [],
  skillManagerSearchQuery: "",
  skillManagerSearchTimerId: null,
  isAgentsPolicyLoading: false,
  isAgentsPolicySaving: false,
  agentsPolicyPath: "",
  agentsPolicyInitialContent: "",
  agentsPolicyLoadedMtimeMs: null,
  terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
  terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
};

function setStatusLine(message) {
  if (!ui.statusLine) {
    return;
  }
  const timestamp = new Date().toLocaleTimeString();
  const detail = typeof message === "string" && message.length > 0 ? ` | ${message}` : "";
  ui.statusLine.textContent = `${timestamp}${detail}`;
}

function setTerminalFontOverlayVisible(visible) {
  if (!ui.terminalFontOverlay) {
    return;
  }
  const shouldShow = Boolean(visible);
  ui.terminalFontOverlay.classList.toggle("visible", shouldShow);
  ui.terminalFontOverlay.setAttribute("aria-hidden", shouldShow ? "false" : "true");
}

function setSkillManagerOverlayVisible(visible) {
  if (!ui.skillManagerOverlay) {
    return;
  }
  const shouldShow = Boolean(visible);
  ui.skillManagerOverlay.classList.toggle("visible", shouldShow);
  ui.skillManagerOverlay.setAttribute("aria-hidden", shouldShow ? "false" : "true");
}

function setAgentsPolicyOverlayVisible(visible) {
  if (!ui.agentsPolicyOverlay) {
    return;
  }
  const shouldShow = Boolean(visible);
  ui.agentsPolicyOverlay.classList.toggle("visible", shouldShow);
  ui.agentsPolicyOverlay.setAttribute("aria-hidden", shouldShow ? "false" : "true");
}

function isSkillManagerOverlayVisible() {
  return Boolean(ui.skillManagerOverlay?.classList.contains("visible"));
}

function isAgentsPolicyOverlayVisible() {
  return Boolean(ui.agentsPolicyOverlay?.classList.contains("visible"));
}

function normalizeSkillName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function setSkillManagerControlsDisabled(disabled) {
  const isDisabled = Boolean(disabled);
  if (ui.skillManagerSearchInput) {
    ui.skillManagerSearchInput.disabled = isDisabled;
  }
  if (ui.skillManagerCancelButton) {
    ui.skillManagerCancelButton.disabled = isDisabled;
  }
}

function normalizeSkillCatalogRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  const normalized = [];
  for (const row of rows) {
    const name = normalizeSkillName(row?.name);
    if (!name) {
      continue;
    }
    const installProvider = String(row?.installProvider || "").trim().toLowerCase();
    const installRepo = String(row?.installRepo || "").trim();
    const installs = Number.parseInt(String(row?.installs || "0"), 10);
    const iconUrl = String(row?.iconUrl || "").trim();
    const iconFallbackUrl = String(row?.iconFallbackUrl || "").trim();
    normalized.push({
      name,
      displayName: String(row?.displayName || name),
      description: String(row?.description || SKILL_MANAGER_DEFAULT_DESCRIPTION),
      installed: Boolean(row?.installed),
      recommended: Boolean(row?.recommended),
      removable: Boolean(row?.removable),
      source: String(row?.source || ""),
      installProvider,
      installRepo,
      installs: Number.isFinite(installs) && installs > 0 ? installs : 0,
      iconUrl,
      iconFallbackUrl,
    });
  }
  return normalized;
}

function clearSkillManagerList(listElement) {
  if (!listElement) {
    return;
  }
  listElement.innerHTML = "";
}

function appendSkillManagerEmpty(listElement, message) {
  if (!listElement) {
    return;
  }
  const empty = document.createElement("div");
  empty.className = "skill-manager-empty";
  empty.textContent = message;
  listElement.appendChild(empty);
}

function toSkillCardIconText(displayName, fallbackName) {
  const base = String(displayName || fallbackName || "").trim();
  if (!base) {
    return "SK";
  }

  const normalized = base
    .replace(/["'`]/g, " ")
    .replace(/[_./-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim();
  const chunks = normalized
    .split(/\s+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  const letters = chunks
    .slice(0, 2)
    .map((chunk) => String(chunk[0] || ""))
    .join("");

  if (letters.length > 0) {
    return letters.toUpperCase();
  }

  const fallback = String(fallbackName || "").trim();
  if (fallback.length > 0) {
    const first = fallback.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 1);
    if (first) {
      return first.toUpperCase();
    }
  }
  return "SK";
}

function getSkillActionKey(skill) {
  const name = normalizeSkillName(skill?.name);
  const provider = String(skill?.installProvider || "").trim().toLowerCase();
  const repo = String(skill?.installRepo || "").trim().toLowerCase();
  return `${name}|${provider}|${repo}`;
}

function getSkillSourceTag(skill) {
  if (skill.source === "agents") {
    return "기본";
  }
  if (skill.source === "codex") {
    return "사용자";
  }
  if (skill.source === "skills-sh") {
    return "skills.sh";
  }
  if (skill.source === "curated") {
    return "추천";
  }
  if (skill.recommended) {
    return "추천";
  }
  return "";
}

function normalizeSkillSearchQuery(value) {
  return String(value || "").trim();
}

function formatSkillInstallCount(count) {
  const numeric = Number.parseInt(String(count || "0"), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }
  if (numeric >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (numeric >= 1_000) {
    return `${(numeric / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `${numeric}`;
}

function doesSkillMatchQuery(skill, query) {
  const keyword = String(query || "").toLowerCase();
  if (!keyword) {
    return true;
  }

  const haystack = [
    String(skill?.name || ""),
    String(skill?.displayName || ""),
    String(skill?.description || ""),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(keyword);
}

function setSkillManagerUpdatedAtText(updatedAt = null) {
  if (!ui.skillManagerUpdatedAt) {
    return;
  }

  if (!updatedAt) {
    ui.skillManagerUpdatedAt.textContent = "업데이트: -";
    return;
  }

  const formatted = updatedAt.toLocaleTimeString("ko-KR", {
    hour12: false,
  });
  ui.skillManagerUpdatedAt.textContent = `업데이트: ${formatted}`;
}

function formatSkillActionError(errorCode) {
  const code = String(errorCode || "");
  if (code === "managed-skill") {
    return "시스템 스킬은 삭제할 수 없습니다";
  }
  if (code === "skill-uninstall-finished-but-present") {
    return "스킬이 완전히 삭제되지 않았습니다";
  }
  if (code.startsWith("skill-uninstall-failed:")) {
    return "스킬 삭제 중 오류가 발생했습니다";
  }
  if (code === "unsupported-skill") {
    return "지원되지 않는 스킬입니다";
  }
  if (code === "skill-install-script-not-found") {
    return "스킬 설치 스크립트를 찾을 수 없습니다";
  }
  if (code === "skill-install-spawn-failed" || code === "skills-install-spawn-failed") {
    return "스킬 설치 실행에 실패했습니다";
  }
  if (code === "curated-source-unavailable") {
    return "기본 추천 목록을 불러오지 못했습니다";
  }
  if (code === "skills-cli-not-found") {
    return "skills CLI를 찾을 수 없습니다 (npx 필요)";
  }
  if (code === "invalid-install-repo" || code === "invalid-payload:installRepo-format") {
    return "스킬 저장소 형식이 올바르지 않습니다";
  }
  if (code === "invalid-payload:installRepo-required") {
    return "skills.sh 설치에는 저장소 정보가 필요합니다";
  }
  if (code === "not-installed") {
    return "설치되지 않은 스킬입니다";
  }
  if (code === "invalid-skill-name" || code === "invalid-payload:skillName-format") {
    return "잘못된 스킬 이름입니다";
  }
  return code || "unknown";
}

function formatOpenInEditorError(errorCode) {
  const code = String(errorCode || "");
  if (code === "unknown-editor") {
    return "알 수 없는 에디터입니다";
  }
  if (code === "editor-launch-command-not-found") {
    return "에디터 실행 경로를 찾지 못했습니다";
  }
  if (code.startsWith("editor-launch-failed:")) {
    return "에디터 실행 중 오류가 발생했습니다";
  }
  if (code.startsWith("editor-exit-")) {
    return "에디터 실행이 비정상 종료되었습니다";
  }
  return code || "unknown";
}

function renderSkillManagerList(listElement, skills = [], emptyMessage = "") {
  clearSkillManagerList(listElement);
  if (!Array.isArray(skills) || skills.length === 0) {
    appendSkillManagerEmpty(listElement, emptyMessage);
    return;
  }

  for (const skill of skills) {
    const action = skill.installed ? "remove" : "install";
    const isBusy = state.isSkillManagerRunning
      && state.skillManagerBusySkillKey === getSkillActionKey(skill);
    const canRunAction = action === "install" ? true : Boolean(skill.removable);

    const row = document.createElement("div");
    row.className = "skill-manager-item";

    const left = document.createElement("div");
    left.className = "skill-manager-item-left";
    const icon = document.createElement("span");
    icon.className = "skill-manager-item-icon";
    if (skill.iconUrl) {
      const image = document.createElement("img");
      image.className = "skill-manager-item-icon-image";
      image.src = skill.iconUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => {
        if (skill.iconFallbackUrl && image.src !== skill.iconFallbackUrl) {
          image.src = skill.iconFallbackUrl;
          return;
        }
        image.remove();
        icon.textContent = toSkillCardIconText(skill.displayName, skill.name);
      });
      icon.appendChild(image);
    } else {
      icon.textContent = toSkillCardIconText(skill.displayName, skill.name);
    }

    const textWrap = document.createElement("div");
    textWrap.className = "skill-manager-item-text";
    const title = document.createElement("p");
    title.className = "skill-manager-item-title";
    title.textContent = skill.displayName;
    const description = document.createElement("p");
    description.className = "skill-manager-item-description";
    description.textContent = skill.description || SKILL_MANAGER_DEFAULT_DESCRIPTION;
    textWrap.appendChild(title);
    textWrap.appendChild(description);
    left.appendChild(icon);
    left.appendChild(textWrap);

    const right = document.createElement("div");
    right.className = "skill-manager-item-right";

    const sourceTagText = getSkillSourceTag(skill);
    if (sourceTagText) {
      const sourceTag = document.createElement("span");
      sourceTag.className = "skill-manager-source-tag";
      sourceTag.textContent = sourceTagText;
      right.appendChild(sourceTag);
    }

    const installCountText = formatSkillInstallCount(skill.installs);
    if (installCountText && !skill.installed) {
      const installCountTag = document.createElement("span");
      installCountTag.className = "skill-manager-source-tag";
      installCountTag.textContent = `${installCountText} 설치`;
      right.appendChild(installCountTag);
    }

    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = `skill-manager-action-btn ${action}`;
    actionButton.textContent = action === "install" ? "+" : "−";
    actionButton.disabled = !canRunAction || state.isSkillManagerRunning;
    actionButton.title = canRunAction
      ? action === "install"
        ? skill.installProvider === "skills-sh" ? "설치 (skills.sh)" : "설치"
        : "삭제"
      : "관리형 스킬은 삭제할 수 없습니다";

    if (canRunAction) {
      actionButton.addEventListener("click", async () => {
        await runSkillManagerAction(skill, action);
      });
    }
    if (isBusy) {
      actionButton.textContent = "...";
    }

    right.appendChild(actionButton);
    row.appendChild(left);
    row.appendChild(right);
    listElement?.appendChild(row);
  }
}

function renderSkillManagerCatalog(skills = []) {
  const all = normalizeSkillCatalogRows(skills);
  state.skillCatalog = all;
  const query = normalizeSkillSearchQuery(state.skillManagerSearchQuery);

  const installed = all
    .filter((skill) => skill.installed)
    .filter((skill) => doesSkillMatchQuery(skill, query))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
  const recommended = all
    .filter((skill) => !skill.installed && skill.recommended)
    .filter((skill) => doesSkillMatchQuery(skill, query))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));

  renderSkillManagerList(
    ui.skillManagerInstalledList,
    installed,
    query ? "검색 결과가 없습니다" : "설치된 스킬이 없습니다",
  );
  renderSkillManagerList(
    ui.skillManagerRecommendedList,
    recommended,
    query ? "검색 결과가 없습니다" : "추천 스킬을 불러오지 못했습니다",
  );
}

async function refreshSkillManagerCatalog(options = {}) {
  const showStatus = Boolean(options.showStatus);
  const query = normalizeSkillSearchQuery(
    options.query !== undefined ? options.query : state.skillManagerSearchQuery,
  );
  if (!api?.app?.process?.listSkills) {
    renderSkillManagerCatalog([]);
    setStatusLine("스킬 목록 기능을 사용할 수 없습니다");
    return;
  }

  if (!state.isSkillManagerRunning) {
    setSkillManagerControlsDisabled(true);
  }
  try {
    const result = await api.app.process.listSkills({ query });
    if (!result || result.ok !== true || !Array.isArray(result.skills)) {
      renderSkillManagerCatalog([]);
      setStatusLine(`스킬 목록 조회 실패: ${String(result?.error || "unknown")}`);
      setSkillManagerUpdatedAtText(null);
      return;
    }

    renderSkillManagerCatalog(result.skills);
    if (query.length >= SKILL_MANAGER_REMOTE_QUERY_MIN && result.skillsShSourceOk === false) {
      setStatusLine("skills.sh 검색 결과를 불러오지 못했습니다");
    } else if (result.curatedSourceOk === false) {
      setStatusLine("로컬 설치 스킬 목록만 표시중입니다");
    } else if (showStatus) {
      if (query.length >= SKILL_MANAGER_REMOTE_QUERY_MIN) {
        setStatusLine("skills.sh 검색 결과를 반영했습니다");
      } else {
        setStatusLine("최신 스킬 목록을 불러왔습니다");
      }
    }
    setSkillManagerUpdatedAtText(new Date());
  } catch (error) {
    renderSkillManagerCatalog([]);
    setStatusLine(`스킬 목록 조회 실패: ${String(error)}`);
    setSkillManagerUpdatedAtText(null);
  } finally {
    if (!state.isSkillManagerRunning) {
      setSkillManagerControlsDisabled(false);
    }
  }
}

async function runSkillManagerAction(skill, action) {
  if (!skill || state.isSkillManagerRunning) {
    return;
  }

  const skillName = normalizeSkillName(skill.name);
  if (!skillName) {
    setStatusLine("스킬 이름이 유효하지 않습니다");
    return;
  }

  if (!api?.app?.process?.installSkill || !api?.app?.process?.uninstallSkill) {
    setStatusLine("스킬 설치/삭제 기능을 사용할 수 없습니다");
    return;
  }

  state.isSkillManagerRunning = true;
  state.skillManagerBusySkillKey = getSkillActionKey(skill);
  setSkillManagerControlsDisabled(true);
  renderSkillManagerCatalog(state.skillCatalog);

  try {
    if (action === "install") {
      setStatusLine(`스킬 설치 중: ${skill.displayName}`);
      const payload = {
        skillName,
      };
      if (skill.installProvider) {
        payload.installProvider = skill.installProvider;
      }
      if (skill.installRepo) {
        payload.installRepo = skill.installRepo;
      }
      const result = await api.app.process.installSkill(payload);
      if (!result || result.ok !== true) {
        setStatusLine(`스킬 설치 실패: ${formatSkillActionError(result?.error)}`);
      } else {
        setStatusLine(`스킬 설치 완료: ${skill.displayName}`);
      }
    } else {
      setStatusLine(`스킬 삭제 중: ${skill.displayName}`);
      const result = await api.app.process.uninstallSkill({ skillName });
      if (!result || result.ok !== true) {
        setStatusLine(`스킬 삭제 실패: ${formatSkillActionError(result?.error)}`);
      } else {
        setStatusLine(`스킬 삭제 완료: ${skill.displayName}`);
      }
    }
  } catch (error) {
    setStatusLine(`스킬 작업 실패: ${String(error)}`);
  } finally {
    state.isSkillManagerRunning = false;
    state.skillManagerBusySkillKey = "";
    setSkillManagerControlsDisabled(false);
    await refreshSkillManagerCatalog({
      query: state.skillManagerSearchQuery,
    });
  }
}

function openSkillManagerDialog() {
  if (!ui.skillManagerOverlay) {
    setStatusLine("스킬관리 UI를 열 수 없습니다");
    return;
  }

  setSkillManagerOverlayVisible(true);
  setSkillManagerControlsDisabled(false);
  state.skillManagerSearchQuery = "";
  if (ui.skillManagerSearchInput) {
    ui.skillManagerSearchInput.value = "";
  }
  setSkillManagerUpdatedAtText(null);
  ui.skillManagerSearchInput?.focus();
  refreshSkillManagerCatalog({ showStatus: true, query: state.skillManagerSearchQuery });
}

function closeSkillManagerDialog() {
  if (state.isSkillManagerRunning) {
    return;
  }
  if (state.skillManagerSearchTimerId) {
    clearTimeout(state.skillManagerSearchTimerId);
    state.skillManagerSearchTimerId = null;
  }
  setSkillManagerOverlayVisible(false);
}

function setAgentsPolicyPathText(pathText = "") {
  if (!ui.agentsPolicyPath) {
    return;
  }
  const normalizedPath = String(pathText || "").trim();
  ui.agentsPolicyPath.textContent = `경로: ${normalizedPath || "-"}`;
}

function hasAgentsPolicyDraftChanges() {
  const current = String(ui.agentsPolicyEditor?.value || "");
  return current !== state.agentsPolicyInitialContent;
}

function syncAgentsPolicyControls() {
  const isBusy = state.isAgentsPolicyLoading || state.isAgentsPolicySaving;
  const hasChanges = hasAgentsPolicyDraftChanges();

  if (ui.agentsPolicyEditor) {
    ui.agentsPolicyEditor.disabled = isBusy;
  }
  if (ui.agentsPolicyCancelButton) {
    ui.agentsPolicyCancelButton.disabled = isBusy;
  }
  if (ui.agentsPolicyReloadButton) {
    ui.agentsPolicyReloadButton.disabled = isBusy;
  }
  if (ui.agentsPolicyOpenEditorButton) {
    ui.agentsPolicyOpenEditorButton.disabled = isBusy;
  }
  if (ui.agentsPolicySaveButton) {
    ui.agentsPolicySaveButton.disabled = isBusy || !hasChanges;
  }
}

function shouldDiscardAgentsPolicyDraft() {
  if (!hasAgentsPolicyDraftChanges()) {
    return true;
  }
  return runtimeWindow.confirm("저장하지 않은 변경사항을 버릴까요?");
}

async function loadAgentsPolicyIntoEditor(options = {}) {
  if (!api?.app?.process?.readAgentsPolicy) {
    setStatusLine("규칙 설정 읽기 기능을 사용할 수 없습니다");
    return false;
  }

  const showStatus = options.showStatus !== false;
  state.isAgentsPolicyLoading = true;
  syncAgentsPolicyControls();
  if (showStatus) {
    setStatusLine("규칙 설정을 불러오는 중...");
  }

  try {
    const result = await api.app.process.readAgentsPolicy();
    if (!result?.ok) {
      setStatusLine(`규칙 설정 불러오기 실패: ${result?.error || "알 수 없는 오류"}`);
      return false;
    }

    const content = typeof result.content === "string" ? result.content : "";
    state.agentsPolicyInitialContent = content;
    state.agentsPolicyPath = typeof result.path === "string" ? result.path.trim() : "";
    state.agentsPolicyLoadedMtimeMs = Number.isFinite(result?.mtimeMs) ? Number(result.mtimeMs) : null;

    if (ui.agentsPolicyEditor) {
      ui.agentsPolicyEditor.value = content;
    }
    setAgentsPolicyPathText(state.agentsPolicyPath);
    if (showStatus) {
      setStatusLine("규칙 설정 파일을 불러왔습니다");
    }
    return true;
  } catch (error) {
    setStatusLine(`규칙 설정 불러오기 실패: ${String(error)}`);
    return false;
  } finally {
    state.isAgentsPolicyLoading = false;
    syncAgentsPolicyControls();
  }
}

async function saveAgentsPolicyEditorContent() {
  if (!ui.agentsPolicyEditor) {
    return false;
  }
  if (!api?.app?.process?.writeAgentsPolicy) {
    setStatusLine("규칙 설정 저장 기능을 사용할 수 없습니다");
    return false;
  }

  const content = String(ui.agentsPolicyEditor.value || "");
  if (content === state.agentsPolicyInitialContent) {
    syncAgentsPolicyControls();
    return true;
  }

  state.isAgentsPolicySaving = true;
  syncAgentsPolicyControls();
  setStatusLine("규칙 설정 저장 중...");

  try {
    const payload = { content };
    if (Number.isFinite(state.agentsPolicyLoadedMtimeMs)) {
      payload.baseMtimeMs = state.agentsPolicyLoadedMtimeMs;
    }

    let result = await api.app.process.writeAgentsPolicy(payload);
    if (result?.ok !== true && result?.error === "stale-version") {
      if (Number.isFinite(result?.currentMtimeMs)) {
        state.agentsPolicyLoadedMtimeMs = Number(result.currentMtimeMs);
      }
      const shouldOverwrite = runtimeWindow.confirm(
        "외부에서 AGENTS.md가 변경되었습니다. 현재 편집 내용으로 덮어쓸까요?",
      );
      if (!shouldOverwrite) {
        setStatusLine("외부 변경 감지: 다시불러오기 후 저장하세요");
        return false;
      }
      result = await api.app.process.writeAgentsPolicy({
        content,
        ignoreStale: true,
      });
    }
    if (!result?.ok) {
      setStatusLine(`규칙 설정 저장 실패: ${result?.error || "알 수 없는 오류"}`);
      return false;
    }

    state.agentsPolicyInitialContent = content;
    if (typeof result.path === "string" && result.path.trim().length > 0) {
      state.agentsPolicyPath = result.path.trim();
      setAgentsPolicyPathText(state.agentsPolicyPath);
    }
    state.agentsPolicyLoadedMtimeMs = Number.isFinite(result?.mtimeMs) ? Number(result.mtimeMs) : null;
    setStatusLine("규칙 설정을 저장했습니다");
    return true;
  } catch (error) {
    setStatusLine(`규칙 설정 저장 실패: ${String(error)}`);
    return false;
  } finally {
    state.isAgentsPolicySaving = false;
    syncAgentsPolicyControls();
  }
}

async function reloadAgentsPolicyEditorContent() {
  if (!shouldDiscardAgentsPolicyDraft()) {
    return false;
  }
  return loadAgentsPolicyIntoEditor({ showStatus: true });
}

function closeAgentsPolicyDialog(options = {}) {
  if (state.isAgentsPolicyLoading || state.isAgentsPolicySaving) {
    return;
  }
  const force = Boolean(options.force);
  if (!force && !shouldDiscardAgentsPolicyDraft()) {
    return;
  }
  setAgentsPolicyOverlayVisible(false);
}

async function openAgentsPolicyInExternalEditor() {
  if (!api?.app?.process?.editAgentsPolicy) {
    setStatusLine("외부 편집기 열기 기능을 사용할 수 없습니다");
    return false;
  }
  const result = await api.app.process.editAgentsPolicy();
  if (!result?.ok) {
    setStatusLine(`AGENTS.md 파일 편집기 열기 실패: ${result?.error || "알 수 없는 오류"}`);
    return false;
  }
  setStatusLine("AGENTS.md 파일을 시스템 기본 편집기로 열었습니다.");
  return true;
}

async function openAgentsPolicyDialog() {
  if (!ui.agentsPolicyOverlay || !ui.agentsPolicyEditor) {
    setStatusLine("규칙설정 UI를 열 수 없습니다");
    return;
  }
  setAgentsPolicyOverlayVisible(true);
  setAgentsPolicyPathText(state.agentsPolicyPath);
  await loadAgentsPolicyIntoEditor({ showStatus: true });
  ui.agentsPolicyEditor.focus();
}

async function runSkillManagerSelection() {
  await refreshSkillManagerCatalog({
    showStatus: true,
    query: state.skillManagerSearchQuery,
  });
}

function scheduleSkillManagerSearchRefresh() {
  if (state.skillManagerSearchTimerId) {
    clearTimeout(state.skillManagerSearchTimerId);
    state.skillManagerSearchTimerId = null;
  }

  const query = normalizeSkillSearchQuery(state.skillManagerSearchQuery);
  if (query.length > 0 && query.length < SKILL_MANAGER_REMOTE_QUERY_MIN) {
    renderSkillManagerCatalog(state.skillCatalog);
    setStatusLine("skills.sh 검색은 2글자 이상부터 지원됩니다");
    return;
  }

  state.skillManagerSearchTimerId = setTimeout(() => {
    state.skillManagerSearchTimerId = null;
    refreshSkillManagerCatalog({
      showStatus: false,
      query,
    });
  }, SKILL_MANAGER_SEARCH_DEBOUNCE_MS);
}

function normalizeTerminalFontFamily(value) {
  const normalized = String(value || "").trim();
  const matched = TERMINAL_FONT_OPTIONS.find((option) => option.value === normalized);
  return matched ? matched.value : DEFAULT_TERMINAL_FONT_FAMILY;
}

function normalizeTerminalFontSize(value) {
  const numeric = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, numeric));
}

function getTerminalFontOptionLabel(value) {
  const normalized = normalizeTerminalFontFamily(value);
  const matched = TERMINAL_FONT_OPTIONS.find((option) => option.value === normalized);
  return matched?.label || "Custom";
}

function readStoredTerminalFontFamily() {
  try {
    const stored = runtimeWindow.localStorage?.getItem(TERMINAL_FONT_STORAGE_KEY) || "";
    return normalizeTerminalFontFamily(stored);
  } catch (_error) {
    return DEFAULT_TERMINAL_FONT_FAMILY;
  }
}

function persistTerminalFontFamily(value) {
  try {
    runtimeWindow.localStorage?.setItem(TERMINAL_FONT_STORAGE_KEY, value);
  } catch (_error) {
    // Best effort only.
  }
}

function readStoredTerminalFontSize() {
  try {
    const stored = runtimeWindow.localStorage?.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY) || "";
    return normalizeTerminalFontSize(stored);
  } catch (_error) {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }
}

function persistTerminalFontSize(value) {
  try {
    runtimeWindow.localStorage?.setItem(TERMINAL_FONT_SIZE_STORAGE_KEY, String(value));
  } catch (_error) {
    // Best effort only.
  }
}

function readStoredAutoInstallSkippedAgents() {
  try {
    const raw = runtimeWindow.localStorage?.getItem(AGENT_AUTO_INSTALL_SKIP_STORAGE_KEY) || "[]";
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }

    const skipped = new Set();
    for (const item of parsed) {
      const normalized = String(item || "").trim().toLowerCase();
      if (isAgentCommand(normalized)) {
        skipped.add(normalized);
      }
    }
    return skipped;
  } catch (_error) {
    return new Set();
  }
}

function persistAutoInstallSkippedAgents() {
  try {
    runtimeWindow.localStorage?.setItem(
      AGENT_AUTO_INSTALL_SKIP_STORAGE_KEY,
      JSON.stringify([...state.autoInstallSkippedAgents]),
    );
  } catch (_error) {
    // Best effort only.
  }
}

function isAutoInstallSkippedAgent(agentCommand) {
  if (!isAgentCommand(agentCommand)) {
    return false;
  }
  return state.autoInstallSkippedAgents.has(agentCommand);
}

function setAutoInstallSkippedAgent(agentCommand, skipped) {
  if (!isAgentCommand(agentCommand)) {
    return;
  }

  const hasAgent = state.autoInstallSkippedAgents.has(agentCommand);
  const shouldSkip = Boolean(skipped);
  if (shouldSkip && !hasAgent) {
    state.autoInstallSkippedAgents.add(agentCommand);
    persistAutoInstallSkippedAgents();
    return;
  }

  if (!shouldSkip && hasAgent) {
    state.autoInstallSkippedAgents.delete(agentCommand);
    persistAutoInstallSkippedAgents();
  }
}

function populateTerminalFontOptions() {
  if (!ui.terminalFontSelect) {
    return;
  }

  ui.terminalFontSelect.innerHTML = "";
  for (const option of TERMINAL_FONT_OPTIONS) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    ui.terminalFontSelect.appendChild(element);
  }
  ui.terminalFontSelect.value = normalizeTerminalFontFamily(state.terminalFontFamily);
}

function syncTerminalFontSizeControls(fontSize = state.terminalFontSize) {
  const normalized = normalizeTerminalFontSize(fontSize);
  if (ui.terminalFontSizeRange) {
    ui.terminalFontSizeRange.value = String(normalized);
  }
  if (ui.terminalFontSizeDisplay) {
    ui.terminalFontSizeDisplay.textContent = String(normalized);
  }
}

function getTerminalFontSizeFromDialog() {
  const preferred = ui.terminalFontSizeRange?.value || state.terminalFontSize;
  return normalizeTerminalFontSize(preferred);
}

function updateTerminalFontPreview(
  fontFamily = state.terminalFontFamily,
  fontSize = state.terminalFontSize,
) {
  const normalizedFamily = normalizeTerminalFontFamily(fontFamily);
  const normalizedSize = normalizeTerminalFontSize(fontSize);
  if (ui.terminalFontPreview) {
    ui.terminalFontPreview.style.fontFamily = normalizedFamily;
    ui.terminalFontPreview.style.fontSize = `${normalizedSize}px`;
  }
}

function applyTerminalFontSettings(settings = {}, options = {}) {
  const normalizedFamily = normalizeTerminalFontFamily(settings.fontFamily || state.terminalFontFamily);
  const normalizedSize = normalizeTerminalFontSize(settings.fontSize ?? state.terminalFontSize);
  const persist = options.persist !== false;
  const refit = options.refit !== false;
  const announce = options.announce !== false;

  state.terminalFontFamily = normalizedFamily;
  state.terminalFontSize = normalizedSize;
  document.documentElement.style.setProperty("--terminal-font-family", normalizedFamily);
  document.documentElement.style.setProperty("--terminal-font-size", `${normalizedSize}px`);
  syncTerminalFontSizeControls(normalizedSize);
  updateTerminalFontPreview(normalizedFamily, normalizedSize);

  if (persist) {
    persistTerminalFontFamily(normalizedFamily);
    persistTerminalFontSize(normalizedSize);
  }

  for (const view of state.paneViews.values()) {
    if (view?.terminal) {
      // In xterm 5+, options must sometimes be set this way or trigger a full layout change. 
      // Some versions need a clear refresh to apply font family changes on the canvas.
      view.terminal.options.fontFamily = normalizedFamily;
      view.terminal.options.fontSize = normalizedSize;

      try {
        // Force xterm to re-evaluate character metrics and redraw the entire canvas
        if (typeof view.terminal.clearTextureAtlas === 'function') {
          view.terminal.clearTextureAtlas();
        }
        view.terminal.refresh(0, view.terminal.rows - 1);
      } catch (e) {
        // Ignore
      }

      if (refit) {
        scheduleFitAndResize(view);
      }
    }
  }

  if (announce) {
    setStatusLine(
      `터미널 폰트 적용: ${getTerminalFontOptionLabel(normalizedFamily)} / ${normalizedSize}px`,
    );
  }
}

function openTerminalFontDialog() {
  populateTerminalFontOptions();
  syncTerminalFontSizeControls();
  updateTerminalFontPreview();
  setTerminalFontOverlayVisible(true);
  ui.terminalFontSelect?.focus();
}

function closeTerminalFontDialog() {
  setTerminalFontOverlayVisible(false);
}

async function ensurePowerShell7Ready() {
  if (!api?.app?.process?.checkPowerShell7Status || !api?.app?.process?.installPowerShell7) {
    return true;
  }
  let status = null;
  try {
    status = await api.app.process.checkPowerShell7Status();
  } catch (error) {
    setStatusLine(`PowerShell 상태 확인 실패: ${String(error)}`);
    return true;
  }

  if (!status || status.ok !== true || !status.supportedPlatform || !status.needsInstall) {
    return true;
  }

  setStatusLine("PowerShell 7 미설치 감지: 자동 설치 중...");
  try {
    const result = await api.app.process.installPowerShell7();
    if (result?.ok === true && result?.installed) {
      setStatusLine(`PowerShell 7 설치 완료${result.currentVersion ? ` (${result.currentVersion})` : ""}`);
      return true;
    }

    if (result?.action === "opened-install-page") {
      setStatusLine("PowerShell 7 설치 페이지를 열었습니다");
      return false;
    }

    setStatusLine(`PowerShell 7 설치 실패: ${String(result?.error || "unknown")}`);
    return false;
  } catch (error) {
    setStatusLine(`PowerShell 7 설치 실패: ${String(error)}`);
    return false;
  }
}

async function ensureNodeRuntimeSupported() {
  if (!api?.app?.process?.checkNodeRuntimeStatus || !api?.app?.process?.installNodeRuntime) {
    return true;
  }

  let nodeStatus = null;
  try {
    nodeStatus = await api.app.process.checkNodeRuntimeStatus();
  } catch (error) {
    setStatusLine(`Node 상태 확인 실패: ${String(error)}`);
    return true;
  }

  if (!nodeStatus || nodeStatus.ok !== true || !nodeStatus.needsUpgrade) {
    return true;
  }

  setStatusLine("Node.js 미설치/버전부족 감지: 자동 설치 중...");
  try {
    const result = await api.app.process.installNodeRuntime();
    if (result?.ok === true && !result?.needsUpgrade) {
      const version =
        typeof result?.currentVersion === "string" && result.currentVersion.length > 0
          ? ` (${result.currentVersion})`
          : "";
      setStatusLine(`Node.js 설치 완료${version}`);
      return true;
    }

    if (result?.action === "opened-install-page") {
      setStatusLine("Node.js 설치 페이지를 열었습니다");
      return false;
    }

    setStatusLine(`Node.js 설치 실패: ${String(result?.error || "unknown")}`);
    return false;
  } catch (error) {
    setStatusLine(`Node.js 설치 실패: ${String(error)}`);
    return false;
  }
}

async function runTerminalColorDiagnosticsOnStartup() {
  if (!api?.app?.process?.queryTerminalColorDiagnostics) {
    return;
  }

  try {
    const result = await api.app.process.queryTerminalColorDiagnostics();
    if (!result || result.ok !== true) {
      setStatusLine(`터미널 진단 실패: ${String(result?.error || "unknown")}`);
      return;
    }

    const status = typeof result?.pwsh?.status === "number" ? result.pwsh.status : null;
    const hasAnsi = Boolean(result?.pwsh?.hasAnsi);
    const outputRenderingMatch = String(result?.pwsh?.stdout || "").match(/OUTPUT_RENDERING=([^\r\n]+)/);
    const outputRendering = outputRenderingMatch?.[1] ? outputRenderingMatch[1].trim() : "unknown";
    const term = String(result?.env?.TERM || "");

    console.info("[terminal-color-diagnostics]", result);
    setStatusLine(
      `터미널 진단: mode=${String(result.colorMode || "unknown")}, output=${outputRendering}, ansi=${hasAnsi ? "yes" : "no"}, TERM=${term || "-"}, exit=${status ?? "?"}`,
    );
  } catch (error) {
    setStatusLine(`터미널 진단 예외: ${String(error)}`);
  }
}

async function ensureAgentInstalled(agentCommand) {
  if (!isAgentCommand(agentCommand)) {
    return false;
  }

  const agentLabel = AGENT_COMMAND_LABELS[agentCommand] || agentCommand;
  if (state.isInstallingAgentCommand) {
    const inProgressLabel =
      AGENT_COMMAND_LABELS[state.isInstallingAgentCommand] || state.isInstallingAgentCommand;
    setStatusLine(`${inProgressLabel} 설치 진행 중입니다`);
    return false;
  }

  let installStatus = null;
  try {
    installStatus = await api.app.process.checkAgentInstallStatus({
      agentCommand,
    });
  } catch (error) {
    setStatusLine(`${agentLabel} 설치 상태 확인 실패: ${String(error)}`);
    return false;
  }

  if (!installStatus || installStatus.ok !== true) {
    setStatusLine(`${agentLabel} 설치 상태 확인 실패`);
    return false;
  }

  if (installStatus.installed) {
    setAutoInstallSkippedAgent(agentCommand, false);
    return true;
  }

  state.isInstallingAgentCommand = agentCommand;
  try {
    setStatusLine(`${agentLabel} 미설치 감지: 최신 버전 자동 설치 중...`);
    const result = await api.app.process.installAgentLatest({
      agentCommand,
    });
    if (!result || result.ok !== true) {
      const reason = result?.error ? String(result.error) : "install-failed";
      setStatusLine(`${agentLabel} 설치 실패: ${reason}`);
      return false;
    }

    setAutoInstallSkippedAgent(agentCommand, false);
    setStatusLine(`${agentLabel} 최신 버전 설치 완료`);
    return true;
  } catch (error) {
    setStatusLine(`${agentLabel} 설치 실패: ${String(error)}`);
    return false;
  } finally {
    state.isInstallingAgentCommand = null;
  }
}

async function ensureRequiredAgentsInstalledOnStartup() {
  if (!api?.app?.process?.checkAgentInstallStatus || !api?.app?.process?.installAgentLatest) {
    return true;
  }

  const failedLabels = [];
  const skippedLabels = [];
  for (const agentCommand of REQUIRED_AGENT_COMMANDS) {
    if (isAutoInstallSkippedAgent(agentCommand)) {
      skippedLabels.push(AGENT_COMMAND_LABELS[agentCommand] || agentCommand);
      continue;
    }

    const ready = await ensureAgentInstalled(agentCommand);
    if (!ready) {
      failedLabels.push(AGENT_COMMAND_LABELS[agentCommand] || agentCommand);
    }
  }

  if (failedLabels.length === 0) {
    if (skippedLabels.length > 0) {
      setStatusLine(`에이전트 설치 점검 완료 (자동설치 제외: ${skippedLabels.join(", ")})`);
      return true;
    }
    setStatusLine("에이전트 설치 점검 완료");
    return true;
  }

  setStatusLine(`에이전트 자동 설치 실패: ${failedLabels.join(", ")}`);
  return false;
}

async function runAgentForViewWithInstallCheck(view, agentCommand, options = {}) {
  if (!view?.sessionId) {
    return;
  }

  if (view.selectedAgentCommand === agentCommand) {
    if (!options.silent) {
      const label = AGENT_COMMAND_LABELS[agentCommand] || agentCommand;
      setStatusLine(`${label} 이미 마운트됨`);
    }
    view.terminal?.focus();
    return;
  }

  const installed = await ensureAgentInstalled(agentCommand);
  if (!installed) {
    view.terminal?.focus();
    return;
  }

  setAgentCommandSelection(view, agentCommand);
  runAgentForView(view, agentCommand, options);
}

function showShutdownOverlay(visible) {
  if (!ui.shutdownOverlay) {
    return;
  }
  ui.shutdownOverlay.classList.toggle("visible", Boolean(visible));
  ui.shutdownOverlay.setAttribute("aria-hidden", visible ? "false" : "true");
}

function highlightPresetButtons(presetId) {
  ui.presetButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.presetButton === presetId);
  });
}

function updateWindowState(windowState) {
  state.isMaximized = Boolean(windowState?.isMaximized);
  if (!ui.windowMaximizeButton) {
    return;
  }
  ui.windowMaximizeButton.classList.toggle("is-maximized", state.isMaximized);
  ui.windowMaximizeButton.setAttribute("aria-label", state.isMaximized ? "Restore" : "Maximize");
}

function withSessionById(layout) {
  const map = new Map();
  for (const session of layout.sessions || []) {
    map.set(session.id, session);
  }
  return map;
}

function getPresetConfig(layout, presetId) {
  const presets = layout?.presetSpec?.presets || {};
  return presets[presetId] || DEFAULT_PRESET_LAYOUTS[presetId] || DEFAULT_PRESET_LAYOUTS["1x2"];
}

function getVisiblePanes(layout) {
  const panes = Array.isArray(layout?.panes) ? layout.panes : [];
  return panes
    .filter((pane) => pane.state === "visible")
    .sort((a, b) => (a.positionIndex ?? 0) - (b.positionIndex ?? 0));
}

const GRID_PRESET_CLASS_NAMES = Object.freeze([
  "preset-1x2",
  "preset-1x4",
  "preset-2x6",
  "preset-2x8",

]);

function applyGridPreset(presetId) {
  ui.grid.classList.remove(...GRID_PRESET_CLASS_NAMES);
  if (typeof presetId === "string" && presetId.length > 0) {
    ui.grid.classList.add(`preset-${presetId}`);
  }
}

function getDisplayStatus(status) {
  if (!status || status === "running") {
    return "";
  }
  return String(status);
}

function getDisplayCwd(cwd) {
  if (typeof cwd !== "string") {
    return "경로 없음";
  }
  const trimmed = cwd.trim();
  return trimmed.length > 0 ? trimmed : "경로 없음";
}

function setPaneFooterCwd(view, cwd = view?.cwd) {
  if (!view?.footerPath) {
    return;
  }
  const displayCwd = getDisplayCwd(cwd);
  view.footerPath.textContent = displayCwd;
  view.footerPath.title = displayCwd;
}

function updateViewCwd(view, cwd) {
  if (!view || typeof cwd !== "string") {
    return;
  }
  const trimmed = cwd.trim();
  if (!trimmed) {
    return;
  }
  view.cwd = trimmed;
  setPaneFooterCwd(view, trimmed);
}

function captureTerminalSnapshotText(terminal, maxLines = TERMINAL_SNAPSHOT_MAX_LINES) {
  const activeBuffer = terminal?.buffer?.active;
  if (!activeBuffer || typeof activeBuffer.getLine !== "function") {
    return "";
  }

  const totalLines = Number(activeBuffer.length);
  if (!Number.isFinite(totalLines) || totalLines <= 0) {
    return "";
  }

  const boundedMaxLines = Number.isFinite(maxLines)
    ? Math.max(1, Math.min(20000, Math.floor(maxLines)))
    : TERMINAL_SNAPSHOT_MAX_LINES;
  const startLine = Math.max(0, totalLines - boundedMaxLines);

  const snapshotLines = [];
  for (let lineIndex = startLine; lineIndex < totalLines; lineIndex += 1) {
    const line = activeBuffer.getLine(lineIndex);
    if (!line) {
      continue;
    }

    snapshotLines.push({
      text: line.translateToString(true),
      isWrapped: Boolean(line.isWrapped),
    });
  }

  // Xterm buffers include many trailing empty viewport rows; trimming them prevents
  // fake vertical gaps after pane re-render and snapshot restore.
  while (snapshotLines.length > 1) {
    const last = snapshotLines[snapshotLines.length - 1];
    if (last?.text !== "" || last?.isWrapped) {
      break;
    }
    snapshotLines.pop();
  }

  if (snapshotLines.length === 0) {
    return "";
  }

  let snapshot = snapshotLines[0]?.text || "";
  for (let index = 1; index < snapshotLines.length; index += 1) {
    const row = snapshotLines[index];
    if (!row?.isWrapped) {
      snapshot += "\r\n";
    }
    snapshot += row?.text || "";
  }

  return snapshot;
}

function rememberPaneSnapshot(view) {
  if (!view?.sessionId) {
    return;
  }

  const snapshot = captureTerminalSnapshotText(view.terminal, TERMINAL_SNAPSHOT_MAX_LINES);
  if (!snapshot) {
    return;
  }
  state.sessionSnapshotBySessionId.set(view.sessionId, snapshot);
}

function restorePaneSnapshot(view) {
  if (!view?.sessionId || !view?.terminal) {
    return;
  }
  const snapshot = state.sessionSnapshotBySessionId.get(view.sessionId);
  if (!snapshot) {
    return;
  }

  try {
    view.terminal.write(snapshot);
  } catch (_error) {
    // Ignore snapshot restore failures during terminal initialization races.
  }
}

function clearPaneViews() {
  for (const view of state.paneViews.values()) {
    rememberPaneSnapshot(view);
    if (view.resizeObserver) {
      view.resizeObserver.disconnect();
    }
    if (view.fitTimer) {
      clearTimeout(view.fitTimer);
    }
    if (view.fitRafId) {
      cancelAnimationFrame(view.fitRafId);
    }
    if (view.outputFlushRafId) {
      cancelAnimationFrame(view.outputFlushRafId);
    }
    if (view.pendingSigintTimer) {
      clearTimeout(view.pendingSigintTimer);
    }
    if (Array.isArray(view.pendingOutputChunks)) {
      view.pendingOutputChunks.length = 0;
    }
    view.pendingOutputViewportLine = null;
    if (view.terminalHost && typeof view.handleWheelCapture === "function") {
      view.terminalHost.removeEventListener("wheel", view.handleWheelCapture, true);
    }
    if (typeof view.handleEditorMenuOutsideClick === "function") {
      document.removeEventListener("click", view.handleEditorMenuOutsideClick);
    }
    view.terminal?.dispose();
  }
  state.paneViews.clear();
  state.sessionToPaneId.clear();
  ui.grid.innerHTML = "";
  updateTitlebarPathSettingVisibility();
}

function syncPaneOverlayLayout(view) {
  if (!view?.actionsOverlay) {
    return;
  }

  view.actionsOverlay.classList.remove("is-wrapped");

  const groups = Array.isArray(view.actionsGroups) ? view.actionsGroups : [];
  let isWrapped = false;

  if (groups.length >= 2 && groups[0] && groups[1]) {
    isWrapped = Math.abs(groups[0].offsetTop - groups[1].offsetTop) > 1;
  } else {
    isWrapped = view.actionsOverlay.scrollHeight > view.actionsOverlay.clientHeight + 1;
  }

  view.actionsOverlay.classList.toggle("is-wrapped", isWrapped);
}

function scheduleFitAndResize(view) {
  if (view.fitTimer) {
    clearTimeout(view.fitTimer);
  }
  if (view.fitRafId) {
    cancelAnimationFrame(view.fitRafId);
    view.fitRafId = null;
  }

  view.fitTimer = setTimeout(() => {
    view.fitTimer = null;

    // Wait for the next paint so layout/padding changes are fully settled.
    view.fitRafId = requestAnimationFrame(() => {
      view.fitRafId = null;
      syncPaneOverlayLayout(view);
      try {
        view.fitAddon.fit();
      } catch (_error) {
        return;
      }

      if (!view.sessionId) {
        return;
      }

      const cols = Math.max(2, view.terminal.cols || 80);
      const rows = Math.max(1, view.terminal.rows || 24);
      const lastResize = view.lastRequestedResize;
      if (lastResize && lastResize.cols === cols && lastResize.rows === rows) {
        return;
      }

      const resizeRequest = { cols, rows };
      view.lastRequestedResize = resizeRequest;
      const capabilityToken = getSessionCapabilityToken(view.sessionId);
      if (!capabilityToken) {
        return;
      }
      api.pty
        .resize({
          sessionId: view.sessionId,
          capabilityToken,
          cols,
          rows,
        })
        .catch(() => {
          if (view.lastRequestedResize === resizeRequest) {
            view.lastRequestedResize = null;
          }
        });
    });
  }, TERMINAL_FIT_DEBOUNCE_MS);
}

function getViewportLineToPreserve(terminal) {
  const activeBuffer = terminal?.buffer?.active;
  const viewportY = activeBuffer?.viewportY;
  const baseY = activeBuffer?.baseY;
  if (
    typeof viewportY === "number"
    && typeof baseY === "number"
    && viewportY < baseY
  ) {
    return viewportY;
  }
  return null;
}

function scheduleTerminalOutputFlush(view) {
  if (!view || view.outputFlushRafId) {
    return;
  }

  view.outputFlushRafId = requestAnimationFrame(() => {
    view.outputFlushRafId = null;

    const chunks = Array.isArray(view.pendingOutputChunks) ? view.pendingOutputChunks : null;
    if (!chunks || chunks.length === 0) {
      view.pendingOutputViewportLine = null;
      return;
    }

    const text = chunks.join("");
    chunks.length = 0;
    if (!text) {
      view.pendingOutputViewportLine = null;
      return;
    }

    const keepViewport = Number.isFinite(view.pendingOutputViewportLine)
      ? view.pendingOutputViewportLine
      : null;
    view.pendingOutputViewportLine = null;

    try {
      view.terminal.write(text, () => {
        if (keepViewport === null) {
          return;
        }

        const nextBaseY = view.terminal.buffer?.active?.baseY;
        const targetLine =
          typeof nextBaseY === "number"
            ? Math.max(0, Math.min(keepViewport, nextBaseY))
            : Math.max(0, keepViewport);
        view.terminal.scrollToLine(targetLine);
      });
    } catch (_error) {
      // Ignore writes that race with terminal disposal.
    }
  });
}

function isPrimaryModifierPressed(event) {
  return Boolean(event.ctrlKey || event.metaKey);
}

function isMacPlatform() {
  return /mac/i.test(String(runtimeWindow.navigator?.platform || ""));
}

function isFontSizeDecreaseShortcut(event) {
  if (!event || event.altKey || !event.shiftKey) {
    return false;
  }

  const usesMacModifier = isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (!usesMacModifier) {
    return false;
  }

  const key = String(event.key || "");
  const code = String(event.code || "").toLowerCase();
  return key === "_" || code === "minus";
}

function adjustTerminalFontSize(delta) {
  const step = Number.parseInt(String(delta), 10);
  if (!Number.isFinite(step) || step === 0) {
    return false;
  }

  const nextSize = normalizeTerminalFontSize(state.terminalFontSize + step);
  if (nextSize === state.terminalFontSize) {
    setStatusLine(`터미널 폰트 크기 한계: ${nextSize}px`);
    return false;
  }

  applyTerminalFontSettings(
    { fontFamily: state.terminalFontFamily, fontSize: nextSize },
    { persist: true, refit: true, announce: true },
  );
  return true;
}

function getTerminalMouseTrackingMode(terminal) {
  const mode = String(terminal?.modes?.mouseTrackingMode || "none").trim().toLowerCase();
  return mode || "none";
}

function hasTerminalScrollbackHistory(terminal) {
  const baseY = Number(terminal?.buffer?.active?.baseY);
  return Number.isFinite(baseY) && baseY > 0;
}

function shouldConsumeWheelWithoutInputForwarding(terminal) {
  if (getTerminalMouseTrackingMode(terminal) !== "none") {
    return false;
  }

  const activeBufferType = String(terminal?.buffer?.active?.type || "normal").toLowerCase();
  const scrollback = Number(terminal?.options?.scrollback);
  const scrollbackEnabled = Number.isFinite(scrollback) ? scrollback > 0 : true;
  const hasScrollbackCapability =
    activeBufferType !== "alternate"
    && scrollbackEnabled
    && hasTerminalScrollbackHistory(terminal);
  return !hasScrollbackCapability;
}

function handleTerminalWheelScroll(event, terminal) {
  if (!event || !terminal) {
    return true;
  }

  // Keep native xterm scrolling when scrollback exists.
  // Only consume wheel when xterm would otherwise translate it to Up/Down input.
  if (shouldConsumeWheelWithoutInputForwarding(terminal)) {
    event.preventDefault();
    return false;
  }
  return true;
}

function handleTerminalHostWheelCapture(event, terminal, view) {
  const handled = handleTerminalWheelScroll(event, terminal);
  if (handled === false) {
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }
  return handled;
}

function isLetterShortcut(event, letter) {
  const expected = String(letter || "").trim().toLowerCase();
  if (!expected) {
    return false;
  }
  const key = String(event?.key || "").toLowerCase();
  const code = String(event?.code || "").toLowerCase();
  return key === expected || code === `key${expected}`;
}

function isCopyShortcut(event) {
  return (
    isPrimaryModifierPressed(event)
    && !event.shiftKey
    && !event.altKey
    && isLetterShortcut(event, "c")
  );
}

function isCopyInsertShortcut(event) {
  const key = String(event.key || "").toLowerCase();
  return event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && key === "insert";
}

function isPasteShortcut(event) {
  const key = String(event.key || "").toLowerCase();
  return (
    (
      isPrimaryModifierPressed(event)
      && !event.shiftKey
      && !event.altKey
      && isLetterShortcut(event, "v")
    ) ||
    (!event.ctrlKey && !event.metaKey && event.shiftKey && !event.altKey && key === "insert")
  );
}

function isSoftLineBreakShortcut(event) {
  const key = String(event.key || "").toLowerCase();
  const code = String(event.code || "").toLowerCase();
  const isEnter = key === "enter" || code === "enter" || code === "numpadenter";
  return event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && isEnter;
}

function isImeCompositionEvent(event) {
  if (!event) {
    return false;
  }

  if (event.isComposing) {
    return true;
  }

  const key = String(event.key || "").toLowerCase();
  const code = Number(event.keyCode);
  return key === "process" || key === "hangulmode" || key === "junjamode" || code === 229;
}

function clearPendingSigint(view) {
  if (!view) {
    return;
  }
  if (view.pendingSigintTimer) {
    clearTimeout(view.pendingSigintTimer);
    view.pendingSigintTimer = null;
  }
  view.pendingSigintExpiresAt = 0;
}

function armPendingSigint(view) {
  if (!view) {
    return;
  }
  clearPendingSigint(view);
  view.pendingSigintExpiresAt = Date.now() + CTRL_C_CONFIRM_WINDOW_MS;
  view.pendingSigintTimer = setTimeout(() => {
    view.pendingSigintTimer = null;
    view.pendingSigintExpiresAt = 0;
  }, CTRL_C_CONFIRM_WINDOW_MS);
}

function copyTerminalSelection(terminal) {
  const selectedText =
    terminal?.hasSelection()
      ? terminal.getSelection()
      : String(window.getSelection?.()?.toString?.() || "");
  if (!selectedText) {
    return false;
  }

  api.app.write
    .clipboardText(selectedText)
    .then((result) => {
      if (result?.ok === false) {
        setStatusLine(`복사 실패: ${String(result.error || "clipboard-write-failed")}`);
      }
    })
    .catch((error) => {
      setStatusLine(`복사 실패: ${String(error)}`);
    });
  return true;
}

function writeToSession(sessionId, data, options = {}) {
  const silent = Boolean(options.silent);
  const errorPrefix =
    typeof options.errorPrefix === "string" && options.errorPrefix.length > 0
      ? options.errorPrefix
      : "터미널 입력 실패";

  if (!sessionId || typeof data !== "string" || data.length === 0) {
    return Promise.resolve(false);
  }
  const capabilityToken = getSessionCapabilityToken(sessionId);
  if (!capabilityToken) {
    if (!silent) {
      setStatusLine(`${errorPrefix}: missing capability token`);
    }
    return Promise.resolve(false);
  }

  return api.pty
    .write({
      sessionId,
      capabilityToken,
      data,
    })
    .then((result) => {
      if (result?.ok === false) {
        if (!silent) {
          setStatusLine(`${errorPrefix}: ${String(result.error || "unknown")}`);
        }
        return false;
      }
      return true;
    })
    .catch((error) => {
      if (!silent) {
        setStatusLine(`${errorPrefix}: ${String(error)}`);
      }
      return false;
    });
}

function handleTerminalClipboardShortcut(event, terminal, view) {
  if (!event || event.type !== "keydown") {
    return true;
  }

  const key = String(event.key || "").toLowerCase();

  if (isSoftLineBreakShortcut(event)) {
    clearPendingSigint(view);
    event.preventDefault();
    event.stopPropagation();

    if (!view?.sessionId) {
      return false;
    }

    writeToSession(view.sessionId, "\n", { errorPrefix: "줄바꿈 입력 실패" });
    return false;
  }

  if (isImeCompositionEvent(event)) {
    return true;
  }

  if (isFontSizeDecreaseShortcut(event)) {
    event.preventDefault();
    event.stopPropagation();
    clearPendingSigint(view);
    adjustTerminalFontSize(-1);
    return false;
  }

  if (isCopyShortcut(event) || isCopyInsertShortcut(event)) {
    event.preventDefault();
    event.stopPropagation();

    if (copyTerminalSelection(terminal)) {
      clearPendingSigint(view);
      return false;
    }

    const canSendSigint =
      Boolean(view?.sessionId) &&
      typeof view.pendingSigintExpiresAt === "number" &&
      view.pendingSigintExpiresAt > Date.now();

    if (canSendSigint) {
      writeToSession(view.sessionId, "\u0003", { errorPrefix: "SIGINT 전송 실패" });
      clearPendingSigint(view);
      return false;
    }

    armPendingSigint(view);
    setStatusLine("Ctrl+C 한 번 더 누르면 SIGINT를 보냅니다");
    return false;
  }

  if (isPasteShortcut(event)) {
    clearPendingSigint(view);
    event.preventDefault();
    event.stopPropagation();

    api.app.read
      .clipboardImageToTemp()
      .then((imageResult) => {
        if (imageResult?.ok === true && typeof imageResult.path === "string" && imageResult.path.length > 0) {
          const attached = writeFilePathsToTerminal(view, [imageResult.path], "clipboard image");
          if (attached) {
            showClipboardPreview(view, imageResult);
            return;
          }
        }

        api.app.read
          .clipboardText()
          .then((text) => {
            if (!view.sessionId || typeof text !== "string" || text.length === 0) {
              if (imageResult?.ok === false && imageResult.error && imageResult.error !== "clipboard-image-empty") {
                setStatusLine(`이미지 첨부 실패: ${String(imageResult.error)}`);
              } else {
                setStatusLine("붙여넣기할 이미지/텍스트가 없습니다");
              }
              return;
            }
            writeToSession(view.sessionId, text, { errorPrefix: "붙여넣기 실패" });
          })
          .catch(() => {
            if (imageResult?.ok === false && imageResult.error && imageResult.error !== "clipboard-image-empty") {
              setStatusLine(`이미지 첨부 실패: ${String(imageResult.error)}`);
            } else {
              setStatusLine("붙여넣기 실패: clipboard read error");
            }
          });
      })
      .catch(() => {
        api.app.read
          .clipboardText()
          .then((text) => {
            if (!view.sessionId || typeof text !== "string" || text.length === 0) {
              setStatusLine("붙여넣기할 이미지/텍스트가 없습니다");
              return;
            }
            writeToSession(view.sessionId, text, { errorPrefix: "붙여넣기 실패" });
          })
          .catch(() => {
            setStatusLine("붙여넣기 실패: clipboard read error");
          });
      });

    return false;
  }

  if (
    view?.pendingSigintExpiresAt &&
    key !== "control" &&
    key !== "meta" &&
    key !== "shift" &&
    key !== "alt"
  ) {
    clearPendingSigint(view);
  }

  return true;
}

function normalizeFilePathList(paths) {
  if (!Array.isArray(paths)) {
    return [];
  }

  const unique = new Set();
  for (const rawPath of paths) {
    if (typeof rawPath !== "string") {
      continue;
    }
    const trimmed = rawPath.trim();
    if (!trimmed) {
      continue;
    }
    unique.add(trimmed);
  }
  return Array.from(unique);
}

function getShellKind(shell) {
  const value = String(shell || "").toLowerCase();
  if (value.includes("powershell") || value.includes("pwsh")) {
    return "powershell";
  }
  if (value === "cmd" || value.endsWith("cmd.exe") || value.includes("\\cmd.exe")) {
    return "cmd";
  }
  return "posix";
}

function quotePathForShell(filePath, shell) {
  const shellKind = getShellKind(shell);
  if (shellKind === "powershell") {
    return `'${filePath.replace(/'/g, "''")}'`;
  }
  if (shellKind === "cmd") {
    return `"${filePath.replace(/"/g, '\\"')}"`;
  }
  return `'${filePath.replace(/'/g, "'\\''")}'`;
}

function formatFilePathsForTerminal(paths, shell) {
  const normalized = normalizeFilePathList(paths);
  if (normalized.length === 0) {
    return {
      count: 0,
      text: "",
    };
  }

  return {
    count: normalized.length,
    text: normalized.map((filePath) => quotePathForShell(filePath, shell)).join(" "),
  };
}

function writeTextToTerminal(view, text) {
  if (!view?.sessionId) {
    return false;
  }

  const value = String(text || "");
  if (!value) {
    return false;
  }

  writeToSession(view.sessionId, value);
  return true;
}

function writeFilePathsToTerminal(view, paths, source) {
  const formatted = formatFilePathsForTerminal(paths, view?.sessionShell);
  if (formatted.count === 0 || !formatted.text) {
    return false;
  }

  const sent = writeTextToTerminal(view, `${formatted.text} `);
  if (!sent) {
    return false;
  }

  view.terminal.focus();
  setStatusLine(`${source}: ${formatted.count} file path(s) inserted`);
  return true;
}

function hideClipboardPreview(view) {
  if (!view?.clipboardPreviewContainer) {
    return;
  }
  view.clipboardPreviewContainer.classList.remove("visible");
}

function showClipboardPreview(view, imageResult) {
  if (!view?.clipboardPreviewContainer || !view.clipboardPreviewImage) {
    return;
  }

  const previewSrc = typeof imageResult?.dataUrl === "string" ? imageResult.dataUrl : "";
  const fileName = typeof imageResult?.fileName === "string" ? imageResult.fileName : "capture.png";
  const width = Number(imageResult?.width) || 0;
  const height = Number(imageResult?.height) || 0;

  if (!previewSrc) {
    return;
  }

  view.clipboardPreviewImage.src = previewSrc;
  view.clipboardPreviewImage.alt = fileName;
  if (view.clipboardPreviewName) {
    view.clipboardPreviewName.textContent = fileName;
  }
  if (view.clipboardPreviewMeta) {
    const sizeLabel = width > 0 && height > 0 ? `${width}x${height}` : "";
    view.clipboardPreviewMeta.textContent = sizeLabel ? `${sizeLabel} saved` : "saved";
  }
  view.clipboardPreviewContainer.classList.add("visible");
}

function shouldHideClipboardPreviewByInput(data) {
  const text = String(data || "");
  if (!text) {
    return false;
  }
  if (text.includes("\r") || text.includes("\n")) {
    return true;
  }
  if (text.includes("\u007f") || text.includes("\b")) {
    return true;
  }
  if (text.includes("\u001b[3~")) {
    return true;
  }
  return false;
}

function isFileDragEvent(event) {
  const types = event?.dataTransfer?.types;
  if (!types) {
    return false;
  }
  return Array.from(types).includes("Files");
}

function getDroppedFilePaths(event) {
  const files = event?.dataTransfer?.files;
  if (!files) {
    return [];
  }

  const paths = [];
  for (const file of Array.from(files)) {
    if (typeof file.path === "string" && file.path.trim().length > 0) {
      paths.push(file.path);
    }
  }

  return normalizeFilePathList(paths);
}

async function browseDirectoryForView(view) {
  if (!view?.sessionId) {
    return;
  }

  try {
    const result = await api.app.write.pickDirectory({
      defaultPath: view.cwd || undefined,
    });
    if (!result || result.canceled || !result.path) {
      return;
    }

    const capabilityToken = getSessionCapabilityToken(view.sessionId);
    if (!capabilityToken) {
      setStatusLine("path change failed: missing capability token");
      return;
    }
    await api.pty.changeDirectory({
      sessionId: view.sessionId,
      capabilityToken,
      cwd: result.path,
    });

    updateViewCwd(view, result.path);
    setStatusLine(`path changed: ${result.path}`);
    view.terminal.focus();
  } catch (error) {
    setStatusLine(`path change failed: ${String(error)}`);
  }
}

async function runCodexForView(view) {
  await runAgentForViewWithInstallCheck(view, "codex");
}

async function runClaudeForView(view) {
  await runAgentForViewWithInstallCheck(view, "claude");
}

async function runGeminiForView(view) {
  await runAgentForViewWithInstallCheck(view, "gemini");
}

async function getAgentLaunchCommand(agentCommand, fullAccessEnabled) {
  const config = FULL_ACCESS_AGENT_COMMANDS[agentCommand];
  if (!config) {
    return null;
  }
  let cmd = fullAccessEnabled ? config.fullAccess : config.normal;

  if (api?.app?.process?.readAgentsPolicy) {
    try {
      const result = await api.app.process.readAgentsPolicy();
      if (result?.ok && result.path && result.content?.trim().length > 0) {
        // We instruct the agent to read the AGENTS.md file from the app's installation directory.
        cmd += ` "I'll load ${result.path} now and align my behavior to it before taking any further action."`;
      }
    } catch (_error) {
      // Silently ignore policy read errors
    }
  }
  return cmd;
}

async function runAgentForView(view, agentCommand, options = {}) {
  if (!view?.sessionId) {
    return;
  }

  const command = await getAgentLaunchCommand(
    agentCommand,
    Boolean(view.fullAccessEnabled),
  );
  if (!command) {
    return;
  }

  writeToSession(view.sessionId, `${command}\r`, { errorPrefix: "명령 전송 실패" });
  view.terminal.focus();
  if (!options.silent) {
    const fullAccessLabel = view.fullAccessEnabled ? " (모든권한)" : "";
    setStatusLine(`${agentCommand} command sent${fullAccessLabel}`);
  }
}

function runClearForView(view) {
  if (!view) {
    return;
  }

  clearPendingSigint(view);

  if (typeof view.terminal?.clear === "function") {
    view.terminal.clear();
  }

  // Send Ctrl+L when a session is attached so interactive shells/CLIs can clear their view too.
  if (view.sessionId) {
    writeToSession(view.sessionId, "\u000c", { errorPrefix: "화면 정리 신호 전송 실패" });
  }

  view.terminal.focus();
  setStatusLine("screen cleared");
}

function createSessionExitWaiter(sessionId, timeoutMs = 3000) {
  let isSettled = false;
  let unsubscribe = null;
  let timeoutId = null;
  let resolvePromise = null;

  const settle = (didExit) => {
    if (isSettled) {
      return;
    }
    isSettled = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    resolvePromise(didExit);
  };

  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
    unsubscribe = api.pty.onExit((payload) => {
      if (payload?.sessionId !== sessionId) {
        return;
      }
      settle(true);
    });
    timeoutId = setTimeout(() => settle(false), timeoutMs);
  });

  return {
    promise,
    cancel: () => settle(false),
  };
}

async function killAndRecreateSession(view, reason = "agent-terminate") {
  if (!view?.sessionId) {
    throw new Error("missing session");
  }

  const sessionId = view.sessionId;
  const cols = Math.max(2, view.terminal?.cols || 80);
  const rows = Math.max(1, view.terminal?.rows || 24);
  const createPayload = {
    sessionId,
    cols,
    rows,
  };

  if (typeof view.cwd === "string" && view.cwd.length > 0) {
    createPayload.cwd = view.cwd;
  }
  if (typeof view.sessionShell === "string" && view.sessionShell.length > 0) {
    createPayload.shell = view.sessionShell;
  }

  const capabilityToken = getSessionCapabilityToken(sessionId);
  if (!capabilityToken) {
    throw new Error("missing capability token");
  }

  const exitWaiter = createSessionExitWaiter(sessionId);
  const killResult = await api.pty.kill({
    sessionId,
    capabilityToken,
    reason,
  });

  if (killResult?.reason === "already-stopped" || killResult?.reason === "missing-session") {
    exitWaiter.cancel();
  } else {
    const didExit = await exitWaiter.promise;
    if (!didExit) {
      throw new Error("session kill timeout");
    }
  }

  const recreated = await api.pty.create(createPayload);
  if (!recreated || recreated.id !== sessionId) {
    throw new Error("session recreate failed");
  }
  rememberSessionCapability(recreated.id, recreated.capabilityToken);
}

async function stopActiveAgentForView(view, options = {}) {
  if (!view?.sessionId || !view.selectedAgentCommand) {
    return false;
  }

  const shouldFocus = options.focus !== false;
  const silent = Boolean(options.silent);
  const activeAgent = view.selectedAgentCommand;
  setAgentCommandSelection(view, null);
  clearPendingSigint(view);

  try {
    await killAndRecreateSession(view);
    if (!silent) {
      setStatusLine(`${activeAgent} agent stopped (kill)`);
    }
  } catch (error) {
    setAgentCommandSelection(view, activeAgent);
    if (!silent) {
      setStatusLine(`agent stop failed: ${String(error)}`);
    }
    if (shouldFocus) {
      view.terminal.focus();
    }
    return false;
  }

  if (shouldFocus) {
    view.terminal.focus();
  }
  return true;
}

async function stopRememberedAgentBySessionId(sessionId, options = {}) {
  if (!sessionId) {
    return false;
  }

  const activeAgent = getRememberedAgentSelection(sessionId);
  if (!activeAgent) {
    return false;
  }

  const silent = Boolean(options.silent);
  state.selectedAgentBySessionId.delete(sessionId);

  const sessionSnapshot = getLayoutSessionById(sessionId);
  const recreateView = {
    sessionId,
    terminal: {
      cols: Number.isFinite(sessionSnapshot?.cols) ? sessionSnapshot.cols : 80,
      rows: Number.isFinite(sessionSnapshot?.rows) ? sessionSnapshot.rows : 24,
    },
    cwd: typeof sessionSnapshot?.cwd === "string" ? sessionSnapshot.cwd : "",
    sessionShell: typeof sessionSnapshot?.shell === "string" ? sessionSnapshot.shell : "",
  };

  try {
    await killAndRecreateSession(recreateView);
    if (!silent) {
      setStatusLine(`${activeAgent} agent stopped (kill)`);
    }
    return true;
  } catch (error) {
    state.selectedAgentBySessionId.set(sessionId, activeAgent);
    if (!silent) {
      setStatusLine(`agent stop failed: ${String(error)}`);
    }
    return false;
  }
}

function setFullAccessEnabled(view, enabled) {
  if (!view) {
    return;
  }

  const nextValue = Boolean(enabled);
  view.fullAccessEnabled = nextValue;

  if (!view.fullAccessButton) {
    return;
  }

  view.fullAccessButton.classList.toggle("is-selected", nextValue);
  view.fullAccessButton.setAttribute("aria-pressed", String(nextValue));
}

function setButtonVisibility(button, visible) {
  if (!button) {
    return;
  }

  const shouldShow = Boolean(visible);
  button.classList.toggle("is-hidden", !shouldShow);
  button.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  if (shouldShow) {
    button.removeAttribute("tabindex");
  } else {
    button.setAttribute("tabindex", "-1");
  }
}

function getSessionViewBySessionId(sessionId) {
  if (!sessionId) {
    return null;
  }

  const paneId = state.sessionToPaneId.get(sessionId);
  if (!paneId) {
    return null;
  }

  return state.paneViews.get(paneId) || null;
}

function getLayoutSessionById(sessionId) {
  if (!sessionId || !Array.isArray(state.layout?.sessions)) {
    return null;
  }

  for (const session of state.layout.sessions) {
    if (session?.id === sessionId) {
      return session;
    }
  }

  return null;
}

function rememberSessionCapability(sessionId, capabilityToken) {
  const normalizedSessionId = typeof sessionId === "string" ? sessionId : "";
  const normalizedToken = typeof capabilityToken === "string" ? capabilityToken : "";
  if (!normalizedSessionId || !normalizedToken) {
    return;
  }
  state.sessionCapabilityBySessionId.set(normalizedSessionId, normalizedToken);
}

function getSessionCapabilityToken(sessionId) {
  if (!sessionId) {
    return "";
  }
  return state.sessionCapabilityBySessionId.get(sessionId) || "";
}

function rememberSessionCapabilities(payload = {}) {
  for (const [sessionId, capabilityToken] of Object.entries(payload || {})) {
    rememberSessionCapability(sessionId, capabilityToken);
  }
}

function pruneSessionCapabilities(layout) {
  const keepSessionIds = new Set();
  for (const session of layout?.sessions || []) {
    const sessionId = typeof session?.id === "string" ? session.id : "";
    if (sessionId) {
      keepSessionIds.add(sessionId);
    }
  }

  for (const sessionId of state.sessionCapabilityBySessionId.keys()) {
    if (!keepSessionIds.has(sessionId)) {
      state.sessionCapabilityBySessionId.delete(sessionId);
    }
  }
}

function pruneSessionSnapshots(layout) {
  const keepSessionIds = new Set();
  for (const session of layout?.sessions || []) {
    const sessionId = typeof session?.id === "string" ? session.id : "";
    if (sessionId) {
      keepSessionIds.add(sessionId);
    }
  }

  for (const sessionId of state.sessionSnapshotBySessionId.keys()) {
    if (!keepSessionIds.has(sessionId)) {
      state.sessionSnapshotBySessionId.delete(sessionId);
    }
  }
}



function getActiveAgentSessionIds() {
  const aliveSessionIds = new Set(
    (state.layout?.sessions || [])
      .map((session) => session?.id)
      .filter((sessionId) => typeof sessionId === "string" && sessionId.length > 0),
  );
  const hasAliveSessionMap = aliveSessionIds.size > 0;
  const activeSessionIds = [];

  for (const [sessionId, agentCommand] of state.selectedAgentBySessionId.entries()) {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      continue;
    }

    if (!isAgentCommand(agentCommand)) {
      state.selectedAgentBySessionId.delete(sessionId);
      continue;
    }

    if (hasAliveSessionMap && !aliveSessionIds.has(sessionId)) {
      state.selectedAgentBySessionId.delete(sessionId);
      continue;
    }

    activeSessionIds.push(sessionId);
  }

  return activeSessionIds;
}

function hasAnyActiveAgent() {
  return getActiveAgentSessionIds().length > 0;
}

function getActiveAgentViews() {
  const activeViews = [];
  for (const sessionId of getActiveAgentSessionIds()) {
    const view = getSessionViewBySessionId(sessionId);
    if (view) {
      activeViews.push(view);
    }
  }
  return activeViews;
}

function getPresetPanelCount(presetId) {
  const fromLayoutSpec = state.layout?.presetSpec?.presets?.[presetId]?.panelCount;
  const fromDefaultSpec = DEFAULT_PRESET_LAYOUTS[presetId]?.panelCount;
  const resolved = Number(fromLayoutSpec ?? fromDefaultSpec);
  return Number.isFinite(resolved) && resolved > 0 ? resolved : 0;
}

function canSelectPresetForRunningAgents(
  presetId,
  runningAgentCount = getActiveAgentSessionIds().length,
) {
  const panelCount = getPresetPanelCount(presetId);
  const requiredCount = Math.max(0, Number(runningAgentCount) || 0);
  return panelCount >= requiredCount;
}

function updatePresetButtonVisibility() {
  const runningAgentCount = getActiveAgentSessionIds().length;
  const updateButton = (button, datasetKey) => {
    if (!button) {
      return;
    }

    const presetId = button.dataset?.[datasetKey];
    if (!presetId) {
      return;
    }

    const canSelect = canSelectPresetForRunningAgents(presetId, runningAgentCount);
    // Keep split preset buttons visible and only block interaction when unavailable.
    setButtonVisibility(button, true);
    button.disabled = !canSelect;
  };

  ui.presetButtons.forEach((button) => {
    updateButton(button, "presetButton");
  });
}

function setTitlebarElementVisibility(element, visible) {
  if (!element) {
    return;
  }

  const shouldShow = Boolean(visible);
  element.classList.toggle("is-hidden", !shouldShow);
  element.setAttribute("aria-hidden", shouldShow ? "false" : "true");
}

function setTitlebarButtonEnabled(button, enabled) {
  if (!button) {
    return;
  }

  const canUse = Boolean(enabled);
  button.disabled = !canUse;
  if (canUse) {
    button.removeAttribute("tabindex");
  } else {
    button.setAttribute("tabindex", "-1");
  }
}

function updateTitlebarPathSettingVisibility() {
  const hasActiveAgent = hasAnyActiveAgent();
  const isStoppingAllAgents = state.isStoppingAllAgents;
  const canUseSetupControls = !hasActiveAgent;
  const shouldShowSetupControls = canUseSetupControls && !isStoppingAllAgents;
  const shouldShowMountControls = !hasActiveAgent;
  const shouldShowAllExit = true;
  const canOpenFontDialog = !isStoppingAllAgents;

  setTitlebarElementVisibility(ui.titlebarPathDivider, shouldShowSetupControls);
  setTitlebarElementVisibility(ui.titlebarPathSettingButton, shouldShowSetupControls);
  setTitlebarElementVisibility(ui.titlebarSkillManagerButton, true);
  setTitlebarElementVisibility(ui.titlebarFontSettingButton, true);
  setTitlebarElementVisibility(ui.titlebarMountCodexButton, shouldShowMountControls);
  setTitlebarElementVisibility(ui.titlebarMountClaudeButton, shouldShowMountControls);
  setTitlebarElementVisibility(ui.titlebarMountGeminiButton, shouldShowMountControls);
  setTitlebarElementVisibility(ui.titlebarAllExitButton, shouldShowAllExit);

  setTitlebarButtonEnabled(ui.titlebarPathSettingButton, canUseSetupControls);
  setTitlebarButtonEnabled(ui.titlebarSkillManagerButton, !isStoppingAllAgents);
  setTitlebarButtonEnabled(ui.titlebarFontSettingButton, canOpenFontDialog);

  for (const button of [
    ui.titlebarMountCodexButton,
    ui.titlebarMountClaudeButton,
    ui.titlebarMountGeminiButton,
  ]) {
    setTitlebarButtonEnabled(button, !isStoppingAllAgents);
  }

  const canRunAllExit = hasActiveAgent && !isStoppingAllAgents;
  setTitlebarButtonEnabled(ui.titlebarAllExitButton, canRunAllExit);
}

async function applyGlobalDirectoryToVisiblePanes() {
  if (hasAnyActiveAgent()) {
    updateTitlebarPathSettingVisibility();
    setStatusLine("에이전트 실행 중에는 경로설정을 사용할 수 없습니다");
    return;
  }

  const views = [...state.paneViews.values()].filter((view) => Boolean(view?.sessionId));
  if (views.length === 0) {
    setStatusLine("적용할 패널이 없습니다");
    return;
  }

  const defaultPathView = views.find((view) => typeof view.cwd === "string" && view.cwd.trim());

  try {
    const result = await api.app.write.pickDirectory({
      defaultPath: defaultPathView?.cwd || undefined,
    });
    if (!result || result.canceled || !result.path) {
      return;
    }

    let successCount = 0;
    for (const view of views) {
      try {
        const capabilityToken = getSessionCapabilityToken(view.sessionId);
        if (!capabilityToken) {
          continue;
        }
        await api.pty.changeDirectory({
          sessionId: view.sessionId,
          capabilityToken,
          cwd: result.path,
        });
        updateViewCwd(view, result.path);
        successCount += 1;
      } catch (_error) {
        // Continue applying path to remaining panes.
      }
    }

    if (successCount === views.length) {
      setStatusLine(`경로설정 완료: ${result.path}`);
    } else {
      setStatusLine(`경로설정 부분 완료: ${successCount}/${views.length}`);
    }

    views[0]?.terminal?.focus();
  } catch (error) {
    setStatusLine(`경로설정 실패: ${String(error)}`);
  }
}

function isAgentCommand(agentCommand) {
  return agentCommand === "codex" || agentCommand === "claude" || agentCommand === "gemini";
}

function rememberAgentSelection(view) {
  if (!view?.sessionId) {
    return;
  }

  if (isAgentCommand(view.selectedAgentCommand)) {
    state.selectedAgentBySessionId.set(view.sessionId, view.selectedAgentCommand);
    return;
  }

  state.selectedAgentBySessionId.delete(view.sessionId);
}

function getRememberedAgentSelection(sessionId) {
  if (!sessionId) {
    return null;
  }

  const remembered = state.selectedAgentBySessionId.get(sessionId);
  return isAgentCommand(remembered) ? remembered : null;
}

function pruneRememberedAgentSelections(layout) {
  const aliveSessionIds = new Set(
    (layout?.sessions || [])
      .map((session) => session?.id)
      .filter((sessionId) => typeof sessionId === "string" && sessionId.length > 0),
  );

  for (const sessionId of state.selectedAgentBySessionId.keys()) {
    if (!aliveSessionIds.has(sessionId)) {
      state.selectedAgentBySessionId.delete(sessionId);
    }
  }
}

function getVisibleSessionViews() {
  return [...state.paneViews.values()].filter((view) => Boolean(view?.sessionId));
}

async function mountAgentToAllVisiblePanes(agentCommand) {
  if (!isAgentCommand(agentCommand)) {
    return;
  }

  let views = getVisibleSessionViews();
  if (views.length === 0) {
    setStatusLine("마운트할 패널이 없습니다");
    return;
  }

  const allAlreadyMounted = views.every((view) => view.selectedAgentCommand === agentCommand);
  if (allAlreadyMounted) {
    const label = AGENT_COMMAND_LABELS[agentCommand] || agentCommand;
    setStatusLine(`이미 전체 마운트됨: ${label}`);
    views[0]?.terminal?.focus();
    return;
  }

  if (state.isStoppingAllAgents) {
    setStatusLine("에이전트 종료 작업이 진행 중입니다");
    views[0]?.terminal?.focus();
    return;
  }

  if (hasAnyActiveAgent()) {
    const label = AGENT_COMMAND_LABELS[agentCommand] || agentCommand;
    setStatusLine(`기존 에이전트 종료 후 ${label}로 전환 중...`);
    await stopAllActiveAgents();
    if (hasAnyActiveAgent()) {
      setStatusLine(`${label} 전환 실패: 기존 에이전트 종료가 필요합니다`);
      views[0]?.terminal?.focus();
      return;
    }
    views = getVisibleSessionViews();
    if (views.length === 0) {
      setStatusLine("마운트할 패널이 없습니다");
      return;
    }
  }

  const installed = await ensureAgentInstalled(agentCommand);
  if (!installed) {
    views[0]?.terminal?.focus();
    return;
  }

  for (const view of views) {
    setAgentCommandSelection(view, agentCommand);
    runAgentForView(view, agentCommand, { silent: true });
  }

  const label = AGENT_COMMAND_LABELS[agentCommand] || agentCommand;
  setStatusLine(`전체 마운트 완료: ${label} (${views.length} panes)`);
  views[0]?.terminal?.focus();
}

async function stopAllActiveAgents() {
  if (state.isStoppingAllAgents) {
    return;
  }

  const activeSessionIds = getActiveAgentSessionIds();
  if (activeSessionIds.length === 0) {
    updateTitlebarPathSettingVisibility();
    setStatusLine("종료할 에이전트가 없습니다");
    return;
  }

  state.isStoppingAllAgents = true;
  updateTitlebarPathSettingVisibility();

  let stoppedCount = 0;
  let stopError = null;
  try {
    for (const sessionId of activeSessionIds) {
      const view = getSessionViewBySessionId(sessionId);
      let stopped = false;
      if (view) {
        stopped = await stopActiveAgentForView(view, { silent: true, focus: false });
      }
      if (!stopped) {
        stopped = await stopRememberedAgentBySessionId(sessionId, { silent: true });
      }
      if (stopped) {
        stoppedCount += 1;
      }
    }
  } catch (error) {
    stopError = error;
  } finally {
    state.isStoppingAllAgents = false;
    updateTitlebarPathSettingVisibility();
  }

  const failedCount = activeSessionIds.length - stoppedCount;
  if (stopError) {
    setStatusLine(`all exit failed: ${String(stopError)}`);
  } else if (failedCount === 0) {
    setStatusLine(`all exit complete (${stoppedCount})`);
  } else if (stoppedCount === 0) {
    setStatusLine(`all exit failed (${failedCount})`);
  } else {
    setStatusLine(`all exit partial (${stoppedCount}/${activeSessionIds.length})`);
  }

  const fallbackView = getVisibleSessionViews()[0];
  fallbackView?.terminal?.focus();
}

function setFullAccessButtonVisibility(view, visible) {
  if (!view?.fullAccessButton) {
    return;
  }

  setButtonVisibility(view.fullAccessButton, visible);
}

async function toggleFullAccessForView(view) {
  if (!view) {
    return;
  }

  if (view.isApplyingFullAccess) {
    return;
  }

  const previousValue = Boolean(view.fullAccessEnabled);
  const nextValue = !previousValue;
  const activeAgent = view.selectedAgentCommand;

  setFullAccessEnabled(view, nextValue);
  const modeLabel = nextValue ? "enabled" : "disabled";

  if (!activeAgent || !view.sessionId) {
    setStatusLine(`모든권한 ${modeLabel}`);
    view.terminal?.focus();
    return;
  }

  view.isApplyingFullAccess = true;

  try {
    await killAndRecreateSession(view, "full-access-toggle");
    runAgentForView(view, activeAgent);
    setStatusLine(`모든권한 ${modeLabel}; ${activeAgent} restarted`);
  } catch (error) {
    setFullAccessEnabled(view, previousValue);
    setStatusLine(`모든권한 적용 실패: ${String(error)}`);
  } finally {
    view.isApplyingFullAccess = false;
    setAgentCommandSelection(view, view.selectedAgentCommand);
    view.terminal?.focus();
  }
}

function setAgentCommandSelection(view, command) {
  if (!view) {
    return;
  }

  const selected =
    command === "codex" || command === "claude" || command === "gemini" ? command : null;
  view.selectedAgentCommand = selected;
  rememberAgentSelection(view);

  const codexSelected = selected === "codex";
  const claudeSelected = selected === "claude";
  const geminiSelected = selected === "gemini";
  const hasActiveAgent = Boolean(selected);
  const shouldShowBrowseButton = !hasActiveAgent;

  if (view.browseButton) {
    setButtonVisibility(view.browseButton, shouldShowBrowseButton);
  }

  if (view.codexButton) {
    view.codexButton.classList.toggle("is-selected", codexSelected);
    view.codexButton.setAttribute("aria-pressed", String(codexSelected));
    setButtonVisibility(view.codexButton, !hasActiveAgent || codexSelected);
  }

  if (view.claudeButton) {
    view.claudeButton.classList.toggle("is-selected", claudeSelected);
    view.claudeButton.setAttribute("aria-pressed", String(claudeSelected));
    setButtonVisibility(view.claudeButton, !hasActiveAgent || claudeSelected);
  }

  if (view.geminiButton) {
    view.geminiButton.classList.toggle("is-selected", geminiSelected);
    view.geminiButton.setAttribute("aria-pressed", String(geminiSelected));
    setButtonVisibility(view.geminiButton, !hasActiveAgent || geminiSelected);
  }

  if (view.terminateButton) {
    setButtonVisibility(view.terminateButton, hasActiveAgent);
  }

  if (view.clearButton) {
    setButtonVisibility(view.clearButton, !hasActiveAgent);
  }

  setFullAccessButtonVisibility(view, hasActiveAgent);
  if (!hasActiveAgent) {
    setFullAccessEnabled(view, DEFAULT_FULL_ACCESS_ENABLED);
  }

  scheduleFitAndResize(view);
  updatePresetButtonVisibility();
  updateTitlebarPathSettingVisibility();
}

const EDITOR_ICONS = {
  finder: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" rx="4" fill="#007AFF"/><path d="M4 6.5C4 6.5 5 7 6 7C7 7 8 6.5 8 6.5" stroke="white" stroke-width="1.5" stroke-linecap="round"/><path d="M10 5.5v2" stroke="white" stroke-width="1.5" stroke-linecap="round"/><path d="M12.5 5.5v2" stroke="white" stroke-width="1.5" stroke-linecap="round"/><path d="M4.5 10c1 1.5 6 1.5 7 0" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>',
  explorer: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="3" width="14" height="10" rx="2" fill="#d5a037"/><path d="M1 6h14" stroke="#8a6519" stroke-width="1"/><path d="M2.5 5h4l1 1h6.5" stroke="#f5c462" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  terminal: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" rx="4" fill="#1e1e1e"/><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" stroke="#7e7e7e"/><path d="M4 5L7 8L4 11" stroke="#4AF626" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 11H12" stroke="#4AF626" stroke-width="1.5" stroke-linecap="round"/></svg>',
  vscode: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 2L4 7L11 12V2Z" fill="#0066b8"/><path d="M4 7l7 5-2.5 3L2 11l2-4z" fill="#007acc"/><path d="M11 2L4 7 2 5l6.5-4L11 2z" fill="#1f9ae0"/><path d="M11 2v10l3-2.5V4.5L11 2z" fill="#24292e"/></svg>',
  cursor: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" rx="4" fill="#1e1e1e"/><path d="M11 11L6 11V6" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 11L5 5" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>',
  windsurf: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" rx="4" fill="#0f172a"/><path d="M2 10c1.8-2.6 3.3-3.9 4.7-3.9 1.3 0 2 .9 2.6 1.7.7.9 1.2 1.5 2.1 1.5.8 0 1.6-.5 2.6-1.7" stroke="#67e8f9" stroke-width="1.2" stroke-linecap="round"/><path d="M2.2 12.2c1.5-1.6 2.8-2.4 3.9-2.4 1 0 1.7.6 2.3 1.1.7.6 1.4 1.2 2.5 1.2 1 0 2-.5 3.1-1.6" stroke="#22d3ee" stroke-width="1.2" stroke-linecap="round"/></svg>',
  idea: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" rx="4" fill="#000000"/><rect x="2" y="2" width="12" height="12" fill="url(#paint0_linear)"/><path d="M5 11H7V5H5V11ZM9 11H11V8H9V11ZM9 6.5H11V5H9V6.5Z" fill="white"/><defs><linearGradient id="paint0_linear" x1="2" y1="2" x2="14" y2="14" gradientUnits="userSpaceOnUse"><stop stop-color="#FE2857"/><stop offset="1" stop-color="#05C9F9"/></linearGradient></defs></svg>',
  xcode: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" rx="4" fill="#1c75db"/><path d="M4 12l2.5-8L12 12M5.5 8.5h5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fallback: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" rx="4" fill="#555555"/><path d="M8 4L4 12h8L8 4z" fill="white"/></svg>',
};

let cachedEditorList = null;

function getEditorMenuFallbackList() {
  return [
    { id: "idea", name: "IntelliJ IDEA" },
    { id: "cursor", name: "Cursor" },
    { id: "vscode", name: "VS Code" },
    { id: "windsurf", name: "Windsurf" },
    { id: "explorer", name: "Explorer" },
  ];
}

function mergeEditorMenuItems(primaryItems = [], fallbackItems = []) {
  const primaryById = new Map();
  for (const item of primaryItems) {
    const id = String(item?.id || "").trim();
    if (!id) {
      continue;
    }
    primaryById.set(id, item);
  }

  const merged = [];
  const seen = new Set();
  for (const fallback of fallbackItems) {
    const id = String(fallback?.id || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(primaryById.get(id) || fallback);
  }

  for (const item of primaryItems) {
    const id = String(item?.id || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(item);
  }

  return merged;
}

async function populateEditorMenu(view) {
  if (!view.editorMenu || !view.openButtonIcon || !view.openButtonText) {
    return;
  }

  const renderItems = (items) => {
    view.editorMenu.innerHTML = '<div class="pane-editor-menu-header">Open in</div>';

    // Always pre-select the first item (usually cursor or vscode) for the main button
    if (items.length > 0 && !view.selectedEditorId) {
      view.selectedEditorId = items[0].id;
      view.openButtonText.textContent = items[0].name;
      if (items[0].icon) {
        view.openButtonIcon.innerHTML = `<img src="${items[0].icon}" alt="" style="width: 100%; height: 100%; object-fit: contain; border-radius: 3px;" />`;
      } else {
        view.openButtonIcon.innerHTML = EDITOR_ICONS[items[0].id] || EDITOR_ICONS.fallback;
      }
    }

    for (const editor of items) {
      const itemBtn = document.createElement("button");
      itemBtn.className = "pane-editor-menu-item";

      const iconSpan = document.createElement("span");
      iconSpan.className = "pane-editor-menu-icon";
      if (editor.icon) {
        iconSpan.innerHTML = `<img src="${editor.icon}" alt="" style="width: 100%; height: 100%; object-fit: contain; border-radius: 3px;" />`;
      } else {
        iconSpan.innerHTML = EDITOR_ICONS[editor.id] || EDITOR_ICONS.fallback;
      }

      const labelSpan = document.createElement("span");
      labelSpan.textContent = editor.name;

      itemBtn.appendChild(iconSpan);
      itemBtn.appendChild(labelSpan);

      itemBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        view.selectedEditorId = editor.id;
        view.openButtonText.textContent = editor.name;
        if (editor.icon) {
          view.openButtonIcon.innerHTML = `<img src="${editor.icon}" alt="" style="width: 100%; height: 100%; object-fit: contain; border-radius: 3px;" />`;
        } else {
          view.openButtonIcon.innerHTML = EDITOR_ICONS[editor.id] || EDITOR_ICONS.fallback;
        }
        view.editorMenu.classList.remove("is-open");
      });

      view.editorMenu.appendChild(itemBtn);
    }
  };

  if (Array.isArray(cachedEditorList)) {
    renderItems(cachedEditorList.length > 0 ? cachedEditorList : getEditorMenuFallbackList());
    return;
  }

  const fallbackList = getEditorMenuFallbackList();
  cachedEditorList = fallbackList;
  renderItems(fallbackList);

  if (!api?.app?.process?.queryEditors) {
    return;
  }
  try {
    const result = await Promise.race([
      api.app.process.queryEditors(),
      new Promise((resolve) => setTimeout(
        () => resolve({ ok: false, error: "editor-query-timeout", editors: [] }),
        EDITOR_QUERY_TIMEOUT_MS,
      )),
    ]);
    if (result?.ok && Array.isArray(result.editors)) {
      cachedEditorList = mergeEditorMenuItems(result.editors, fallbackList);
      renderItems(cachedEditorList);
    }
  } catch (_error) {
    // Keep fallback list already rendered.
  }
}

function createPaneView(pane, index, preset, sessionMap) {
  const session = pane.sessionId ? sessionMap.get(pane.sessionId) : null;
  const initialCwd = typeof session?.cwd === "string" ? session.cwd.trim() : "";

  const root = document.createElement("section");
  root.className = "pane";

  const header = document.createElement("header");
  header.className = "pane-header";

  const body = document.createElement("div");
  body.className = "pane-body";

  const actionsOverlay = document.createElement("div");
  actionsOverlay.className = "pane-actions-overlay";
  const actionsLeft = document.createElement("div");
  actionsLeft.className = "pane-actions-group";
  const actionsRight = document.createElement("div");
  actionsRight.className = "pane-actions-group";

  const browseButton = document.createElement("button");
  browseButton.type = "button";
  browseButton.className = "pane-path-btn";
  browseButton.title = "경로설정";
  browseButton.textContent = "경로설정";

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "pane-path-btn";
  clearButton.title = "화면정리";
  clearButton.textContent = "화면정리";

  const terminateButton = document.createElement("button");
  terminateButton.type = "button";
  terminateButton.className = "pane-path-btn pane-terminate-btn";
  terminateButton.title = "종료";
  terminateButton.textContent = "종료";

  const codexButton = document.createElement("button");
  codexButton.type = "button";
  codexButton.className = "pane-path-btn pane-agent-btn";
  codexButton.title = "Codex";
  codexButton.textContent = "Codex";
  codexButton.setAttribute("aria-pressed", "false");

  const claudeButton = document.createElement("button");
  claudeButton.type = "button";
  claudeButton.className = "pane-path-btn pane-agent-btn";
  claudeButton.title = "Claude";
  claudeButton.textContent = "Claude";
  claudeButton.setAttribute("aria-pressed", "false");

  const geminiButton = document.createElement("button");
  geminiButton.type = "button";
  geminiButton.className = "pane-path-btn pane-agent-btn";
  geminiButton.title = "Gemini";
  geminiButton.textContent = "Gemini";
  geminiButton.setAttribute("aria-pressed", "false");

  const fullAccessButton = document.createElement("button");
  fullAccessButton.type = "button";
  fullAccessButton.className = "pane-path-btn pane-full-access-btn";
  fullAccessButton.title = "모든권한";
  fullAccessButton.textContent = "모든권한";
  fullAccessButton.setAttribute("aria-pressed", "false");

  const editorGroup = document.createElement("div");
  editorGroup.className = "pane-editor-group";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "pane-open-btn";

  const openButtonIcon = document.createElement("span");
  openButtonIcon.className = "pane-open-icon";
  openButtonIcon.innerHTML = EDITOR_ICONS.fallback;

  const openButtonText = document.createElement("span");
  openButtonText.textContent = "Open";

  const openButtonChevron = document.createElement("span");
  openButtonChevron.className = "pane-open-chevron";
  openButtonChevron.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';

  openButton.appendChild(openButtonIcon);
  openButton.appendChild(openButtonText);
  openButton.appendChild(openButtonChevron);

  const editorMenu = document.createElement("div");
  editorMenu.className = "pane-editor-menu";

  editorGroup.appendChild(openButton);
  editorGroup.appendChild(editorMenu);

  const terminalHost = document.createElement("div");
  terminalHost.className = "terminal-host";

  const clipboardPreviewContainer = document.createElement("div");
  clipboardPreviewContainer.className = "clipboard-preview";
  const clipboardPreviewImage = document.createElement("img");
  clipboardPreviewImage.className = "clipboard-preview-image";
  clipboardPreviewImage.alt = "";
  const clipboardPreviewText = document.createElement("div");
  clipboardPreviewText.className = "clipboard-preview-text";
  const clipboardPreviewName = document.createElement("div");
  clipboardPreviewName.className = "clipboard-preview-name";
  const clipboardPreviewMeta = document.createElement("div");
  clipboardPreviewMeta.className = "clipboard-preview-meta";
  const clipboardPreviewClose = document.createElement("button");
  clipboardPreviewClose.type = "button";
  clipboardPreviewClose.className = "clipboard-preview-close";
  clipboardPreviewClose.textContent = "×";
  clipboardPreviewClose.title = "close";
  clipboardPreviewText.appendChild(clipboardPreviewName);
  clipboardPreviewText.appendChild(clipboardPreviewMeta);
  clipboardPreviewContainer.appendChild(clipboardPreviewImage);
  clipboardPreviewContainer.appendChild(clipboardPreviewText);
  clipboardPreviewContainer.appendChild(clipboardPreviewClose);

  const footer = document.createElement("footer");
  footer.className = "pane-footer";
  const footerPath = document.createElement("span");
  footerPath.className = "pane-footer-path";
  footer.appendChild(footerPath);

  actionsLeft.appendChild(codexButton);
  actionsLeft.appendChild(claudeButton);
  actionsLeft.appendChild(geminiButton);
  actionsRight.appendChild(editorGroup);
  actionsRight.appendChild(fullAccessButton);
  actionsRight.appendChild(clearButton);
  actionsRight.appendChild(browseButton);
  actionsRight.appendChild(terminateButton);
  actionsOverlay.appendChild(actionsLeft);
  actionsOverlay.appendChild(actionsRight);
  header.appendChild(actionsOverlay);
  root.appendChild(header);
  body.appendChild(terminalHost);
  body.appendChild(clipboardPreviewContainer);
  root.appendChild(body);
  root.appendChild(footer);

  const terminal = new TerminalCtor({
    cursorBlink: true,
    convertEol: true,
    allowProposedApi: false,
    fontFamily: state.terminalFontFamily,
    fontSize: state.terminalFontSize,
    lineHeight: 1.2,
    rescaleOverlappingGlyphs: false,
    scrollback: TERMINAL_SCROLLBACK,
    overviewRuler: {
      width: 1,
    },
    theme: {
      background: "#1e1e1e",
      foreground: "#cccccc",
      cursor: "#aeafad",
      cursorAccent: "#1e1e1e",
      selectionBackground: "rgba(255, 255, 255, 0.2)",
      selectionInactiveBackground: "rgba(255, 255, 255, 0.12)",
      scrollbarSliderBackground: "rgba(121, 121, 121, 0.36)",
      scrollbarSliderHoverBackground: "rgba(121, 121, 121, 0.52)",
      scrollbarSliderActiveBackground: "rgba(121, 121, 121, 0.64)",
      overviewRulerBorder: "#1e1e1e",
    },
  });
  const fitAddon = new FitAddonCtor();
  terminal.loadAddon(fitAddon);

  const view = {
    root,
    header,
    body,
    actionsOverlay,
    actionsGroups: [actionsLeft, actionsRight],
    terminalHost,
    terminal,
    fitAddon,
    sessionId: pane.sessionId || null,
    cwd: initialCwd,
    footerPath,
    sessionShell: session?.shell || "",
    terminateButton,
    clearButton,
    browseButton,
    codexButton,
    claudeButton,
    geminiButton,
    fullAccessButton,
    editorGroup,
    openButton,
    openButtonIcon,
    openButtonText,
    editorMenu,
    selectedEditorId: null,
    fullAccessEnabled: DEFAULT_FULL_ACCESS_ENABLED,
    isApplyingFullAccess: false,
    selectedAgentCommand: null,
    resizeObserver: null,
    fitTimer: null,
    fitRafId: null,
    outputFlushRafId: null,
    pendingOutputChunks: [],
    pendingOutputViewportLine: null,
    handleWheelCapture: null,
    lastRequestedResize: null,
    pendingSigintExpiresAt: 0,
    pendingSigintTimer: null,
    handleEditorMenuOutsideClick: null,
    clipboardPreviewContainer,
    clipboardPreviewImage,
    clipboardPreviewName,
    clipboardPreviewMeta,
  };

  restorePaneSnapshot(view);

  const handleWheelCapture = (event) =>
    handleTerminalHostWheelCapture(event, terminal, view);
  view.handleWheelCapture = handleWheelCapture;
  terminalHost.addEventListener("wheel", handleWheelCapture, { capture: true, passive: false });
  terminal.attachCustomKeyEventHandler((event) =>
    handleTerminalClipboardShortcut(event, terminal, view),
  );
  terminal.attachCustomWheelEventHandler((event) => handleTerminalWheelScroll(event, terminal));
  terminal.onData((data) => {
    if (!pane.sessionId) {
      return;
    }
    if (shouldHideClipboardPreviewByInput(data)) {
      hideClipboardPreview(view);
    }
    writeToSession(pane.sessionId, data, { silent: true });
  });

  // Do not replay cached raw PTY output on pane re-creation.
  // Replaying control-query sequences (for example, DA/DSR requests) can
  // cause terminals to emit response bytes back into the shell when presets
  // are switched, which appears as garbled input.

  setPaneFooterCwd(view, initialCwd);
  const rememberedAgent = getRememberedAgentSelection(view.sessionId);
  setAgentCommandSelection(view, rememberedAgent);
  setFullAccessEnabled(view, DEFAULT_FULL_ACCESS_ENABLED);

  browseButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await browseDirectoryForView(view);
  });
  openButton.addEventListener("click", async (event) => {
    event.stopPropagation();

    if (editorMenu.childElementCount <= 1) {
      await populateEditorMenu(view);
    }

    // Default click opens/closes the list for reliability.
    const forceDirectOpen = Boolean(event.shiftKey || event.ctrlKey || event.metaKey);
    if (!forceDirectOpen) {
      editorMenu.classList.toggle("is-open");
      return;
    }

    editorMenu.classList.remove("is-open");

    const editorId = view.selectedEditorId;
    if (!editorId) {
      setStatusLine("에디터 목록을 먼저 불러와주세요");
      return;
    }
    const cwd = view.cwd || process.cwd?.() || "";
    if (!api?.app?.process?.openInEditor) {
      setStatusLine("열기 기능을 사용할 수 없습니다");
      return;
    }
    try {
      const result = await api.app.process.openInEditor({ editorId, cwd });
      if (result?.ok) {
        setStatusLine(`${view.openButtonText.textContent}에서 열기 완료`);
      } else {
        setStatusLine(`열기 실패: ${formatOpenInEditorError(result?.error)}`);
      }
    } catch (error) {
      setStatusLine(`열기 실패: ${String(error)}`);
    }
  });

  // Close menu when clicking outside
  const handleEditorMenuOutsideClick = (event) => {
    if (!editorGroup.contains(event.target)) {
      editorMenu.classList.remove("is-open");
    }
  };
  view.handleEditorMenuOutsideClick = handleEditorMenuOutsideClick;
  document.addEventListener("click", handleEditorMenuOutsideClick);

  populateEditorMenu(view);
  codexButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await runCodexForView(view);
  });
  claudeButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await runClaudeForView(view);
  });
  geminiButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await runGeminiForView(view);
  });
  fullAccessButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await toggleFullAccessForView(view);
  });
  clearButton.addEventListener("click", (event) => {
    event.stopPropagation();
    runClearForView(view);
  });
  terminateButton.addEventListener("click", (event) => {
    event.stopPropagation();
    stopActiveAgentForView(view);
  });
  clipboardPreviewClose.addEventListener("click", (event) => {
    event.stopPropagation();
    hideClipboardPreview(view);
  });

  let dragDepth = 0;
  const setFileDragActive = (active) => {
    body.classList.toggle("is-file-drag-over", Boolean(active));
  };

  const handleDragEnter = (event) => {
    if (!isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepth += 1;
    setFileDragActive(true);
  };

  const handleDragOver = (event) => {
    if (!isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    setFileDragActive(true);
  };

  const handleDragLeave = (event) => {
    if (!isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      setFileDragActive(false);
    }
  };

  const handleDrop = (event) => {
    if (!isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    setFileDragActive(false);

    const droppedPaths = getDroppedFilePaths(event);
    const handled = writeFilePathsToTerminal(view, droppedPaths, "file drop");
    if (!handled) {
      setStatusLine("file drop failed: no file path");
    }
  };

  body.addEventListener("dragenter", handleDragEnter);
  body.addEventListener("dragover", handleDragOver);
  body.addEventListener("dragleave", handleDragLeave);
  body.addEventListener("drop", handleDrop);

  // Let xterm handle pointer events naturally so drag-selection is not interrupted.

  return view;
}

function updatePaneStatusBySessionId(sessionId, status, cwd, shell) {
  const sessionSnapshot = getLayoutSessionById(sessionId);
  if (sessionSnapshot) {
    if (typeof status === "string" && status.length > 0) {
      sessionSnapshot.status = status;
    }
    if (typeof cwd === "string" && cwd.length > 0) {
      sessionSnapshot.cwd = cwd;
    }
    if (typeof shell === "string" && shell.length > 0) {
      sessionSnapshot.shell = shell;
    }
  }

  const view = getSessionViewBySessionId(sessionId);
  if (!view) {
    return;
  }

  if (typeof cwd === "string" && cwd.length > 0) {
    updateViewCwd(view, cwd);
  }
  if (typeof shell === "string" && shell.length > 0) {
    view.sessionShell = shell;
  }
}

function appendOutput(sessionId, data) {
  const paneId = state.sessionToPaneId.get(sessionId);
  if (!paneId) {
    return;
  }

  const view = state.paneViews.get(paneId);
  if (!view) {
    return;
  }

  const chunk = String(data || "");
  if (!chunk) {
    return;
  }

  if (view.pendingOutputViewportLine === null) {
    view.pendingOutputViewportLine = getViewportLineToPreserve(view.terminal);
  }
  view.pendingOutputChunks.push(chunk);
  scheduleTerminalOutputFlush(view);
}

function renderLayout(layout) {
  clearPaneViews();
  state.layout = JSON.parse(JSON.stringify(layout));
  rememberSessionCapabilities(layout?.sessionCapabilities || {});
  pruneSessionCapabilities(state.layout);
  pruneSessionSnapshots(state.layout);
  pruneRememberedAgentSelections(state.layout);

  const preset = getPresetConfig(state.layout, state.layout.presetId);
  const visiblePanes = getVisiblePanes(state.layout);
  const sessionMap = withSessionById(state.layout);

  applyGridPreset(state.layout.presetId);
  highlightPresetButtons(state.layout.presetId);

  visiblePanes.forEach((pane, index) => {
    const view = createPaneView(pane, index, preset, sessionMap);
    state.paneViews.set(pane.id, view);
    if (pane.sessionId) {
      state.sessionToPaneId.set(pane.sessionId, pane.id);
    }
    ui.grid.appendChild(view.root);

    // Xterm must correctly measure character grid sizes; open it ONLY when attached to DOM
    view.terminal.open(view.terminalHost);
    view.resizeObserver = new ResizeObserver(() => {
      scheduleFitAndResize(view);
    });
    view.resizeObserver.observe(view.body);
    syncPaneOverlayLayout(view);
    scheduleFitAndResize(view);
  });

  updateTitlebarPathSettingVisibility();
  updatePresetButtonVisibility();

  const firstPane = visiblePanes[0];
  if (firstPane) {
    const firstView = state.paneViews.get(firstPane.id);
    firstView?.terminal.focus();
  }
}

async function setPreset(presetId) {
  if (state.layout?.presetId === presetId) {
    return;
  }

  const runningAgentSessionIds = getActiveAgentSessionIds();
  const runningAgentCount = runningAgentSessionIds.length;
  if (!canSelectPresetForRunningAgents(presetId, runningAgentCount)) {
    updatePresetButtonVisibility();
    setStatusLine(`실행중 앱(${runningAgentCount})보다 작은 분할은 선택할 수 없습니다`);
    return;
  }

  const preferredSessionIds = [...runningAgentSessionIds];

  try {
    const layout = await api.layout.setPreset({
      presetId,
      preferredSessionIds,
      minPanelCount: runningAgentCount,
    });
    rememberSessionCapabilities(layout?.sessionCapabilities || {});
    renderLayout(layout);
    setStatusLine(`preset ${presetId}`);
  } catch (error) {
    setStatusLine(`preset failed: ${String(error)}`);
  }
}

async function restoreLayout() {
  try {
    const result = await api.layout.restore();
    if (result?.restored && result.layout) {
      rememberSessionCapabilities(result.layout?.sessionCapabilities || {});
      renderLayout(result.layout);
      setStatusLine("layout restored");
      return true;
    }
    return false;
  } catch (error) {
    setStatusLine(`restore failed: ${String(error)}`);
    return false;
  }
}

async function requestCloseWindow() {
  if (state.isWindowClosing) {
    return;
  }

  state.isWindowClosing = true;
  showShutdownOverlay(true);

  try {
    await api.app.window.close();
  } catch (error) {
    state.isWindowClosing = false;
    showShutdownOverlay(false);
    setStatusLine(`close failed: ${String(error)}`);
  }
}

function bindEvents() {
  ui.terminalFontSizeRange?.addEventListener("input", () => {
    const selectedSize = normalizeTerminalFontSize(ui.terminalFontSizeRange?.value);
    syncTerminalFontSizeControls(selectedSize);
    updateTerminalFontPreview(state.terminalFontFamily, selectedSize);
    applyTerminalFontSettings({ fontFamily: state.terminalFontFamily, fontSize: selectedSize }, { persist: false, announce: false });
  });
  ui.terminalFontSizeRange?.addEventListener("change", () => {
    const selectedSize = normalizeTerminalFontSize(ui.terminalFontSizeRange?.value);
    applyTerminalFontSettings({ fontFamily: state.terminalFontFamily, fontSize: selectedSize }, { persist: true, refit: true, announce: true });
  });
  ui.terminalFontCancelButton?.addEventListener("click", () => {
    closeTerminalFontDialog();
  });
  ui.terminalFontOverlay?.addEventListener("click", (event) => {
    if (event.target !== ui.terminalFontOverlay) {
      return;
    }
    closeTerminalFontDialog();
  });
  ui.skillManagerSearchInput?.addEventListener("input", () => {
    state.skillManagerSearchQuery = normalizeSkillSearchQuery(ui.skillManagerSearchInput?.value);
    scheduleSkillManagerSearchRefresh();
  });
  ui.skillManagerCancelButton?.addEventListener("click", () => {
    closeSkillManagerDialog();
  });
  ui.skillManagerOverlay?.addEventListener("click", (event) => {
    if (event.target !== ui.skillManagerOverlay) {
      return;
    }
    closeSkillManagerDialog();
  });
  ui.agentsPolicyEditor?.addEventListener("input", () => {
    syncAgentsPolicyControls();
  });
  ui.agentsPolicyEditor?.addEventListener("keydown", (event) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    if (String(event.key || "").toLowerCase() !== "s") {
      return;
    }
    event.preventDefault();
    saveAgentsPolicyEditorContent();
  });
  ui.agentsPolicyCancelButton?.addEventListener("click", () => {
    closeAgentsPolicyDialog();
  });
  ui.agentsPolicySaveButton?.addEventListener("click", async () => {
    await saveAgentsPolicyEditorContent();
  });
  ui.agentsPolicyReloadButton?.addEventListener("click", async () => {
    await reloadAgentsPolicyEditorContent();
  });
  ui.agentsPolicyOpenEditorButton?.addEventListener("click", async () => {
    await openAgentsPolicyInExternalEditor();
  });
  ui.agentsPolicyOverlay?.addEventListener("click", (event) => {
    if (event.target !== ui.agentsPolicyOverlay) {
      return;
    }
    closeAgentsPolicyDialog();
  });

  ui.windowMinimizeButton?.addEventListener("click", () => {
    api.app.window.minimize();
  });
  ui.windowMaximizeButton?.addEventListener("click", () => {
    api.app.window.toggleMaximize();
  });
  ui.windowCloseButton?.addEventListener("click", () => {
    requestCloseWindow();
  });
  ui.dragRegion?.addEventListener("dblclick", () => {
    api.app.window.toggleMaximize();
  });
  ui.titlebarPathSettingButton?.addEventListener("click", async () => {
    await applyGlobalDirectoryToVisiblePanes();
  });
  ui.titlebarSkillManagerButton?.addEventListener("click", () => {
    openSkillManagerDialog();
  });

  ui.titlebarEditAgentsButton?.addEventListener("click", async () => {
    await openAgentsPolicyDialog();
  });

  ui.titlebarFontSettingButton?.addEventListener("click", () => {
    openTerminalFontDialog();
  });
  ui.titlebarMountCodexButton?.addEventListener("click", async () => {
    await mountAgentToAllVisiblePanes("codex");
  });
  ui.titlebarMountClaudeButton?.addEventListener("click", async () => {
    await mountAgentToAllVisiblePanes("claude");
  });
  ui.titlebarMountGeminiButton?.addEventListener("click", async () => {
    await mountAgentToAllVisiblePanes("gemini");
  });
  ui.titlebarAllExitButton?.addEventListener("click", async () => {
    await stopAllActiveAgents();
  });
  const preventFileDropNavigation = (event) => {
    if (!isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
  };

  window.addEventListener("dragover", preventFileDropNavigation);
  window.addEventListener("drop", preventFileDropNavigation);
  state.eventUnsubscribers.push(() => {
    window.removeEventListener("dragover", preventFileDropNavigation);
    window.removeEventListener("drop", preventFileDropNavigation);
  });

  const handleEscapeForInstallPrompt = (event) => {
    if (isFontSizeDecreaseShortcut(event)) {
      event.preventDefault();
      adjustTerminalFontSize(-1);
      return;
    }

    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    if (isAgentsPolicyOverlayVisible()) {
      closeAgentsPolicyDialog();
      return;
    }
    if (isSkillManagerOverlayVisible()) {
      closeSkillManagerDialog();
      return;
    }
    if (ui.terminalFontOverlay?.classList.contains("visible")) {
      closeTerminalFontDialog();
      return;
    }
  };
  window.addEventListener("keydown", handleEscapeForInstallPrompt, true);
  state.eventUnsubscribers.push(() => {
    window.removeEventListener("keydown", handleEscapeForInstallPrompt, true);
  });

  setAgentsPolicyPathText(state.agentsPolicyPath);
  syncAgentsPolicyControls();

  state.eventUnsubscribers.push(
    api.app.window.onState((payload) => {
      updateWindowState(payload);
    }),
  );

  ui.presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const presetId = button.dataset.presetButton;
      if (presetId) {
        setPreset(presetId);
      }
    });
  });

  state.eventUnsubscribers.push(
    api.pty.onData((payload) => {
      appendOutput(payload.sessionId, payload.data);
    }),
  );

  state.eventUnsubscribers.push(
    api.pty.onExit((payload) => {
      appendOutput(
        payload.sessionId,
        `\r\n[session ${payload.sessionId} exited: code=${payload.exitCode}, status=${payload.status}]\r\n`,
      );
      updatePaneStatusBySessionId(payload.sessionId, payload.status);
    }),
  );

  state.eventUnsubscribers.push(
    api.pty.onStatus((payload) => {
      updatePaneStatusBySessionId(payload.id, payload.status, payload.cwd, payload.shell);
    }),
  );

  window.addEventListener("beforeunload", () => {
    api.app.lifecycle.rendererUnloading();
    for (const unsubscribe of state.eventUnsubscribers) {
      unsubscribe();
    }
    clearPaneViews();
  });
}

async function bootstrap() {
  if (!api) {
    throw new Error("preload bridge is missing: window.multiTerminal");
  }
  if (!TerminalCtor || !FitAddonCtor) {
    setStatusLine("xterm load failed");
    return;
  }

  state.terminalFontFamily = readStoredTerminalFontFamily();
  state.terminalFontSize = readStoredTerminalFontSize();
  state.autoInstallSkippedAgents = readStoredAutoInstallSkippedAgents();
  applyTerminalFontSettings(
    {
      fontFamily: state.terminalFontFamily,
      fontSize: state.terminalFontSize,
    },
    {
      persist: false,
      refit: false,
      announce: false,
    },
  );

  bindEvents();
  await ensureRequiredAgentsInstalledOnStartup();
  await ensurePowerShell7Ready();
  await runTerminalColorDiagnosticsOnStartup();
  await ensureNodeRuntimeSupported();
  const restored = await restoreLayout();
  if (!restored) {
    await setPreset(INITIAL_PRESET_ID);
  }

}

bootstrap();
