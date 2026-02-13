const { contextBridge, ipcRenderer } = require("electron");

const IPC_CHANNELS = Object.freeze({
  PTY_CREATE: "pty:create",
  PTY_WRITE: "pty:write",
  PTY_RESIZE: "pty:resize",
  PTY_KILL: "pty:kill",
  PTY_CHANGE_DIRECTORY: "pty:change-directory",
  PTY_DATA: "pty:data",
  PTY_EXIT: "pty:exit",
  PTY_STATUS: "pty:status",
  LAYOUT_SET_PRESET: "layout:setPreset",
  LAYOUT_RESTORE: "layout:restore",
  APP_RENDERER_UNLOADING: "app:renderer-unloading",
  APP_WINDOW_MINIMIZE: "app:window-minimize",
  APP_WINDOW_MAXIMIZE_TOGGLE: "app:window-maximize-toggle",
  APP_WINDOW_DEVTOOLS_TOGGLE: "app:window-devtools-toggle",
  APP_WINDOW_CLOSE: "app:window-close",
  APP_WINDOW_STATE: "app:window-state",
  APP_PICK_DIRECTORY: "app:pick-directory",
  APP_PICK_FILES: "app:pick-files",
  APP_AGENT_INSTALL_STATUS: "app:agent-install-status",
  APP_AGENT_INSTALL_LATEST: "app:agent-install-latest",
  APP_PWSH7_STATUS: "app:pwsh7-status",
  APP_PWSH7_INSTALL: "app:pwsh7-install",
  APP_NODE_RUNTIME_STATUS: "app:node-runtime-status",
  APP_TERMINAL_COLOR_DIAGNOSTICS: "app:terminal-color-diagnostics",
  APP_CODEX_MODEL_CATALOG: "app:codex-model-catalog",
  APP_GEMINI_MODEL_CATALOG: "app:gemini-model-catalog",
  APP_CLIPBOARD_READ: "app:clipboard-read",
  APP_CLIPBOARD_IMAGE_TO_TEMP: "app:clipboard-image-to-temp",
  APP_CLIPBOARD_WRITE: "app:clipboard-write",
});

function subscribe(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

async function invokeSafe(channel, payload = undefined) {
  try {
    return await ipcRenderer.invoke(channel, payload);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const appApi = Object.freeze({
  lifecycle: Object.freeze({
    rendererUnloading: () => ipcRenderer.send(IPC_CHANNELS.APP_RENDERER_UNLOADING),
  }),
  window: Object.freeze({
    minimize: () => ipcRenderer.send(IPC_CHANNELS.APP_WINDOW_MINIMIZE),
    toggleMaximize: () => ipcRenderer.send(IPC_CHANNELS.APP_WINDOW_MAXIMIZE_TOGGLE),
    toggleDevTools: () => ipcRenderer.invoke(IPC_CHANNELS.APP_WINDOW_DEVTOOLS_TOGGLE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.APP_WINDOW_CLOSE),
    onState: (listener) => subscribe(IPC_CHANNELS.APP_WINDOW_STATE, listener),
  }),
  write: Object.freeze({
    pickDirectory: (payload) => ipcRenderer.invoke(IPC_CHANNELS.APP_PICK_DIRECTORY, payload),
    pickFiles: (payload) => ipcRenderer.invoke(IPC_CHANNELS.APP_PICK_FILES, payload),
    clipboardText: (text) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_CLIPBOARD_WRITE, {
        text,
      }),
  }),
  read: Object.freeze({
    clipboardText: () => ipcRenderer.invoke(IPC_CHANNELS.APP_CLIPBOARD_READ),
    clipboardImageToTemp: () => ipcRenderer.invoke(IPC_CHANNELS.APP_CLIPBOARD_IMAGE_TO_TEMP),
  }),
  process: Object.freeze({
    checkAgentInstallStatus: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_AGENT_INSTALL_STATUS, payload),
    installAgentLatest: (payload) => ipcRenderer.invoke(IPC_CHANNELS.APP_AGENT_INSTALL_LATEST, payload),
    checkPowerShell7Status: () => ipcRenderer.invoke(IPC_CHANNELS.APP_PWSH7_STATUS),
    installPowerShell7: () => ipcRenderer.invoke(IPC_CHANNELS.APP_PWSH7_INSTALL),
    checkNodeRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.APP_NODE_RUNTIME_STATUS),
    queryTerminalColorDiagnostics: () =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_TERMINAL_COLOR_DIAGNOSTICS),
    queryCodexModelCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.APP_CODEX_MODEL_CATALOG),
    queryGeminiModelCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GEMINI_MODEL_CATALOG),
  }),
});

contextBridge.exposeInMainWorld(
  "multiTerminal",
  Object.freeze({
    pty: Object.freeze({
      create: (payload) => ipcRenderer.invoke(IPC_CHANNELS.PTY_CREATE, payload),
      write: (payload) => invokeSafe(IPC_CHANNELS.PTY_WRITE, payload),
      resize: (payload) => ipcRenderer.invoke(IPC_CHANNELS.PTY_RESIZE, payload),
      kill: (payload) => ipcRenderer.invoke(IPC_CHANNELS.PTY_KILL, payload),
      changeDirectory: (payload) => ipcRenderer.invoke(IPC_CHANNELS.PTY_CHANGE_DIRECTORY, payload),
      onData: (listener) => subscribe(IPC_CHANNELS.PTY_DATA, listener),
      onExit: (listener) => subscribe(IPC_CHANNELS.PTY_EXIT, listener),
      onStatus: (listener) => subscribe(IPC_CHANNELS.PTY_STATUS, listener),
    }),
    layout: Object.freeze({
      setPreset: (payload) => ipcRenderer.invoke(IPC_CHANNELS.LAYOUT_SET_PRESET, payload),
      restore: () => ipcRenderer.invoke(IPC_CHANNELS.LAYOUT_RESTORE),
    }),
    app: Object.freeze({
      lifecycle: appApi.lifecycle,
      window: appApi.window,
      write: appApi.write,
      read: appApi.read,
      process: appApi.process,

      // Backward-compatible aliases
      rendererUnloading: () => appApi.lifecycle.rendererUnloading(),
      minimizeWindow: () => appApi.window.minimize(),
      toggleMaximizeWindow: () => appApi.window.toggleMaximize(),
      toggleDevToolsWindow: () => appApi.window.toggleDevTools(),
      closeWindow: () => appApi.window.close(),
      pickDirectory: (payload) => appApi.write.pickDirectory(payload),
      pickFiles: (payload) => appApi.write.pickFiles(payload),
      checkAgentInstallStatus: (payload) => appApi.process.checkAgentInstallStatus(payload),
      installAgentLatest: (payload) => appApi.process.installAgentLatest(payload),
      checkPowerShell7Status: () => appApi.process.checkPowerShell7Status(),
      installPowerShell7: () => appApi.process.installPowerShell7(),
      checkNodeRuntimeStatus: () => appApi.process.checkNodeRuntimeStatus(),
      queryTerminalColorDiagnostics: () => appApi.process.queryTerminalColorDiagnostics(),
      queryCodexModelCatalog: () => appApi.process.queryCodexModelCatalog(),
      queryGeminiModelCatalog: () => appApi.process.queryGeminiModelCatalog(),
      readClipboardText: () => appApi.read.clipboardText(),
      readClipboardImageToTemp: () => appApi.read.clipboardImageToTemp(),
      writeClipboardText: (text) => appApi.write.clipboardText(text),
      onWindowState: (listener) => appApi.window.onState(listener),
    }),
  }),
);
