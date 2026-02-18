const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  splitPathEntries,
  mergePathEntries,
  buildAugmentedPath,
  getKnownCommandLocations,
  isExecutableFile,
  withAugmentedPath,
} = require("../src/main/path-utils");

test("splitPathEntries ignores empty segments", () => {
  const raw = `${path.delimiter}/usr/bin${path.delimiter}${path.delimiter}/bin${path.delimiter}`;
  assert.deepEqual(splitPathEntries(raw), ["/usr/bin", "/bin"]);
});

test("mergePathEntries keeps order and removes duplicates", () => {
  const merged = mergePathEntries(["/usr/bin", "/bin"], ["/opt/homebrew/bin", "/bin"]);
  assert.deepEqual(merged, ["/usr/bin", "/bin", "/opt/homebrew/bin"]);
});

test("buildAugmentedPath appends macOS fallback locations", () => {
  const base = ["/usr/bin", "/bin"].join(path.delimiter);
  const augmented = buildAugmentedPath(base, "darwin");
  const entries = splitPathEntries(augmented);
  assert.deepEqual(entries.slice(0, 2), ["/usr/bin", "/bin"]);
  assert.equal(entries.includes("/opt/homebrew/bin"), true);
  assert.equal(entries.includes("/usr/local/bin"), true);
  assert.equal(entries.includes("/usr/sbin"), true);
  assert.equal(entries.includes("/sbin"), true);
});

test("withAugmentedPath keeps existing environment keys", () => {
  const input = { PATH: "/usr/bin", FOO: "bar" };
  const output = withAugmentedPath(input, "darwin");
  assert.equal(output.FOO, "bar");
  assert.match(output.PATH, /\/opt\/homebrew\/bin/);
});

test("getKnownCommandLocations returns darwin command candidates", () => {
  const locations = getKnownCommandLocations("tmux", "darwin");
  assert.deepEqual(locations.slice(0, 2), ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"]);
});

test("isExecutableFile validates absolute executable paths", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "path-utils-test-"));
  const executablePath = path.join(tempRoot, "tool");

  try {
    fs.writeFileSync(executablePath, "#!/bin/sh\necho ok\n", "utf8");
    fs.chmodSync(executablePath, 0o755);
    assert.equal(isExecutableFile(executablePath), true);
    assert.equal(isExecutableFile("tool"), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
