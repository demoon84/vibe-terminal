const { EventEmitter } = require("events");
const { spawnSync } = require("node:child_process");
const pty = require("node-pty");
const {
  withAugmentedPath,
  getKnownCommandLocations,
  isExecutableFile,
} = require("./path-utils");
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
const TMUX_COMMAND_NAME = "tmux";
const TMUX_SESSION_PREFIX = "vibe-pane-";
const TMUX_COMMAND_TIMEOUT_MS = 10_000;
const TMUX_HIDE_STATUS = String(process.env.VIBE_TMUX_HIDE_STATUS || "1")
  .trim()
  .toLowerCase() !== "0";

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

function trimTail(text, maxLength = 8_192) {
  const normalized = String(text || "");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(normalized.length - maxLength);
}

function parseLocatedPaths(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function resolveTmuxBinary(baseEnv = process.env) {
  const lookupEnv = withAugmentedPath(baseEnv);
  const locator = process.platform === "win32" ? "where" : "which";
  const located = spawnSync(locator, [TMUX_COMMAND_NAME], {
    encoding: "utf8",
    env: lookupEnv,
    windowsHide: true,
    timeout: 3_000,
  });

  const locatedPaths = located.status === 0 ? parseLocatedPaths(located.stdout) : [];
  const knownPaths = getKnownCommandLocations(TMUX_COMMAND_NAME).filter((candidatePath) =>
    isExecutableFile(candidatePath)
  );

  const resolvedPath = [...locatedPaths, ...knownPaths]
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)[0];

  return resolvedPath || TMUX_COMMAND_NAME;
}

function toTmuxCommandResult(result) {
  const stdout = trimTail(result.stdout || "");
  const stderr = trimTail(result.stderr || "");

  if (result.error) {
    return {
      ok: false,
      status: typeof result.status === "number" ? result.status : null,
      stdout,
      stderr,
      error: String(result.error),
    };
  }

  if (result.status === 0) {
    return {
      ok: true,
      status: 0,
      stdout,
      stderr,
      error: null,
    };
  }

  return {
    ok: false,
    status: typeof result.status === "number" ? result.status : null,
    stdout,
    stderr,
    error: `tmux-exit-${String(result.status)}`,
  };
}

