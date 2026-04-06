function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const MAX_PTY_WRITE_CHARS = 8192;
const MAX_PATH_CHARS = 1024;
const MAX_ENV_KEY_CHARS = 128;
const MAX_ENV_VALUE_CHARS = 4096;
const MAX_NOTIFICATION_TITLE_CHARS = 120;
const MAX_NOTIFICATION_BODY_CHARS = 480;
const MAX_LAYOUT_PANE_COUNT = 12;

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

function validateTrackSizeArray(rawTrackSizes) {
  if (!Array.isArray(rawTrackSizes) || rawTrackSizes.length === 0 || rawTrackSizes.length > 12) {
    return null;
  }

  const safe = [];
  for (const rawValue of rawTrackSizes) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100_000) {
      return null;
    }
    safe.push(parsed);
  }
  return safe;
}

function validateLayoutPaneArray(rawPanes) {
  if (!Array.isArray(rawPanes) || rawPanes.length === 0 || rawPanes.length > MAX_LAYOUT_PANE_COUNT) {
    return null;
  }

  const safePanes = [];
  const seenSlotIndexes = new Set();

  for (const rawPane of rawPanes) {
    if (!isPlainObject(rawPane)) {
      return null;
    }

    const id = asTrimmedString(rawPane.id);
    const slotIndex = asFiniteInteger(rawPane.slotIndex);
    const positionIndex = asFiniteInteger(rawPane.positionIndex);
    const state = asTrimmedString(rawPane.state);
    const groupId = rawPane.groupId == null ? "" : asTrimmedString(rawPane.groupId);

    if (!id || id.length > 160) {
      return null;
    }
    if (
      slotIndex === null
      || slotIndex < 0
      || slotIndex >= MAX_LAYOUT_PANE_COUNT
      || seenSlotIndexes.has(slotIndex)
    ) {
      return null;
    }
    if (positionIndex === null || positionIndex < 0 || positionIndex >= MAX_LAYOUT_PANE_COUNT) {
      return null;
    }
    if (state !== "visible" && state !== "hidden" && state !== "terminated") {
      return null;
    }
    if (groupId.length > 80) {
      return null;
    }

    let sessionId = null;
    if (rawPane.sessionId !== undefined && rawPane.sessionId !== null) {
      sessionId = asTrimmedString(rawPane.sessionId);
      if (!sessionId || sessionId.length > 160) {
        return null;
      }
    }

    seenSlotIndexes.add(slotIndex);
    safePanes.push({
      id,
      slotIndex,
      positionIndex,
      groupId,
      state,
      sessionId,
    });
  }

  return safePanes;
}

function validateGridShape(rawGridShape) {
  if (!isPlainObject(rawGridShape)) {
    return null;
  }

  const columns = asFiniteInteger(rawGridShape.columns);
  const rows = asFiniteInteger(rawGridShape.rows);
  if (
    columns === null
    || rows === null
    || columns < 1
    || rows < 1
    || columns > MAX_LAYOUT_PANE_COUNT
    || rows > MAX_LAYOUT_PANE_COUNT
  ) {
    return null;
  }

  return { columns, rows };
}

function validateLayoutVariant(rawLayoutVariant) {
  const layoutVariant = asTrimmedString(rawLayoutVariant);
  if (!layoutVariant || layoutVariant.length > 40) {
    return null;
  }
  return layoutVariant;
}

function validateLayoutSavePayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "invalid-payload" };
  }

  const presetId = asTrimmedString(payload.presetId);
  if (!presetId) {
    return { ok: false, error: "invalid-payload:presetId" };
  }

  let gridTracks = null;
  if (payload.gridTracks !== undefined && payload.gridTracks !== null) {
    if (!isPlainObject(payload.gridTracks)) {
      return { ok: false, error: "invalid-payload:gridTracks" };
    }

    const columns = validateTrackSizeArray(payload.gridTracks.columns);
    const rows = validateTrackSizeArray(payload.gridTracks.rows);
    if (!columns || !rows) {
      return { ok: false, error: "invalid-payload:gridTracks" };
    }

    gridTracks = {
      columns,
      rows,
    };
  }

  let panes = null;
  if (payload.panes !== undefined && payload.panes !== null) {
    panes = validateLayoutPaneArray(payload.panes);
    if (!panes) {
      return { ok: false, error: "invalid-payload:panes" };
    }
  }

  let gridShape = null;
  if (payload.gridShape !== undefined && payload.gridShape !== null) {
    gridShape = validateGridShape(payload.gridShape);
    if (!gridShape) {
      return { ok: false, error: "invalid-payload:gridShape" };
    }
  }

  let layoutVariant = null;
  if (payload.layoutVariant !== undefined && payload.layoutVariant !== null) {
    layoutVariant = validateLayoutVariant(payload.layoutVariant);
    if (!layoutVariant) {
      return { ok: false, error: "invalid-payload:layoutVariant" };
    }
  }

  return {
    ok: true,
    value: {
      presetId,
      gridTracks,
      panes,
      gridShape,
      layoutVariant,
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
  if (agentCommand !== "codex") {
    return { ok: false, error: "invalid-payload:agentCommand-unsupported" };
  }
  return { ok: true, value: { agentCommand } };
}

function validateSkillCatalogPayload(payload) {
  if (payload === undefined) {
    return { ok: true, value: { query: "" } };
  }
  if (!isPlainObject(payload)) {
    return { ok: false, error: "invalid-payload" };
  }

  const query = asTrimmedString(payload.query);
  if (query.length > 120) {
    return { ok: false, error: "invalid-payload:query-too-long" };
  }
  return { ok: true, value: { query } };
}

function validateSkillInstallPayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "invalid-payload" };
  }

  const skillName = asTrimmedString(payload.skillName).toLowerCase();
  if (!skillName) {
    return { ok: false, error: "invalid-payload:skillName" };
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(skillName)) {
    return { ok: false, error: "invalid-payload:skillName-format" };
  }

  const installProvider = asTrimmedString(payload.installProvider).toLowerCase() || "curated";
  if (installProvider !== "curated" && installProvider !== "skills-sh") {
    return { ok: false, error: "invalid-payload:installProvider" };
  }

  const installRepo = asTrimmedString(payload.installRepo);
  if (installRepo && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(installRepo)) {
    return { ok: false, error: "invalid-payload:installRepo-format" };
  }
  if (installProvider === "skills-sh" && !installRepo) {
    return { ok: false, error: "invalid-payload:installRepo-required" };
  }

  const installSkillId = asTrimmedString(payload.installSkillId);
  if (installSkillId.length > 160) {
    return { ok: false, error: "invalid-payload:installSkillId-too-long" };
  }
  if (installSkillId && !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(installSkillId)) {
    return { ok: false, error: "invalid-payload:installSkillId-format" };
  }

  return {
    ok: true,
    value: {
      skillName,
      installProvider,
      installRepo,
      installSkillId,
    },
  };
}

function validateSkillNamePayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "invalid-payload" };
  }
  const skillName = asTrimmedString(payload.skillName).toLowerCase();
  if (!skillName) {
    return { ok: false, error: "invalid-payload:skillName" };
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(skillName)) {
    return { ok: false, error: "invalid-payload:skillName-format" };
  }
  return { ok: true, value: { skillName } };
}

function validateClipboardWritePayload(payload) {
  if (!isPlainObject(payload) || typeof payload.text !== "string") {
    return { ok: false, error: "invalid-payload" };
  }
  return { ok: true, value: { text: payload.text } };
}

function validateNotificationPayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "invalid-payload" };
  }

  const title = asTrimmedString(payload.title);
  if (!title) {
    return { ok: false, error: "invalid-payload:title" };
  }
  if (title.length > MAX_NOTIFICATION_TITLE_CHARS) {
    return { ok: false, error: "invalid-payload:title-too-long" };
  }

  const body = asTrimmedString(payload.body);
  if (body.length > MAX_NOTIFICATION_BODY_CHARS) {
    return { ok: false, error: "invalid-payload:body-too-long" };
  }

  const category = asTrimmedString(payload.category).toLowerCase() || "info";
  if (
    category !== "info"
    && category !== "completion"
    && category !== "confirmation"
    && category !== "error"
  ) {
    return { ok: false, error: "invalid-payload:category" };
  }

  return {
    ok: true,
    value: {
      title,
      body,
      category,
    },
  };
}

module.exports = {
  validatePtyWritePayload,
  validatePtyCreatePayload,
  validatePtyResizePayload,
  validatePtyKillPayload,
  validatePtyChangeDirectoryPayload,

  validateLayoutSetPresetPayload,
  validateLayoutSavePayload,
  validatePathDialogPayload,
  validateAgentCommandPayload,
  validateSkillCatalogPayload,
  validateSkillInstallPayload,
  validateSkillNamePayload,
  validateClipboardWritePayload,
  validateNotificationPayload,
};
