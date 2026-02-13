const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { registerIpcRoutes } = require("../src/main/ipc-router");
const { IPC_CHANNELS } = require("../src/shared/ipc-channels");

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
    this.listeners = new Map();
  }

  handle(channel, handler) {
    this.handlers.set(channel, handler);
  }

  on(channel, listener) {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, []);
    }
    this.listeners.get(channel).push(listener);
  }

  async invoke(channel, payload) {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`missing handler: ${channel}`);
    }
    return handler(
      {
        sender: {
          id: 7,
          isDestroyed: () => false,
          getURL: () => "file:///index.html",
        },
        senderFrame: {
          url: "file:///index.html",
        },
      },
      payload,
    );
  }
}

class FakeSessionManager extends EventEmitter {
  constructor() {
    super();
    this.writeCalls = [];
    this.runningSessionIds = new Set(["session-1"]);
  }

  createSession(payload = {}) {
    const id = payload.sessionId || "session-1";
    this.runningSessionIds.add(id);
    return {
      id,
      cwd: process.cwd(),
      shell: "mock-shell",
      env: {},
      cols: 80,
      rows: 24,
      status: "running",
      lastActiveAt: Date.now(),
    };
  }

  writeSession(sessionId, data) {
    if (!this.runningSessionIds.has(sessionId)) {
      throw new Error(`Session is not running: ${sessionId}`);
    }
    this.writeCalls.push({ sessionId, data });
    return true;
  }

  resizeSession() {
    return {};
  }

  killSession(sessionId) {
    this.runningSessionIds.delete(sessionId);
    return { killed: true };
  }

  changeDirectory() {
    return {};
  }

  cleanupAll() {
    return { cleaned: 0 };
  }

  recoverSession(snapshot) {
    return this.createSession({ sessionId: snapshot.id });
  }

  snapshotSessions() {
    return [];
  }
}

class FakeLayoutStore {
  save(layout) {
    return layout;
  }

  load() {
    return null;
  }
}

function setup() {
  const ipcMain = new FakeIpcMain();
  const sessionManager = new FakeSessionManager();
  const layoutStore = new FakeLayoutStore();

  registerIpcRoutes({
    ipcMain,
    sessionManager,
    layoutStore,
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        id: 7,
      },
    }),
  });

  return { ipcMain, sessionManager };
}

test("PTY_WRITE returns ok:false instead of throwing for stale session", async () => {
  const { ipcMain } = setup();
  const created = await ipcMain.invoke(IPC_CHANNELS.PTY_CREATE, {
    sessionId: "session-1",
  });
  await ipcMain.invoke(IPC_CHANNELS.PTY_KILL, {
    sessionId: "session-1",
    capabilityToken: created.capabilityToken,
    reason: "test-stop",
  });

  const result = await ipcMain.invoke(IPC_CHANNELS.PTY_WRITE, {
    sessionId: "session-1",
    capabilityToken: created.capabilityToken,
    data: "echo test\r",
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error || ""), /Session is not running/);
});

test("PTY_WRITE returns ok:true and forwards payload for running session", async () => {
  const { ipcMain, sessionManager } = setup();
  const created = await ipcMain.invoke(IPC_CHANNELS.PTY_CREATE, {
    sessionId: "session-1",
  });

  const result = await ipcMain.invoke(IPC_CHANNELS.PTY_WRITE, {
    sessionId: "session-1",
    capabilityToken: created.capabilityToken,
    data: "pwd\r",
  });

  assert.equal(result.ok, true);
  assert.equal(sessionManager.writeCalls.length, 1);
  assert.deepEqual(sessionManager.writeCalls[0], {
    sessionId: "session-1",
    data: "pwd\r",
  });
});

test("PTY_WRITE rejects malformed payload with invalid-payload error", async () => {
  const { ipcMain, sessionManager } = setup();
  const created = await ipcMain.invoke(IPC_CHANNELS.PTY_CREATE, {
    sessionId: "session-1",
  });

  const result = await ipcMain.invoke(IPC_CHANNELS.PTY_WRITE, {
    sessionId: "session-1",
    capabilityToken: created.capabilityToken,
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error || ""), /invalid-payload/);
  assert.equal(sessionManager.writeCalls.length, 0);
});

test("PTY_WRITE rejects invalid capability token", async () => {
  const { ipcMain, sessionManager } = setup();
  await ipcMain.invoke(IPC_CHANNELS.PTY_CREATE, {
    sessionId: "session-1",
  });

  const result = await ipcMain.invoke(IPC_CHANNELS.PTY_WRITE, {
    sessionId: "session-1",
    capabilityToken: "0123456789abcdef01234567",
    data: "pwd\r",
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error || ""), /forbidden/);
  assert.equal(sessionManager.writeCalls.length, 0);
});
