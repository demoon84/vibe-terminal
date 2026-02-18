const fs = require("fs");
const os = require("os");
const path = require("path");

const MAC_GUI_FALLBACK_PATHS = Object.freeze([
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
]);

function parseNodeVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    raw: String(value || "").trim(),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareNodeVersion(left, right) {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
}

function getLatestNvmBinPath(homeDir) {
  const nodeRoot = path.join(homeDir, ".nvm", "versions", "node");
  if (!fs.existsSync(nodeRoot)) {
    return null;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(nodeRoot, { withFileTypes: true });
  } catch (_error) {
    return null;
  }

  const parsedVersions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const parsed = parseNodeVersion(entry.name);
    if (!parsed) {
      continue;
    }
    parsedVersions.push(parsed);
  }

  if (parsedVersions.length === 0) {
    return null;
  }

  parsedVersions.sort((left, right) => compareNodeVersion(right, left));
  const latestDirName = parsedVersions[0].raw.startsWith("v")
    ? parsedVersions[0].raw
    : `v${parsedVersions[0].raw}`;
  const latestBinPath = path.join(nodeRoot, latestDirName, "bin");
  return fs.existsSync(latestBinPath) ? latestBinPath : null;
}

function getUserToolFallbackPaths(platform = process.platform) {
  if (platform !== "darwin" && platform !== "linux") {
    return [];
  }

  const homeDir = process.env.HOME || os.homedir();
  if (typeof homeDir !== "string" || homeDir.length === 0) {
    return [];
  }

  const candidates = [
    path.join(homeDir, "bin"),
    path.join(homeDir, ".local", "bin"),
    path.join(homeDir, ".npm-global", "bin"),
    path.join(homeDir, ".volta", "bin"),
    path.join(homeDir, ".fnm", "current", "bin"),
    path.join(homeDir, ".asdf", "shims"),
  ];

  const nvmBinPath = getLatestNvmBinPath(homeDir);
  if (nvmBinPath) {
    candidates.push(nvmBinPath);
  }

  return candidates.filter((candidate) => fs.existsSync(candidate));
}

function splitPathEntries(pathValue) {
  if (typeof pathValue !== "string" || pathValue.length === 0) {
    return [];
  }
  return pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function getFallbackPathEntries(platform = process.platform) {
  const userToolPaths = getUserToolFallbackPaths(platform);
  if (platform === "darwin") {
    return [...MAC_GUI_FALLBACK_PATHS, ...userToolPaths];
  }
  if (platform === "linux") {
    return [...userToolPaths];
  }
  return [];
}

function mergePathEntries(primaryEntries = [], fallbackEntries = []) {
  const merged = [];
  const seen = new Set();

  for (const entry of [...primaryEntries, ...fallbackEntries]) {
    if (typeof entry !== "string" || entry.length === 0 || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    merged.push(entry);
  }

  return merged;
}

function buildAugmentedPath(pathValue, platform = process.platform) {
  const primaryEntries = splitPathEntries(pathValue);
  const fallbackEntries = getFallbackPathEntries(platform);
  const merged = mergePathEntries(primaryEntries, fallbackEntries);
  return merged.join(path.delimiter);
}

function resolvePathKey(env) {
  if (process.platform !== "win32") {
    return "PATH";
  }

  const key = Object.keys(env || {}).find((name) => name.toLowerCase() === "path");
  return key || "Path";
}

function withAugmentedPath(baseEnv = process.env, platform = process.platform) {
  const sourceEnv = baseEnv && typeof baseEnv === "object" ? baseEnv : {};
  const pathKey = resolvePathKey(sourceEnv);
  const currentPath = sourceEnv[pathKey] || sourceEnv.PATH || "";
  const nextPath = buildAugmentedPath(currentPath, platform);

  const nextEnv = { ...sourceEnv };
  nextEnv[pathKey] = nextPath;
  if (pathKey !== "PATH") {
    nextEnv.PATH = nextPath;
  }
  return nextEnv;
}

function getKnownCommandLocations(commandName, platform = process.platform) {
  const normalized = String(commandName || "").trim();
  if (normalized.length === 0) {
    return [];
  }

  return getFallbackPathEntries(platform).map((dir) => path.join(dir, normalized));
}

function isExecutableFile(filePath) {
  const normalized = String(filePath || "").trim();
  if (normalized.length === 0 || !path.isAbsolute(normalized)) {
    return false;
  }

  try {
    fs.accessSync(normalized, fs.constants.X_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = {
  buildAugmentedPath,
  getKnownCommandLocations,
  isExecutableFile,
  mergePathEntries,
  splitPathEntries,
  withAugmentedPath,
};
