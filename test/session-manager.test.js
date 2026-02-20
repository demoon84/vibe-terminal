const test = require("node:test");
const assert = require("node:assert/strict");

const { SessionManager } = require("../src/main/session-manager");

test("SessionManager constructor initializes empty state", () => {
  const manager = new SessionManager();
  assert.ok(manager.sessions instanceof Map);
  assert.ok(manager.clients instanceof Map);
  assert.deepEqual(manager.stoppedSessionOrder, []);
});

test("snapshotSessions returns empty array when no sessions exist", () => {
  const manager = new SessionManager();
  const snapshots = manager.snapshotSessions();
  assert.deepEqual(snapshots, []);
});

test("killSession returns missing-session for unknown sessionId", () => {
  const manager = new SessionManager();
  const result = manager.killSession("nonexistent-session");
  assert.equal(result.killed, false);
  assert.equal(result.reason, "missing-session");
});