function isSpawnEnoentError(value) {
  return String(value || "").toUpperCase().includes("ENOENT");
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

function quotePosixShellToken(value) {
  return `'${String(value || "").replace(/'/g, `'"'"'`)}'`;
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

function buildSessionCommandEnvironmentSpec(extraEnv = {}, shell = "") {
  const assignments = {};
  const unsets = new Set();

  for (const [key, rawValue] of Object.entries(extraEnv || {})) {
    const envKey = String(key || "").trim();
    if (!envKey) {
      continue;
    }
    assignments[envKey] = String(rawValue);
  }

  if (process.platform === "win32" && isPowerShell7(shell)) {
    assignments.ComSpec = shell;
    assignments.COMSPEC = shell;
  }

  if (TERMINAL_COLOR_MODE === "force") {
    unsets.add("NO_COLOR");
    assignments.FORCE_COLOR = "1";
    assignments.CLICOLOR = "1";
    assignments.CLICOLOR_FORCE = "1";
    if (!assignments.COLORTERM) {
      assignments.COLORTERM = process.env.COLORTERM || "truecolor";
    }
    if (!assignments.TERM) {
      assignments.TERM = process.env.TERM || "xterm-256color";
    }
  } else if (TERMINAL_COLOR_MODE === "disable") {
    assignments.NO_COLOR = "1";
    unsets.add("FORCE_COLOR");
    unsets.add("CLICOLOR_FORCE");
  }

  if (process.platform !== "win32") {
    const localeProbe = { ...process.env, ...assignments };
    const hasInvalidLcAll = typeof localeProbe.LC_ALL === "string"
      && localeProbe.LC_ALL.trim().length > 0
      && !isUtf8LocaleValue(localeProbe.LC_ALL);
    const hasUtf8Locale = [localeProbe.LC_ALL, localeProbe.LC_CTYPE, localeProbe.LANG]
      .some((value) => isUtf8LocaleValue(value));
    if (hasInvalidLcAll || !hasUtf8Locale) {
      const fallbackLocale = getUtf8LocaleFallback();
      assignments.LANG = fallbackLocale;
      assignments.LC_CTYPE = fallbackLocale;
      assignments.LC_ALL = fallbackLocale;
    }
  }

  return {
    assignments,
    unsets: [...unsets],
  };
}

function buildPosixEnvironmentPrefix(extraEnv = {}, shell = "") {
  const spec = buildSessionCommandEnvironmentSpec(extraEnv, shell);
  const segments = [];

  if (spec.unsets.length > 0) {
    segments.push(`unset ${spec.unsets.join(" ")}`);
  }

  const assignmentSegments = Object.entries(spec.assignments).map(
    ([key, value]) => `${key}=${quotePosixShellToken(value)}`,
  );
  if (assignmentSegments.length > 0) {
    segments.push(assignmentSegments.join(" "));
  }

  return segments.join("; ");
}

function buildInitialShellCommand(shell, extraEnv = {}) {
  const normalizedShell = String(shell || "").trim();
  if (!normalizedShell) {
    return null;
  }

  const envPrefix = buildPosixEnvironmentPrefix(extraEnv, normalizedShell);
  if (process.platform === "win32" && isPowerShellShell(normalizedShell)) {
    const command = `${quotePosixShellToken(normalizedShell)} -NoLogo -NoExit -Command ${quotePosixShellToken(POWERSHELL_STARTUP_COMMAND)}`;
    return envPrefix ? `${envPrefix}; ${command}` : command;
  }

  const command = `exec ${quotePosixShellToken(normalizedShell)}`;
  return envPrefix ? `${envPrefix}; ${command}` : command;
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

function normalizeTmuxSessionName(sessionId) {
  const rawId = String(sessionId || "");
  const safeId = rawId.replace(/[^A-Za-z0-9_-]/g, "_") || "session";
  return `${TMUX_SESSION_PREFIX}${safeId}`.slice(0, 96);
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
    this.tmuxVersion = null;
    this.tmuxBinary = TMUX_COMMAND_NAME;
    this.tmuxEnv = withAugmentedPath(process.env);
    this.refreshTmuxRuntime(this.tmuxEnv);
  }

  refreshTmuxRuntime(baseEnv = process.env) {
    this.tmuxEnv = withAugmentedPath(baseEnv);
    this.tmuxBinary = resolveTmuxBinary(this.tmuxEnv);
  }

  runTmuxCommand(args = [], options = {}) {
    const env = withAugmentedPath(options.env || this.tmuxEnv || process.env);
    const cwd = options.cwd || process.cwd();
    const timeout = options.timeoutMs || TMUX_COMMAND_TIMEOUT_MS;
    let tmuxBinary = this.tmuxBinary || TMUX_COMMAND_NAME;

    let result = spawnSync(tmuxBinary, args, {
      encoding: "utf8",
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout,
    });

    let parsed = toTmuxCommandResult(result);

    if (parsed.error && isSpawnEnoentError(parsed.error)) {
      this.refreshTmuxRuntime(options.env || env);
      if (this.tmuxBinary !== tmuxBinary) {
        tmuxBinary = this.tmuxBinary || TMUX_COMMAND_NAME;
        result = spawnSync(tmuxBinary, args, {
          encoding: "utf8",
          cwd,
          env: this.tmuxEnv,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          timeout,
        });
        parsed = toTmuxCommandResult(result);
      }
    }

    return parsed;
  }

  ensureTmuxReady() {
    if (this.tmuxVersion) {
      return;
    }

    const result = this.runTmuxCommand(["-V"], {
      timeoutMs: 3_000,
    });

    if (!result.ok) {
      const details = [result.error, result.stderr, result.stdout].filter(Boolean).join(" | ");
      throw new Error(`tmux unavailable: ${details || "unknown"}`);
    }

    this.tmuxVersion = String(result.stdout || "").trim() || "tmux";
  }

  applyTmuxClientDisplayOptions(tmuxSessionName) {
    if (!TMUX_HIDE_STATUS || !tmuxSessionName) {
      return;
    }

    this.runTmuxCommand(["set-option", "-t", tmuxSessionName, "status", "off"], {
      timeoutMs: 3_000,
    });
  }

  hasTmuxSession(tmuxSessionName) {
    const result = this.runTmuxCommand(["has-session", "-t", tmuxSessionName], {
      timeoutMs: 3_000,
    });
    return result.ok;
  }

  killTmuxSession(tmuxSessionName) {
    const result = this.runTmuxCommand(["kill-session", "-t", tmuxSessionName], {
      timeoutMs: 4_000,
    });

    if (result.ok) {
      return {
        ok: true,
        killed: true,
        error: null,
      };
    }

    const message = `${result.stderr}\n${result.stdout}`.toLowerCase();
    if (
      message.includes("can't find session") ||
      message.includes("no server running") ||
      message.includes("failed to connect to server")
    ) {
      return {
        ok: true,
        killed: false,
        error: null,
      };
    }

    return {
      ok: false,
      killed: false,
      error: [result.error, result.stderr, result.stdout].filter(Boolean).join(" | ") || "tmux-kill-failed",
    };
  }

  createDetachedTmuxSession(session, options = {}) {
    const tmuxSessionName = session.tmuxSessionName;
    const recovery = Boolean(options.recovery);
    if (recovery && this.hasTmuxSession(tmuxSessionName)) {
      return {
        reusedExisting: true,
        fallbackShell: false,
      };
    }

    if (this.hasTmuxSession(tmuxSessionName)) {
      this.killTmuxSession(tmuxSessionName);
    }

    const env = buildTerminalEnv(session.env, session.shell);
    const shellCommand = buildInitialShellCommand(session.shell, session.env);
    const baseArgs = [
      "new-session",
      "-d",
      "-s",
      tmuxSessionName,
      "-x",
      String(session.cols),
      "-y",
      String(session.rows),
      "-c",
      session.cwd,
    ];

    const primaryArgs = shellCommand ? [...baseArgs, shellCommand] : [...baseArgs];
    const primaryResult = this.runTmuxCommand(primaryArgs, {
      cwd: session.cwd,
      env,
    });

    if (primaryResult.ok) {
      return {
        reusedExisting: false,
        fallbackShell: false,
      };
    }

    if (!shellCommand) {
      const details = [primaryResult.error, primaryResult.stderr, primaryResult.stdout]
        .filter(Boolean)
        .join(" | ");
      throw new Error(`tmux new-session failed: ${details || "unknown"}`);
    }

    const fallbackResult = this.runTmuxCommand(baseArgs, {
      cwd: session.cwd,
      env,
    });

    if (fallbackResult.ok) {
      return {
        reusedExisting: false,
        fallbackShell: true,
      };
    }

    const details = [
      primaryResult.error,
      primaryResult.stderr,
      primaryResult.stdout,
      fallbackResult.error,
      fallbackResult.stderr,
      fallbackResult.stdout,
    ]
      .filter(Boolean)
      .join(" | ");
    throw new Error(`tmux new-session failed: ${details || "unknown"}`);
  }

  disposeClientRuntime(sessionId) {
    const runtime = this.clients.get(sessionId);
    if (!runtime) {
      return;
    }

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

    this.clients.delete(sessionId);
  }

  tryReattachClient(session) {
    const currentAttempts = Number(session.reattachAttempts || 0);
    if (currentAttempts >= 1) {
      return false;
    }

    session.reattachAttempts = currentAttempts + 1;
    try {
      this.attachTmuxClient(session);
      session.status = SESSION_STATUS.RUNNING;
      session.lastActiveAt = now();
      this.emit("status", sanitizeSession(session));
      return true;
    } catch (_error) {
      return false;
    }
  }

  handleClientData(sessionId, data) {
    const current = this.sessions.get(sessionId);
    if (!current) {
      return;
    }

    current.reattachAttempts = 0;
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
    this.disposeClientRuntime(sessionId);
    this.osc7Remainders.delete(sessionId);

    const current = this.sessions.get(sessionId);
    if (!current) {
      return;
    }

    let tmuxAlive = this.hasTmuxSession(current.tmuxSessionName);
    if (current.status !== SESSION_STATUS.STOPPING && tmuxAlive) {
      const reattached = this.tryReattachClient(current);
      if (reattached) {
        return;
      }
    }

    if (current.status === SESSION_STATUS.STOPPING && tmuxAlive) {
      const retryResult = this.killTmuxSession(current.tmuxSessionName);
      if (retryResult.ok) {
        tmuxAlive = this.hasTmuxSession(current.tmuxSessionName);
      }
    }

    const stoppedByRoutine = current.status === SESSION_STATUS.STOPPING;
    current.status = tmuxAlive ? SESSION_STATUS.ERRORED : SESSION_STATUS.STOPPED;
    current.exitCode = exitCode;
    current.signal = signal;
    current.lastActiveAt = now();
    if (current.status === SESSION_STATUS.ERRORED && stoppedByRoutine && tmuxAlive) {
      current.error = "tmux-session-still-running";
    }

    this.emit("status", sanitizeSession(current));
    this.emit("exit", {
      sessionId,
      exitCode,
      signal,
      status: current.status,
    });

    if (current.status === SESSION_STATUS.STOPPED) {
      this.retainStoppedSession(sessionId);
    }
  }

  attachTmuxClient(session) {
    this.applyTmuxClientDisplayOptions(session.tmuxSessionName);
    const env = withAugmentedPath(buildTerminalEnv(session.env, session.shell));
    this.refreshTmuxRuntime(env);
    const tmuxBinary = this.tmuxBinary || TMUX_COMMAND_NAME;

    const client = pty.spawn(tmuxBinary, ["attach-session", "-t", session.tmuxSessionName], {
      name: "xterm-256color",
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      env: this.tmuxEnv,
    });

    const runtime = {
      sessionId: session.id,
      tmuxSessionName: session.tmuxSessionName,
      client,
      dataSubscription: null,
      exitSubscription: null,
    };

    runtime.dataSubscription = client.onData((data) => {
      this.handleClientData(session.id, data);
    });

    runtime.exitSubscription = client.onExit(({ exitCode, signal }) => {
      this.handleClientExit(session.id, exitCode, signal);
    });

    this.clients.set(session.id, runtime);
    this.osc7Remainders.set(session.id, "");
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
    const startingStatus = options.recovery
      ? SESSION_STATUS.RECOVERING
      : SESSION_STATUS.CREATING;

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
      status: startingStatus,
      lastActiveAt: now(),
      tmuxSessionName: normalizeTmuxSessionName(id),
      reattachAttempts: 0,
    };

    this.stoppedSessionOrder = this.stoppedSessionOrder.filter((sessionId) => sessionId !== id);
    this.sessions.set(id, session);
    this.emit("status", sanitizeSession(session));

    try {
      this.ensureTmuxReady();
      const created = this.createDetachedTmuxSession(session, {
        recovery: Boolean(options.recovery),
      });
      if (created.fallbackShell) {
        session.shell = defaultShell;
      }

      this.attachTmuxClient(session);

      session.status = SESSION_STATUS.RUNNING;
      session.lastActiveAt = now();
      session.reattachAttempts = 0;
      delete session.error;
      this.emit("status", sanitizeSession(session));
      return sanitizeSession(session);
    } catch (error) {
      this.disposeClientRuntime(id);
      this.osc7Remainders.delete(id);
      this.killTmuxSession(session.tmuxSessionName);

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

    this.runTmuxCommand(
      [
        "resize-window",
        "-t",
        session.tmuxSessionName,
        "-x",
        String(safeCols),
        "-y",
        String(safeRows),
      ],
      {
        timeoutMs: 3_000,
      },
    );

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
    const hasTmux = this.hasTmuxSession(session.tmuxSessionName);

    if (!hasClient && !hasTmux) {
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

    const tmuxKillResult = this.killTmuxSession(session.tmuxSessionName);
    let clientKilled = false;

    if (hasClient) {
      try {
        client.kill();
        clientKilled = true;
      } catch (_error) {
        clientKilled = false;
      }
    }

    if (!hasClient) {
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
    }

    let tmuxStillAlive = this.hasTmuxSession(session.tmuxSessionName);
    if (tmuxStillAlive) {
      const retryResult = this.killTmuxSession(session.tmuxSessionName);
      if (retryResult.ok) {
        tmuxStillAlive = this.hasTmuxSession(session.tmuxSessionName);
      }
    }

    if ((!tmuxKillResult.ok && !clientKilled) || tmuxStillAlive) {
      session.status = SESSION_STATUS.ERRORED;
      session.error = tmuxKillResult.error || (tmuxStillAlive ? "tmux-session-still-running" : "tmux-kill-failed");
      session.lastActiveAt = now();
      this.emit("status", sanitizeSession(session));
      throw new Error(session.error);
    }

    return {
      killed: tmuxKillResult.killed || clientKilled,
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
