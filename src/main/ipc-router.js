const { IPC_CHANNELS } = require("../shared/ipc-channels");
const crypto = require("node:crypto");
const { PRESET_IDS, isPresetId } = require("../shared/models");
const { LayoutManager } = require("./layout-manager");
const { createTrustedRendererGuard } = require("./ipc-trust");
const {
  validatePtyWritePayload,
  validatePtyCreatePayload,
  validatePtyResizePayload,
  validatePtyKillPayload,
  validatePtyChangeDirectoryPayload,
  validateLayoutSetPresetPayload,
} = require("./ipc-validators");

const PTY_DATA_FLUSH_INTERVAL_MS = 16;

function registerIpcRoutes({ ipcMain, sessionManager, layoutStore, getMainWindow }) {
  const layoutManager = new LayoutManager({
    sessionManager,
    defaultPresetId: PRESET_IDS.ONE_BY_TWO,
  });
  const pendingPtyDataBySessionId = new Map();
  const sessionCapabilities = new Map();
  let ptyDataFlushTimer = null;

  function issueCapabilityToken(sessionId) {
    const token = crypto.randomBytes(24).toString("base64url");
    sessionCapabilities.set(sessionId, token);
    return token;
  }

  function getOrIssueCapabilityToken(sessionId) {
    const existing = sessionCapabilities.get(sessionId);
    if (existing) {
      return existing;
    }
    return issueCapabilityToken(sessionId);
  }

  function assertSessionCapability(sessionId, capabilityToken) {
    const expected = sessionCapabilities.get(sessionId);
    if (!expected || expected !== capabilityToken) {
      throw new Error("forbidden");
    }
  }

  function buildSessionCapabilitiesPayload(sessions) {
    const output = {};
    for (const session of sessions || []) {
      const sessionId = typeof session?.id === "string" ? session.id : "";
      if (!sessionId) {
        continue;
      }
      output[sessionId] = getOrIssueCapabilityToken(sessionId);
    }
    return output;
  }

  function sendToRenderer(channel, payload) {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) {
      return;
    }
    window.webContents.send(channel, payload);
  }

  const isTrustedRendererEvent = createTrustedRendererGuard({ getMainWindow });

  function flushQueuedPtyData() {
    if (ptyDataFlushTimer) {
      clearTimeout(ptyDataFlushTimer);
      ptyDataFlushTimer = null;
    }
    if (pendingPtyDataBySessionId.size === 0) {
      return;
    }

    const queuedEntries = [...pendingPtyDataBySessionId.entries()];
    pendingPtyDataBySessionId.clear();
    for (const [sessionId, data] of queuedEntries) {
      if (!sessionId || typeof data !== "string" || data.length === 0) {
        continue;
      }
      sendToRenderer(IPC_CHANNELS.PTY_DATA, { sessionId, data });
    }
  }

  function schedulePtyDataFlush() {
    if (ptyDataFlushTimer) {
      return;
    }
    ptyDataFlushTimer = setTimeout(() => {
      flushQueuedPtyData();
    }, PTY_DATA_FLUSH_INTERVAL_MS);
  }

  sessionManager.on("data", (payload) => {
    const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
    const chunk = typeof payload?.data === "string" ? payload.data : String(payload?.data || "");
    if (!sessionId || !chunk) {
      return;
    }
    pendingPtyDataBySessionId.set(
      sessionId,
      `${pendingPtyDataBySessionId.get(sessionId) || ""}${chunk}`,
    );
    schedulePtyDataFlush();
  });
  sessionManager.on("exit", (payload) => {
    flushQueuedPtyData();
    const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
    if (sessionId) {
      sessionCapabilities.delete(sessionId);
    }
    sendToRenderer(IPC_CHANNELS.PTY_EXIT, payload);
  });
  sessionManager.on("status", (payload) => {
    sendToRenderer(IPC_CHANNELS.PTY_STATUS, payload);
  });

  ipcMain.handle(IPC_CHANNELS.PTY_CREATE, (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      throw new Error("forbidden");
    }
    const validated = validatePtyCreatePayload(payload);
    if (!validated.ok) {
      throw new Error(validated.error);
    }
    const session = sessionManager.createSession(validated.value);
    const capabilityToken = issueCapabilityToken(session.id);
    return {
      ...session,
      capabilityToken,
    };
  });

  ipcMain.handle(IPC_CHANNELS.PTY_WRITE, (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      return {
        ok: false,
        error: "forbidden",
      };
    }
    const validated = validatePtyWritePayload(payload);
    if (!validated.ok) {
      return { ok: false, error: validated.error };
    }

    try {
      assertSessionCapability(validated.value.sessionId, validated.value.capabilityToken);
      sessionManager.writeSession(validated.value.sessionId, validated.value.data);
      return {
        ok: true,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PTY_RESIZE, (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      throw new Error("forbidden");
    }
    const validated = validatePtyResizePayload(payload);
    if (!validated.ok) {
      throw new Error(validated.error);
    }
    try {
      assertSessionCapability(validated.value.sessionId, validated.value.capabilityToken);
      return sessionManager.resizeSession(
        validated.value.sessionId,
        validated.value.cols,
        validated.value.rows,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.startsWith("Session not found:")
        || message.startsWith("Session is not running:")
      ) {
        return null;
      }
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.PTY_KILL, (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      throw new Error("forbidden");
    }
    const validated = validatePtyKillPayload(payload);
    if (!validated.ok) {
      throw new Error(validated.error);
    }
    assertSessionCapability(validated.value.sessionId, validated.value.capabilityToken);
    return sessionManager.killSession(validated.value.sessionId, validated.value.reason);
  });

  ipcMain.handle(IPC_CHANNELS.PTY_CHANGE_DIRECTORY, (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      throw new Error("forbidden");
    }
    const validated = validatePtyChangeDirectoryPayload(payload);
    if (!validated.ok) {
      throw new Error(validated.error);
    }
    assertSessionCapability(validated.value.sessionId, validated.value.capabilityToken);
    return sessionManager.changeDirectory(validated.value.sessionId, validated.value.cwd);
  });



  ipcMain.handle(IPC_CHANNELS.LAYOUT_SET_PRESET, (event, payload = {}) => {
    if (!isTrustedRendererEvent(event)) {
      throw new Error("forbidden");
    }
    const validated = validateLayoutSetPresetPayload(payload);
    if (!validated.ok) {
      throw new Error(validated.error);
    }
    if (!isPresetId(validated.value.presetId)) {
      throw new Error(`Unsupported preset: ${validated.value.presetId}`);
    }

    const layout = layoutManager.setPreset({
      presetId: validated.value.presetId,
      sessionDefaults: validated.value.sessionDefaults || {},
      preferredSessionIds: validated.value.preferredSessionIds || [],
      minPanelCount: validated.value.minPanelCount,
    });
    layoutStore.save(layout);
    return {
      ...layout,
      sessionCapabilities: buildSessionCapabilitiesPayload(layout.sessions),
    };
  });

  ipcMain.handle(IPC_CHANNELS.LAYOUT_RESTORE, (event) => {
    if (!isTrustedRendererEvent(event)) {
      throw new Error("forbidden");
    }
    const persisted = layoutStore.load();
    if (!persisted) {
      return {
        restored: false,
        layout: null,
      };
    }

    const result = layoutManager.restoreLayout(persisted);
    if (result.restored && result.layout) {
      layoutStore.save(result.layout);
    }
    if (!result.restored || !result.layout) {
      return result;
    }
    return {
      ...result,
      layout: {
        ...result.layout,
        sessionCapabilities: buildSessionCapabilitiesPayload(result.layout.sessions),
      },
    };
  });

  ipcMain.on(IPC_CHANNELS.APP_RENDERER_UNLOADING, (event) => {
    if (!isTrustedRendererEvent(event)) {
      return;
    }
    flushQueuedPtyData();
    pendingPtyDataBySessionId.clear();
    sessionCapabilities.clear();
    sessionManager.cleanupAll("renderer-unloading");
  });
}

module.exports = {
  registerIpcRoutes,
};
