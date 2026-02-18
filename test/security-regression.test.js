const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), "utf8");
}

test("renderer keeps dangerous full-access mode enabled by default", () => {
  const rendererSource = read("src/renderer/renderer.js");
  assert.match(
    rendererSource,
    /const\s+DEFAULT_FULL_ACCESS_ENABLED\s*=\s*true\s*;/,
  );
});

test("public app does not build user-driven templates with dynamic innerHTML interpolation", () => {
  const source = read("public/app.js");
  const lines = source.split(/\r?\n/);
  const innerHtmlLine = lines.find((line) => line.includes("innerHTML ="));
  assert.ok(innerHtmlLine, "expected at least one innerHTML assignment");
  assert.doesNotMatch(innerHtmlLine, /\$\{/);
});

test("server token extraction does not use query-string token transport", () => {
  const source = read("server/index.js");
  assert.doesNotMatch(source, /req(?:uest)?\s*\.\s*query\s*\.\s*token/i);
});

test("production build keeps BrowserWindow devTools disabled", () => {
  const source = read("src/main/main.js");
  assert.match(source, /devTools:\s*!isProductionBuild\(\)/);
});

test("devtools IPC toggle is blocked in production mode", () => {
  const source = read("src/main/main.js");
  assert.match(
    source,
    /ipcMain\.handle\(IPC_CHANNELS\.APP_WINDOW_DEVTOOLS_TOGGLE[\s\S]*?if\s*\(isProductionBuild\(\)\)\s*\{\s*return\s*\{\s*ok:\s*false,\s*error:\s*"disabled-in-production"/,
  );
});

test("sensitive main-process IPC handlers enforce trusted renderer guard", () => {
  const source = read("src/main/main.js");
  const sensitiveChannels = [
    "APP_WINDOW_MINIMIZE",
    "APP_WINDOW_MAXIMIZE_TOGGLE",
    "APP_WINDOW_DEVTOOLS_TOGGLE",
    "APP_WINDOW_CLOSE",
    "APP_PICK_DIRECTORY",
    "APP_PICK_FILES",
    "APP_TMUX_STATUS",
    "APP_TMUX_INSTALL",
    "APP_NODE_RUNTIME_STATUS",
    "APP_NODE_RUNTIME_INSTALL",
    "APP_CLIPBOARD_READ",
    "APP_CLIPBOARD_IMAGE_TO_TEMP",
    "APP_CLIPBOARD_WRITE",
  ];

  for (const channel of sensitiveChannels) {
    const pattern = new RegExp(
      `ipcMain\\.(?:on|handle)\\(IPC_CHANNELS\\.${channel}[\\s\\S]*?if\\s*\\(!isTrustedRendererEvent\\(event\\)\\)`,
    );
    assert.match(source, pattern);
  }
});

test("PTY IPC handlers enforce trusted renderer guard and capability tokens", () => {
  const source = read("src/main/ipc-router.js");
  const guardedChannels = [
    "PTY_CREATE",
    "PTY_WRITE",
    "PTY_RESIZE",
    "PTY_KILL",
    "PTY_CHANGE_DIRECTORY",
    "LAYOUT_SET_PRESET",
    "LAYOUT_RESTORE",
  ];

  for (const channel of guardedChannels) {
    const pattern = new RegExp(
      `ipcMain\\.handle\\(IPC_CHANNELS\\.${channel}[\\s\\S]*?if\\s*\\(!isTrustedRendererEvent\\(event\\)\\)`,
    );
    assert.match(source, pattern);
  }

  assert.match(source, /assertSessionCapability\(validated\.value\.sessionId,\s*validated\.value\.capabilityToken\)/);
});

test("renderer CSP policy remains compatible with xterm and disallows inline scripts", () => {
  const source = read("src/renderer/index.html");
  assert.match(source, /http-equiv="Content-Security-Policy"/);
  assert.match(source, /script-src 'self'/);
  assert.match(source, /style-src 'self' 'unsafe-inline'/);

  const scriptTagPattern = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let scriptMatch = null;
  while ((scriptMatch = scriptTagPattern.exec(source)) !== null) {
    const attrs = scriptMatch[1] || "";
    const body = scriptMatch[2] || "";
    assert.match(attrs, /\ssrc=/i);
    assert.equal(body.trim(), "");
  }
});

test("renderer xterm styles keep selection and helper textarea behavior stable", () => {
  const styleSource = read("src/renderer/styles.css");
  const rendererSource = read("src/renderer/renderer.js");
  assert.match(
    styleSource,
    /\.terminal-host \.xterm \.xterm-helper-textarea,\s*[\r\n]+\s*\.terminal-host \.xterm \.composition-view/,
  );
  assert.match(styleSource, /\.terminal-host \.xterm \.xterm-helper-textarea[\s\S]*?caret-color:\s*transparent/i);
  assert.match(styleSource, /\.terminal-host \.xterm \.xterm-selection[\s\S]*?opacity:\s*1/i);
  assert.match(styleSource, /\.terminal-host \.xterm-viewport[\s\S]*?overflow-y:\s*auto/i);
  assert.match(rendererSource, /cursorBlink:\s*true/);
});
