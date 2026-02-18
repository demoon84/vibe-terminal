const test = require("node:test");
const assert = require("node:assert/strict");

const { LayoutManager } = require("../src/main/layout-manager");
const {
  PRESET_DEFINITIONS,
  PRESET_IDS,
} = require("../src/shared/models");

class MockSessionManager {
  constructor() {
    this.seq = 0;
    this.sessions = new Map();
    this.killed = [];
    this.recovered = [];
  }

  createSession() {
    this.seq += 1;
    const session = {
      id: `session-${String(this.seq).padStart(3, "0")}`,
      status: "running",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      shell: "mock-shell",
      env: {},
      lastActiveAt: Date.now(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  killSession(sessionId, reason) {
    if (this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId);
    }
    this.killed.push({ sessionId, reason });
    return { killed: true };
  }

  cleanupAll(reason) {
    for (const sessionId of this.sessions.keys()) {
      this.killed.push({ sessionId, reason });
    }
    this.sessions.clear();
    return { cleaned: this.killed.length, reason };
  }

  recoverSession(snapshot) {
    const recovered = { ...snapshot, status: "running", lastActiveAt: Date.now() };
    this.sessions.set(recovered.id, recovered);
    this.recovered.push(recovered.id);
    return recovered;
  }

  snapshotSessions(sessionIds) {
    return sessionIds
      .map((id) => this.sessions.get(id))
      .filter(Boolean)
      .map((session) => ({ ...session }));
  }
}

function createManager() {
  const sessionManager = new MockSessionManager();
  const manager = new LayoutManager({ sessionManager });
  return { manager, sessionManager };
}

test("manager defaults to 1x2 startup preset", () => {
  const { manager } = createManager();
  const snapshot = manager.snapshotLayout();
  const visible = snapshot.panes.filter((pane) => pane.state === "visible");

  assert.equal(snapshot.presetId, PRESET_IDS.ONE_BY_TWO);
  assert.equal(visible.length, 0);
});

test("preset geometry is fixed to 2x2(4) / 2x6 / 2x8 / 3x12", () => {
  assert.deepEqual(
    {
      rows: PRESET_DEFINITIONS[PRESET_IDS.ONE_BY_FOUR].rows,
      columns: PRESET_DEFINITIONS[PRESET_IDS.ONE_BY_FOUR].columns,
    },
    { rows: 2, columns: 2 },
  );
  assert.deepEqual(
    {
      rows: PRESET_DEFINITIONS[PRESET_IDS.TWO_BY_SIX].rows,
      columns: PRESET_DEFINITIONS[PRESET_IDS.TWO_BY_SIX].columns,
    },
    { rows: 2, columns: 3 },
  );
  assert.deepEqual(
    {
      rows: PRESET_DEFINITIONS[PRESET_IDS.TWO_BY_EIGHT].rows,
      columns: PRESET_DEFINITIONS[PRESET_IDS.TWO_BY_EIGHT].columns,
    },
    { rows: 2, columns: 4 },
  );
  assert.deepEqual(
    {
      rows: PRESET_DEFINITIONS[PRESET_IDS.THREE_BY_TWELVE].rows,
      columns: PRESET_DEFINITIONS[PRESET_IDS.THREE_BY_TWELVE].columns,
    },
    { rows: 3, columns: 4 },
  );
});

test("set preset to 1x4 creates exactly 4 visible sessions", () => {
  const { manager } = createManager();
  const layout = manager.setPreset({ presetId: PRESET_IDS.ONE_BY_FOUR });

  const visible = layout.panes.filter((pane) => pane.state === "visible");
  const hidden = layout.panes.filter((pane) => pane.state === "hidden");
  const terminated = layout.panes.filter((pane) => pane.state === "terminated");

  assert.equal(visible.length, 4);
  assert.equal(hidden.length, 0);
  assert.equal(terminated.length, 8);
});

test("set preset to 3x12 creates exactly 12 visible sessions", () => {
  const { manager } = createManager();
  const layout = manager.setPreset({ presetId: PRESET_IDS.THREE_BY_TWELVE });

  const visible = layout.panes.filter((pane) => pane.state === "visible");
  assert.equal(visible.length, 12);
});

test("shrinking layout hides extra panes and expanding restores same sessions", () => {
  const { manager } = createManager();

  manager.setPreset({ presetId: PRESET_IDS.TWO_BY_EIGHT });
  const expanded = manager.snapshotLayout();
  const overflowSessionIds = expanded.panes
    .filter((pane) => pane.state === "visible")
    .sort((a, b) => a.positionIndex - b.positionIndex)
    .slice(4)
    .map((pane) => pane.sessionId);

  manager.setPreset({ presetId: PRESET_IDS.ONE_BY_FOUR });

  manager.setPreset({ presetId: PRESET_IDS.TWO_BY_EIGHT });

  const reExpanded = manager.snapshotLayout();
  const reExpandedOverflow = reExpanded.panes
    .filter((pane) => pane.state === "visible")
    .sort((a, b) => a.positionIndex - b.positionIndex)
    .slice(4)
    .map((pane) => pane.sessionId);

  assert.deepEqual(reExpandedOverflow, overflowSessionIds);
});

test("restore fills visible pane count to match preset panelCount", () => {
  const { manager } = createManager();

  const sparseLayout = {
    presetId: PRESET_IDS.TWO_BY_EIGHT,
    panes: [
      { id: "pane-a", slotIndex: 0, positionIndex: 0, state: "visible", sessionId: "session-a" },
      { id: "pane-b", slotIndex: 1, positionIndex: 1, state: "visible", sessionId: "session-b" },
      { id: "pane-c", slotIndex: 2, positionIndex: 2, state: "hidden", sessionId: null },
      { id: "pane-d", slotIndex: 3, positionIndex: 3, state: "hidden", sessionId: null },
      { id: "pane-e", slotIndex: 4, positionIndex: 4, state: "terminated", sessionId: null },
      { id: "pane-f", slotIndex: 5, positionIndex: 5, state: "terminated", sessionId: null },
      { id: "pane-g", slotIndex: 6, positionIndex: 6, state: "terminated", sessionId: null },
      { id: "pane-h", slotIndex: 7, positionIndex: 7, state: "terminated", sessionId: null },
    ],
    sessions: [
      {
        id: "session-a",
        cwd: process.cwd(),
        shell: "mock-shell",
        env: {},
        cols: 80,
        rows: 24,
        status: "running",
        lastActiveAt: Date.now(),
      },
      {
        id: "session-b",
        cwd: process.cwd(),
        shell: "mock-shell",
        env: {},
        cols: 80,
        rows: 24,
        status: "running",
        lastActiveAt: Date.now(),
      },
    ],
  };

  const restored = manager.restoreLayout(sparseLayout);
  assert.equal(restored.restored, true);

  const visible = restored.layout.panes.filter((pane) => pane.state === "visible");
  assert.equal(visible.length, 8);
});

test("restore recovers only visible pane sessions and clears hidden session bindings", () => {
  const { manager, sessionManager } = createManager();

  const persisted = {
    presetId: PRESET_IDS.ONE_BY_TWO,
    panes: [
      { id: "pane-a", slotIndex: 0, positionIndex: 0, state: "visible", sessionId: "session-a" },
      { id: "pane-b", slotIndex: 1, positionIndex: 1, state: "visible", sessionId: "session-b" },
      { id: "pane-c", slotIndex: 2, positionIndex: 2, state: "hidden", sessionId: "session-c" },
      { id: "pane-d", slotIndex: 3, positionIndex: 3, state: "hidden", sessionId: "session-d" },
    ],
    sessions: [
      {
        id: "session-a",
        cwd: process.cwd(),
        shell: "mock-shell",
        env: {},
        cols: 80,
        rows: 24,
        status: "running",
        lastActiveAt: Date.now(),
      },
      {
        id: "session-b",
        cwd: process.cwd(),
        shell: "mock-shell",
        env: {},
        cols: 80,
        rows: 24,
        status: "running",
        lastActiveAt: Date.now(),
      },
      {
        id: "session-c",
        cwd: process.cwd(),
        shell: "mock-shell",
        env: {},
        cols: 80,
        rows: 24,
        status: "running",
        lastActiveAt: Date.now(),
      },
      {
        id: "session-d",
        cwd: process.cwd(),
        shell: "mock-shell",
        env: {},
        cols: 80,
        rows: 24,
        status: "running",
        lastActiveAt: Date.now(),
      },
    ],
  };

  const restored = manager.restoreLayout(persisted);
  assert.equal(restored.restored, true);
  assert.deepEqual(sessionManager.recovered.sort(), ["session-a", "session-b"]);

  const hiddenWithSession = restored.layout.panes.filter(
    (pane) => pane.state === "hidden" && typeof pane.sessionId === "string" && pane.sessionId.length > 0,
  );
  assert.equal(hiddenWithSession.length, 0);
});
