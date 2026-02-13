const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

const AGENT_IDS = ["A", "B", "C", "D"];

function loadDotenvFiles() {
  const rawNodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const normalizedNodeEnv = rawNodeEnv || "development";
  const candidates = [
    `.env.${normalizedNodeEnv}.local`,
    ".env.local",
    `.env.${normalizedNodeEnv}`,
    ".env",
  ];

  for (const fileName of candidates) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    dotenv.config({ path: filePath });
  }
}

loadDotenvFiles();

function asNumber(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function asBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function asHost(value, fallback) {
  const host = String(value || "").trim();
  return host || fallback;
}

function asToken(value) {
  const token = String(value || "").trim();
  return token.length > 0 ? token : "";
}

function asStringList(value, fallback = []) {
  const raw = String(value || "").trim();
  if (!raw) {
    return [...fallback];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function asOptionalToken(value) {
  const token = String(value || "").trim();
  return token.length > 0 ? token : "";
}

function asRuntimeEnv(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "production" || normalized === "prod") {
    return "production";
  }
  if (normalized === "staging" || normalized === "stage") {
    return "staging";
  }
  return "development";
}

function asRuntimeDefaultBoolean(value, runtimeEnv, defaultsByEnv) {
  const fallback = Boolean(defaultsByEnv?.[runtimeEnv]);
  return asBoolean(value, fallback);
}

function resolveAllowedOrigins(runtimeEnv) {
  const globalOrigins = asStringList(process.env.ALLOWED_ORIGINS, []);
  if (globalOrigins.length > 0) {
    return globalOrigins;
  }

  if (runtimeEnv === "production") {
    return asStringList(process.env.ALLOWED_ORIGINS_PROD, []);
  }
  if (runtimeEnv === "staging") {
    return asStringList(process.env.ALLOWED_ORIGINS_STAGE, []);
  }
  return asStringList(process.env.ALLOWED_ORIGINS_DEV, []);
}

const runtimeEnv = asRuntimeEnv(process.env.NODE_ENV);

const config = {
  runtimeEnv,
  port: asNumber(process.env.PORT, 4310),
  host: asHost(process.env.HOST, "127.0.0.1"),
  maxPtys: asNumber(process.env.MAX_PTYS, 4),
  bufferSize: asNumber(process.env.BUFFER_SIZE, 120000),
  autoRestartDelayMs: asNumber(process.env.AUTO_RESTART_DELAY_MS, 1500),
  telemetryEnabled: asBoolean(process.env.TELEMETRY_ENABLED, false),
  apiToken: asToken(process.env.API_TOKEN),
  requireApiTokenForLoopback: asRuntimeDefaultBoolean(
    process.env.REQUIRE_API_TOKEN_FOR_LOOPBACK,
    runtimeEnv,
    {
      development: false,
      staging: true,
      production: true,
    },
  ),
  allowedOrigins: resolveAllowedOrigins(runtimeEnv),
  rateLimitWindowMs: asNumber(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMaxRequests: asNumber(process.env.RATE_LIMIT_MAX_REQUESTS, 240),
  wsRateLimitWindowMs: asNumber(process.env.WS_RATE_LIMIT_WINDOW_MS, 60_000),
  wsRateLimitMaxMessages: asNumber(process.env.WS_RATE_LIMIT_MAX_MESSAGES, 400),
  commandAllowlist: asStringList(process.env.COMMAND_ALLOWLIST, []),
  commandApprovalToken: asOptionalToken(process.env.COMMAND_APPROVAL_TOKEN),
  persistCommandInWorkset: asBoolean(process.env.PERSIST_COMMAND_IN_WORKSET, false),
  persistEnvInWorkset: asBoolean(process.env.PERSIST_ENV_IN_WORKSET, false),
  maskSensitiveEnvValues: asBoolean(process.env.MASK_SENSITIVE_ENV_VALUES, true),
  dataDir: path.join(process.cwd(), "data"),
};

module.exports = {
  AGENT_IDS,
  config,
};
