const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const pty = require("node-pty");
const { getDefaultShell } = require("../src/shared/models");

const MAX_COMMAND_LENGTH = 2048;
const MAX_CWD_LENGTH = 1024;
const MAX_ENV_KEY_LENGTH = 128;
const MAX_ENV_VALUE_LENGTH = 4096;
const SAFE_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORBIDDEN_ENV_KEYS = new Set([
  "NODE_OPTIONS",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
  "PROMPT_COMMAND",
  "BASH_ENV",
  "ENV",
]);
const DANGEROUS_COMMAND_PATTERNS = [
  /--dangerously-bypass-approvals-and-sandbox/i,
  /--dangerously-skip-permissions/i,
  /--sandbox=false/i,
  /\brm\s+-rf\s+\/\b/i,
  /\bdel\s+\/[sq]\b/i,
  /\bformat\s+[a-z]:/i,
];

function asText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value);
}

function normalizeAndValidateCwd(value, fallback) {
  const next = asText(value, fallback).trim();
  if (!next) {
    return fallback;
  }
  if (next.length > MAX_CWD_LENGTH) {
    throw new Error("cwd is too long");
  }

  const resolved = path.resolve(next);
  let stats = null;
  try {
    stats = fs.statSync(resolved);
  } catch (_error) {
    throw new Error(`cwd does not exist: ${resolved}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`cwd is not a directory: ${resolved}`);
  }

  return resolved;
}

function normalizeAndValidateCommand(value, fallback) {
  const next = asText(value, fallback);
  if (next.length > MAX_COMMAND_LENGTH) {
    throw new Error(`command exceeds max length (${MAX_COMMAND_LENGTH})`);
  }
  return next;
}

function isCommandAllowedByAllowlist(command, allowlist) {
  if (!command || !command.trim()) {
    return true;
  }
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return true;
  }

  const normalized = command.trim().toLowerCase();
  return allowlist.some((entry) => {
    const token = String(entry || "").trim().toLowerCase();
    if (!token) {
      return false;
    }
    return normalized === token || normalized.startsWith(`${token} `);
  });
}

function getDangerousCommandReason(command) {
  const normalized = String(command || "").trim();
  if (!normalized) {
    return "";
  }
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(normalized)) {
      return pattern.source;
    }
  }
  return "";
}

function normalizeEnv(env) {
  if (!env) {
    return {};
  }

  if (typeof env === "string") {
    const output = {};
    const lines = env.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) {
        continue;
      }
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!key || key.length > MAX_ENV_KEY_LENGTH || !SAFE_ENV_KEY_RE.test(key)) {
        throw new Error(`invalid env key: ${key || "<empty>"}`);
      }
      if (FORBIDDEN_ENV_KEYS.has(key.toUpperCase())) {
        throw new Error(`forbidden env key: ${key}`);
      }
      if (value.length > MAX_ENV_VALUE_LENGTH) {
        throw new Error(`env value too long: ${key}`);
      }
      output[key] = value;
    }
    return output;
  }

  if (typeof env === "object") {
    const output = {};
    for (const [key, value] of Object.entries(env)) {
      const envKey = String(key || "").trim();
      if (!envKey || envKey.length > MAX_ENV_KEY_LENGTH || !SAFE_ENV_KEY_RE.test(envKey)) {
        throw new Error(`invalid env key: ${envKey || "<empty>"}`);
      }
      if (FORBIDDEN_ENV_KEYS.has(envKey.toUpperCase())) {
        throw new Error(`forbidden env key: ${envKey}`);
      }
      const envValue = asText(value);
      if (envValue.length > MAX_ENV_VALUE_LENGTH) {
        throw new Error(`env value too long: ${envKey}`);
      }
      output[envKey] = envValue;
    }
    return output;
  }

  return {};
}

function trimBuffer(input, maxSize) {
  if (input.length <= maxSize) {
    return input;
  }
  return input.slice(input.length - maxSize);
}

class PanelManager extends EventEmitter {
  constructor({ agentIds, config, telemetry, ptyModule = pty }) {
    super();
    this.config = config;
    this.telemetry = telemetry;
    this.pty = ptyModule;
    this.panels = new Map();

    for (const id of agentIds) {
      this.panels.set(id, this.buildDefaultPanel(id));
    }
  }

  buildDefaultPanel(id) {
    return {
      id,
      label: `Agent ${id}`,
      status: "stopped",
      cwd: process.cwd(),
      command: "",
      env: {},
      autoRestart: true,
      cols: 120,
      rows: 32,
      buffer: "",
      lastExitCode: null,
      lastExitSignal: null,
      restartCount: 0,
      _pty: null,
      _manualStop: false,
      _restartTimer: null,
    };
  }

  serializePanel(panel) {
    return {
      id: panel.id,
      label: panel.label,
      status: panel.status,
      cwd: panel.cwd,
      command: panel.command,
      env: panel.env,
      autoRestart: panel.autoRestart,
      cols: panel.cols,
      rows: panel.rows,
      buffer: panel.buffer,
      lastExitCode: panel.lastExitCode,
      lastExitSignal: panel.lastExitSignal,
      restartCount: panel.restartCount,
    };
  }

  getPanels() {
    return [...this.panels.values()].map((panel) => this.serializePanel(panel));
  }

  getPanel(id) {
    const panel = this.panels.get(id);
    if (!panel) {
      return null;
    }
    return this.serializePanel(panel);
  }

  requirePanel(id) {
    const panel = this.panels.get(id);
    if (!panel) {
      /** @type {NodeJS.ErrnoException} */
      const error = new Error(`Unknown panel: ${id}`);
      error.code = "PANEL_NOT_FOUND";
      throw error;
    }
    return panel;
  }

  runningCount() {
    let count = 0;
    for (const panel of this.panels.values()) {
      if (panel.status === "running") {
        count += 1;
      }
    }
    return count;
  }

  canSpawnNewPty(panelId) {
    const running = this.runningCount();
    const panel = this.requirePanel(panelId);
    if (panel.status === "running") {
      return true;
    }
    return running < this.config.maxPtys;
  }

  clearRestartTimer(panel) {
    if (!panel?._restartTimer) {
      return;
    }
    clearTimeout(panel._restartTimer);
    panel._restartTimer = null;
  }

  updatePanelConfig(id, payload = {}) {
    const panel = this.requirePanel(id);

    if (payload.label !== undefined) {
      panel.label = asText(payload.label, panel.label) || panel.label;
    }
    if (payload.cwd !== undefined) {
      panel.cwd = normalizeAndValidateCwd(payload.cwd, panel.cwd);
    }
    if (payload.command !== undefined) {
      panel.command = normalizeAndValidateCommand(payload.command, panel.command);
    }
    if (payload.env !== undefined) {
      panel.env = normalizeEnv(payload.env);
    }
    if (payload.autoRestart !== undefined) {
      panel.autoRestart = Boolean(payload.autoRestart);
      if (!panel.autoRestart) {
        this.clearRestartTimer(panel);
      }
    }
    if (payload.clearBuffer) {
      panel.buffer = "";
      this.emit("panel_output", {
        panelId: panel.id,
        chunk: "",
        buffer: panel.buffer,
      });
    }

    const serialized = this.serializePanel(panel);
    this.emit("panel_update", serialized);
    return serialized;
  }

  appendSystemMessage(panel, message) {
    const stamp = new Date().toISOString();
    panel.buffer = trimBuffer(
      `${panel.buffer}\r\n[${stamp}] [manager] ${message}\r\n`,
      this.config.bufferSize
    );
    this.emit("panel_output", {
      panelId: panel.id,
      chunk: message,
      buffer: panel.buffer,
    });
  }

  createSpawnArgs(panel) {
    const isWindows = process.platform === "win32";
    if (isWindows) {
      const windowsShell = getDefaultShell();
      if (panel.command && panel.command.trim()) {
        return {
          shell: windowsShell,
          args: ["-NoLogo", "-NoExit", "-Command", panel.command],
        };
      }
      return {
        shell: windowsShell,
        args: ["-NoLogo"],
      };
    }

    if (panel.command && panel.command.trim()) {
      return {
        shell: process.env.SHELL || "/bin/bash",
        args: ["-lc", panel.command],
      };
    }
    return {
      shell: process.env.SHELL || "/bin/bash",
      args: ["-l"],
    };
  }

  async startPanel(id, payload = {}) {
    const panel = this.requirePanel(id);
    this.updatePanelConfig(id, payload);
    this.clearRestartTimer(panel);

    if (panel.status === "running") {
      return this.serializePanel(panel);
    }

    if (!this.canSpawnNewPty(id)) {
      /** @type {NodeJS.ErrnoException} */
      const error = new Error(
        `Cannot start panel ${id}: max PTY limit (${this.config.maxPtys}) reached`
      );
      error.code = "MAX_PTYS_REACHED";
      throw error;
    }

    if (!isCommandAllowedByAllowlist(panel.command, this.config.commandAllowlist)) {
      /** @type {NodeJS.ErrnoException} */
      const error = new Error("Command is not allowed by COMMAND_ALLOWLIST policy");
      error.code = "COMMAND_NOT_ALLOWED";
      throw error;
    }

    const dangerousCommandReason = getDangerousCommandReason(panel.command);
    if (dangerousCommandReason) {
      const approvedDangerousCommand = Boolean(payload?.approvedDangerousCommand);
      const providedApprovalToken = asText(payload?.approvalToken || "").trim();
      const expectedApprovalToken = asText(this.config.commandApprovalToken || "").trim();
      const isApproved =
        approvedDangerousCommand
        && expectedApprovalToken.length > 0
        && providedApprovalToken.length > 0
        && providedApprovalToken === expectedApprovalToken;
      if (!isApproved) {
        /** @type {NodeJS.ErrnoException} */
        const error = new Error(
          "Dangerous command requires approval token (set COMMAND_APPROVAL_TOKEN and pass approvedDangerousCommand=true)",
        );
        error.code = "COMMAND_REQUIRES_APPROVAL";
        error.details = {
          reason: dangerousCommandReason,
        };
        throw error;
      }
    }

    const { shell, args } = this.createSpawnArgs(panel);
    const env = {
      ...process.env,
      ...panel.env,
    };

    try {
      panel._manualStop = false;
      panel._pty = this.pty.spawn(shell, args, {
        cols: panel.cols,
        rows: panel.rows,
        cwd: panel.cwd || process.cwd(),
        env,
        name: "xterm-256color",
      });
    } catch (error) {
      this.appendSystemMessage(panel, `Failed to spawn PTY: ${error.message}`);
      throw error;
    }

    panel.status = "running";
    panel.lastExitCode = null;
    panel.lastExitSignal = null;

    panel._pty.onData((chunk) => {
      panel.buffer = trimBuffer(`${panel.buffer}${chunk}`, this.config.bufferSize);
      this.emit("panel_output", {
        panelId: panel.id,
        chunk,
        buffer: panel.buffer,
      });
    });

    panel._pty.onExit((event) => {
      const manualStop = panel._manualStop;
      this.clearRestartTimer(panel);
      panel._pty = null;
      panel.status = "stopped";
      panel.lastExitCode = event.exitCode ?? null;
      panel.lastExitSignal = event.signal ?? null;
      panel._manualStop = false;

      this.emit("panel_update", this.serializePanel(panel));
      this.telemetry.track("panel_count", {
        running: this.runningCount(),
        total: this.panels.size,
      });

      const crashed = !manualStop && (event.exitCode !== 0 || event.signal !== 0);
      if (crashed) {
        this.telemetry.track("pty_crash", {
          panelId: panel.id,
          exitCode: event.exitCode,
          signal: event.signal,
        });
      }

      if (crashed && panel.autoRestart) {
        panel.restartCount += 1;
        this.appendSystemMessage(
          panel,
          `PTY crashed. Restarting in ${this.config.autoRestartDelayMs}ms (attempt ${panel.restartCount}).`
        );
        panel._restartTimer = setTimeout(() => {
          panel._restartTimer = null;
          if (!panel.autoRestart || panel.status !== "stopped" || panel._manualStop) {
            return;
          }
          this.startPanel(panel.id).catch((error) => {
            this.appendSystemMessage(
              panel,
              `Auto-restart failed: ${error.message || String(error)}`
            );
          });
        }, this.config.autoRestartDelayMs);
      }
    });

    this.telemetry.track("panel_count", {
      running: this.runningCount(),
      total: this.panels.size,
    });

    this.emit("panel_update", this.serializePanel(panel));
    return this.serializePanel(panel);
  }

  async stopPanel(id) {
    const panel = this.requirePanel(id);
    this.clearRestartTimer(panel);
    if (!panel._pty || panel.status !== "running") {
      panel._manualStop = true;
      return this.serializePanel(panel);
    }

    panel._manualStop = true;
    try {
      panel._pty.kill();
    } catch (error) {
      this.appendSystemMessage(panel, `Failed to stop PTY cleanly: ${error.message}`);
      panel.status = "stopped";
      panel._pty = null;
    }

    this.emit("panel_update", this.serializePanel(panel));
    return this.serializePanel(panel);
  }

  async restartPanel(id, payload = {}) {
    await this.stopPanel(id);
    return this.startPanel(id, payload);
  }

  async startAll(overridesById = {}) {
    const started = [];
    const failed = [];

    for (const panel of this.panels.values()) {
      try {
        const next = await this.startPanel(panel.id, overridesById[panel.id] || {});
        started.push(next);
      } catch (error) {
        failed.push({ panelId: panel.id, error: error.message });
      }
    }

    return { started, failed };
  }

  async stopAll() {
    const stopped = [];
    for (const panel of this.panels.values()) {
      const next = await this.stopPanel(panel.id);
      stopped.push(next);
    }
    return { stopped };
  }

  resizePanel(id, cols, rows) {
    const panel = this.requirePanel(id);
    const safeCols = Math.max(40, Number(cols) || panel.cols);
    const safeRows = Math.max(10, Number(rows) || panel.rows);

    if (safeCols === panel.cols && safeRows === panel.rows) {
      return this.serializePanel(panel);
    }

    panel.cols = safeCols;
    panel.rows = safeRows;

    if (panel._pty) {
      try {
        panel._pty.resize(safeCols, safeRows);
      } catch (_) {
        // Ignore resize errors for dead PTYs.
      }
    }

    this.telemetry.track("panel_resize", {
      panelId: panel.id,
      cols: safeCols,
      rows: safeRows,
    });
    this.emit("panel_update", this.serializePanel(panel));
    return this.serializePanel(panel);
  }

  writePanel(id, data) {
    const panel = this.requirePanel(id);
    if (!panel._pty || panel.status !== "running") {
      return this.serializePanel(panel);
    }

    const text = asText(data);
    if (!text) {
      return this.serializePanel(panel);
    }

    panel._pty.write(text);
    return this.serializePanel(panel);
  }

  currentSessionSnapshot() {
    return {
      panels: [...this.panels.values()].map((panel) => ({
        ...this.serializePanel(panel),
        running: panel.status === "running",
      })),
    };
  }

  async shutdown() {
    for (const panel of this.panels.values()) {
      this.clearRestartTimer(panel);
      if (panel._pty) {
        try {
          panel._manualStop = true;
          panel._pty.kill();
        } catch (_) {
          // Ignore shutdown errors.
        }
      }
    }
  }
}

module.exports = {
  PanelManager,
};
