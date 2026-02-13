import { TerminalPane } from "./terminal-pane.js";

const state = {
  panels: new Map(),
};

const elements = {
  panelsGrid: document.getElementById("panelsGrid"),
  startAllBtn: document.getElementById("startAllBtn"),
  stopAllBtn: document.getElementById("stopAllBtn"),
  appAlertOverlay: document.getElementById("appAlertOverlay"),
  appAlertTitle: document.getElementById("appAlertTitle"),
  appAlertMessage: document.getElementById("appAlertMessage"),
  appAlertCloseBtn: document.getElementById("appAlertCloseBtn"),
};

const panelRefs = new Map();
let runtimeSocket = null;
const socketQueue = [];
const MAX_SOCKET_QUEUE = 500;

function toEnvText(env) {
  return Object.entries(env || {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function parseEnvText(text) {
  const output = {};
  const lines = (text || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const index = trimmed.indexOf("=");
    if (index <= 0) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key) {
      output[key] = value;
    }
  }

  return output;
}

function countMatches(text, keyword) {
  const source = String(text || "").toLowerCase();
  const needle = String(keyword || "").toLowerCase();
  if (!needle) {
    return 0;
  }

  return source.split(needle).length - 1;
}

function getStatusClass(status) {
  return status === "running" ? "status running" : "status stopped";
}

function writeIfNotFocused(input, value) {
  if (document.activeElement !== input) {
    input.value = value;
  }
}

function hideAppAlertOverlay() {
  if (!elements.appAlertOverlay) {
    return;
  }
  elements.appAlertOverlay.classList.remove("visible");
  elements.appAlertOverlay.setAttribute("aria-hidden", "true");
}

function showAppAlert(message, title = "오류") {
  if (!elements.appAlertOverlay || !elements.appAlertMessage) {
    // Last-resort console fallback when overlay container is missing.
    // eslint-disable-next-line no-console
    console.error(message);
    return;
  }

  if (elements.appAlertTitle) {
    elements.appAlertTitle.textContent = String(title || "오류");
  }
  elements.appAlertMessage.textContent = String(message || "알 수 없는 오류");
  elements.appAlertOverlay.classList.add("visible");
  elements.appAlertOverlay.setAttribute("aria-hidden", "false");
  elements.appAlertCloseBtn?.focus();
}

function bindAlertOverlayActions() {
  elements.appAlertCloseBtn?.addEventListener("click", () => {
    hideAppAlertOverlay();
  });

  elements.appAlertOverlay?.addEventListener("click", (event) => {
    if (event.target !== elements.appAlertOverlay) {
      return;
    }
    hideAppAlertOverlay();
  });
}

async function withErrorGuard(action) {
  try {
    await action();
  } catch (error) {
    showAppAlert(error.message || String(error));
  }
}

async function api(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return payload;
}

function sendSocketMessage(message) {
  const encoded = JSON.stringify(message);
  if (runtimeSocket && runtimeSocket.readyState === WebSocket.OPEN) {
    runtimeSocket.send(encoded);
    return;
  }

  socketQueue.push(encoded);
  if (socketQueue.length > MAX_SOCKET_QUEUE) {
    socketQueue.shift();
  }
}

function flushSocketQueue() {
  if (!runtimeSocket || runtimeSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  while (socketQueue.length > 0) {
    runtimeSocket.send(socketQueue.shift());
  }
}

function collectPanelPayload(panelId) {
  const refs = panelRefs.get(panelId);
  return {
    label: refs.labelInput.value.trim() || `Agent ${panelId}`,
    cwd: refs.cwdInput.value.trim(),
    command: refs.commandInput.value,
    env: parseEnvText(refs.envInput.value),
    autoRestart: refs.autoRestartCheckbox.checked,
  };
}

function updateSearchResult(panelId) {
  const refs = panelRefs.get(panelId);
  if (!refs) {
    return;
  }

  const term = refs.searchInput.value.trim();
  if (!term) {
    refs.searchResult.textContent = "";
    return;
  }

  const panel = state.panels.get(panelId);
  const matches = countMatches(panel?.buffer || "", term);
  refs.searchResult.textContent = `${matches} matches`;
}

function updatePanelCard(panel, options = {}) {
  const refs = panelRefs.get(panel.id);
  if (!refs) {
    return;
  }

  writeIfNotFocused(refs.labelInput, panel.label);
  writeIfNotFocused(refs.cwdInput, panel.cwd || "");
  writeIfNotFocused(refs.commandInput, panel.command || "");
  writeIfNotFocused(refs.envInput, toEnvText(panel.env));
  refs.autoRestartCheckbox.checked = Boolean(panel.autoRestart);
  refs.status.textContent = panel.status;
  refs.status.className = getStatusClass(panel.status);

  if (options.syncTerminal !== false) {
    refs.terminalPane.syncBuffer(panel.buffer || "");
  }

  updateSearchResult(panel.id);
}

function buildPanelCard(panel) {
  const section = document.createElement("section");
  section.className = "panel";
  section.dataset.id = panel.id;
  section.innerHTML = `
    <div class="panel-head">
      <input class="label-input" type="text" />
      <span class="status"></span>
    </div>
    <div class="panel-config">
      <input class="cwd-input" type="text" placeholder="cwd (working directory)" />
      <input class="command-input" type="text" placeholder="startup command (ex: codex --model gpt-5)" />
      <textarea class="env-input" placeholder="environment variables: KEY=VALUE (one per line)"></textarea>
      <label class="checkbox-line"><input class="auto-restart" type="checkbox" />auto restart on crash</label>
    </div>
    <div class="panel-actions">
      <button class="btn solid start-btn">Start</button>
      <button class="btn danger stop-btn">Stop</button>
      <button class="btn restart-btn">Restart</button>
      <button class="btn apply-btn">Save Config</button>
      <button class="btn ghost clear-btn">Clear Log</button>
    </div>
    <div class="search-row">
      <input class="search-input" type="text" placeholder="search in panel log" />
      <button class="btn search-btn">Search</button>
      <span class="search-result"></span>
    </div>
    <div class="terminal-shell">
      <div class="terminal-host"></div>
    </div>
  `;

  const refs = {
    root: section,
    labelInput: section.querySelector(".label-input"),
    status: section.querySelector(".status"),
    cwdInput: section.querySelector(".cwd-input"),
    commandInput: section.querySelector(".command-input"),
    envInput: section.querySelector(".env-input"),
    autoRestartCheckbox: section.querySelector(".auto-restart"),
    startBtn: section.querySelector(".start-btn"),
    stopBtn: section.querySelector(".stop-btn"),
    restartBtn: section.querySelector(".restart-btn"),
    applyBtn: section.querySelector(".apply-btn"),
    clearBtn: section.querySelector(".clear-btn"),
    searchInput: section.querySelector(".search-input"),
    searchBtn: section.querySelector(".search-btn"),
    searchResult: section.querySelector(".search-result"),
    terminalHost: section.querySelector(".terminal-host"),
    terminalPane: null,
  };

  refs.terminalPane = new TerminalPane({
    panelId: panel.id,
    host: refs.terminalHost,
    sendMessage: sendSocketMessage,
  });

  refs.startBtn.addEventListener("click", () =>
    withErrorGuard(() =>
      api(`/api/panels/${panel.id}/start`, "POST", collectPanelPayload(panel.id))
    )
  );

  refs.stopBtn.addEventListener("click", () =>
    withErrorGuard(() => api(`/api/panels/${panel.id}/stop`, "POST"))
  );

  refs.restartBtn.addEventListener("click", () =>
    withErrorGuard(() =>
      api(`/api/panels/${panel.id}/restart`, "POST", collectPanelPayload(panel.id))
    )
  );

  refs.applyBtn.addEventListener("click", () =>
    withErrorGuard(() =>
      api(`/api/panels/${panel.id}/config`, "POST", collectPanelPayload(panel.id))
    )
  );

  refs.clearBtn.addEventListener("click", () =>
    withErrorGuard(() => api(`/api/panels/${panel.id}/config`, "POST", { clearBuffer: true }))
  );

  refs.searchBtn.addEventListener("click", () => {
    const term = refs.searchInput.value.trim();
    if (!term) {
      refs.searchResult.textContent = "";
      return;
    }

    updateSearchResult(panel.id);
    window.find(term, false, false, true, false, false, false);
  });

  panelRefs.set(panel.id, refs);
  elements.panelsGrid.appendChild(section);
  updatePanelCard(panel);
}

function renderPanels() {
  for (const [panelId, refs] of panelRefs.entries()) {
    if (!state.panels.has(panelId)) {
      refs.terminalPane.dispose();
      refs.root.remove();
      panelRefs.delete(panelId);
    }
  }

  for (const panel of state.panels.values()) {
    if (!panelRefs.has(panel.id)) {
      buildPanelCard(panel);
    } else {
      updatePanelCard(panel);
    }
  }
}

function applyFullState(payload) {
  state.panels.clear();

  for (const panel of payload.panels || []) {
    state.panels.set(panel.id, panel);
  }

  renderPanels();
}

function bindGlobalActions() {
  elements.startAllBtn.addEventListener("click", () =>
    withErrorGuard(async () => {
      const overridesById = {};
      for (const panelId of state.panels.keys()) {
        overridesById[panelId] = collectPanelPayload(panelId);
      }
      await api("/api/panels/start-all", "POST", { overridesById });
    })
  );

  elements.stopAllBtn.addEventListener("click", () =>
    withErrorGuard(() => api("/api/panels/stop-all", "POST"))
  );
}

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}`);
  runtimeSocket = socket;

  socket.addEventListener("open", () => {
    if (runtimeSocket === socket) {
      flushSocketQueue();
    }
  });

  socket.addEventListener("message", (event) => {
    let payload;

    try {
      payload = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    if (payload.type === "state") {
      applyFullState(payload.state);
      return;
    }

    if (payload.type === "panel_update") {
      const previousPanel = state.panels.get(payload.panel.id) || {};
      const nextPanel = {
        ...previousPanel,
        ...payload.panel,
      };

      state.panels.set(nextPanel.id, nextPanel);
      if (!panelRefs.has(nextPanel.id)) {
        buildPanelCard(nextPanel);
      } else {
        updatePanelCard(nextPanel, {
          syncTerminal: typeof payload.panel.buffer === "string",
        });
      }
      return;
    }

    if (payload.type === "panel_output") {
      const panel = state.panels.get(payload.panelId);
      if (!panel) {
        return;
      }

      panel.buffer = payload.buffer;
      state.panels.set(payload.panelId, panel);

      const refs = panelRefs.get(payload.panelId);
      if (refs?.terminalPane) {
        refs.terminalPane.appendChunk(payload.chunk, payload.buffer);
      }

      updateSearchResult(payload.panelId);
      return;
    }

  });

  socket.addEventListener("close", () => {
    if (runtimeSocket === socket) {
      runtimeSocket = null;
    }

    window.setTimeout(connectWebSocket, 1200);
  });
}

window.addEventListener("beforeunload", () => {
  for (const refs of panelRefs.values()) {
    refs.terminalPane.dispose();
  }
});

async function init() {
  bindAlertOverlayActions();
  bindGlobalActions();
  const payload = await api("/api/state");
  applyFullState(payload);
  connectWebSocket();
}

init().catch((error) => {
  showAppAlert(error.message || String(error));
});
