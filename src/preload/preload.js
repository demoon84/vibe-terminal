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
  LAYOUT_SAVE: "layout:save",
  LAYOUT_RESTORE: "layout:restore",
  APP_RENDERER_UNLOADING: "app:renderer-unloading",
  APP_WINDOW_MINIMIZE: "app:window-minimize",
  APP_WINDOW_MAXIMIZE_TOGGLE: "app:window-maximize-toggle",
  APP_WINDOW_CLOSE: "app:window-close",
  APP_WINDOW_STATE: "app:window-state",
  APP_PICK_DIRECTORY: "app:pick-directory",
  APP_PICK_FILES: "app:pick-files",
  APP_AGENT_INSTALL_STATUS: "app:agent-install-status",
  APP_AGENT_INSTALL_LATEST: "app:agent-install-latest",
  APP_AGENT_UNINSTALL: "app:agent-uninstall",
  APP_SKILL_CATALOG: "app:skill-catalog",
  APP_SKILL_INSTALL: "app:skill-install",
  APP_SKILL_UNINSTALL: "app:skill-uninstall",

  APP_PWSH7_STATUS: "app:pwsh7-status",
  APP_PWSH7_INSTALL: "app:pwsh7-install",
  APP_NODE_RUNTIME_STATUS: "app:node-runtime-status",
  APP_NODE_RUNTIME_INSTALL: "app:node-runtime-install",
  APP_TERMINAL_COLOR_DIAGNOSTICS: "app:terminal-color-diagnostics",
  APP_CLIPBOARD_READ: "app:clipboard-read",
  APP_CLIPBOARD_IMAGE_TO_TEMP: "app:clipboard-image-to-temp",
  APP_CLIPBOARD_WRITE: "app:clipboard-write",
  APP_SHOW_NOTIFICATION: "app:show-notification",
  APP_QUERY_EDITORS: "app:query-editors",
  APP_OPEN_IN_EDITOR: "app:open-in-editor",
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
    uninstallAgent: (payload) => ipcRenderer.invoke(IPC_CHANNELS.APP_AGENT_UNINSTALL, payload),
    listSkills: (payload) => ipcRenderer.invoke(IPC_CHANNELS.APP_SKILL_CATALOG, payload),
    installSkill: (payload) => ipcRenderer.invoke(IPC_CHANNELS.APP_SKILL_INSTALL, payload),
    uninstallSkill: (payload) => ipcRenderer.invoke(IPC_CHANNELS.APP_SKILL_UNINSTALL, payload),

    checkPowerShell7Status: () => ipcRenderer.invoke(IPC_CHANNELS.APP_PWSH7_STATUS),
    installPowerShell7: () => ipcRenderer.invoke(IPC_CHANNELS.APP_PWSH7_INSTALL),
    checkNodeRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.APP_NODE_RUNTIME_STATUS),
    installNodeRuntime: () => ipcRenderer.invoke(IPC_CHANNELS.APP_NODE_RUNTIME_INSTALL),
    queryTerminalColorDiagnostics: () =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_TERMINAL_COLOR_DIAGNOSTICS),
    showNotification: (payload) => ipcRenderer.invoke(IPC_CHANNELS.APP_SHOW_NOTIFICATION, payload),
    queryEditors: () => ipcRenderer.invoke(IPC_CHANNELS.APP_QUERY_EDITORS),
    openInEditor: (payload) => ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_IN_EDITOR, payload),
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
      save: (payload) => ipcRenderer.invoke(IPC_CHANNELS.LAYOUT_SAVE, payload),
      restore: () => ipcRenderer.invoke(IPC_CHANNELS.LAYOUT_RESTORE),
    }),
    app: Object.freeze({
      lifecycle: appApi.lifecycle,
      window: appApi.window,
      write: appApi.write,
      read: appApi.read,
      process: appApi.process,
    }),
  }),
);
