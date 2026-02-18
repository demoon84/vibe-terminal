const path = require("path");
const fs = require("fs");
const os = require("os");
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
  validateClipboardWritePayload,
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
const TERMINAL_COLOR_MODE = String(process.env.VIBE_TERMINAL_COLOR_MODE || "force")
  .trim()
  .toLowerCase();
const TMUX_INSTALL_PAGE_URL = "https://github.com/tmux/tmux/wiki/Installing";
const FORCE_TMUX_NOT_INSTALLED = String(process.env.VIBE_FORCE_TMUX_NOT_INSTALLED || "")
  .trim()
  .toLowerCase() === "1";
const FORCE_TMUX_INSTALL_FAIL = String(process.env.VIBE_FORCE_TMUX_INSTALL_FAIL || "")
  .trim()
  .toLowerCase() === "1";
const FORCE_TMUX_INSTALL_SUCCESS = String(process.env.VIBE_FORCE_TMUX_INSTALL_SUCCESS || "")
  .trim()
  .toLowerCase() === "1";
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

function buildTmuxInstallCommand() {
  if (process.platform === "darwin") {
    return "brew install tmux";
  }
  if (process.platform === "win32") {
    return "winget install --id GnuWin32.Tmux --source winget -e";
  }
  if (process.platform === "linux") {
    return "sudo apt-get install -y tmux";
  }
  return TMUX_INSTALL_PAGE_URL;
}

function canAutoInstallTmux() {
  if (process.platform === "darwin") {
    return isExecutableAvailable("brew");
  }
  if (process.platform === "win32") {
    return isExecutableAvailable("winget");
  }
  return false;
}

function queryTmuxStatus() {
  const installed = FORCE_TMUX_NOT_INSTALLED ? false : isExecutableAvailable("tmux");
  const supportedPlatform = process.platform === "darwin" || process.platform === "win32";
  if (installed) {
    return {
      ok: true,
      supportedPlatform,
      installed: true,
      needsInstall: false,
      installCommand: buildTmuxInstallCommand(),
      installPageUrl: TMUX_INSTALL_PAGE_URL,
      autoInstallAvailable: canAutoInstallTmux(),
      reason: FORCE_TMUX_NOT_INSTALLED ? "forced-tmux-not-installed" : "compatible",
    };
  }

  if (!supportedPlatform) {
    return {
      ok: true,
      supportedPlatform: false,
      installed: false,
      needsInstall: false,
      installCommand: buildTmuxInstallCommand(),
      installPageUrl: TMUX_INSTALL_PAGE_URL,
      autoInstallAvailable: false,
      reason: "unsupported-platform",
    };
  }

  return {
    ok: true,
    supportedPlatform: true,
    installed: false,
    needsInstall: true,
    installCommand: buildTmuxInstallCommand(),
    installPageUrl: TMUX_INSTALL_PAGE_URL,
    autoInstallAvailable: canAutoInstallTmux(),
    reason: FORCE_TMUX_NOT_INSTALLED ? "forced-tmux-not-installed" : "tmux-not-found",
  };
}

function openTmuxInstallPage() {
  try {
    shell.openExternal(TMUX_INSTALL_PAGE_URL);
    return true;
  } catch (_error) {
    return false;
  }
}

function buildTmuxInstallAttempts() {
  if (process.platform === "darwin") {
    return [
      {
        command: "brew",
        args: ["install", "tmux"],
        errorPrefix: "brew",
      },
    ];
  }
  if (process.platform === "win32") {
    const agreementArgs = ["--accept-package-agreements", "--accept-source-agreements"];
    return [
      {
        command: "winget",
        args: [
          "install",
          "--id",
          "GnuWin32.Tmux",
          "--source",
          "winget",
          "-e",
          ...agreementArgs,
        ],
        errorPrefix: "winget-id",
      },
      {
        command: "winget",
        args: [
          "install",
          "tmux",
          "--source",
          "winget",
          ...agreementArgs,
        ],
        errorPrefix: "winget-query",
      },
    ];
  }
  return [];
}

