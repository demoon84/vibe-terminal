const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const { pathToFileURL } = require("url");
const { spawn, spawnSync } = require("child_process");
const { app, BrowserWindow, dialog, ipcMain, Menu, clipboard, shell } = require("electron");
const pty = require("node-pty");
const { IPC_CHANNELS } = require("../shared/ipc-channels");
const { getDefaultShell } = require("../shared/models");
const { SessionManager } = require("./session-manager");
const { LayoutStore } = require("./layout-store");
const { registerIpcRoutes } = require("./ipc-router");
const { createTrustedRendererGuard } = require("./ipc-trust");
const {
  withAugmentedPath,
  getKnownCommandLocations,
  isExecutableFile,
} = require("./path-utils");
const {
  validatePathDialogPayload,
  validateAgentCommandPayload,
  validateSkillCatalogPayload,
  validateSkillInstallPayload,
  validateSkillNamePayload,
  validateClipboardWritePayload,
  validateAgentsPolicyWritePayload,
} = require("./ipc-validators");

const sessionManager = new SessionManager();
let mainWindow = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

const APP_ICON_CANDIDATE_PATHS =
  process.platform === "darwin"
    ? [
      path.join(__dirname, "..", "..", "assets", "app-icon-mac.png"),
      path.join(__dirname, "..", "..", "assets", "app-icon.png"),
      path.join(__dirname, "..", "renderer", "app-icon.png"),
    ]
    : [
      path.join(__dirname, "..", "..", "assets", "app-icon.png"),
      path.join(__dirname, "..", "renderer", "app-icon.png"),
    ];
const APP_ICON_PATH =
  APP_ICON_CANDIDATE_PATHS.find(
    (candidatePath) => typeof candidatePath === "string" && fs.existsSync(candidatePath),
  ) || null;
const WINDOW_CLOSE_OVERLAY_DELAY_MS = 260;
const HOT_RELOAD_DEBOUNCE_MS = 120;
const HOT_RELOAD_EXTENSIONS = new Set([".html", ".css", ".js"]);
const CODEX_MODEL_QUERY_TIMEOUT_MS = 18000;
const CODEX_MODEL_QUERY_START_DELAY_MS = 400;
const CODEX_MODEL_QUERY_SEND_MODEL_DELAY_MS = 4200;
const CODEX_MODEL_QUERY_SEND_EXIT_DELAY_MS = 10000;
const CODEX_MODEL_QUERY_SETTLE_DELAY_MS = 2600;
const GEMINI_MODEL_QUERY_TIMEOUT_MS = 14000;
const GEMINI_MODEL_QUERY_START_DELAY_MS = 400;
const GEMINI_MODEL_QUERY_SEND_EXIT_DELAY_MS = 9000;
const GEMINI_MODEL_QUERY_SETTLE_DELAY_MS = 1600;
const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const GEMINI_MODEL_FALLBACKS = Object.freeze([
  "auto-gemini-3",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "auto-gemini-2.5",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
]);
const AGENT_INSTALL_TARGETS = Object.freeze({
  codex: Object.freeze({
    id: "codex",
    label: "Codex",
    executable: "codex",
    packageName: "@openai/codex",
    npmUrl: "https://www.npmjs.com/package/@openai/codex",
    docsUrl: "https://github.com/openai/codex",
  }),
  claude: Object.freeze({
    id: "claude",
    label: "Claude",
    executable: "claude",
    packageName: "@anthropic-ai/claude-code",
    npmUrl: "https://www.npmjs.com/package/@anthropic-ai/claude-code",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/setup",
  }),
  gemini: Object.freeze({
    id: "gemini",
    label: "Gemini",
    executable: "gemini",
    packageName: "@google/gemini-cli",
    npmUrl: "https://www.npmjs.com/package/@google/gemini-cli",
    docsUrl: "https://github.com/google-gemini/gemini-cli",
  }),
});
const CURATED_SKILL_REPO = "openai/skills";
const CURATED_SKILL_PATH_PREFIX = "skills/.curated";
const SKILLS_SH_API_BASE = String(process.env.SKILLS_API_URL || "https://skills.sh").trim()
  || "https://skills.sh";
const SKILLS_SH_SEARCH_LIMIT = 18;
const SKILLS_SH_QUERY_MIN_LENGTH = 2;
const SKILLS_SH_FETCH_TIMEOUT_MS = 8_000;
const CURATED_ICON_TREE_CACHE_TTL_MS = 10 * 60 * 1000;
const CURATED_ICON_TREE_TIMEOUT_MS = 8_000;
const DEFAULT_SKILL_DESCRIPTION = "openai/skills에서 설치 가능한 스킬";
const SKILL_DESCRIPTION_OVERRIDES = Object.freeze({
  "cloudflare-deploy": "Cloudflare Workers/Pages 배포 자동화",
  "develop-web-game": "웹 게임 개발 및 Playwright 테스트 루프",
  doc: "문서 파일 편집 및 리뷰",
  figma: "Figma MCP 기반 디자인-코드 작업",
  "figma-implement-design": "Figma 디자인을 프로덕션 코드로 구현",
  "gh-address-comments": "GitHub PR 리뷰 코멘트 반영",
  "gh-fix-ci": "GitHub Actions CI 오류 디버깅",
  imagegen: "OpenAI 이미지 생성/편집",
  "jupyter-notebook": "실험용 Jupyter 노트북 생성",
  linear: "Linear 이슈 조회 및 업데이트",
  "netlify-deploy": "Netlify 사이트/함수 배포",
  "notion-knowledge-capture": "Notion 지식 수집 및 정리",
  "notion-meeting-intelligence": "회의 내용 요약과 액션 아이템 정리",
  "notion-research-documentation": "리서치 문서 작성 및 정리",
  "notion-spec-to-implementation": "스펙을 구현 계획으로 전환",
  "openai-docs": "OpenAI 공식 문서 검색",
  pdf: "PDF 문서 분석/요약",
  playwright: "터미널에서 실제 브라우저 자동화",
  "render-deploy": "Render 서비스 배포",
  screenshot: "스크린샷 캡처/첨부 자동화",
  "security-best-practices": "보안 베스트 프랙티스 점검",
  "security-ownership-map": "보안 담당 영역 맵핑",
  "security-threat-model": "변경사항 위협 모델링",
  sentry: "Sentry 이슈 조사 및 해결",
  sora: "Sora 기반 영상 생성/편집",
  speech: "텍스트 음성 변환",
  spreadsheet: "스프레드시트 분석/편집",
  transcribe: "음성 전사 및 화자 분리",
  "vercel-deploy": "Vercel 배포 자동화",
  yeet: "빠른 초기 작업 보조",
});
const SECURITY_SHIELD_DATA_URI = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none">'
  + '<path d="M12 2L4 6v5c0 5.25 3.4 10.17 8 11.37C16.6 21.17 20 16.25 20 11V6l-8-4z" fill="rgba(255,255,255,0.85)"/>'
  + '<path d="M10.5 14.5l-2-2 1-1 1 1 3.5-3.5 1 1-4.5 4.5z" fill="rgba(30,30,30,0.9)"/>'
  + '</svg>',
);
const SKILL_ICON_OVERRIDES = Object.freeze({
  "security-best-practices": SECURITY_SHIELD_DATA_URI,
  "security-ownership-map": SECURITY_SHIELD_DATA_URI,
  "security-threat-model": SECURITY_SHIELD_DATA_URI,
});
const TERMINAL_COLOR_MODE = String(process.env.VIBE_TERMINAL_COLOR_MODE || "force")
  .trim()
  .toLowerCase();
let curatedSkillIconCache = {
  fetchedAt: 0,
  bySkill: new Map(),
  ok: false,
  error: null,
};

const PWSH7_MIN_REQUIRED_VERSION = "7.0.0";
const PWSH7_INSTALL_PAGE_URL = "https://aka.ms/powershell-release?tag=stable";
const FORCE_PWSH7_INSTALL_FAIL = String(process.env.VIBE_FORCE_PWSH7_INSTALL_FAIL || "")
  .trim()
  .toLowerCase() === "1";
const NODE_MIN_REQUIRED_VERSION = "20.0.0";
const NODE_RECOMMENDED_VERSION = "20.19.0";
const NODE_INSTALL_PAGE_URL = "https://nodejs.org/en/download";
const CLIPBOARD_RATE_LIMIT_WINDOW_MS = 10_000;
const CLIPBOARD_RATE_LIMIT_MAX_CALLS = 40;
let hasWindowCloseCleanupRun = false;
const isProductionBuild = () =>
  app.isPackaged || String(process.env.NODE_ENV || "").toLowerCase() === "production";
const SHOULD_AUTO_OPEN_DEVTOOLS =
  String(process.env.VIBE_OPEN_DEVTOOLS || "")
    .trim()
    .toLowerCase() === "1";
const clipboardRequestBuckets = new Map();

function isWithinRateLimit(bucketMap, key, windowMs, maxCalls) {
  const now = Date.now();
  const current = bucketMap.get(key);
  if (!current || now >= current.resetAt) {
    bucketMap.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return true;
  }

  current.count += 1;
  return current.count <= maxCalls;
}

function buildClipboardRateLimitKey(event) {
  const senderId = Number(event?.sender?.id) || 0;
  const frameUrl = String(event?.senderFrame?.url || event?.sender?.getURL?.() || "");
  return `${senderId}::${frameUrl}`;
}

function isClipboardIpcAllowed(event) {
  const key = buildClipboardRateLimitKey(event);
  return isWithinRateLimit(
    clipboardRequestBuckets,
    key,
    CLIPBOARD_RATE_LIMIT_WINDOW_MS,
    CLIPBOARD_RATE_LIMIT_MAX_CALLS,
  );
}

function cleanupSessions(reason) {
  sessionManager.cleanupAll(reason);
}

function cleanupSessionsOnce(reason) {
  if (hasWindowCloseCleanupRun) {
    return;
  }
  cleanupSessions(reason);
  hasWindowCloseCleanupRun = true;
}

function emitWindowState(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  window.webContents.send(IPC_CHANNELS.APP_WINDOW_STATE, {
    isMaximized: window.isMaximized(),
  });
}

const isTrustedRendererEvent = createTrustedRendererGuard({
  getMainWindow: () => mainWindow,
});

function normalizeTerminalOutput(text) {
  return String(text || "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "\n")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .replace(/\r/g, "\n");
}

function normalizeModelName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }
  return MODEL_NAME_PATTERN.test(trimmed) ? trimmed : null;
}

function normalizeModelList(values) {
  const unique = new Set();
  const normalized = [];
  for (const value of values || []) {
    const candidate = normalizeModelName(value);
    if (!candidate || unique.has(candidate)) {
      continue;
    }
    unique.add(candidate);
    normalized.push(candidate);
  }
  return normalized;
}

function parseCodexModelCatalog(rawOutput) {
  const normalized = normalizeTerminalOutput(rawOutput);
  const seen = new Set();
  const rows = [];
  const rowPattern = /(?:^|\n)\s*(?:[›>]\s*)?(\d{1,3})\.\s*([a-z0-9][a-z0-9._:-]*)(?:\s+\((current)\))?/g;

  let rowMatch = null;
  while ((rowMatch = rowPattern.exec(normalized)) !== null) {
    const order = Number(rowMatch[1]);
    const model = rowMatch[2];
    if (!Number.isFinite(order) || !model || seen.has(model)) {
      continue;
    }
    seen.add(model);
    rows.push({ order, model });
  }

  rows.sort((a, b) => a.order - b.order);
  const models = rows.map((row) => row.model);

  let selectedModel = null;
  const currentPattern =
    /(?:^|\n)\s*(?:[›>]\s*)?\d{1,3}\.\s*([a-z0-9][a-z0-9._:-]*)\s+\(current\)/;
  const currentMatch = normalized.match(currentPattern);
  if (currentMatch?.[1]) {
    selectedModel = currentMatch[1];
  }

  if (!selectedModel) {
    const headerPattern = /model:\s*([a-z0-9][a-z0-9._:-]*)/gi;
    let headerMatch = null;
    while ((headerMatch = headerPattern.exec(normalized)) !== null) {
      const candidate = String(headerMatch[1] || "").trim();
      if (candidate && candidate.toLowerCase() !== "loading") {
        selectedModel = candidate;
      }
    }
  }

  if (selectedModel && !models.includes(selectedModel)) {
    models.unshift(selectedModel);
  }

  return {
    models,
    selectedModel: selectedModel || null,
  };
}

