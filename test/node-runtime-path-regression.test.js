const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), "utf8");
}

test("node runtime detection uses augmented PATH in GUI launch contexts", () => {
  const source = read("src/main/main.js");
  assert.match(
    source,
    /function queryNodeRuntimeStatus\(\)[\s\S]*?spawnSync\("node",\s*\["-v"\],\s*\{[\s\S]*?env:\s*withAugmentedPath\(process\.env\)/,
  );
});

test("node runtime auto-install attempts use augmented PATH", () => {
  const source = read("src/main/main.js");
  assert.match(
    source,
    /function runNodeRuntimeInstallAttempt\(attempt\)[\s\S]*?spawn\(attempt\.command,\s*attempt\.args,\s*\{[\s\S]*?env:\s*withAugmentedPath\(process\.env\)/,
  );
});
