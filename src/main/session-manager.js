const { EventEmitter } = require("events");
const { execFileSync } = require("node:child_process");
const pty = require("node-pty");
const {
  SESSION_STATUS,
  createId,
  getDefaultShell,
  clonePlainObject,
} = require("../shared/models");

const OSC7_PREFIX = "\u001b]7;file://";
const OSC7_COMPLETE_RE = /\u001b\]7;file:\/\/[^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const MAX_RETAINED_STOPPED_SESSIONS = 128;
const TERMINAL_COLOR_MODE = String(process.env.VIBE_TERMINAL_COLOR_MODE || "force")
  .trim()
  .toLowerCase();

const POWERSHELL_UTF8_BOOTSTRAP =
  "try { " +
  "$utf8NoBom = [System.Text.UTF8Encoding]::new($false); " +
  "[Console]::InputEncoding = $utf8NoBom; " +
  "[Console]::OutputEncoding = $utf8NoBom; " +
  "$OutputEncoding = $utf8NoBom; " +
  "$__mtShellPath = ''; " +
  "try { $__mtShellPath = (Get-Process -Id $PID).Path } catch {} " +
  "if ($__mtShellPath) { $env:ComSpec = $__mtShellPath; $env:COMSPEC = $__mtShellPath } " +
  "if ($env:OS -eq 'Windows_NT') { try { & chcp.com 65001 > $null } catch {} } " +
  "} catch {}";

const POWERSHELL_PROMPT_HOOK =
  "if (-not (Get-Variable -Name __mt_orig_prompt -Scope global -ErrorAction SilentlyContinue)) { $global:__mt_orig_prompt = $function:prompt }; " +
  "function global:prompt { " +
  "try { $p=(Get-Location).ProviderPath -replace '\\\\','/'; [Console]::Write(\"`e]7;file://$env:COMPUTERNAME/$p`a\") } catch {}; " +
  "if ($global:__mt_orig_prompt) { & $global:__mt_orig_prompt } else { \"PS $(Get-Location)> \" } " +
  "}";

const POWERSHELL_STARTUP_COMMAND = `${POWERSHELL_UTF8_BOOTSTRAP}; ${POWERSHELL_PROMPT_HOOK}`;

function now() {
  return Date.now();
}

function toSafePid(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function shouldForceTreeKill(reason) {
  return (
    reason === "app-before-quit" ||
    reason === "app-will-quit" ||
    reason === "window-close" ||
    reason === "window-closed" ||
    reason === "renderer-unloading" ||
    reason === "renderer-crash"
  );
}

function forceKillProcessTree(pid) {
  const safePid = toSafePid(pid);
  if (!safePid) {
    return false;
  }

  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(safePid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return true;
    } catch (_error) {
      return false;
    }
  }

  try {
    process.kill(-safePid, "SIGKILL");
    return true;
  } catch (_error) {
    // Fallback to direct pid kill when process group kill is unavailable.
  }

  try {
    process.kill(safePid, "SIGKILL");
    return true;
  } catch (_error) {
    return false;
  }
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

function resolveSpawnSpec(shell) {
  if (process.platform === "win32" && isPowerShellShell(shell)) {
    return {
      command: shell,
      args: ["-NoLogo", "-NoExit", "-Command", POWERSHELL_STARTUP_COMMAND],
    };
  }

  return {
    command: shell,
    args: [],
  };
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
    // Gemini CLI checks ComSpec to select its shell tool backend on Windows.
    setWindowsEnvVariable(merged, "ComSpec", shell);
    setWindowsEnvVariable(merged, "COMSPEC", shell);
  }
  // `inherit` keeps user environment untouched.
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
    this.terminals = new Map();
    this.osc7Remainders = new Map();
    this.stoppedSessionOrder = [];
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
    if (!sessionId || this.terminals.has(sessionId)) {
      return;
    }

    this.stoppedSessionOrder = this.stoppedSessionOrder.filter((id) => id !== sessionId);
    this.stoppedSessionOrder.push(sessionId);

    while (this.stoppedSessionOrder.length > MAX_RETAINED_STOPPED_SESSIONS) {
      const oldestId = this.stoppedSessionOrder.shift();
      if (!oldestId || this.terminals.has(oldestId)) {
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
    /** @type {string} */
    const startingStatus = options.recovery
      ? SESSION_STATUS.RECOVERING
      : SESSION_STATUS.CREATING;

    if (this.terminals.has(id)) {
      this.killSession(id, "replace-session");
    }

    const session = {
      id,
      cwd,
      shell,
      env,
      cols,
      rows,
      status: startingStatus,
      lastActiveAt: now(),
    };
    this.stoppedSessionOrder = this.stoppedSessionOrder.filter((sessionId) => sessionId !== id);
    this.sessions.set(id, session);
    this.emit("status", sanitizeSession(session));

    try {
      const spawnTerminal = (spec, sessionShell) =>
        pty.spawn(spec.command, spec.args, {
          name: "xterm-256color",
          cwd,
          cols,
          rows,
          env: buildTerminalEnv(env, sessionShell),
        });

      let terminal = null;
      try {
        terminal = spawnTerminal(resolveSpawnSpec(shell), shell);
      } catch (error) {
        if (!requestedShell || shell === defaultShell) {
          throw error;
        }
        terminal = spawnTerminal(resolveSpawnSpec(defaultShell), defaultShell);
        session.shell = defaultShell;
      }

      this.terminals.set(id, terminal);
      this.osc7Remainders.set(id, "");

      terminal.onData((data) => {
        const current = this.sessions.get(id);
        if (!current) {
          return;
        }

        const remainder = this.osc7Remainders.get(id) || "";
        const parsed = extractCwdFromOsc7Stream(`${remainder}${data}`);
        this.osc7Remainders.set(id, parsed.remainder);

        if (parsed.cwd && parsed.cwd !== current.cwd) {
          current.cwd = parsed.cwd;
          this.emit("status", sanitizeSession(current));
        }

        current.lastActiveAt = now();
        this.emit("data", { sessionId: id, data });
      });

      terminal.onExit(({ exitCode, signal }) => {
        this.terminals.delete(id);
        this.osc7Remainders.delete(id);
        const current = this.sessions.get(id);
        if (!current) {
          return;
        }

        const stoppedByRoutine = current.status === SESSION_STATUS.STOPPING;
        current.status = stoppedByRoutine
          ? SESSION_STATUS.STOPPED
          : SESSION_STATUS.ERRORED;
        current.exitCode = exitCode;
        current.signal = signal;
        current.lastActiveAt = now();

        this.emit("status", sanitizeSession(current));
        this.emit("exit", {
          sessionId: id,
          exitCode,
          signal,
          status: current.status,
        });
        this.retainStoppedSession(id);
      });

      session.status = SESSION_STATUS.RUNNING;
      session.lastActiveAt = now();
      this.emit("status", sanitizeSession(session));
      return sanitizeSession(session);
    } catch (error) {
      session.status = SESSION_STATUS.ERRORED;
      session.error = error instanceof Error ? error.message : String(error);
      session.lastActiveAt = now();
      this.emit("status", sanitizeSession(session));
      throw error;
    }
  }

  writeSession(sessionId, data) {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
      throw new Error(`Session is not running: ${sessionId}`);
    }
    terminal.write(data);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActiveAt = now();
    }
    return true;
  }

  changeDirectory(sessionId, cwd) {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
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
    terminal.write(command);

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
    const terminal = this.terminals.get(sessionId);
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

    if (terminal) {
      terminal.resize(safeCols, safeRows);
    }
    session.cols = safeCols;
    session.rows = safeRows;
    session.lastActiveAt = now();
    this.emit("status", sanitizeSession(session));
    return sanitizeSession(session);
  }

  killSession(sessionId, reason = "manual", options = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { killed: false, reason: "missing-session" };
    }

    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
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

    const forceTree =
      Boolean(options?.forceTreeKill) || shouldForceTreeKill(reason);
    const terminalPid = toSafePid(terminal.pid);

    try {
      terminal.kill();
      if (forceTree) {
        forceKillProcessTree(terminalPid);
      }
      return { killed: true, reason };
    } catch (error) {
      session.status = SESSION_STATUS.ERRORED;
      session.error = error instanceof Error ? error.message : String(error);
      session.lastActiveAt = now();
      this.emit("status", sanitizeSession(session));
      if (forceTree) {
        forceKillProcessTree(terminalPid);
      }
      throw error;
    }
  }

  cleanupAll(reason = "cleanup", options = {}) {
    const ids = [...this.terminals.keys()];
    for (const sessionId of ids) {
      try {
        this.killSession(sessionId, reason, options);
      } catch (_error) {
        // Best effort during cleanup.
      }
    }
    return { cleaned: ids.length, reason };
  }

  recoverSession(snapshot) {
    return this.createSession({
      sessionId: snapshot.id,
      cwd: snapshot.cwd,
      shell: snapshot.shell,
      env: snapshot.env,
      cols: snapshot.cols,
      rows: snapshot.rows,
      recovery: true,
    });
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