function queryCodexModelCatalog(timeoutMs = CODEX_MODEL_QUERY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let shell = null;
    try {
      shell = getDefaultShell();
    } catch (error) {
      resolve({
        ok: false,
        models: [],
        selectedModel: null,
        error: String(error),
      });
      return;
    }

    let terminal = null;
    try {
      terminal = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        cwd: process.cwd(),
        env: process.env,
      });
    } catch (error) {
      resolve({
        ok: false,
        models: [],
        selectedModel: null,
        error: String(error),
      });
      return;
    }

    const timers = [];
    let output = "";
    let settled = false;

    const registerTimer = (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      timers.push(timer);
      return timer;
    };

    const clearAllTimers = () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.length = 0;
    };

    const finish = (reason) => {
      if (settled) {
        return;
      }
      settled = true;
      clearAllTimers();

      const parsed = parseCodexModelCatalog(output);
      try {
        terminal.kill();
      } catch (_error) {
        // Best effort.
      }

      if (!Array.isArray(parsed.models) || parsed.models.length === 0) {
        resolve({
          ok: false,
          models: [],
          selectedModel: null,
          error: `model-parse-failed:${reason}`,
        });
        return;
      }

      resolve({
        ok: true,
        models: parsed.models,
        selectedModel: parsed.selectedModel || parsed.models[0] || null,
      });
    };

    terminal.onData((data) => {
      output += String(data || "");
    });

    terminal.onExit(() => {
      finish("exit");
    });

    registerTimer(() => {
      try {
        terminal.write("codex --no-alt-screen\r");
      } catch (_error) {
        finish("write-codex-failed");
      }
    }, CODEX_MODEL_QUERY_START_DELAY_MS);

    registerTimer(() => {
      try {
        terminal.write("/model\r");
      } catch (_error) {
        finish("write-model-failed");
      }
    }, CODEX_MODEL_QUERY_SEND_MODEL_DELAY_MS);

    registerTimer(() => {
      try {
        terminal.write("/exit\r");
      } catch (_error) {
        // Ignore and wait for timeout.
      }
    }, CODEX_MODEL_QUERY_SEND_EXIT_DELAY_MS);

    registerTimer(
      () => finish("post-model-settle"),
      CODEX_MODEL_QUERY_SEND_EXIT_DELAY_MS + CODEX_MODEL_QUERY_SETTLE_DELAY_MS,
    );

    registerTimer(() => finish("timeout"), timeoutMs);
  });
}

function getCommandLocations(commandName) {
  const normalized = String(commandName || "").trim();
  if (normalized.length === 0) {
    return [];
  }

  const locator = process.platform === "win32" ? "where" : "which";
  const located = spawnSync(locator, [normalized], {
    encoding: "utf8",
    windowsHide: true,
    env: withAugmentedPath(process.env),
  });
  const locatedPaths = located.status === 0
    ? String(located.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    : [];
  const knownPaths = getKnownCommandLocations(normalized).filter((candidatePath) =>
    isExecutableFile(candidatePath)
  );

  return [...locatedPaths, ...knownPaths]
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line, index, array) => array.indexOf(line) === index);
}

function getAgentInstallTarget(agentCommand) {
  const key = String(agentCommand || "").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(AGENT_INSTALL_TARGETS, key)) {
    return null;
  }
  return AGENT_INSTALL_TARGETS[key];
}

function isExecutableAvailable(commandName) {
  if (typeof commandName !== "string" || commandName.trim().length === 0) {
    return false;
  }
  return getCommandLocations(commandName.trim()).length > 0;
}

function resolveNpmCommand() {
  const candidates =
    process.platform === "win32" ? ["npm.cmd", "npm", "npm.exe"] : ["npm"];
  for (const candidate of candidates) {
    const locations = getCommandLocations(candidate);
    if (locations.length > 0) {
      return locations[0];
    }
  }
  return null;
}

function resolvePythonCommand() {
  const candidates =
    process.platform === "win32" ? ["python.exe", "python3.exe", "python", "python3"] : ["python3", "python"];
  for (const candidate of candidates) {
    const locations = getCommandLocations(candidate);
    if (locations.length > 0) {
      return locations[0];
    }
  }
  return null;
}

function resolveNpxCommand() {
  const candidates =
    process.platform === "win32" ? ["npx.cmd", "npx", "npx.exe"] : ["npx"];
  for (const candidate of candidates) {
    const locations = getCommandLocations(candidate);
    if (locations.length > 0) {
      return locations[0];
    }
  }
  return null;
}

function getCodexHomeDir() {
  const configured = String(process.env.CODEX_HOME || "").trim();
  if (configured) {
    return configured;
  }
  return path.join(os.homedir(), ".codex");
}

function getCodexSkillsDir() {
  return path.join(getCodexHomeDir(), "skills");
}

function getAgentsSkillsDir() {
  return path.join(os.homedir(), ".agents", "skills");
}

function getSkillInstallerScriptsDir() {
  return path.join(getCodexSkillsDir(), ".system", "skill-installer", "scripts");
}

function getSkillInstallPaths(skillName) {
  const normalized = toSafeSkillName(skillName);
  if (!normalized) {
    return {
      normalized: "",
      codexPath: "",
      agentsPath: "",
    };
  }
  return {
    normalized,
    codexPath: path.join(getCodexSkillsDir(), normalized),
    agentsPath: path.join(getAgentsSkillsDir(), normalized),
  };
}

function hasSkillManifest(skillPath) {
  const normalizedPath = String(skillPath || "").trim();
  if (!normalizedPath) {
    return false;
  }
  return fs.existsSync(path.join(normalizedPath, "SKILL.md"));
}

function resolveInstalledSkillPath(skillName) {
  const paths = getSkillInstallPaths(skillName);
  if (!paths.normalized) {
    return "";
  }
  if (hasSkillManifest(paths.codexPath)) {
    return paths.codexPath;
  }
  if (hasSkillManifest(paths.agentsPath)) {
    return paths.agentsPath;
  }
  return "";
}

function cleanupStaleSkillInstallPaths(skillName) {
  const paths = getSkillInstallPaths(skillName);
  if (!paths.normalized) {
    return;
  }

  for (const candidate of [paths.codexPath, paths.agentsPath]) {
    if (!candidate || !fs.existsSync(candidate)) {
      continue;
    }
    if (hasSkillManifest(candidate)) {
      continue;
    }
    try {
      fs.rmSync(candidate, {
        recursive: true,
        force: true,
        maxRetries: 2,
      });
    } catch (_error) {
      // Best-effort cleanup only.
    }
  }
}

function toSafeSkillName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function toSafeRepositorySlug(value) {
  const text = String(value || "").trim();
  const match = text.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!match || !match[1] || !match[2]) {
    return "";
  }
  return `${match[1]}/${match[2]}`;
}

function normalizeSkillSearchQuery(value) {
  return String(value || "").trim();
}

function normalizeSkillInstallProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "skills-sh") {
    return "skills-sh";
  }
  return "curated";
}

function isImageFileName(fileName) {
  return /\.(svg|png|webp|jpg|jpeg)$/i.test(String(fileName || "").trim());
}

function toFileUrl(filePath) {
  try {
    return pathToFileURL(String(filePath || "")).toString();
  } catch (_error) {
    return "";
  }
}

function pickLocalSkillIconPath(skillDir) {
  const assetsDir = path.join(String(skillDir || ""), "assets");
  if (!fs.existsSync(assetsDir) || !fs.statSync(assetsDir).isDirectory()) {
    return "";
  }

  const entries = fs.readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => isImageFileName(name));
  if (entries.length === 0) {
    return "";
  }

  const priorityMatchers = [
    /\.png$/i,
    /\.(webp|jpg|jpeg)$/i,
    /-small\.svg$/i,
    /^icon\.svg$/i,
    /\.svg$/i,
  ];
  for (const matcher of priorityMatchers) {
    const found = entries.find((name) => matcher.test(name));
    if (found) {
      return path.join(assetsDir, found);
    }
  }

  return path.join(assetsDir, entries[0]);
}

function parseCuratedIconTree(payload) {
  const bySkill = new Map();
  const tree = Array.isArray(payload?.tree) ? payload.tree : [];

  const bucket = new Map();
  for (const item of tree) {
    if (item?.type !== "blob") {
      continue;
    }
    const itemPath = String(item?.path || "");
    const match = itemPath.match(/^skills\/\.curated\/([^/]+)\/assets\/(.+)$/);
    if (!match || !match[1] || !match[2]) {
      continue;
    }
    if (!isImageFileName(match[2])) {
      continue;
    }

    const skillName = toSafeSkillName(match[1]);
    if (!skillName) {
      continue;
    }

    if (!bucket.has(skillName)) {
      bucket.set(skillName, []);
    }
    bucket.get(skillName).push(match[2]);
  }

  const scoreFile = (name) => {
    if (/\.png$/i.test(name)) {
      return 1;
    }
    if (/\.(webp|jpg|jpeg)$/i.test(name)) {
      return 2;
    }
    if (/-small\.svg$/i.test(name)) {
      return 3;
    }
    if (/^icon\.svg$/i.test(name)) {
      return 4;
    }
    if (/\.svg$/i.test(name)) {
      return 5;
    }
    return 6;
  };

  for (const [skillName, names] of bucket.entries()) {
    const sorted = [...names].sort((a, b) => {
      const scoreDiff = scoreFile(a) - scoreFile(b);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return a.localeCompare(b, "en");
    });
    if (sorted.length > 0) {
      bySkill.set(skillName, sorted[0]);
    }
  }

  return bySkill;
}

function buildCuratedRawAssetUrl(skillName, assetFileName) {
  const normalizedSkillName = toSafeSkillName(skillName);
  const fileName = String(assetFileName || "").trim();
  if (!normalizedSkillName || !fileName || !isImageFileName(fileName)) {
    return "";
  }
  return `https://raw.githubusercontent.com/${CURATED_SKILL_REPO}/main/skills/.curated/${normalizedSkillName}/assets/${encodeURIComponent(fileName)}`;
}

async function queryCuratedSkillIconMap() {
  const now = Date.now();
  if (
    curatedSkillIconCache.bySkill instanceof Map
    && now - curatedSkillIconCache.fetchedAt < CURATED_ICON_TREE_CACHE_TTL_MS
  ) {
    return curatedSkillIconCache;
  }

  let url = null;
  try {
    url = new URL(`/repos/${CURATED_SKILL_REPO}/git/trees/main?recursive=1`, "https://api.github.com");
  } catch (_error) {
    return {
      fetchedAt: now,
      bySkill: new Map(),
      ok: false,
      error: "curated-icon-url-invalid",
    };
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => {
      controller.abort();
    }, CURATED_ICON_TREE_TIMEOUT_MS)
    : null;

  try {
    if (typeof fetch !== "function") {
      throw new Error("fetch-not-available");
    }
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
      },
      signal: controller?.signal,
    });
    if (!response.ok) {
      throw new Error(`http-${response.status}`);
    }
    const payload = await response.json();
    curatedSkillIconCache = {
      fetchedAt: now,
      bySkill: parseCuratedIconTree(payload),
      ok: true,
      error: null,
    };
    return curatedSkillIconCache;
  } catch (error) {
    const aborted = error?.name === "AbortError";
    curatedSkillIconCache = {
      fetchedAt: now,
      bySkill: new Map(),
      ok: false,
      error: aborted ? "curated-icon-timeout" : `curated-icon-fetch-failed:${String(error)}`,
    };
    return curatedSkillIconCache;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function getSkillsShOwnerAvatarUrl(installRepo) {
  const repository = toSafeRepositorySlug(installRepo);
  if (!repository) {
    return "";
  }
  const owner = repository.split("/")[0];
  if (!owner) {
    return "";
  }
  return `https://github.com/${owner}.png?size=64`;
}

function formatSkillDisplayName(skillName) {
  const normalized = toSafeSkillName(skillName);
  if (!normalized) {
    return "";
  }
  return normalized
    .split("-")
    .map((part) => (part.length > 0 ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function parseSkillMetadata(skillFilePath) {
  const stripWrappingQuotes = (value) => {
    const text = String(value || "").trim();
    if (text.length < 2) {
      return text;
    }
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return text.slice(1, -1).trim();
    }
    return text;
  };

  try {
    if (!skillFilePath || !fs.existsSync(skillFilePath)) {
      return {
        name: null,
        description: null,
      };
    }

    const content = fs.readFileSync(skillFilePath, "utf8");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch?.[1] || "";
    const nameMatch = frontmatter.match(/(?:^|\n)name:\s*(.+)\s*$/m);
    const descriptionMatch = frontmatter.match(/(?:^|\n)description:\s*(.+)\s*$/m);

    return {
      name: stripWrappingQuotes(nameMatch?.[1]) || null,
      description: stripWrappingQuotes(descriptionMatch?.[1]) || null,
    };
  } catch (_error) {
    return {
      name: null,
      description: null,
    };
  }
}

function listSkillDirs(baseDir, options = {}) {
  if (!baseDir || !fs.existsSync(baseDir)) {
    return [];
  }

  const {
    includeHidden = false,
    excludeNames = [],
  } = options;
  const exclude = new Set(
    (excludeNames || []).map((value) => String(value || "").trim()).filter((value) => value.length > 0),
  );

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const name = String(entry.name || "").trim();
    if (!name) {
      continue;
    }
    if (!includeHidden && name.startsWith(".")) {
      continue;
    }
    if (exclude.has(name)) {
      continue;
    }

    const normalized = toSafeSkillName(name);
    if (!normalized) {
      continue;
    }

    const skillDir = path.join(baseDir, name);
    const skillFilePath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFilePath)) {
      continue;
    }

    const metadata = parseSkillMetadata(skillFilePath);
    const description =
      SKILL_DESCRIPTION_OVERRIDES[normalized]
      || metadata.description
      || DEFAULT_SKILL_DESCRIPTION;
    const displayName = metadata.name || formatSkillDisplayName(normalized) || normalized;
    const localIconPath = pickLocalSkillIconPath(skillDir);

    skills.push({
      name: normalized,
      displayName,
      description,
      path: skillDir,
      iconUrl: localIconPath ? toFileUrl(localIconPath) : "",
    });
  }

  return skills;
}