function runTmuxInstallAttempt(attempt) {
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

async function installTmux() {
  const status = queryTmuxStatus();
  if (status.ok !== true) {
    return {
      ok: false,
      error: "status-check-failed",
    };
  }

  if (!status.supportedPlatform) {
    const opened = openTmuxInstallPage();
    return {
      ok: false,
      installed: false,
      needsInstall: true,
      action: opened ? "opened-install-page" : "open-install-page-failed",
      error: "unsupported-platform",
      installCommand: buildTmuxInstallCommand(),
      installPageUrl: TMUX_INSTALL_PAGE_URL,
    };
  }

  if (!status.needsInstall) {
    return {
      ok: true,
      installed: true,
      needsInstall: false,
      action: "already-installed",
    };
  }

  if (FORCE_TMUX_INSTALL_FAIL) {
    console.info("[tmux-install] forced failure path");
    const opened = openTmuxInstallPage();
    return {
      ok: false,
      installed: false,
      needsInstall: true,
      action: opened ? "opened-install-page" : "open-install-page-failed",
      error: "forced-install-failure",
      installCommand: buildTmuxInstallCommand(),
      installPageUrl: TMUX_INSTALL_PAGE_URL,
    };
  }

  if (FORCE_TMUX_INSTALL_SUCCESS) {
    console.info("[tmux-install] forced success path");
    return {
      ok: true,
      installed: true,
      needsInstall: false,
      action: "forced-install-success",
      installCommand: buildTmuxInstallCommand(),
      installPageUrl: TMUX_INSTALL_PAGE_URL,
    };
  }

  if (!status.autoInstallAvailable) {
    const opened = openTmuxInstallPage();
    return {
      ok: false,
      installed: false,
      needsInstall: true,
      action: opened ? "opened-install-page" : "open-install-page-failed",
      error: process.platform === "win32" ? "winget-not-found" : "brew-not-found",
      installCommand: buildTmuxInstallCommand(),
      installPageUrl: TMUX_INSTALL_PAGE_URL,
    };
  }

  const attempts = buildTmuxInstallAttempts();
  let combinedStdout = "";
  let combinedStderr = "";
  let lastError = "install-attempt-unavailable";

  for (const attempt of attempts) {
    const result = await runTmuxInstallAttempt(attempt);
    if (result.stdout) {
      combinedStdout = trimTail(`${combinedStdout}${combinedStdout ? "\n" : ""}${result.stdout}`);
    }
    if (result.stderr) {
      combinedStderr = trimTail(`${combinedStderr}${combinedStderr ? "\n" : ""}${result.stderr}`);
    }
    if (result.error) {
      lastError = String(result.error);
    }

    const installed = isExecutableAvailable("tmux");
    if (result.ok && installed) {
      return {
        ok: true,
        installed: true,
        needsInstall: false,
        action: "auto-installed",
        installCommand: buildTmuxInstallCommand(),
        installPageUrl: TMUX_INSTALL_PAGE_URL,
        stdout: trimTail(combinedStdout),
        stderr: trimTail(combinedStderr),
      };
    }
  }

  const installed = isExecutableAvailable("tmux");
  if (installed) {
    return {
      ok: true,
      installed: true,
      needsInstall: false,
      action: "auto-installed",
      installCommand: buildTmuxInstallCommand(),
      installPageUrl: TMUX_INSTALL_PAGE_URL,
      stdout: trimTail(combinedStdout),
      stderr: trimTail(combinedStderr),
    };
  }

  const opened = openTmuxInstallPage();
  return {
    ok: false,
    installed: false,
    needsInstall: true,
    action: opened ? "opened-install-page" : "open-install-page-failed",
    error: lastError,
    installCommand: buildTmuxInstallCommand(),
    installPageUrl: TMUX_INSTALL_PAGE_URL,
    stdout: trimTail(combinedStdout),
    stderr: trimTail(combinedStderr),
  };
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
        env: process.env,
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
    return () => {};
  }

  const rendererRoot = path.join(__dirname, "..", "renderer");
  if (!fs.existsSync(rendererRoot)) {
    return () => {};
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
    width: 1600,
    height: 1000,
    minWidth: 900,
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
      properties: ["openDirectory", "dontAddToRecent"],
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

  ipcMain.handle(IPC_CHANNELS.APP_TMUX_STATUS, (event) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    return queryTmuxStatus();
  });

  ipcMain.handle(IPC_CHANNELS.APP_TMUX_INSTALL, async (event) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    return installTmux();
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
