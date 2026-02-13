const { spawnSync } = require("node:child_process");

const files = [
  "src/main/main.js",
  "src/main/ipc-router.js",
  "src/main/layout-manager.js",
  "src/main/layout-store.js",
  "src/main/session-manager.js",
  "src/preload/preload.js",
  "src/shared/ipc-channels.js",
  "src/shared/models.js",
  "src/renderer/renderer.js",
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
