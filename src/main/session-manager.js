const { EventEmitter } = require("events");
const pty = require("node-pty");
const {
  withAugmentedPath,
} = require("./path-utils");
const {
  getDefaultShell,
  createId,
  clonePlainObject,
} = require("../shared/models");

const SESSION_STATUS = Object.freeze({
  CREATING: "creating",
  RUNNING: "running",
  STOPPING: "stopping",
  STOPPED: "stopped",
  ERRORED: "errored",
});

const MAX_RETAINED_STOPPED_SESSIONS = 48;
const TERMINAL_COLOR_MODE = String(process.env.VIBE_TERMINAL_COLOR_MODE || "force")
  .trim()
  .toLowerCase();

const OSC7_COMPLETE_RE =
  /\u001b\]7;file:\/\/[^\u0007]*(?:\u0007|\u001b\\)/g;
const OSC7_PREFIX = "\u001b]7;file://";

function now() {
  return Date.now();
}

function parseOsc7Sequence(sequence) {
  const stripped = sequence
    .replace(/^\u001b\]7;file:\/\//, "")
    .replace(/\u0007$/, "")
    .replace(/\u001b\\$/, "");

  if (!stripped) {
    return null;
  }

  let pathPart = stripped;
  if (!pathPart.startsWith("/")) {
    const firstSlash = pathPart.indexOf("/");
    if (firstSlash < 0) {
      return null;
    }
    pathPart = pathPart.slice(firstSlash);
  }

  let decoded = pathPart;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch (_error) {
    // Keep raw string when decoding fails.
  }

  if (process.platform === "win32") {
    if (/^\/[A-Za-z]:/.test(decoded)) {
      decoded = decoded.slice(1);
    }
    decoded = decoded.replace(/\//g, "\\");
  }

  return decoded || null;
}

function extractCwdFromOsc7Stream(chunk) {
  let nextCwd = null;
  let match = null;
  OSC7_COMPLETE_RE.lastIndex = 0;
  while ((match = OSC7_COMPLETE_RE.exec(chunk)) !== null) {
    const parsed = parseOsc7Sequence(match[0]);
    if (parsed) {
      nextCwd = parsed;
    }
  }

  let remainder = "";
  const startIndex = chunk.lastIndexOf(OSC7_PREFIX);
  if (startIndex >= 0) {
    const tail = chunk.slice(startIndex);
    const completed = /\u0007|\u001b\\/.test(tail);
    if (!completed) {
      remainder = tail.slice(-2048);
    }
  }

  return { cwd: nextCwd, remainder };
}

function isPowerShellShell(shell) {
  const normalized = String(shell || "").toLowerCase();
  return (
    normalized === "pwsh" ||
    normalized === "pwsh.exe" ||
    normalized === "powershell" ||
    normalized === "powershell.exe" ||
    normalized.endsWith("\\pwsh.exe") ||
    normalized.endsWith("/pwsh.exe") ||
    normalized.endsWith("\\powershell.exe") ||
    normalized.endsWith("/powershell.exe")
  );
}

function isPowerShell7(shell) {
  const normalized = String(shell || "").toLowerCase();
  return (
    normalized === "pwsh" ||
    normalized === "pwsh.exe" ||
    normalized.endsWith("\\pwsh.exe") ||
    normalized.endsWith("/pwsh.exe")
  );
}

function isCmdShell(shell) {
  const normalized = String(shell || "").toLowerCase();
  return (
    normalized === "cmd" ||
    normalized === "cmd.exe" ||
    normalized.endsWith("\\cmd.exe") ||
    normalized.endsWith("/cmd.exe")
  );
}

function quotePowerShellPath(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function quotePosixPath(value) {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

function buildChangeDirectoryCommand(shell, cwd) {
  if (process.platform === "win32") {
    if (isPowerShellShell(shell)) {
      return `Set-Location -LiteralPath ${quotePowerShellPath(cwd)}\r`;
    }
    if (isCmdShell(shell)) {
      return `cd /d "${String(cwd || "").replace(/"/g, '""')}"\r`;
    }
  }

  if (isPowerShellShell(shell)) {
    return `Set-Location -LiteralPath ${quotePowerShellPath(cwd)}\r`;
  }
  return `cd ${quotePosixPath(cwd)}\r`;
}

function isUtf8LocaleValue(value) {
  return /utf-?8/i.test(String(value || "").trim());
}

function getUtf8LocaleFallback() {
  return process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8";
}

function applyUtf8LocaleSettings(env) {
  if (process.platform === "win32" || !env || typeof env !== "object") {
    return;
  }

  const hasInvalidLcAll = typeof env.LC_ALL === "string"
    && env.LC_ALL.trim().length > 0
    && !isUtf8LocaleValue(env.LC_ALL);
  if (!hasInvalidLcAll && [env.LC_ALL, env.LC_CTYPE, env.LANG].some((value) => isUtf8LocaleValue(value))) {
    return;
  }

  const fallbackLocale = getUtf8LocaleFallback();
  env.LANG = fallbackLocale;
  env.LC_CTYPE = fallbackLocale;
  env.LC_ALL = fallbackLocale;
}

function setWindowsEnvVariable(env, key, value) {
  const existingKey = Object.keys(env).find(
    (candidate) => String(candidate).toLowerCase() === String(key).toLowerCase(),
  );
  if (existingKey) {
    env[existingKey] = value;
    return;
  }
  env[key] = value;
}

function buildTerminalEnv(extraEnv = {}, shell = "") {
  const merged = { ...process.env, ...extraEnv };
  if (process.platform === "win32" && isPowerShell7(shell)) {
    setWindowsEnvVariable(merged, "ComSpec", shell);
    setWindowsEnvVariable(merged, "COMSPEC", shell);
  }
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
  applyUtf8LocaleSettings(merged);
  return merged;
}

function sanitizeSession(session) {
  const result = {
    id: session.id,
    cwd: session.cwd,
    shell: session.shell,
    env: clonePlainObject(session.env || {}),
    cols: session.cols,
    rows: session.rows,
    status: session.status,
    lastActiveAt: session.lastActiveAt,
  };

  if (typeof session.exitCode === "number") {
    result.exitCode = session.exitCode;
  }
  if (typeof session.signal === "number") {
    result.signal = session.signal;
  }
  if (typeof session.error === "string") {
    result.error = session.error;
  }
  return result;
}

class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
    this.clients = new Map();
    this.osc7Remainders = new Map();
    this.stoppedSessionOrder = [];
  }

  handleClientData(sessionId, data) {
    const current = this.sessions.get(sessionId);
    if (!current) {
      return;
    }

    const remainder = this.osc7Remainders.get(sessionId) || "";
    const parsed = extractCwdFromOsc7Stream(`${remainder}${data}`);
    this.osc7Remainders.set(sessionId, parsed.remainder);

    if (parsed.cwd && parsed.cwd !== current.cwd) {
      current.cwd = parsed.cwd;
      this.emit("status", sanitizeSession(current));
    }

    current.lastActiveAt = now();
    this.emit("data", { sessionId, data });
  }

  handleClientExit(sessionId, exitCode, signal) {
    this.clients.delete(sessionId);
    this.osc7Remainders.delete(sessionId);

    const current = this.sessions.get(sessionId);
    if (!current) {
      return;
    }

    current.status = SESSION_STATUS.STOPPED;
    current.exitCode = exitCode;
    current.signal = signal;
    current.lastActiveAt = now();

    this.emit("status", sanitizeSession(current));
    this.emit("exit", {
      sessionId,
      exitCode,
      signal,
      status: current.status,
    });

    this.retainStoppedSession(sessionId);
  }

  forgetSession(sessionId) {
    if (!sessionId) {
      return;
    }
    this.osc7Remainders.delete(sessionId);
    this.sessions.delete(sessionId);
    this.stoppedSessionOrder = this.stoppedSessionOrder.filter((id) => id !== sessionId);
  }

  retainStoppedSession(sessionId) {
    if (!sessionId || this.clients.has(sessionId)) {
      return;
    }

    this.stoppedSessionOrder = this.stoppedSessionOrder.filter((id) => id !== sessionId);
    this.stoppedSessionOrder.push(sessionId);

    while (this.stoppedSessionOrder.length > MAX_RETAINED_STOPPED_SESSIONS) {
      const oldestId = this.stoppedSessionOrder.shift();
      if (!oldestId || this.clients.has(oldestId)) {
        continue;
      }
      this.forgetSession(oldestId);
    }
  }

  createSession(options = {}) {
    const id = options.sessionId || createId("session");
    const cwd = options.cwd || process.cwd();
    const requestedShellRaw = typeof options.shell === "string" ? options.shell.trim() : "";
    const requestedShell = process.platform === "win32" ? "" : requestedShellRaw;
    const defaultShell = getDefaultShell();
    const shell = requestedShell || defaultShell;
    const env = clonePlainObject(options.env || {});
    const cols = Number.isFinite(options.cols) ? Math.max(2, options.cols) : 80;
    const rows = Number.isFinite(options.rows) ? Math.max(1, options.rows) : 24;

    if (this.clients.has(id)) {
      this.killSession(id, "replace-session");
    }

    const session = {
      id,
      cwd,
      shell,
      env,
      cols,
      rows,
      status: SESSION_STATUS.CREATING,
      lastActiveAt: now(),
    };

    this.stoppedSessionOrder = this.stoppedSessionOrder.filter((sessionId) => sessionId !== id);
    this.sessions.set(id, session);
    this.emit("status", sanitizeSession(session));

    try {
      const terminalEnv = withAugmentedPath(buildTerminalEnv(env, shell));
      const client = pty.spawn(shell, [], {
        name: "xterm-256color",
        cwd,
        cols,
        rows,
        env: terminalEnv,
      });

      const dataSubscription = client.onData((data) => {
        this.handleClientData(id, data);
      });

      const exitSubscription = client.onExit(({ exitCode, signal }) => {
        this.handleClientExit(id, exitCode, signal);
      });

      this.clients.set(id, {
        sessionId: id,
        client,
        dataSubscription,
        exitSubscription,
      });
      this.osc7Remainders.set(id, "");

      session.status = SESSION_STATUS.RUNNING;
      session.lastActiveAt = now();
      delete session.error;
      this.emit("status", sanitizeSession(session));
      return sanitizeSession(session);
    } catch (error) {
      const runtime = this.clients.get(id);
      if (runtime) {
        try { runtime.dataSubscription?.dispose?.(); } catch (_e) { /* best effort */ }
        try { runtime.exitSubscription?.dispose?.(); } catch (_e) { /* best effort */ }
        this.clients.delete(id);
      }
      this.osc7Remainders.delete(id);

      session.status = SESSION_STATUS.ERRORED;
      session.error = error instanceof Error ? error.message : String(error);
      session.lastActiveAt = now();
      this.emit("status", sanitizeSession(session));
      throw error;
    }
  }

  writeSession(sessionId, data) {
    const runtime = this.clients.get(sessionId);
    const client = runtime?.client;
    if (!client) {
      throw new Error(`Session is not running: ${sessionId}`);
    }

    client.write(data);

    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActiveAt = now();
    }
    return true;
  }

  changeDirectory(sessionId, cwd) {
    const runtime = this.clients.get(sessionId);
    const client = runtime?.client;
    if (!client) {
      throw new Error(`Session is not running: ${sessionId}`);
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const nextCwd = typeof cwd === "string" ? cwd.trim() : "";
    if (!nextCwd) {
      throw new Error("cwd is required");
    }

    const command = buildChangeDirectoryCommand(session.shell, nextCwd);
    client.write(command);

    session.cwd = nextCwd;
    session.lastActiveAt = now();
    this.emit("status", sanitizeSession(session));

    return sanitizeSession(session);
  }

  resizeSession(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const parsedCols = Number(cols);
    const parsedRows = Number(rows);
    const fallbackCols = Number.isFinite(session.cols)
      ? Math.max(2, Math.floor(session.cols))
      : 80;
    const fallbackRows = Number.isFinite(session.rows)
      ? Math.max(1, Math.floor(session.rows))
      : 24;
    const safeCols = Number.isFinite(parsedCols)
      ? Math.max(2, Math.floor(parsedCols))
      : fallbackCols;
    const safeRows = Number.isFinite(parsedRows)
      ? Math.max(1, Math.floor(parsedRows))
      : fallbackRows;

    if (session.cols === safeCols && session.rows === safeRows) {
      return sanitizeSession(session);
    }

    const runtime = this.clients.get(sessionId);
    const client = runtime?.client;
    if (client) {
      client.resize(safeCols, safeRows);
    }

    session.cols = safeCols;
    session.rows = safeRows;
    session.lastActiveAt = now();
    this.emit("status", sanitizeSession(session));
    return sanitizeSession(session);
  }

  killSession(sessionId, reason = "manual") {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { killed: false, reason: "missing-session" };
    }

    const runtime = this.clients.get(sessionId);
    const client = runtime?.client;
    const hasClient = Boolean(client);

    if (!hasClient) {
      session.status = SESSION_STATUS.STOPPED;
      session.lastActiveAt = now();
      this.emit("status", sanitizeSession(session));
      this.retainStoppedSession(sessionId);
      return { killed: false, reason: "already-stopped" };
    }

    if (session.status === SESSION_STATUS.STOPPING) {
      return { killed: false, reason: "already-stopping" };
    }

    session.status = SESSION_STATUS.STOPPING;
    session.lastActiveAt = now();
    this.emit("status", sanitizeSession(session));

    let clientKilled = false;
    try {
      runtime.dataSubscription?.dispose?.();
    } catch (_error) {
      // Best effort.
    }
    try {
      runtime.exitSubscription?.dispose?.();
    } catch (_error) {
      // Best effort.
    }
    try {
      client.kill();
      clientKilled = true;
    } catch (_error) {
      clientKilled = false;
    }
    this.clients.delete(sessionId);
    this.osc7Remainders.delete(sessionId);

    session.status = SESSION_STATUS.STOPPED;
    session.exitCode = 0;
    session.signal = 0;
    session.lastActiveAt = now();
    this.emit("status", sanitizeSession(session));
    this.emit("exit", {
      sessionId,
      exitCode: 0,
      signal: 0,
      status: session.status,
    });
    this.retainStoppedSession(sessionId);

    return {
      killed: clientKilled,
      reason,
    };
  }

  cleanupAll(reason = "cleanup") {
    const ids = [...this.sessions.keys()];
    for (const sessionId of ids) {
      try {
        this.killSession(sessionId, reason);
      } catch (_error) {
        // Best effort during cleanup.
      }
    }
    return { cleaned: ids.length, reason };
  }

  snapshotSessions(sessionIds) {
    const ids =
      Array.isArray(sessionIds) && sessionIds.length > 0
        ? sessionIds
        : [...this.sessions.keys()];
    const snapshots = [];
    for (const id of ids) {
      const session = this.sessions.get(id);
      if (session) {
        snapshots.push(sanitizeSession(session));
      }
    }
    return snapshots;
  }
}

module.exports = {
  SessionManager,
};
