const test = require("node:test");
const assert = require("node:assert/strict");

const { PanelManager } = require("../server/panelManager");

class FakeTelemetry {
  track() {}
}

class FakeTerminal {
  constructor() {
    this.exitHandlers = [];
    this.dataHandlers = [];
    this.killed = false;
  }

  onData(handler) {
    this.dataHandlers.push(handler);
  }

  onExit(handler) {
    this.exitHandlers.push(handler);
  }

  resize() {}

  write() {}

  kill() {
    this.killed = true;
    this.emitExit({ exitCode: 0, signal: 0 });
  }

  emitExit(event) {
    for (const handler of this.exitHandlers) {
      handler(event);
    }
  }
}

class FakePty {
  constructor() {
    this.terminals = [];
  }

  spawn() {
    const terminal = new FakeTerminal();
    this.terminals.push(terminal);
    return terminal;
  }
}

test("stopPanel cancels pending auto-restart after crash", async () => {
  const fakePty = new FakePty();
  const manager = new PanelManager({
    agentIds: ["A"],
    config: {
      maxPtys: 4,
      bufferSize: 120000,
      autoRestartDelayMs: 30,
    },
    telemetry: new FakeTelemetry(),
    ptyModule: fakePty,
  });

  await manager.startPanel("A");
  assert.equal(fakePty.terminals.length, 1);

  const firstTerminal = fakePty.terminals[0];
  firstTerminal.emitExit({ exitCode: 1, signal: 0 });

  await manager.stopPanel("A");
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(fakePty.terminals.length, 1);
  assert.equal(manager.getPanel("A").status, "stopped");
});

test("dangerous command requires approval token", async () => {
  const fakePty = new FakePty();
  const manager = new PanelManager({
    agentIds: ["A"],
    config: {
      maxPtys: 4,
      bufferSize: 120000,
      autoRestartDelayMs: 30,
      commandApprovalToken: "admin-token",
    },
    telemetry: new FakeTelemetry(),
    ptyModule: fakePty,
  });

  manager.updatePanelConfig("A", {
    command: "codex --dangerously-bypass-approvals-and-sandbox",
  });

  await assert.rejects(
    () => manager.startPanel("A"),
    /requires approval token/i,
  );
  assert.equal(fakePty.terminals.length, 0);
});

test("dangerous command can run with explicit approval token", async () => {
  const fakePty = new FakePty();
  const manager = new PanelManager({
    agentIds: ["A"],
    config: {
      maxPtys: 4,
      bufferSize: 120000,
      autoRestartDelayMs: 30,
      commandApprovalToken: "admin-token",
    },
    telemetry: new FakeTelemetry(),
    ptyModule: fakePty,
  });

  manager.updatePanelConfig("A", {
    command: "codex --dangerously-bypass-approvals-and-sandbox",
  });

  await manager.startPanel("A", {
    approvedDangerousCommand: true,
    approvalToken: "admin-token",
  });
  assert.equal(fakePty.terminals.length, 1);
});

test("command allowlist blocks unapproved startup command", async () => {
  const fakePty = new FakePty();
  const manager = new PanelManager({
    agentIds: ["A"],
    config: {
      maxPtys: 4,
      bufferSize: 120000,
      autoRestartDelayMs: 30,
      commandAllowlist: ["codex", "claude", "gemini"],
    },
    telemetry: new FakeTelemetry(),
    ptyModule: fakePty,
  });

  manager.updatePanelConfig("A", {
    command: "python -m http.server",
  });

  await assert.rejects(
    () => manager.startPanel("A"),
    /COMMAND_ALLOWLIST/i,
  );
  assert.equal(fakePty.terminals.length, 0);
});