function parseCuratedSkillListResult(stdout) {
  try {
    const parsed = JSON.parse(String(stdout || "[]"));
    if (!Array.isArray(parsed)) {
      return [];
    }

    const rows = [];
    for (const row of parsed) {
      const name = toSafeSkillName(row?.name);
      if (!name) {
        continue;
      }
      rows.push({
        name,
        installed: Boolean(row?.installed),
      });
    }
    return rows;
  } catch (_error) {
    return [];
  }
}

function queryCuratedSkillRows() {
  const python = resolvePythonCommand();
  const scriptPath = path.join(getSkillInstallerScriptsDir(), "list-skills.py");
  if (!python || !fs.existsSync(scriptPath)) {
    return {
      ok: false,
      error: "skill-list-script-not-found",
      rows: [],
      stdout: "",
      stderr: "",
    };
  }

  const result = spawnSync(python, [scriptPath, "--format", "json"], {
    encoding: "utf8",
    windowsHide: true,
    env: withAugmentedPath(process.env),
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const rows = parseCuratedSkillListResult(stdout);
  if (result.status !== 0) {
    return {
      ok: false,
      error: `skill-list-exit-${result.status}`,
      rows,
      stdout: trimTail(stdout),
      stderr: trimTail(stderr),
    };
  }

  return {
    ok: true,
    rows,
    stdout: trimTail(stdout),
    stderr: trimTail(stderr),
  };
}

function parseSkillsShIdentifier(value) {
  const parts = String(value || "")
    .trim()
    .split("/")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  if (parts.length < 3) {
    return {
      repo: "",
      skillId: "",
    };
  }

  const repo = toSafeRepositorySlug(`${parts[0]}/${parts[1]}`);
  const skillId = toSafeSkillName(parts.slice(2).join("-"));
  return {
    repo,
    skillId,
  };
}

function normalizeSkillsShSlug(value) {
  const parts = String(value || "")
    .trim()
    .split("/")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  if (parts.length < 3) {
    return "";
  }

  const owner = parts[0];
  const repo = parts[1];
  const skill = parts.slice(2).join("/");
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    return "";
  }
  if (!skill) {
    return "";
  }
  return `${owner}/${repo}/${skill}`;
}

function buildSkillsShOpenGraphImageUrl(slug) {
  const normalized = normalizeSkillsShSlug(slug);
  if (!normalized) {
    return "";
  }

  const parts = normalized.split("/");
  const owner = parts[0];
  const repo = parts[1];
  const skill = parts.slice(2).join("/");
  return `https://skills.sh/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(skill)}/opengraph-image`;
}

function parseSkillsShSearchResult(payload) {
  if (!payload || !Array.isArray(payload.skills)) {
    return [];
  }

  const rows = [];
  for (const skill of payload.skills) {
    const parsedId = parseSkillsShIdentifier(skill?.id);
    const slug = normalizeSkillsShSlug(skill?.id);
    const repository = toSafeRepositorySlug(skill?.source) || parsedId.repo;
    const skillName = toSafeSkillName(skill?.skillId || parsedId.skillId || skill?.name);
    if (!repository || !skillName) {
      continue;
    }

    const displayName = String(skill?.name || skillName).trim()
      || formatSkillDisplayName(skillName)
      || skillName;
    const installs = Number.parseInt(String(skill?.installs || "0"), 10);
    const fallbackIconUrl = getSkillsShOwnerAvatarUrl(repository);
    const iconUrl = buildSkillsShOpenGraphImageUrl(slug);
    rows.push({
      name: skillName,
      displayName,
      description: `${repository} · skills.sh 검색 결과`,
      installProvider: "skills-sh",
      installRepo: repository,
      installs: Number.isFinite(installs) && installs > 0 ? installs : 0,
      iconUrl: iconUrl || fallbackIconUrl,
      iconFallbackUrl: fallbackIconUrl,
    });
  }

  return rows;
}

async function querySkillsShRows(query, limit = SKILLS_SH_SEARCH_LIMIT) {
  const normalizedQuery = normalizeSkillSearchQuery(query);
  if (normalizedQuery.length < SKILLS_SH_QUERY_MIN_LENGTH) {
    return {
      ok: true,
      skipped: true,
      query: normalizedQuery,
      rows: [],
      error: null,
    };
  }

  let url = null;
  try {
    url = new URL("/api/search", SKILLS_SH_API_BASE);
  } catch (_error) {
    return {
      ok: false,
      skipped: false,
      query: normalizedQuery,
      rows: [],
      error: "skills-sh-invalid-api-base",
    };
  }

  url.searchParams.set("q", normalizedQuery);
  url.searchParams.set("limit", String(limit));

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => {
      controller.abort();
    }, SKILLS_SH_FETCH_TIMEOUT_MS)
    : null;
  try {
    if (typeof fetch !== "function") {
      return {
        ok: false,
        skipped: false,
        query: normalizedQuery,
        rows: [],
        error: "skills-sh-fetch-unavailable",
      };
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller?.signal,
    });
    const bodyText = String(await response.text() || "");
    let parsed = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch (_error) {
      parsed = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        skipped: false,
        query: normalizedQuery,
        rows: [],
        error: `skills-sh-http-${response.status}`,
        body: trimTail(bodyText),
      };
    }

    return {
      ok: true,
      skipped: false,
      query: normalizedQuery,
      rows: parseSkillsShSearchResult(parsed),
      error: null,
    };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return {
      ok: false,
      skipped: false,
      query: normalizedQuery,
      rows: [],
      error: aborted ? "skills-sh-timeout" : `skills-sh-fetch-failed:${String(error)}`,
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function buildTerminalDiagnosticEnv(extraEnv = {}) {
  const merged = { ...process.env, ...extraEnv };
  if (TERMINAL_COLOR_MODE === "force") {
    delete merged.NO_COLOR;
    merged.FORCE_COLOR = "1";
    merged.CLICOLOR = "1";
    merged.CLICOLOR_FORCE = "1";
    merged.COLORTERM = merged.COLORTERM || "truecolor";
    merged.TERM = merged.TERM || "xterm-256color";
  } else if (TERMINAL_COLOR_MODE === "disable") {
    merged.NO_COLOR = "1";
    delete merged.FORCE_COLOR;
    delete merged.CLICOLOR_FORCE;
  }
  return merged;
}

function queryTerminalColorDiagnostics() {
  let shell = null;
  try {
    shell = getDefaultShell();
  } catch (error) {
    return {
      ok: false,
      error: String(error),
    };
  }

  const diagnosticEnv = buildTerminalDiagnosticEnv();
  const command = [
    '$v=$PSVersionTable.PSVersion.ToString()',
    '$o=$PSStyle.OutputRendering',
    '$esc=[char]27',
    '$ansi="$esc[31mRED$esc[0m"',
    'Write-Output "PS_VERSION=$v"',
    'Write-Output "OUTPUT_RENDERING=$o"',
    'Write-Output "TERM=$env:TERM"',
    'Write-Output "COLORTERM=$env:COLORTERM"',
    'Write-Output "NO_COLOR=$env:NO_COLOR"',
    'Write-Output "FORCE_COLOR=$env:FORCE_COLOR"',
    'Write-Output "CLICOLOR_FORCE=$env:CLICOLOR_FORCE"',
    'Write-Output "ANSI_SAMPLE=$ansi"',
  ].join("; ");

  const result = spawnSync(shell, ["-NoLogo", "-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    env: diagnosticEnv,
  });

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const mergedOutput = `${stdout}\n${stderr}`;
  const hasAnsi = /\u001b\[[0-9;]*m/.test(mergedOutput);

  return {
    ok: true,
    colorMode: TERMINAL_COLOR_MODE,
    shell,
    env: {
      TERM: diagnosticEnv.TERM || "",
      COLORTERM: diagnosticEnv.COLORTERM || "",
      NO_COLOR: diagnosticEnv.NO_COLOR || "",
      FORCE_COLOR: diagnosticEnv.FORCE_COLOR || "",
      CLICOLOR_FORCE: diagnosticEnv.CLICOLOR_FORCE || "",
    },
    pwsh: {
      status: result.status,
      hasAnsi,
      stdout: trimTail(stdout, 4000),
      stderr: trimTail(stderr, 4000),
    },
  };
}

function normalizeSemver(value) {
  const cleaned = String(value || "").trim().replace(/^v/i, "");
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemver(left, right) {
  if (!left || !right) {
    return 0;
  }
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
}

function buildNodeUpgradeCommand() {
  if (process.platform === "win32") {
    return "winget install --id OpenJS.NodeJS.LTS --source winget -e";
  }
  if (process.platform === "darwin") {
    return "brew install node@20";
  }
  return "nvm install 20 && nvm use 20";
}

function canAutoInstallNodeRuntime() {
  if (process.platform === "win32") {
    return isExecutableAvailable("winget");
  }
  if (process.platform === "darwin") {
    return isExecutableAvailable("brew");
  }
  return false;
}

function openNodeInstallPage() {
  try {
    shell.openExternal(NODE_INSTALL_PAGE_URL);
    return true;
  } catch (_error) {
    return false;
  }
}

async function openPathInWindowsEditorFallback(filePath) {
  const normalizedFilePath = String(filePath || "").trim();
  if (!normalizedFilePath) {
    return { ok: false, error: "invalid-path" };
  }

  const preferredEditorIds = ["cursor", "vscode", "windsurf"];
  let lastError = "editor-launch-command-not-found";
  for (const editorId of preferredEditorIds) {
    const editor = KNOWN_EDITORS.find((item) => item.id === editorId);
    if (!editor) {
      continue;
    }
    const launch = resolveEditorLaunchCommand(editor);
    if (!launch) {
      continue;
    }
    const result = await spawnDetachedCommand(
      launch.command,
      [...launch.args, normalizedFilePath],
      { cwd: path.dirname(normalizedFilePath) },
    );
    if (result.ok) {
      return { ok: true, editorId };
    }
    lastError = result.error || lastError;
  }

  const notepadResult = await spawnDetachedCommand(
    "notepad.exe",
    [normalizedFilePath],
    { cwd: path.dirname(normalizedFilePath) },
  );
  if (notepadResult.ok) {
    return { ok: true, editorId: "notepad" };
  }

  return {
    ok: false,
    error: notepadResult.error || lastError,
  };
}


function getWindowsProgramsDir() {
  const localAppData = String(process.env.LOCALAPPDATA || "").trim();
  if (localAppData) {
    return path.join(localAppData, "Programs");
  }
  return path.join(os.homedir(), "AppData", "Local", "Programs");
}

function buildKnownEditors() {
  if (process.platform === "win32") {
    const programsDir = getWindowsProgramsDir();
    return [
      {
        id: "cursor",
        name: "Cursor",
        command: ["cursor"],
        fallbackExecutables: [
          path.join(programsDir, "cursor", "Cursor.exe"),
        ],
      },
      {
        id: "vscode",
        name: "VS Code",
        command: ["code"],
        fallbackExecutables: [
          path.join(programsDir, "Microsoft VS Code", "Code.exe"),
          path.join(programsDir, "VS Code", "Code.exe"),
        ],
      },
      {
        id: "windsurf",
        name: "Windsurf",
        command: ["windsurf"],
        fallbackExecutables: [
          path.join(programsDir, "Windsurf", "Windsurf.exe"),
        ],
      },
      {
        id: "explorer",
        name: "Explorer",
        command: ["explorer.exe"],
        alwaysVisible: true,
      },
    ];
  }

  if (process.platform === "darwin") {
    return [
      { id: "idea", name: "IntelliJ IDEA", app: "IntelliJ IDEA.app", command: ["open", "-a", "IntelliJ IDEA"] },
      { id: "vscode", name: "VS Code", app: "Visual Studio Code.app", command: ["open", "-a", "Visual Studio Code"] },
      { id: "cursor", name: "Cursor", app: "Cursor.app", command: ["open", "-a", "Cursor"] },
      { id: "finder", name: "Finder", app: null, command: ["open"] },
      { id: "antigravity", name: "Antigravity", app: "Antigravity.app", command: ["open", "-a", "Antigravity"] },
      { id: "xcode", name: "Xcode", app: "Xcode.app", command: ["open", "-a", "Xcode"] },
    ];
  }

  return [
    { id: "cursor", name: "Cursor", command: ["cursor"] },
    { id: "vscode", name: "VS Code", command: ["code"] },
    { id: "file-manager", name: "File Manager", command: ["xdg-open"] },
  ];
}

const KNOWN_EDITORS = buildKnownEditors();

let cachedInstalledEditors = null;

async function getMacAppIconBase64(appPath) {
  try {
    const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
    if (!require("node:fs").existsSync(infoPlistPath)) {
      return null;
    }
    // Very basic regex to find CFBundleIconFile or we can just use defaults read. Let's use execSync for defaults to be safe.
    let iconName = "";
    try {
      iconName = require("node:child_process")
        .execSync(`defaults read "${infoPlistPath}" CFBundleIconFile`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .trim();
    } catch (_) {
      // Sometimes defaults read fails or CFBundleIconFile is missing.
      return null;
    }

    if (!iconName.endsWith(".icns")) {
      iconName += ".icns";
    }

    const icnsPath = path.join(appPath, "Contents", "Resources", iconName);
    if (!require("node:fs").existsSync(icnsPath)) {
      return null;
    }

    // Use sips to convert the .icns file to a png buffer and output as base64
    const tmpDir = require("node:os").tmpdir();
    const tempPngPath = path.join(tmpDir, `vibe-temp-icon-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);

    // Convert highest res icon to 64x64 PNG
    require("node:child_process").execSync(`sips -s format png -z 64 64 "${icnsPath}" --out "${tempPngPath}"`, {
      stdio: "ignore"
    });

    const pngBuffer = require("node:fs").readFileSync(tempPngPath);
    require("node:fs").unlinkSync(tempPngPath);

    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  } catch (error) {
    return null;
  }
}

function resolveEditorLaunchCommand(editor) {
  if (!editor || !Array.isArray(editor.command) || editor.command.length === 0) {
    return null;
  }

  const [firstCommand, ...restArgs] = editor.command;
  const primaryCommand = String(firstCommand || "").trim();
  if (!primaryCommand) {
    return null;
  }

  if (path.isAbsolute(primaryCommand) && fs.existsSync(primaryCommand)) {
    return {
      command: primaryCommand,
      args: restArgs,
    };
  }

  const locations = getCommandLocations(primaryCommand);
  if (locations.length > 0) {
    return {
      command: locations[0],
      args: restArgs,
    };
  }

  const fallbackExecutables = Array.isArray(editor.fallbackExecutables)
    ? editor.fallbackExecutables
    : [];
  for (const candidate of fallbackExecutables) {
    const candidatePath = String(candidate || "").trim();
    if (!candidatePath || !path.isAbsolute(candidatePath)) {
      continue;
    }
    if (fs.existsSync(candidatePath)) {
      return {
        command: candidatePath,
        args: restArgs,
      };
    }
  }

  return null;
}

function toShortError(error) {
  if (!error) {
    return "";
  }
  return String(error?.message || error).trim();
}

function spawnDetachedCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const commandText = String(command || "").trim();
    if (!commandText) {
      resolve({ ok: false, error: "editor-launch-command-not-found" });
      return;
    }

    const launchArgs = Array.isArray(args)
      ? args.map((arg) => String(arg ?? ""))
      : [];
    const launchCwd = String(options.cwd || "").trim() || app.getPath("home");

    try {
      const child = spawn(commandText, launchArgs, {
        cwd: launchCwd,
        env: withAugmentedPath(process.env),
        windowsHide: true,
        stdio: "ignore",
        detached: true,
        shell: false,
      });

      let settled = false;
      child.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({
          ok: false,
          error: `editor-launch-failed:${toShortError(error) || "spawn-error"}`,
        });
      });
      child.once("spawn", () => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          child.unref();
        } catch (_error) {
          // Best effort.
        }
        resolve({ ok: true });
      });
    } catch (error) {
      resolve({
        ok: false,
        error: `editor-launch-failed:${toShortError(error) || "spawn-throw"}`,
      });
    }
  });
}

async function queryInstalledEditors() {
  if (cachedInstalledEditors) {
    return cachedInstalledEditors;
  }

  if (process.platform !== "darwin") {
    const installed = [];
    for (const editor of KNOWN_EDITORS) {
      if (editor.alwaysVisible || resolveEditorLaunchCommand(editor)) {
        installed.push({ id: editor.id, name: editor.name });
      }
    }
    cachedInstalledEditors = installed;
    return installed;
  }

  const installed = [];
  for (const editor of KNOWN_EDITORS) {
    if (!editor.app) {
      // Finders etc (null app path) won't have an icon via getFileIcon out of the box unless we pass a valid path.
      // We can use /System/Library/CoreServices/Finder.app
      if (editor.id === "finder") {
        try {
          const finderPath = "/System/Library/CoreServices/Finder.app";
          const icon = await getMacAppIconBase64(finderPath);
          if (icon) {
            installed.push({ id: editor.id, name: editor.name, icon });
          } else {
            installed.push({ id: editor.id, name: editor.name });
          }
        } catch (_) {
          installed.push({ id: editor.id, name: editor.name });
        }
      } else {
        installed.push({ id: editor.id, name: editor.name });
      }
      continue;
    }

    const appPath = path.join("/Applications", editor.app);
    try {
      const stat = require("node:fs").statSync(appPath);
      if (stat.isDirectory()) {
        try {
          const icon = await getMacAppIconBase64(appPath);
          if (icon) {
            installed.push({ id: editor.id, name: editor.name, icon });
          } else {
            installed.push({ id: editor.id, name: editor.name });
          }
        } catch (e) {
          installed.push({ id: editor.id, name: editor.name });
        }
      }
    } catch (_error) {
      // Not installed in /Applications, maybe ~/Applications?
      const userAppPath = path.join(app.getPath("home"), "Applications", editor.app);
      try {
        const stat2 = require("node:fs").statSync(userAppPath);
        if (stat2.isDirectory()) {
          try {
            const icon = await getMacAppIconBase64(userAppPath);
            if (icon) {
              installed.push({ id: editor.id, name: editor.name, icon });
            } else {
              installed.push({ id: editor.id, name: editor.name });
            }
          } catch (e) {
            installed.push({ id: editor.id, name: editor.name });
          }
        }
      } catch (_e) {
        // Really not installed.
      }
    }
  }

  cachedInstalledEditors = installed;
  return installed;
}

async function openInEditor(editorId, cwd) {
  const editor = KNOWN_EDITORS.find((e) => e.id === editorId);
  if (!editor) {
    return { ok: false, error: "unknown-editor" };
  }

  const requestedPath = typeof cwd === "string" && cwd.trim() ? cwd.trim() : process.cwd();
  const targetPath = fs.existsSync(requestedPath) ? requestedPath : process.cwd();

  try {
    if (process.platform === "win32" && editor.id === "explorer") {
      const openError = await shell.openPath(targetPath);
      if (openError) {
        return {
          ok: false,
          error: `editor-launch-failed:${openError}`,
        };
      }
      return { ok: true };
    }

    if (editor.app && editor.command[0] === "open") {
      return await spawnDetachedCommand("open", ["-a", editor.app, targetPath], {
        cwd: targetPath || app.getPath("home"),
      });
    }

    const launch = resolveEditorLaunchCommand(editor);
    if (!launch) {
      return { ok: false, error: "editor-launch-command-not-found" };
    }

    return await spawnDetachedCommand(launch.command, [...launch.args, targetPath], {
      cwd: targetPath || app.getPath("home"),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}


function getPwshExecutableName() {
  return process.platform === "win32" ? "pwsh.exe" : "pwsh";
}

function getPowerShell7VersionInfo() {
  const executableName = getPwshExecutableName();
  const locations = getCommandLocations(executableName);
  if (locations.length === 0) {
    return {
      installed: false,
      executable: null,
      version: null,
    };
  }

  const executable = locations[0];
  const versionResult = spawnSync(
    executable,
    ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  const versionText = String(versionResult.stdout || "").trim();
  const parsed = normalizeSemver(versionText);
  return {
    installed: true,
    executable,
    version: parsed ? `v${parsed.major}.${parsed.minor}.${parsed.patch}` : versionText || null,
  };
}

function buildPowerShell7InstallCommand() {
  if (process.platform === "win32") {
    return "winget install --id Microsoft.PowerShell --source winget -e";
  }
  if (process.platform === "darwin") {
    return "brew install --cask powershell";
  }
  return "https://learn.microsoft.com/powershell/scripting/install/installing-powershell";
}

function canAutoInstallPowerShell7() {
  if (process.platform !== "win32") {
    return false;
  }
  return isExecutableAvailable("winget");
}

function queryPowerShell7Status() {
  if (process.platform !== "win32") {
    return {
      ok: true,
      supportedPlatform: false,
      installed: true,
      needsInstall: false,
      minimumVersion: PWSH7_MIN_REQUIRED_VERSION,
      installCommand: buildPowerShell7InstallCommand(),
      installPageUrl: PWSH7_INSTALL_PAGE_URL,
      autoInstallAvailable: false,
      reason: "unsupported-platform",
    };
  }

  const minParsed = normalizeSemver(PWSH7_MIN_REQUIRED_VERSION);
  const info = getPowerShell7VersionInfo();
  if (!info.installed) {
    return {
      ok: true,
      supportedPlatform: true,
      installed: false,
      currentVersion: null,
      minimumVersion: PWSH7_MIN_REQUIRED_VERSION,
      needsInstall: true,
      installCommand: buildPowerShell7InstallCommand(),
      installPageUrl: PWSH7_INSTALL_PAGE_URL,
      autoInstallAvailable: canAutoInstallPowerShell7(),
      reason: "pwsh-not-found",
    };
  }

  const parsedCurrent = normalizeSemver(info.version);
  const belowMinimum = Boolean(minParsed && parsedCurrent && compareSemver(parsedCurrent, minParsed) < 0);
  return {
    ok: true,
    supportedPlatform: true,
    installed: true,
    currentVersion: info.version,
    minimumVersion: PWSH7_MIN_REQUIRED_VERSION,
    needsInstall: belowMinimum,
    installCommand: buildPowerShell7InstallCommand(),
    installPageUrl: PWSH7_INSTALL_PAGE_URL,
    autoInstallAvailable: canAutoInstallPowerShell7(),
    reason: belowMinimum ? "below-minimum" : "compatible",
  };
}

function openPowerShell7InstallPage() {
  try {
    shell.openExternal(PWSH7_INSTALL_PAGE_URL);
    return true;
  } catch (_error) {
    return false;
  }
}

function installPowerShell7() {
  return new Promise((resolve) => {
    const status = queryPowerShell7Status();
    if (status.ok !== true) {
      resolve({
        ok: false,
        error: "status-check-failed",
      });
      return;
    }

    if (!status.needsInstall) {
      resolve({
        ok: true,
        installed: true,
        needsInstall: false,
        currentVersion: status.currentVersion || null,
        action: "already-installed",
      });
      return;
    }

    if (FORCE_PWSH7_INSTALL_FAIL) {
      const opened = openPowerShell7InstallPage();
      resolve({
        ok: false,
        installed: false,
        needsInstall: true,
        action: opened ? "opened-install-page" : "open-install-page-failed",
        error: "forced-install-failure",
        installPageUrl: PWSH7_INSTALL_PAGE_URL,
      });
      return;
    }

    if (!status.autoInstallAvailable) {
      const opened = openPowerShell7InstallPage();
      resolve({
        ok: false,
        installed: false,
        needsInstall: true,
        action: opened ? "opened-install-page" : "open-install-page-failed",
        installPageUrl: PWSH7_INSTALL_PAGE_URL,
      });
      return;
    }

    const args = [
      "install",
      "--id",
      "Microsoft.PowerShell",
      "--source",
      "winget",
      "-e",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ];
    let stdout = "";
    let stderr = "";

    let child = null;
    try {
      child = spawn("winget", args, {
        cwd: app.getPath("home"),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      const opened = openPowerShell7InstallPage();
      resolve({
        ok: false,
        installed: false,
        needsInstall: true,
        action: opened ? "opened-install-page" : "open-install-page-failed",
        error: `spawn-failed:${String(error)}`,
        stdout: trimTail(stdout),
        stderr: trimTail(stderr),
        installPageUrl: PWSH7_INSTALL_PAGE_URL,
      });
      return;
    }

    child.stdout?.on("data", (chunk) => {
      stdout = trimTail(`${stdout}${String(chunk || "")}`);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = trimTail(`${stderr}${String(chunk || "")}`);
    });

    child.on("error", (error) => {
      const opened = openPowerShell7InstallPage();
      resolve({
        ok: false,
        installed: false,
        needsInstall: true,
        action: opened ? "opened-install-page" : "open-install-page-failed",
        error: `spawn-error:${String(error)}`,
        stdout: trimTail(stdout),
        stderr: trimTail(stderr),
        installPageUrl: PWSH7_INSTALL_PAGE_URL,
      });
    });

    child.on("close", (code) => {
      const nextStatus = queryPowerShell7Status();
      if (code === 0 && nextStatus.ok === true && !nextStatus.needsInstall) {
        resolve({
          ok: true,
          installed: true,
          needsInstall: false,
          currentVersion: nextStatus.currentVersion || null,
          action: "auto-installed",
          stdout: trimTail(stdout),
          stderr: trimTail(stderr),
        });
        return;
      }

      const opened = openPowerShell7InstallPage();
      resolve({
        ok: false,
        installed: false,
        needsInstall: true,
        action: opened ? "opened-install-page" : "open-install-page-failed",
        error: `winget-exit-${String(code)}`,
        stdout: trimTail(stdout),
        stderr: trimTail(stderr),
        installPageUrl: PWSH7_INSTALL_PAGE_URL,
      });
    });
  });
}

function queryNodeRuntimeStatus() {
  const supportedPlatform = process.platform === "win32" || process.platform === "darwin";
  const autoInstallAvailable = canAutoInstallNodeRuntime();
  const minimumParsed = normalizeSemver(NODE_MIN_REQUIRED_VERSION);
  const recommendedParsed = normalizeSemver(NODE_RECOMMENDED_VERSION);
  const detected = spawnSync("node", ["-v"], {
    encoding: "utf8",
    windowsHide: true,
    env: withAugmentedPath(process.env),
  });

  if (detected.status !== 0) {
    return {
      ok: true,
      supportedPlatform,
      installed: false,
      currentVersion: null,
      minimumVersion: NODE_MIN_REQUIRED_VERSION,
      recommendedVersion: NODE_RECOMMENDED_VERSION,
      needsUpgrade: supportedPlatform,
      upgradeCommand: buildNodeUpgradeCommand(),
      installCommand: buildNodeUpgradeCommand(),
      installPageUrl: NODE_INSTALL_PAGE_URL,
      autoInstallAvailable,
      reason: supportedPlatform ? "node-not-found" : "unsupported-platform",
    };
  }

  const currentVersionText = String(detected.stdout || "").trim();
  const currentParsed = normalizeSemver(currentVersionText);
  if (!currentParsed || !minimumParsed || !recommendedParsed) {
    return {
      ok: true,
      supportedPlatform,
      installed: true,
      currentVersion: currentVersionText || null,
      minimumVersion: NODE_MIN_REQUIRED_VERSION,
      recommendedVersion: NODE_RECOMMENDED_VERSION,
      needsUpgrade: false,
      upgradeCommand: buildNodeUpgradeCommand(),
      installCommand: buildNodeUpgradeCommand(),
      installPageUrl: NODE_INSTALL_PAGE_URL,
      autoInstallAvailable,
      reason: "version-parse-skipped",
    };
  }

  const belowMinimum = compareSemver(currentParsed, minimumParsed) < 0;
  const belowRecommended = compareSemver(currentParsed, recommendedParsed) < 0;
  const needsUpgrade = supportedPlatform && (belowMinimum || belowRecommended);
  return {
    ok: true,
    supportedPlatform,
    installed: true,
    currentVersion: `v${currentParsed.major}.${currentParsed.minor}.${currentParsed.patch}`,
    minimumVersion: NODE_MIN_REQUIRED_VERSION,
    recommendedVersion: NODE_RECOMMENDED_VERSION,
    needsUpgrade,
    belowMinimum,
    belowRecommended,
    upgradeCommand: buildNodeUpgradeCommand(),
    installCommand: buildNodeUpgradeCommand(),
    installPageUrl: NODE_INSTALL_PAGE_URL,
    autoInstallAvailable,
    reason: !supportedPlatform
      ? "unsupported-platform"
      : belowMinimum
        ? "below-minimum"
        : belowRecommended
          ? "below-recommended"
          : "compatible",
  };
}

function buildNodeRuntimeInstallAttempts() {
  if (process.platform === "win32") {
    const agreementArgs = ["--accept-package-agreements", "--accept-source-agreements"];
    return [
      {
        command: "winget",
        args: [
          "install",
          "--id",
          "OpenJS.NodeJS.LTS",
          "--source",
          "winget",
          "-e",
          ...agreementArgs,
        ],
        errorPrefix: "winget-lts",
      },
      {
        command: "winget",
        args: [
          "install",
          "OpenJS.NodeJS.LTS",
          "--source",
          "winget",
          ...agreementArgs,
        ],
        errorPrefix: "winget-query",
      },
    ];
  }
  if (process.platform === "darwin") {
    return [
      {
        command: "brew",
        args: ["install", "node@20"],
        errorPrefix: "brew-install-node20",
      },
      {
        command: "brew",
        args: ["upgrade", "node@20"],
        errorPrefix: "brew-upgrade-node20",
      },
    ];
  }
  return [];
}

function runNodeRuntimeInstallAttempt(attempt) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        ...payload,
        stdout: trimTail(stdout),
        stderr: trimTail(stderr),
      });
    };

    let child = null;
    try {
      child = spawn(attempt.command, attempt.args, {
        cwd: app.getPath("home"),
        env: withAugmentedPath(process.env),
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      finish({
        ok: false,
        error: `${attempt.errorPrefix}-spawn-failed:${String(error)}`,
      });
      return;
    }

    child.stdout?.on("data", (chunk) => {
      stdout = trimTail(`${stdout}${String(chunk || "")}`);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = trimTail(`${stderr}${String(chunk || "")}`);
    });

    child.on("error", (error) => {
      finish({
        ok: false,
        error: `${attempt.errorPrefix}-spawn-error:${String(error)}`,
      });
    });

    child.on("close", (code) => {
      if (code === 0) {
        finish({
          ok: true,
          error: null,
        });
        return;
      }
      finish({
        ok: false,
        error: `${attempt.errorPrefix}-exit-${String(code)}`,
      });
    });
  });
}

async function installNodeRuntime() {
  const status = queryNodeRuntimeStatus();
  if (status.ok !== true) {
    return {
      ok: false,
      error: "status-check-failed",
    };
  }

  if (!status.needsUpgrade) {
    return {
      ok: true,
      installed: Boolean(status.installed),
      needsUpgrade: false,
      currentVersion: status.currentVersion || null,
      action: "already-compatible",
    };
  }

  if (!status.supportedPlatform) {
    const opened = openNodeInstallPage();
    return {
      ok: false,
      installed: Boolean(status.installed),
      needsUpgrade: true,
      currentVersion: status.currentVersion || null,
      action: opened ? "opened-install-page" : "open-install-page-failed",
      error: "unsupported-platform",
      installCommand: buildNodeUpgradeCommand(),
      installPageUrl: NODE_INSTALL_PAGE_URL,
    };
  }

  if (!status.autoInstallAvailable) {
    const opened = openNodeInstallPage();
    return {
      ok: false,
      installed: Boolean(status.installed),
      needsUpgrade: true,
      currentVersion: status.currentVersion || null,
      action: opened ? "opened-install-page" : "open-install-page-failed",
      error: process.platform === "win32" ? "winget-not-found" : "brew-not-found",
      installCommand: buildNodeUpgradeCommand(),
      installPageUrl: NODE_INSTALL_PAGE_URL,
    };
  }

  const attempts = buildNodeRuntimeInstallAttempts();
  let combinedStdout = "";
  let combinedStderr = "";
  let lastError = "install-attempt-unavailable";

  for (const attempt of attempts) {
    const result = await runNodeRuntimeInstallAttempt(attempt);
    if (result.stdout) {
      combinedStdout = trimTail(`${combinedStdout}${combinedStdout ? "\n" : ""}${result.stdout}`);
    }
    if (result.stderr) {
      combinedStderr = trimTail(`${combinedStderr}${combinedStderr ? "\n" : ""}${result.stderr}`);
    }
    if (result.error) {
      lastError = String(result.error);
    }

    const nextStatus = queryNodeRuntimeStatus();
    if (result.ok && nextStatus.ok === true && !nextStatus.needsUpgrade) {
      return {
        ok: true,
        installed: Boolean(nextStatus.installed),
        needsUpgrade: false,
        currentVersion: nextStatus.currentVersion || null,
        action: "auto-installed",
        installCommand: buildNodeUpgradeCommand(),
        installPageUrl: NODE_INSTALL_PAGE_URL,
        stdout: trimTail(combinedStdout),
        stderr: trimTail(combinedStderr),
      };
    }
  }

  const finalStatus = queryNodeRuntimeStatus();
  if (finalStatus.ok === true && !finalStatus.needsUpgrade) {
    return {
      ok: true,
      installed: Boolean(finalStatus.installed),
      needsUpgrade: false,
      currentVersion: finalStatus.currentVersion || null,
      action: "auto-installed",
      installCommand: buildNodeUpgradeCommand(),
      installPageUrl: NODE_INSTALL_PAGE_URL,
      stdout: trimTail(combinedStdout),
      stderr: trimTail(combinedStderr),
    };
  }

  const opened = openNodeInstallPage();
  return {
    ok: false,
    installed: Boolean(finalStatus.installed),
    needsUpgrade: true,
    currentVersion: finalStatus.currentVersion || null,
    action: opened ? "opened-install-page" : "open-install-page-failed",
    error: lastError,
    installCommand: buildNodeUpgradeCommand(),
    installPageUrl: NODE_INSTALL_PAGE_URL,
    stdout: trimTail(combinedStdout),
    stderr: trimTail(combinedStderr),
  };
}

function buildAgentInstallCommand(target) {
  return `npm install -g ${target.packageName}@latest`;
}

function buildAgentUninstallCommand(target) {
  return `npm uninstall -g ${target.packageName}`;
}

function ensureTempClipboardDir() {
  const baseDir = path.join(os.tmpdir(), "vibe-terminal", "clipboard");
  fs.mkdirSync(baseDir, { recursive: true });
  return baseDir;
}

function saveClipboardImageToTemp() {
  const image = clipboard.readImage();
  if (!image || image.isEmpty()) {
    return {
      ok: false,
      error: "clipboard-image-empty",
    };
  }

  const tempDir = ensureTempClipboardDir();
  const fileName = `capture-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.png`;
  const filePath = path.join(tempDir, fileName);
  const pngBuffer = image.toPNG();
  fs.writeFileSync(filePath, pngBuffer);

  const size = image.getSize();
  return {
    ok: true,
    path: filePath,
    fileName,
    width: Number(size?.width) || 0,
    height: Number(size?.height) || 0,
    dataUrl: image.toDataURL(),
  };
}

function getAgentInstallStatus(agentCommand) {
  const target = getAgentInstallTarget(agentCommand);
  if (!target) {
    return {
      ok: false,
      error: "unsupported-agent",
    };
  }

  const installed = isExecutableAvailable(target.executable);
  return {
    ok: true,
    agentCommand: target.id,
    label: target.label,
    installed,
    packageName: target.packageName,
    installCommand: buildAgentInstallCommand(target),
    uninstallCommand: buildAgentUninstallCommand(target),
    npmUrl: target.npmUrl,
    docsUrl: target.docsUrl,
  };
}

function trimTail(value, maxLength = 12000) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(text.length - maxLength);
}

function installAgentLatest(agentCommand) {
  return new Promise((resolve) => {
    const target = getAgentInstallTarget(agentCommand);
    if (!target) {
      resolve({
        ok: false,
        error: "unsupported-agent",
      });
      return;
    }

    const npmCommand = resolveNpmCommand();
    if (!npmCommand) {
      resolve({
        ok: false,
        error: "npm-not-found",
        installCommand: buildAgentInstallCommand(target),
      });
      return;
    }

    const npmArgs = ["install", "-g", `${target.packageName}@latest`];
    let stdout = "";
    let stderr = "";
    let resolved = false;

    const finish = (payload) => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve({
        ...payload,
        agentCommand: target.id,
        label: target.label,
        packageName: target.packageName,
        installCommand: buildAgentInstallCommand(target),
        uninstallCommand: buildAgentUninstallCommand(target),
        npmUrl: target.npmUrl,
        docsUrl: target.docsUrl,
        stdout: trimTail(stdout),
        stderr: trimTail(stderr),
      });
    };

    let child = null;
    try {
      child = spawn(npmCommand, npmArgs, {
        cwd: app.getPath("home"),
        env: withAugmentedPath(process.env),
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      finish({
        ok: false,
        error: `spawn-failed:${String(error)}`,
      });
      return;
    }

    child.stdout?.on("data", (chunk) => {
      stdout = trimTail(`${stdout}${String(chunk || "")}`);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = trimTail(`${stderr}${String(chunk || "")}`);
    });

    child.on("error", (error) => {
      finish({
        ok: false,
        error: `spawn-error:${String(error)}`,
      });
    });

    child.on("close", (code) => {
      const installed = isExecutableAvailable(target.executable);
      if (code === 0 && installed) {
        finish({
          ok: true,
          installed: true,
        });
        return;
      }

      if (code === 0 && !installed) {
        finish({
          ok: false,
          installed: false,
          error: "install-finished-but-command-not-found",
        });
        return;
      }

      finish({
        ok: false,
        installed,
        error: `npm-exit-${String(code)}`,
      });
    });
  });
}

function uninstallAgent(agentCommand) {
  return new Promise((resolve) => {
    const target = getAgentInstallTarget(agentCommand);
    if (!target) {
      resolve({
        ok: false,
        error: "unsupported-agent",
      });
      return;
    }

    const npmCommand = resolveNpmCommand();
    if (!npmCommand) {
      resolve({
        ok: false,
        error: "npm-not-found",
        uninstallCommand: buildAgentUninstallCommand(target),
      });
      return;
    }

    const npmArgs = ["uninstall", "-g", target.packageName];
    let stdout = "";
    let stderr = "";
    let resolved = false;

    const finish = (payload) => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve({
        ...payload,
        agentCommand: target.id,
        label: target.label,
        packageName: target.packageName,
        installCommand: buildAgentInstallCommand(target),
        uninstallCommand: buildAgentUninstallCommand(target),
        npmUrl: target.npmUrl,
        docsUrl: target.docsUrl,
        stdout: trimTail(stdout),
        stderr: trimTail(stderr),
      });
    };

    let child = null;
    try {
      child = spawn(npmCommand, npmArgs, {
        cwd: app.getPath("home"),
        env: withAugmentedPath(process.env),
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      finish({
        ok: false,
        error: `spawn-failed:${String(error)}`,
      });
      return;
    }

    child.stdout?.on("data", (chunk) => {
      stdout = trimTail(`${stdout}${String(chunk || "")}`);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = trimTail(`${stderr}${String(chunk || "")}`);
    });

    child.on("error", (error) => {
      finish({
        ok: false,
        error: `spawn-error:${String(error)}`,
      });
    });

    child.on("close", (code) => {
      const installed = isExecutableAvailable(target.executable);
      if (code === 0 && !installed) {
        finish({
          ok: true,
          installed: false,
          action: "uninstalled",
        });
        return;
      }

      if (code === 0 && installed) {
        finish({
          ok: false,
          error: "still-installed",
          installed: true,
        });
        return;
      }

      finish({
        ok: false,
        error: `npm-exit-${code}`,
        installed,
      });
    });
  });
}

async function getSkillCatalog(options = {}) {
  const query = normalizeSkillSearchQuery(options?.query);
  const codexSkillsDir = getCodexSkillsDir();
  const agentsSkillsDir = getAgentsSkillsDir();
  const codexInstalledSkills = listSkillDirs(codexSkillsDir, {
    includeHidden: false,
    excludeNames: [".system"],
  });
  const agentsInstalledSkills = listSkillDirs(agentsSkillsDir, {
    includeHidden: false,
  });
  const curated = queryCuratedSkillRows();
  const curatedIcons = await queryCuratedSkillIconMap();
  const skillsSh = await querySkillsShRows(query);
  const getCuratedIconUrl = (skillName) => {
    const fileName = curatedIcons.bySkill.get(toSafeSkillName(skillName));
    return buildCuratedRawAssetUrl(skillName, fileName);
  };

  const SKILLS_SH_TOP_ALL_TIME = [
    { name: "find-skills", repo: "vercel-labs/skills", installs: 271900 },
    { name: "vercel-react-best-practices", repo: "vercel-labs/agent-skills", installs: 149200 },
    { name: "web-design-guidelines", repo: "vercel-labs/agent-skills", installs: 112800 },
    { name: "remotion-best-practices", repo: "remotion-dev/skills", installs: 100200 },
    { name: "frontend-design", repo: "anthropics/skills", installs: 82900 },
    { name: "vercel-composition-patterns", repo: "vercel-labs/agent-skills", installs: 48500 },
    { name: "agent-browser", repo: "vercel-labs/agent-browser", installs: 47000 },
    { name: "typescript-design-patterns", repo: "vercel-labs/agent-skills", installs: 40100 },
    { name: "vercel-ai-sdk-best-practices", repo: "vercel-labs/agent-skills", installs: 38200 },
    { name: "git-commit-guidelines", repo: "anthropics/skills", installs: 35000 },
    { name: "error-handling-patterns", repo: "wshobson/agents", installs: 3500 },
    { name: "backlink-analyzer", repo: "aaron-he-zhu/seo-geo-claude-skills", installs: 2600 },
    { name: "session-handoff", repo: "softaworks/agent-toolkit", installs: 2100 },
    { name: "baoyu-markdown-to-html", repo: "jimliu/baoyu-skills", installs: 1800 },
    { name: "gdpr-data-handling", repo: "wshobson/agents", installs: 1800 },
    { name: "on-call-handoff-patterns", repo: "wshobson/agents", installs: 1600 },
    { name: "security-audit-patterns", repo: "wshobson/agents", installs: 1500 },
    { name: "api-integration-patterns", repo: "wshobson/agents", installs: 1400 },
    { name: "database-schema-patterns", repo: "wshobson/agents", installs: 1200 },
    { name: "testing-patterns", repo: "wshobson/agents", installs: 1100 }
  ];

  const byKey = new Map();
  const installedByName = new Map();
  const pushSkill = (key, skill) => {
    if (!key || !skill || byKey.has(key)) {
      return;
    }
    byKey.set(key, skill);
  };

  for (const local of codexInstalledSkills) {
    const skill = {
      name: local.name,
      displayName: local.displayName || formatSkillDisplayName(local.name) || local.name,
      description: local.description || DEFAULT_SKILL_DESCRIPTION,
      installed: true,
      recommended: false,
      removable: true,
      source: "codex",
      installProvider: null,
      installRepo: "",
      installs: 0,
      iconUrl: String(local.iconUrl || ""),
      iconFallbackUrl: "",
    };
    pushSkill(`codex:${local.name}`, skill);
    installedByName.set(local.name, skill);
  }

  for (const local of agentsInstalledSkills) {
    if (installedByName.has(local.name)) {
      continue;
    }
    const skill = {
      name: local.name,
      displayName: local.displayName || formatSkillDisplayName(local.name) || local.name,
      description: local.description || DEFAULT_SKILL_DESCRIPTION,
      installed: true,
      recommended: false,
      removable: true,
      source: "agents",
      installProvider: null,
      installRepo: "",
      installs: 0,
      iconUrl: String(local.iconUrl || ""),
      iconFallbackUrl: "",
    };
    pushSkill(`agents:${local.name}`, skill);
    installedByName.set(local.name, skill);
  }

  for (const row of curated.rows) {
    const name = toSafeSkillName(row?.name);
    if (!name) {
      continue;
    }
    const installedSkill = installedByName.get(name);
    if (installedSkill) {
      installedSkill.recommended = true;
      const curatedUrl = getCuratedIconUrl(name) || SKILL_ICON_OVERRIDES[name] || "";
      if (curatedUrl) {
        installedSkill.iconFallbackUrl = installedSkill.iconUrl || "";
        installedSkill.iconUrl = curatedUrl;
      }
      continue;
    }
    pushSkill(`curated:${name}`, {
      name,
      displayName: formatSkillDisplayName(name) || name,
      description: SKILL_DESCRIPTION_OVERRIDES[name] || DEFAULT_SKILL_DESCRIPTION,
      installed: false,
      recommended: true,
      removable: false,
      source: "curated",
      installProvider: "curated",
      installRepo: CURATED_SKILL_REPO,
      installs: 0,
      iconUrl: getCuratedIconUrl(name) || SKILL_ICON_OVERRIDES[name] || "",
      iconFallbackUrl: "",
    });
  }

  const skillsShRowsToRender = skillsSh.skipped
    ? SKILLS_SH_TOP_ALL_TIME.map(s => ({
      ...s,
      installRepo: s.repo,
      iconUrl: buildSkillsShOpenGraphImageUrl(`${s.repo}/${s.name}`),
      iconFallbackUrl: getSkillsShOwnerAvatarUrl(s.repo)
    }))
    : skillsSh.rows;

  let addedMockCount = 0;

  for (const row of skillsShRowsToRender) {
    const name = toSafeSkillName(row?.name);
    const installRepo = toSafeRepositorySlug(row?.installRepo);
    if (!name || !installRepo || installedByName.has(name)) {
      continue;
    }
    const isMock = skillsSh.skipped;

    if (isMock) {
      if (addedMockCount >= 10) continue;
      addedMockCount++;
    }

    const descText = isMock ? `${installRepo} · skills.sh 역대 설치 상위 스킬` : `${installRepo} · skills.sh 검색 결과`;
    pushSkill(`skills-sh:${installRepo}:${name}`, {
      name,
      displayName: String(row.displayName || formatSkillDisplayName(name) || name),
      description: String(row.description || descText),
      installed: false,
      recommended: true,
      removable: false,
      source: "skills-sh",
      installProvider: "skills-sh",
      installRepo,
      installs: Number.isFinite(row?.installs) ? Math.max(0, row.installs) : 0,
      iconUrl: String(row?.iconUrl || getSkillsShOwnerAvatarUrl(installRepo)),
      iconFallbackUrl: String(row?.iconFallbackUrl || getSkillsShOwnerAvatarUrl(installRepo)),
    });
  }

  const skills = [...byKey.values()].sort((a, b) =>
    String(a.displayName || a.name).localeCompare(String(b.displayName || b.name), "ko"),
  );
  const installedSkills = skills.filter((skill) => skill.installed);
  const recommendedSkills = skills.filter((skill) => !skill.installed && skill.recommended);

  return {
    ok: true,
    curatedSourceOk: curated.ok,
    curatedError: curated.ok ? null : curated.error,
    curatedIconSourceOk: curatedIcons.ok,
    curatedIconError: curatedIcons.ok ? null : curatedIcons.error,
    skillsShSourceOk: skillsSh.ok,
    skillsShError: skillsSh.ok ? null : skillsSh.error,
    skillsShQuery: skillsSh.query || query,
    installedSkills,
    recommendedSkills,
    skills,
  };
}

function installCuratedSkill(skillName) {
  const normalized = toSafeSkillName(skillName);
  if (!normalized) {
    return {
      ok: false,
      error: "invalid-skill-name",
    };
  }

  const installedPath = resolveInstalledSkillPath(normalized);
  if (installedPath) {
    return {
      ok: true,
      skillName: normalized,
      action: "already-installed",
    };
  }
  cleanupStaleSkillInstallPaths(normalized);

  const curated = queryCuratedSkillRows();
  const supported = curated.rows.some((row) => row.name === normalized);
  if (!supported) {
    return {
      ok: false,
      error: curated.ok ? "unsupported-skill" : "curated-source-unavailable",
      skillName: normalized,
    };
  }

  const python = resolvePythonCommand();
  const scriptPath = path.join(getSkillInstallerScriptsDir(), "install-skill-from-github.py");
  if (!python || !fs.existsSync(scriptPath)) {
    return {
      ok: false,
      error: "skill-install-script-not-found",
      skillName: normalized,
    };
  }

  const result = spawnSync(
    python,
    [
      scriptPath,
      "--repo",
      CURATED_SKILL_REPO,
      "--path",
      `${CURATED_SKILL_PATH_PREFIX}/${normalized}`,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: withAugmentedPath(process.env),
      cwd: app.getPath("home"),
    },
  );
  const stdout = trimTail(String(result.stdout || ""));
  const stderr = trimTail(String(result.stderr || ""));
  if (result.error) {
    return {
      ok: false,
      error: "skill-install-spawn-failed",
      skillName: normalized,
      stdout,
      stderr: trimTail(`${stderr}\n${String(result.error.message || result.error)}`),
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: `skill-install-exit-${result.status}`,
      skillName: normalized,
      stdout,
      stderr,
    };
  }

  const nextInstalledPath = resolveInstalledSkillPath(normalized);
  if (!nextInstalledPath) {
    return {
      ok: false,
      error: "skill-install-finished-but-missing",
      skillName: normalized,
      stdout,
      stderr,
    };
  }

  return {
    ok: true,
    skillName: normalized,
    action: "installed",
    stdout,
    stderr,
  };
}

function installSkillsShSkill(skillName, installRepo) {
  const normalized = toSafeSkillName(skillName);
  const repository = toSafeRepositorySlug(installRepo);
  if (!normalized) {
    return {
      ok: false,
      error: "invalid-skill-name",
    };
  }
  if (!repository) {
    return {
      ok: false,
      error: "invalid-install-repo",
      skillName: normalized,
    };
  }

  const installedPath = resolveInstalledSkillPath(normalized);
  if (installedPath) {
    return {
      ok: true,
      skillName: normalized,
      action: "already-installed",
    };
  }
  cleanupStaleSkillInstallPaths(normalized);

  const npxCommand = resolveNpxCommand();
  if (!npxCommand) {
    return {
      ok: false,
      error: "skills-cli-not-found",
      skillName: normalized,
    };
  }

  const result = spawnSync(
    npxCommand,
    [
      "-y",
      "skills",
      "add",
      repository,
      "--skill",
      normalized,
      "--agent",
      "codex",
      "--global",
      "--yes",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: withAugmentedPath(process.env),
      cwd: app.getPath("home"),
    },
  );
  const stdout = trimTail(String(result.stdout || ""));
  const stderr = trimTail(String(result.stderr || ""));
  if (result.error) {
    return {
      ok: false,
      error: "skills-install-spawn-failed",
      skillName: normalized,
      stdout,
      stderr: trimTail(`${stderr}\n${String(result.error.message || result.error)}`),
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: `skills-install-exit-${result.status}`,
      skillName: normalized,
      stdout,
      stderr,
    };
  }

  const nextInstalledPath = resolveInstalledSkillPath(normalized);
  if (!nextInstalledPath) {
    return {
      ok: false,
      error: "skills-install-finished-but-missing",
      skillName: normalized,
      stdout,
      stderr,
    };
  }

  return {
    ok: true,
    skillName: normalized,
    action: "installed",
    stdout,
    stderr,
  };
}

function installSkill(payload = {}) {
  const normalized = toSafeSkillName(payload.skillName);
  const installProvider = normalizeSkillInstallProvider(payload.installProvider);
  const installRepo = toSafeRepositorySlug(payload.installRepo);
  if (!normalized) {
    return {
      ok: false,
      error: "invalid-skill-name",
    };
  }

  if (installProvider === "skills-sh") {
    return installSkillsShSkill(normalized, installRepo);
  }

  return installCuratedSkill(normalized);
}

function uninstallSkill(skillName) {
  const normalized = toSafeSkillName(skillName);
  if (!normalized) {
    return {
      ok: false,
      error: "invalid-skill-name",
    };
  }

  const codexPath = path.join(getCodexSkillsDir(), normalized);
  const agentsPath = path.join(getAgentsSkillsDir(), normalized);
  const installedInCodex = fs.existsSync(codexPath);
  const installedInAgents = fs.existsSync(agentsPath);

  if (!installedInCodex && !installedInAgents) {
    return {
      ok: false,
      error: "not-installed",
      skillName: normalized,
    };
  }

  let stdout = "";
  let stderr = "";

  if (installedInAgents) {
    const npxCommand = resolveNpxCommand();
    if (npxCommand) {
      const cliResult = spawnSync(
        npxCommand,
        [
          "-y",
          "skills",
          "remove",
          normalized,
          "--global",
          "--yes",
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          env: withAugmentedPath(process.env),
          cwd: app.getPath("home"),
        },
      );
      stdout = trimTail(String(cliResult.stdout || ""));
      stderr = trimTail(String(cliResult.stderr || ""));
    }

    if (fs.existsSync(agentsPath)) {
      try {
        fs.rmSync(agentsPath, {
          recursive: true,
          force: false,
          maxRetries: 2,
        });
      } catch (error) {
        return {
          ok: false,
          error: `skill-uninstall-failed:${String(error)}`,
          skillName: normalized,
          stdout,
          stderr,
        };
      }
    }
  }

  if (installedInCodex && fs.existsSync(codexPath)) {
    try {
      fs.rmSync(codexPath, {
        recursive: true,
        force: false,
        maxRetries: 2,
      });
    } catch (error) {
      return {
        ok: false,
        error: `skill-uninstall-failed:${String(error)}`,
        skillName: normalized,
        stdout,
        stderr,
      };
    }
  }

  if (fs.existsSync(codexPath) || fs.existsSync(agentsPath)) {
    return {
      ok: false,
      error: "skill-uninstall-finished-but-present",
      skillName: normalized,
      stdout,
      stderr,
    };
  }

  return {
    ok: true,
    skillName: normalized,
    action: "uninstalled",
    stdout,
    stderr,
  };
}

function resolveGeminiCliCoreModulePath() {
  const executableName = process.platform === "win32" ? "gemini.cmd" : "gemini";
  const executablePaths = getCommandLocations(executableName);
  if (executablePaths.length === 0) {
    return null;
  }

  const candidates = [];
  for (const executablePath of executablePaths) {
    const executableDir = path.dirname(executablePath);
    candidates.push(
      path.join(
        executableDir,
        "node_modules",
        "@google",
        "gemini-cli",
        "node_modules",
        "@google",
        "gemini-cli-core",
      ),
    );

    const scopedPackageDir = path.join(executableDir, "node_modules", "@google");
    if (!fs.existsSync(scopedPackageDir)) {
      continue;
    }

    let scopedEntries = [];
    try {
      scopedEntries = fs.readdirSync(scopedPackageDir);
    } catch (_error) {
      scopedEntries = [];
    }

    for (const entry of scopedEntries) {
      if (!entry.startsWith(".gemini-cli-")) {
        continue;
      }
      candidates.push(
        path.join(
          scopedPackageDir,
          entry,
          "node_modules",
          "@google",
          "gemini-cli-core",
        ),
      );
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveGeminiCatalogBase() {
  const coreModulePath = resolveGeminiCliCoreModulePath();
  if (!coreModulePath) {
    const models = normalizeModelList(GEMINI_MODEL_FALLBACKS);
    return {
      models,
      selectedModel: models[0] || null,
    };
  }

  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const core = require(coreModulePath);
    const models = normalizeModelList([
      ...(core?.VALID_GEMINI_MODELS ? [...core.VALID_GEMINI_MODELS] : []),
      core?.PREVIEW_GEMINI_MODEL_AUTO,
      core?.DEFAULT_GEMINI_MODEL_AUTO,
      core?.PREVIEW_GEMINI_MODEL,
      core?.PREVIEW_GEMINI_FLASH_MODEL,
      core?.DEFAULT_GEMINI_MODEL,
      core?.DEFAULT_GEMINI_FLASH_MODEL,
      core?.DEFAULT_GEMINI_FLASH_LITE_MODEL,
      ...GEMINI_MODEL_FALLBACKS,
    ]);

    const selectedModel = normalizeModelName(core?.PREVIEW_GEMINI_MODEL_AUTO)
      || normalizeModelName(core?.DEFAULT_GEMINI_MODEL_AUTO)
      || normalizeModelName(core?.DEFAULT_GEMINI_MODEL)
      || models[0]
      || null;

    return {
      models,
      selectedModel,
    };
  } catch (_error) {
    const models = normalizeModelList(GEMINI_MODEL_FALLBACKS);
    return {
      models,
      selectedModel: models[0] || null,
    };
  }
}

function parseGeminiCurrentModel(rawOutput) {
  const normalized = normalizeTerminalOutput(rawOutput).toLowerCase();

  if (/(^|\s)auto\s*\(\s*gemini\s*3(?:\.0)?\s*\)/i.test(normalized)) {
    return "auto-gemini-3";
  }
  if (/(^|\s)auto\s*\(\s*gemini\s*2\.5\s*\)/i.test(normalized)) {
    return "auto-gemini-2.5";
  }

  const modelPattern = /\b(auto-gemini-(?:2\.5|3)|gemini-[a-z0-9][a-z0-9.-]*)\b/g;
  let selectedModel = null;
  let match = null;
  while ((match = modelPattern.exec(normalized)) !== null) {
    selectedModel = match[1];
  }

  return normalizeModelName(selectedModel);
}

function queryGeminiCurrentModel(timeoutMs = GEMINI_MODEL_QUERY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let shell = null;
    try {
      shell = getDefaultShell();
    } catch (_error) {
      resolve(null);
      return;
    }

    let terminal = null;
    try {
      terminal = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        cwd: process.cwd(),
        env: process.env,
      });
    } catch (_error) {
      resolve(null);
      return;
    }

    const timers = [];
    let output = "";
    let settled = false;

    const registerTimer = (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      timers.push(timer);
      return timer;
    };

    const clearAllTimers = () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.length = 0;
    };

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearAllTimers();

      const selectedModel = parseGeminiCurrentModel(output);
      try {
        terminal.kill();
      } catch (_error) {
        // Best effort.
      }
      resolve(selectedModel || null);
    };

    terminal.onData((data) => {
      output += String(data || "");
    });

    terminal.onExit(() => {
      finish();
    });

    registerTimer(() => {
      try {
        terminal.write("gemini\r");
      } catch (_error) {
        finish();
      }
    }, GEMINI_MODEL_QUERY_START_DELAY_MS);

    registerTimer(() => {
      try {
        terminal.write("/exit\r");
      } catch (_error) {
        // Ignore and wait for timeout.
      }
    }, GEMINI_MODEL_QUERY_SEND_EXIT_DELAY_MS);

    registerTimer(
      () => finish(),
      GEMINI_MODEL_QUERY_SEND_EXIT_DELAY_MS + GEMINI_MODEL_QUERY_SETTLE_DELAY_MS,
    );

    registerTimer(() => finish(), timeoutMs);
  });
}

async function queryGeminiModelCatalog() {
  const baseCatalog = resolveGeminiCatalogBase();
  const envSelected = normalizeModelName(process.env.GEMINI_MODEL);
  const discoveredSelected = await queryGeminiCurrentModel();
  const selectedModel = normalizeModelName(discoveredSelected)
    || envSelected
    || normalizeModelName(baseCatalog.selectedModel)
    || null;

  const models = normalizeModelList([
    ...baseCatalog.models,
    selectedModel,
  ]);

  if (models.length === 0) {
    return {
      ok: false,
      models: [],
      selectedModel: null,
      error: "model-list-empty",
    };
  }

  const resolvedSelected = selectedModel && models.includes(selectedModel)
    ? selectedModel
    : models[0];

  return {
    ok: true,
    models,
    selectedModel: resolvedSelected,
  };
}

function createRendererHotReload(window) {
  if (!window || window.isDestroyed() || app.isPackaged) {
    return () => { };
  }

  const rendererRoot = path.join(__dirname, "..", "renderer");
  if (!fs.existsSync(rendererRoot)) {
    return () => { };
  }

  let reloadTimer = null;
  let watcher = null;

  const scheduleReload = () => {
    if (!window || window.isDestroyed()) {
      return;
    }
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (!window || window.isDestroyed()) {
        return;
      }
      window.webContents.reloadIgnoringCache();
    }, HOT_RELOAD_DEBOUNCE_MS);
  };

  try {
    watcher = fs.watch(rendererRoot, { recursive: true }, (_eventType, filename) => {
      if (typeof filename === "string" && filename.length > 0) {
        const ext = path.extname(filename).toLowerCase();
        if (ext && !HOT_RELOAD_EXTENSIONS.has(ext)) {
          return;
        }
      }
      scheduleReload();
    });
  } catch (error) {
    // Best effort only in development mode.
    console.warn(`[hot-reload] watcher disabled: ${String(error)}`);
  }

  return () => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  };
}

function createMainWindow() {
  hasWindowCloseCleanupRun = false;

  const windowOptions = {
    width: 1400,
    height: 1000,
    minWidth: 1400,
    minHeight: 600,
    title: "Vibe Terminal",
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !isProductionBuild(),
    },
  };

  if (typeof APP_ICON_PATH === "string" && APP_ICON_PATH.length > 0 && fs.existsSync(APP_ICON_PATH)) {
    windowOptions.icon = APP_ICON_PATH;
  }

  mainWindow = new BrowserWindow(windowOptions);
  const disposeRendererHotReload = createRendererHotReload(mainWindow);
  const { webContents } = mainWindow;

  // Keep app chrome/text scale fixed and let renderer manage terminal font sizing only.
  webContents.setZoomFactor(1);
  webContents.setZoomLevel(0);
  webContents
    .setVisualZoomLevelLimits(1, 1)
    .catch(() => {
      // Best effort only.
    });
  webContents.on("zoom-changed", (event) => {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    webContents.setZoomFactor(1);
    webContents.setZoomLevel(0);
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.setMenuBarVisibility(false);
  if (typeof mainWindow.removeMenu === "function") {
    mainWindow.removeMenu();
  }

  if (!isProductionBuild() && SHOULD_AUTO_OPEN_DEVTOOLS) {
    mainWindow.webContents.once("did-finish-load", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      const { webContents: targetContents } = mainWindow;
      if (targetContents.isDevToolsOpened()) {
        return;
      }
      targetContents.openDevTools({ mode: "detach", activate: true });
    });
  }

  mainWindow.on("close", () => {
    cleanupSessionsOnce("window-close");
  });

  mainWindow.on("closed", () => {
    disposeRendererHotReload();
    cleanupSessionsOnce("window-closed");
    hasWindowCloseCleanupRun = false;
    mainWindow = null;
  });

  mainWindow.webContents.on("render-process-gone", () => {
    cleanupSessions("renderer-crash");
  });

  mainWindow.on("maximize", () => {
    emitWindowState(mainWindow);
  });

  mainWindow.on("unmaximize", () => {
    emitWindowState(mainWindow);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    emitWindowState(mainWindow);
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  ipcMain.on(IPC_CHANNELS.APP_WINDOW_MINIMIZE, (event) => {
    if (!isTrustedRendererEvent(event)) {
      return;
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) {
      return;
    }
    window.minimize();
  });

  ipcMain.on(IPC_CHANNELS.APP_WINDOW_MAXIMIZE_TOGGLE, (event) => {
    if (!isTrustedRendererEvent(event)) {
      return;
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) {
      return;
    }

    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
    emitWindowState(window);
  });

  ipcMain.handle(IPC_CHANNELS.APP_WINDOW_DEVTOOLS_TOGGLE, (event) => {
    if (!isTrustedRendererEvent(event)) {
      return { ok: false, error: "forbidden" };
    }

    if (isProductionBuild()) {
      return { ok: false, error: "disabled-in-production" };
    }

    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) {
      return { ok: false, error: "window-missing" };
    }

    const webContents = window.webContents;
    const isOpen = webContents.isDevToolsOpened();
    if (isOpen) {
      webContents.closeDevTools();
      return { ok: true, isOpen: false };
    }

    webContents.openDevTools({ mode: "detach", activate: true });
    return { ok: true, isOpen: true };
  });

  ipcMain.handle(IPC_CHANNELS.APP_WINDOW_CLOSE, async (event) => {
    if (!isTrustedRendererEvent(event)) {
      return { ok: false, error: "forbidden" };
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) {
      return { ok: false };
    }

    cleanupSessionsOnce("window-close-request");

    await new Promise((resolve) => {
      setTimeout(resolve, WINDOW_CLOSE_OVERLAY_DELAY_MS);
    });

    if (!window.isDestroyed()) {
      setTimeout(() => {
        if (!window.isDestroyed()) {
          window.close();
        }
      }, 0);
    }

    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.APP_PICK_DIRECTORY, async (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        canceled: true,
        path: null,
      };
    }
    const validated = validatePathDialogPayload(payload);
    if (!validated.ok) {
      return {
        canceled: true,
        path: null,
      };
    }
    const window = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!window || window.isDestroyed()) {
      return {
        canceled: true,
        path: null,
      };
    }

    const fallbackPath = app.getPath("home");
    const defaultPath =
      typeof validated.value.defaultPath === "string" && validated.value.defaultPath.length > 0
        ? validated.value.defaultPath
        : fallbackPath;

    const result = await dialog.showOpenDialog(window, {
      title: "작업 폴더 선택",
      defaultPath,
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"],
    });

    if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
      return {
        canceled: true,
        path: null,
      };
    }

    return {
      canceled: false,
      path: result.filePaths[0],
    };
  });

  ipcMain.handle(IPC_CHANNELS.APP_PICK_FILES, async (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        canceled: true,
        paths: [],
      };
    }
    const validated = validatePathDialogPayload(payload);
    if (!validated.ok) {
      return {
        canceled: true,
        paths: [],
      };
    }
    const window = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!window || window.isDestroyed()) {
      return {
        canceled: true,
        paths: [],
      };
    }

    const fallbackPath = app.getPath("home");
    const defaultPath =
      typeof validated.value.defaultPath === "string" && validated.value.defaultPath.length > 0
        ? validated.value.defaultPath
        : fallbackPath;

    const result = await dialog.showOpenDialog(window, {
      title: "파일 첨부",
      defaultPath,
      properties: ["openFile", "multiSelections", "dontAddToRecent"],
    });

    if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
      return {
        canceled: true,
        paths: [],
      };
    }

    return {
      canceled: false,
      paths: result.filePaths,
    };
  });

  ipcMain.handle(IPC_CHANNELS.APP_AGENT_INSTALL_STATUS, (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    const validated = validateAgentCommandPayload(payload);
    if (!validated.ok) {
      return {
        ok: false,
        error: validated.error,
      };
    }
    return getAgentInstallStatus(validated.value.agentCommand);
  });

  ipcMain.handle(IPC_CHANNELS.APP_AGENT_INSTALL_LATEST, async (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    const validated = validateAgentCommandPayload(payload);
    if (!validated.ok) {
      return {
        ok: false,
        error: validated.error,
      };
    }
    return installAgentLatest(validated.value.agentCommand);
  });

  ipcMain.handle(IPC_CHANNELS.APP_AGENT_UNINSTALL, async (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    const validated = validateAgentCommandPayload(payload);
    if (!validated.ok) {
      return {
        ok: false,
        error: validated.error,
      };
    }
    return uninstallAgent(validated.value.agentCommand);
  });

  ipcMain.handle(IPC_CHANNELS.APP_SKILL_CATALOG, async (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    const validated = validateSkillCatalogPayload(payload);
    if (!validated.ok) {
      return {
        ok: false,
        error: validated.error,
      };
    }
    return getSkillCatalog(validated.value);
  });

  ipcMain.handle(IPC_CHANNELS.APP_SKILL_INSTALL, (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    const validated = validateSkillInstallPayload(payload);
    if (!validated.ok) {
      return {
        ok: false,
        error: validated.error,
      };
    }
    return installSkill(validated.value);
  });

  ipcMain.handle(IPC_CHANNELS.APP_SKILL_UNINSTALL, (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    const validated = validateSkillNamePayload(payload);
    if (!validated.ok) {
      return {
        ok: false,
        error: validated.error,
      };
    }
    return uninstallSkill(validated.value.skillName);
  });



  ipcMain.handle(IPC_CHANNELS.APP_PWSH7_STATUS, (event) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    return queryPowerShell7Status();
  });

  ipcMain.handle(IPC_CHANNELS.APP_PWSH7_INSTALL, async (event) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    return installPowerShell7();
  });

  ipcMain.handle(IPC_CHANNELS.APP_NODE_RUNTIME_STATUS, (event) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    return queryNodeRuntimeStatus();
  });

  ipcMain.handle(IPC_CHANNELS.APP_NODE_RUNTIME_INSTALL, async (event) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    return installNodeRuntime();
  });

  ipcMain.handle(IPC_CHANNELS.APP_TERMINAL_COLOR_DIAGNOSTICS, (event) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    return queryTerminalColorDiagnostics();
  });

  ipcMain.handle(IPC_CHANNELS.APP_CODEX_MODEL_CATALOG, async (event) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        models: [],
        selectedModel: null,
        error: "forbidden",
      };
    }
    return queryCodexModelCatalog();
  });

  ipcMain.handle(IPC_CHANNELS.APP_GEMINI_MODEL_CATALOG, async (event) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        models: [],
        selectedModel: null,
        error: "forbidden",
      };
    }
    return queryGeminiModelCatalog();
  });

  ipcMain.handle(IPC_CHANNELS.APP_CLIPBOARD_READ, (event) => {
    if (!isTrustedRendererEvent(event)) {
      return "";
    }
    if (!isClipboardIpcAllowed(event)) {
      return "";
    }
    return clipboard.readText();
  });

  ipcMain.handle(IPC_CHANNELS.APP_CLIPBOARD_IMAGE_TO_TEMP, (event) => {
    if (!isTrustedRendererEvent(event)) {
      return { ok: false, error: "forbidden" };
    }
    if (!isClipboardIpcAllowed(event)) {
      return { ok: false, error: "rate-limit-exceeded" };
    }
    try {
      return saveClipboardImageToTemp();
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.APP_CLIPBOARD_WRITE, (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      return { ok: false, error: "forbidden" };
    }
    if (!isClipboardIpcAllowed(event)) {
      return { ok: false, error: "rate-limit-exceeded" };
    }
    const validated = validateClipboardWritePayload(payload);
    if (!validated.ok) {
      return { ok: false, error: validated.error };
    }
    clipboard.writeText(validated.value.text);
    return { ok: true };
  });

  ipcMain.handle("app:query-editors", async (event) => {
    if (!isTrustedRendererEvent(event)) {
      return { ok: false, error: "forbidden" };
    }
    const editors = await queryInstalledEditors();
    return { ok: true, editors };
  });

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_IN_EDITOR, (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      return { ok: false, error: "forbidden" };
    }
    const editorId = typeof payload?.editorId === "string" ? payload.editorId.trim() : "";
    const cwd = typeof payload?.cwd === "string" ? payload.cwd.trim() : "";
    if (!editorId) {
      return { ok: false, error: "invalid-editor-id" };
    }
    return openInEditor(editorId, cwd);
  });

  function resolveAgentsPolicyPath() {
    return path.join(app.getPath("userData"), "AGENTS.md");
  }

  function resolveAgentsPolicySourcePath() {
    const candidates = [];

    // Packaged apps should prefer the resource copy shipped via electron-builder extraResources.
    if (app.isPackaged && typeof process.resourcesPath === "string" && process.resourcesPath.trim()) {
      candidates.push(path.join(process.resourcesPath, "AGENTS.md"));
    }

    candidates.push(path.join(app.getAppPath(), "AGENTS.md"));
    candidates.push(path.join(process.cwd(), "AGENTS.md"));

    for (const candidatePath of candidates) {
      if (typeof candidatePath !== "string" || !candidatePath) {
        continue;
      }
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }

    return "";
  }

  function readAgentsPolicySourceContent() {
    const sourcePath = resolveAgentsPolicySourcePath();
    if (!sourcePath) {
      return "";
    }
    try {
      return fs.readFileSync(sourcePath, "utf-8");
    } catch (_error) {
      return "";
    }
  }

  function computeTextHash(value) {
    return crypto.createHash("sha256").update(String(value || ""), "utf-8").digest("hex");
  }

  function resolveAgentsPolicySyncMetaPath(userDataPolicyPath) {
    return path.join(path.dirname(userDataPolicyPath), "AGENTS.sync.json");
  }

  function readAgentsPolicySyncMeta(metaPath) {
    if (!metaPath || !fs.existsSync(metaPath)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(metaPath, "utf-8");
      const parsed = JSON.parse(raw);
      const sourceHash = typeof parsed?.sourceHash === "string" ? parsed.sourceHash.trim() : "";
      const userHash = typeof parsed?.userHash === "string" ? parsed.userHash.trim() : "";
      const autoSyncEligible = typeof parsed?.autoSyncEligible === "boolean" ? parsed.autoSyncEligible : null;
      if (!sourceHash || !userHash || autoSyncEligible === null) {
        return null;
      }
      return { sourceHash, userHash, autoSyncEligible };
    } catch (_error) {
      return null;
    }
  }

  function writeAgentsPolicySyncMeta(metaPath, meta) {
    if (!metaPath || !meta) {
      return;
    }
    try {
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            sourceHash: meta.sourceHash,
            userHash: meta.userHash,
            autoSyncEligible: Boolean(meta.autoSyncEligible),
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf-8",
      );
    } catch (_error) {
      // Ignore metadata sync failures; AGENTS.md remains the source of truth.
    }
  }

  function prepareAgentsPolicyPath() {
    const userDataPolicyPath = resolveAgentsPolicyPath();
    const userDataDir = path.dirname(userDataPolicyPath);

    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    const sourceContent = readAgentsPolicySourceContent();
    const sourceHash = computeTextHash(sourceContent);
    const syncMetaPath = resolveAgentsPolicySyncMetaPath(userDataPolicyPath);

    if (!fs.existsSync(userDataPolicyPath)) {
      fs.writeFileSync(userDataPolicyPath, sourceContent, "utf-8");
      writeAgentsPolicySyncMeta(syncMetaPath, {
        sourceHash,
        userHash: computeTextHash(sourceContent),
        autoSyncEligible: true,
      });
      return userDataPolicyPath;
    }

    const userContent = fs.readFileSync(userDataPolicyPath, "utf-8");
    const userHash = computeTextHash(userContent);
    const syncMeta = readAgentsPolicySyncMeta(syncMetaPath);

    const canAutoSyncFromSource = Boolean(
      syncMeta
      && syncMeta.autoSyncEligible
      && syncMeta.userHash === userHash
      && syncMeta.sourceHash !== sourceHash,
    );

    if (canAutoSyncFromSource) {
      fs.writeFileSync(userDataPolicyPath, sourceContent, "utf-8");
      writeAgentsPolicySyncMeta(syncMetaPath, {
        sourceHash,
        userHash: computeTextHash(sourceContent),
        autoSyncEligible: true,
      });
      return userDataPolicyPath;
    }

    const inferredAutoSyncEligible = userHash === sourceHash
      ? true
      : Boolean(syncMeta && syncMeta.autoSyncEligible && syncMeta.userHash === userHash);
    const shouldRefreshMeta = !syncMeta
      || syncMeta.sourceHash !== sourceHash
      || syncMeta.userHash !== userHash
      || syncMeta.autoSyncEligible !== inferredAutoSyncEligible;
    if (shouldRefreshMeta) {
      writeAgentsPolicySyncMeta(syncMetaPath, {
        sourceHash,
        userHash,
        autoSyncEligible: inferredAutoSyncEligible,
      });
    }

    return userDataPolicyPath;
  }

  function getFileMtimeMs(filePath) {
    try {
      const stat = fs.statSync(filePath);
      return Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : 0;
    } catch (_error) {
      return 0;
    }
  }

  ipcMain.handle(IPC_CHANNELS.APP_READ_AGENTS_POLICY, (event) => {
    if (!isTrustedRendererEvent(event)) {
      return { ok: false, error: "forbidden" };
    }
    try {
      const userDataPolicyPath = prepareAgentsPolicyPath();
      if (fs.existsSync(userDataPolicyPath)) {
        return {
          ok: true,
          content: fs.readFileSync(userDataPolicyPath, "utf-8"),
          path: userDataPolicyPath,
          mtimeMs: getFileMtimeMs(userDataPolicyPath),
        };
      }
      return { ok: true, content: null };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.APP_WRITE_AGENTS_POLICY, (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      return { ok: false, error: "forbidden" };
    }
    const validated = validateAgentsPolicyWritePayload(payload);
    if (!validated.ok) {
      return { ok: false, error: validated.error };
    }
    try {
      const userDataPolicyPath = prepareAgentsPolicyPath();
      const currentMtimeMs = getFileMtimeMs(userDataPolicyPath);
      const hasBaseMtime = Number.isFinite(validated.value.baseMtimeMs);
      if (
        hasBaseMtime
        && !validated.value.ignoreStale
        && Math.abs(currentMtimeMs - validated.value.baseMtimeMs) > 1
      ) {
        return {
          ok: false,
          error: "stale-version",
          path: userDataPolicyPath,
          currentMtimeMs,
        };
      }
      fs.writeFileSync(userDataPolicyPath, validated.value.content, "utf-8");
      const sourceHash = computeTextHash(readAgentsPolicySourceContent());
      const userHash = computeTextHash(validated.value.content);
      writeAgentsPolicySyncMeta(resolveAgentsPolicySyncMetaPath(userDataPolicyPath), {
        sourceHash,
        userHash,
        autoSyncEligible: userHash === sourceHash,
      });
      return {
        ok: true,
        path: userDataPolicyPath,
        mtimeMs: getFileMtimeMs(userDataPolicyPath),
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.APP_EDIT_AGENTS_POLICY, async (event) => {
    if (!isTrustedRendererEvent(event)) {
      return { ok: false, error: "forbidden" };
    }
    try {
      const userDataPolicyPath = prepareAgentsPolicyPath();
      if (fs.existsSync(userDataPolicyPath)) {
        const defaultOpenError = await shell.openPath(userDataPolicyPath);
        if (!defaultOpenError) {
          return { ok: true };
        }

        if (process.platform === "win32") {
          const fallback = await openPathInWindowsEditorFallback(userDataPolicyPath);
          if (fallback.ok) {
            return { ok: true, openedBy: fallback.editorId || "fallback" };
          }
          return {
            ok: false,
            error: `default-open-failed:${defaultOpenError}; fallback-failed:${fallback.error || "unknown"}`,
          };
        }

        return { ok: false, error: defaultOpenError };
      }
      return { ok: false, error: "AGENTS.md not found in user data directory." };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  const layoutStore = new LayoutStore(path.join(app.getPath("userData"), "state"));
  registerIpcRoutes({
    ipcMain,
    sessionManager,
    layoutStore,
    getMainWindow: () => mainWindow,
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  cleanupSessions("app-before-quit");
});

app.on("will-quit", () => {
  cleanupSessions("app-will-quit");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
