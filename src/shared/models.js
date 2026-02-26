const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SESSION_STATUS = Object.freeze({
  CREATING: "creating",
  RUNNING: "running",
  STOPPING: "stopping",
  STOPPED: "stopped",
  ERRORED: "errored",
  RECOVERING: "recovering",
});

const PRESET_IDS = Object.freeze({
  ONE_BY_ONE: "1x1",
  ONE_BY_TWO: "1x2",
  ONE_BY_FOUR: "1x4",
  TWO_BY_SIX: "2x6",
  TWO_BY_EIGHT: "2x8",

});

const PRESET_DEFINITIONS = Object.freeze({
  [PRESET_IDS.ONE_BY_ONE]: Object.freeze({
    id: PRESET_IDS.ONE_BY_ONE,
    name: "1x1 (1)",
    rows: 1,
    columns: 1,
    panelCount: 1,
  }),
  [PRESET_IDS.ONE_BY_TWO]: Object.freeze({
    id: PRESET_IDS.ONE_BY_TWO,
    name: "1x2 (2)",
    rows: 1,
    columns: 2,
    panelCount: 2,
  }),
  [PRESET_IDS.ONE_BY_FOUR]: Object.freeze({
    id: PRESET_IDS.ONE_BY_FOUR,
    name: "2x2 (4)",
    rows: 2,
    columns: 2,
    panelCount: 4,
  }),
  [PRESET_IDS.TWO_BY_SIX]: Object.freeze({
    id: PRESET_IDS.TWO_BY_SIX,
    name: "2x3 (6)",
    rows: 2,
    columns: 3,
    panelCount: 6,
  }),
  [PRESET_IDS.TWO_BY_EIGHT]: Object.freeze({
    id: PRESET_IDS.TWO_BY_EIGHT,
    name: "2x4 (8)",
    rows: 2,
    columns: 4,
    panelCount: 8,
  }),
  [PRESET_IDS.THREE_BY_TWELVE]: Object.freeze({
    id: PRESET_IDS.THREE_BY_TWELVE,
    name: "3x4 (12)",
    rows: 3,
    columns: 4,
    panelCount: 12,
  }),
});

const LAYOUT_CONSTRAINTS = Object.freeze({
  minPanelWidthPx: 220,
  minPanelHeightPx: 160,
  splitterSizePx: 1,
  splitterHitAreaPx: 16,
});

const PRESET_LAYOUT_SPEC = Object.freeze({
  defaultPresetId: PRESET_IDS.ONE_BY_TWO,
  presets: PRESET_DEFINITIONS,
  constraints: LAYOUT_CONSTRAINTS,
});

let cachedWindowsShell = null;

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function isPresetId(value) {
  return Object.prototype.hasOwnProperty.call(PRESET_DEFINITIONS, value);
}

function getPresetDefinition(presetId) {
  if (!isPresetId(presetId)) {
    throw new Error(`Unsupported preset: ${presetId}`);
  }
  return PRESET_DEFINITIONS[presetId];
}

function getMaxPanelCount() {
  return Math.max(...Object.values(PRESET_DEFINITIONS).map((preset) => preset.panelCount));
}

function getGroupIdByPositionIndex(positionIndex, presetId) {
  const preset = getPresetDefinition(presetId);
  const row = Math.floor(positionIndex / preset.columns);
  return `row-${row + 1}`;
}

function buildPanesForPreset(presetId) {
  const preset = getPresetDefinition(presetId);
  const panes = [];
  for (let index = 0; index < preset.panelCount; index += 1) {
    panes.push({
      id: createId("pane"),
      slotIndex: index,
      positionIndex: index,
      groupId: getGroupIdByPositionIndex(index, presetId),
      state: "visible",
      sessionId: null,
    });
  }
  return panes;
}

function resolveWindowsShell() {
  if (cachedWindowsShell) {
    return cachedWindowsShell;
  }

  const envPath = String(process.env.PWSH_PATH || "").trim();
  if (envPath) {
    if (!fs.existsSync(envPath)) {
      throw new Error(`PWSH_PATH does not exist: ${envPath}`);
    }
    if (path.basename(envPath).toLowerCase() !== "pwsh.exe") {
      throw new Error("PWSH_PATH must point to PowerShell 7 executable (pwsh.exe)");
    }
    cachedWindowsShell = envPath;
    return cachedWindowsShell;
  }

  const staticCandidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe"),
    path.join(process.env.ProgramW6432 || "C:\\Program Files", "PowerShell", "7", "pwsh.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7-preview", "pwsh.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "pwsh.exe"),
  ];

  for (const candidate of staticCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      cachedWindowsShell = candidate;
      return cachedWindowsShell;
    }
  }

  const commandCandidates = ["pwsh.exe"];
  for (const command of commandCandidates) {
    try {
      const whereResult = execFileSync("where.exe", [command], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      const firstMatch = String(whereResult)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (firstMatch) {
        cachedWindowsShell = firstMatch;
        return cachedWindowsShell;
      }
    } catch (_error) {
      // Continue to next candidate.
    }
  }

  throw new Error(
    "PowerShell 7 (pwsh.exe) is required. Install PowerShell 7 or set PWSH_PATH to pwsh.exe.",
  );
}

function getDefaultShell() {
  if (process.platform === "win32") {
    return resolveWindowsShell();
  }
  if (process.platform === "darwin") {
    return process.env.SHELL || "/bin/zsh";
  }
  return process.env.SHELL || "/bin/bash";
}

function clonePlainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  SESSION_STATUS,
  PRESET_IDS,
  PRESET_DEFINITIONS,
  PRESET_LAYOUT_SPEC,
  LAYOUT_CONSTRAINTS,
  createId,
  isPresetId,
  getPresetDefinition,
  getMaxPanelCount,
  getGroupIdByPositionIndex,
  buildPanesForPreset,
  getDefaultShell,
  clonePlainObject,
};
