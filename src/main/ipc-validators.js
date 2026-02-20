function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const MAX_PTY_WRITE_CHARS = 8192;
const MAX_PATH_CHARS = 1024;
const MAX_ENV_KEY_CHARS = 128;
const MAX_ENV_VALUE_CHARS = 4096;

const CAPABILITY_TOKEN_MIN_LENGTH = 16;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asFiniteInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  return Math.floor(n);
}

function validatePtyWritePayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "invalid-payload" };
  }
  const sessionId = asTrimmedString(payload.sessionId);
  const capabilityToken = asTrimmedString(payload.capabilityToken);
  if (!sessionId || typeof payload.data !== "string") {
    return { ok: false, error: "invalid-payload" };
  }
  if (
    !capabilityToken
    || capabilityToken.length < CAPABILITY_TOKEN_MIN_LENGTH
    || capabilityToken.length > 256
  ) {
    return { ok: false, error: "invalid-payload" };
  }
  if (payload.data.length > MAX_PTY_WRITE_CHARS) {
    return { ok: false, error: "invalid-payload:data-too-long" };
  }
  return {
    ok: true,
    value: {
      sessionId,
      capabilityToken,
      data: payload.data,
    },
  };
}

function validatePtyCreatePayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: true, value: {} };
  }

  const value = {};
  const sessionId = asTrimmedString(payload.sessionId);
  if (payload.sessionId !== undefined && !sessionId) {
    return { ok: false, error: "invalid-payload:sessionId" };
  }
  if (sessionId) {
    value.sessionId = sessionId;
  }

  const cwd = asTrimmedString(payload.cwd);
  if (payload.cwd !== undefined && !cwd) {
    return { ok: false, error: "invalid-payload:cwd" };
  }
  if (cwd && cwd.length > MAX_PATH_CHARS) {
    return { ok: false, error: "invalid-payload:cwd-too-long" };
  }
  if (cwd) {
    value.cwd = cwd;
  }

  const shell = asTrimmedString(payload.shell);
  if (payload.shell !== undefined && !shell) {
    return { ok: false, error: "invalid-payload:shell" };
  }
  if (shell) {
    value.shell = shell;
  }

  if (payload.env !== undefined) {
    if (!isPlainObject(payload.env)) {
      return { ok: false, error: "invalid-payload:env" };
    }
    const env = {};
    for (const [key, raw] of Object.entries(payload.env)) {
      const envKey = asTrimmedString(key);
      if (!envKey) {
        continue;
      }
      if (envKey.length > MAX_ENV_KEY_CHARS || !ENV_KEY_RE.test(envKey)) {
        return { ok: false, error: "invalid-payload:env-key" };
      }
      if (typeof raw !== "string") {
        return { ok: false, error: "invalid-payload:env-value" };
      }
      if (raw.length > MAX_ENV_VALUE_CHARS) {
        return { ok: false, error: "invalid-payload:env-value-too-long" };
      }
      env[envKey] = raw;
    }
    value.env = env;
  }

  if (payload.cols !== undefined) {
    const cols = asFiniteInteger(payload.cols);
    if (!cols || cols < 2) {
      return { ok: false, error: "invalid-payload:cols" };
    }
    value.cols = cols;
  }

  if (payload.rows !== undefined) {
    const rows = asFiniteInteger(payload.rows);
    if (!rows || rows < 1) {
      return { ok: false, error: "invalid-payload:rows" };
    }
    value.rows = rows;
  }

  if (payload.recovery !== undefined) {
    value.recovery = Boolean(payload.recovery);
  }

  return { ok: true, value };
}

function validatePtyResizePayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "invalid-payload" };
  }
  const sessionId = asTrimmedString(payload.sessionId);
  const capabilityToken = asTrimmedString(payload.capabilityToken);
  const cols = asFiniteInteger(payload.cols);
  const rows = asFiniteInteger(payload.rows);
  if (
    !sessionId
    || !capabilityToken
    || capabilityToken.length < CAPABILITY_TOKEN_MIN_LENGTH
    || capabilityToken.length > 256
    || !cols
    || !rows
    || cols < 2
    || rows < 1
  ) {
    return { ok: false, error: "invalid-payload" };
  }
  return { ok: true, value: { sessionId, capabilityToken, cols, rows } };
}

function validatePtyKillPayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "invalid-payload" };
  }
  const sessionId = asTrimmedString(payload.sessionId);
  const capabilityToken = asTrimmedString(payload.capabilityToken);
  if (
    !sessionId
    || !capabilityToken
    || capabilityToken.length < CAPABILITY_TOKEN_MIN_LENGTH
    || capabilityToken.length > 256
  ) {
    return { ok: false, error: "invalid-payload" };
  }
  const reason = asTrimmedString(payload.reason) || "renderer-request";
  return { ok: true, value: { sessionId, capabilityToken, reason } };
}

function validatePtyChangeDirectoryPayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "invalid-payload" };
  }
  const sessionId = asTrimmedString(payload.sessionId);
  const capabilityToken = asTrimmedString(payload.capabilityToken);
  const cwd = asTrimmedString(payload.cwd);
  if (
    !sessionId
    || !cwd
    || cwd.length > MAX_PATH_CHARS
    || !capabilityToken
    || capabilityToken.length < CAPABILITY_TOKEN_MIN_LENGTH
    || capabilityToken.length > 256
  ) {
    return { ok: false, error: "invalid-payload" };
  }
  return { ok: true, value: { sessionId, capabilityToken, cwd } };
}



function validateLayoutSetPresetPayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "invalid-payload" };
  }
  const presetId = asTrimmedString(payload.presetId);
  if (!presetId) {
    return { ok: false, error: "invalid-payload:presetId" };
  }

  let sessionDefaults = {};
  if (payload.sessionDefaults !== undefined) {
    if (!isPlainObject(payload.sessionDefaults)) {
      return { ok: false, error: "invalid-payload:sessionDefaults" };
    }
    sessionDefaults = payload.sessionDefaults;
  }

  let preferredSessionIds = [];
  if (payload.preferredSessionIds !== undefined) {
    if (!Array.isArray(payload.preferredSessionIds)) {
      return { ok: false, error: "invalid-payload:preferredSessionIds" };
    }
    preferredSessionIds = payload.preferredSessionIds
      .map((item) => asTrimmedString(item))
      .filter((item) => item.length > 0);
  }

  let minPanelCount = payload.minPanelCount;
  if (payload.minPanelCount !== undefined) {
    const parsed = asFiniteInteger(payload.minPanelCount);
    if (parsed === null || parsed < 0) {
      return { ok: false, error: "invalid-payload:minPanelCount" };
    }
    minPanelCount = parsed;
  }

  return {
    ok: true,
    value: {
      presetId,
      sessionDefaults,
      preferredSessionIds,
      minPanelCount,
    },
  };
}

function validatePathDialogPayload(payload) {
  if (payload === undefined) {
    return { ok: true, value: {} };
  }
  if (!isPlainObject(payload)) {
    return { ok: false, error: "invalid-payload" };
  }

  const value = {};
  if (payload.defaultPath !== undefined) {
    const defaultPath = asTrimmedString(payload.defaultPath);
    if (!defaultPath) {
      return { ok: false, error: "invalid-payload:defaultPath" };
    }
    value.defaultPath = defaultPath;
  }

  return { ok: true, value };
}

function validateAgentCommandPayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "invalid-payload" };
  }
  const agentCommand = asTrimmedString(payload.agentCommand).toLowerCase();
  if (!agentCommand) {
    return { ok: false, error: "invalid-payload:agentCommand" };
  }
  return { ok: true, value: { agentCommand } };
}

function validateClipboardWritePayload(payload) {
  if (!isPlainObject(payload) || typeof payload.text !== "string") {
    return { ok: false, error: "invalid-payload" };
  }
  return { ok: true, value: { text: payload.text } };
}

module.exports = {
  validatePtyWritePayload,
  validatePtyCreatePayload,
  validatePtyResizePayload,
  validatePtyKillPayload,
  validatePtyChangeDirectoryPayload,

  validateLayoutSetPresetPayload,
  validatePathDialogPayload,
  validateAgentCommandPayload,
  validateClipboardWritePayload,
};
