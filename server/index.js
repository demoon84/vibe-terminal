const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const WebSocket = require("ws");
const { AGENT_IDS, config } = require("./config");
const { Storage } = require("./storage");
const { Telemetry } = require("./telemetry");
const { PanelManager } = require("./panelManager");

function normalizeAddress(value) {
  const address = String(value || "").trim();
  if (!address) {
    return "";
  }
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

function isLoopbackAddress(value) {
  const address = normalizeAddress(value).toLowerCase();
  return address === "127.0.0.1" || address === "::1" || address === "localhost";
}

function parseBearerToken(headerValue) {
  if (typeof headerValue !== "string") {
    return "";
  }
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function readRequestToken(request) {
  const bearerToken = parseBearerToken(request?.headers?.authorization);
  if (bearerToken) {
    return bearerToken;
  }

  const headerToken = String(request?.headers?.["x-api-token"] || "").trim();
  if (headerToken) {
    return headerToken;
  }
  return "";
}

function safeTokenEquals(actualToken, expectedToken) {
  if (!actualToken || !expectedToken) {
    return false;
  }
  const left = Buffer.from(actualToken);
  const right = Buffer.from(expectedToken);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function isTrustedRequest(request, expectedToken, options = {}) {
  const allowLoopbackWithoutToken = options.allowLoopbackWithoutToken !== false;
  const remoteAddress = normalizeAddress(request?.socket?.remoteAddress);
  if (allowLoopbackWithoutToken && isLoopbackAddress(remoteAddress)) {
    return true;
  }

  if (!expectedToken) {
    return false;
  }

  const providedToken = readRequestToken(request);
  return safeTokenEquals(providedToken, expectedToken);
}

function buildAllowedOrigins({ host, port, configuredOrigins }) {
  if (Array.isArray(configuredOrigins) && configuredOrigins.length > 0) {
    return new Set(configuredOrigins);
  }

  const normalizedHost = String(host || "").trim();
  const normalizedPort = Number(port);
  if (!normalizedHost || !Number.isFinite(normalizedPort)) {
    return new Set();
  }

  const hostVariants = new Set([normalizedHost]);
  if (normalizedHost === "0.0.0.0") {
    hostVariants.add("127.0.0.1");
    hostVariants.add("localhost");
  }

  const origins = new Set();
  for (const hostVariant of hostVariants) {
    origins.add(`http://${hostVariant}:${normalizedPort}`);
    origins.add(`https://${hostVariant}:${normalizedPort}`);
  }

  return origins;
}

function isTrustedOrigin(origin, allowedOrigins) {
  const normalized = String(origin || "").trim();
  if (!normalized) {
    return true;
  }
  return allowedOrigins.has(normalized);
}

function toPublicWorksets(worksets) {
  return Object.values(worksets).map((item) => ({
    name: item.name,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    panelCount: Array.isArray(item.panels) ? item.panels.length : 0,
  }));
}

function sanitizeEnvForStorage(env, config) {
  if (!env || typeof env !== "object") {
    return {};
  }
  const output = {};
  for (const [key, value] of Object.entries(env)) {
    const envKey = String(key || "");
    if (!envKey) {
      continue;
    }
    if (!config.maskSensitiveEnvValues) {
      output[envKey] = value;
      continue;
    }
    if (/(token|secret|password|passwd|key|credential)/i.test(envKey)) {
      output[envKey] = "***";
      continue;
    }
    output[envKey] = value;
  }
  return output;
}

async function main() {
  const storage = new Storage(config.dataDir);
  await storage.init();

  let worksets = await storage.getWorksets();

  const telemetry = new Telemetry({
    enabled: config.telemetryEnabled,
    filePath: storage.telemetryPath,
  });

  const panelManager = new PanelManager({
    agentIds: AGENT_IDS,
    config,
    telemetry,
  });

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });
  const allowedOrigins = buildAllowedOrigins({
    host: config.host,
    port: config.port,
    configuredOrigins: config.allowedOrigins,
  });
  const requestBuckets = new Map();

  function trackSecurityEvent(type, payload = {}) {
    telemetry.track("security_event", {
      type,
      ...payload,
    });
  }

  function statePayload() {
    return {
      config: {
        maxPtys: config.maxPtys,
        bufferSize: config.bufferSize,
      },
      panels: panelManager.getPanels(),
      worksets: toPublicWorksets(worksets),
      telemetry: telemetry.summary(),
    };
  }

  function applySecurityHeaders(_req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
        "font-src 'self' data: https://cdn.jsdelivr.net",
        "img-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
    next();
  }

  function enforceRateLimit(req, res, next) {
    const now = Date.now();
    const windowMs = Math.max(1_000, Number(config.rateLimitWindowMs) || 60_000);
    const maxRequests = Math.max(20, Number(config.rateLimitMaxRequests) || 240);
    const remoteAddress = normalizeAddress(req?.socket?.remoteAddress);
    const providedToken = readRequestToken(req);
    const key = `${remoteAddress}::${providedToken || "-"}`;

    const current = requestBuckets.get(key);
    if (!current || now >= current.resetAt) {
      requestBuckets.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      next();
      return;
    }

    current.count += 1;
    if (current.count <= maxRequests) {
      next();
      return;
    }

    const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    trackSecurityEvent("http-rate-limit-exceeded", {
      remoteAddress,
      tokenPresent: Boolean(providedToken),
      path: req?.path,
      method: req?.method,
    });
    res.status(429).json({ ok: false, error: "rate-limit-exceeded" });
  }

  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of requestBuckets.entries()) {
      if (!bucket || now >= bucket.resetAt) {
        requestBuckets.delete(key);
      }
    }
  }, 30_000).unref();

  function broadcast(payload) {
    const text = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(text);
      }
    }
  }

  panelManager.on("panel_update", (panel) => {
    const { buffer, ...panelWithoutBuffer } = panel;
    broadcast({ type: "panel_update", panel: panelWithoutBuffer });
  });

  panelManager.on("panel_output", (output) => {
    broadcast({ type: "panel_output", ...output });
  });

  telemetry.on("event", (event) => {
    broadcast({ type: "telemetry_event", event });
  });

  telemetry.on("toggle", (enabled) => {
    broadcast({ type: "telemetry_toggle", enabled });
  });

  const requiresTokenForBind = !isLoopbackAddress(config.host) || config.requireApiTokenForLoopback;
  if (requiresTokenForBind && !config.apiToken) {
    throw new Error(
      "API_TOKEN is required by current bind/policy. Provide API_TOKEN or relax REQUIRE_API_TOKEN_FOR_LOOPBACK only for local development.",
    );
  }

  app.use(express.json({ limit: "1mb" }));
  app.use(applySecurityHeaders);
  app.use((req, res, next) => {
    const origin = String(req.headers.origin || "").trim();
    if (isTrustedOrigin(origin, allowedOrigins)) {
      next();
      return;
    }
    trackSecurityEvent("http-forbidden-origin", {
      origin,
      path: req?.path,
      method: req?.method,
      remoteAddress: normalizeAddress(req?.socket?.remoteAddress),
    });
    res.status(403).json({ ok: false, error: "forbidden-origin" });
  });
  app.use(enforceRateLimit);
  app.use((req, res, next) => {
    if (
      isTrustedRequest(req, config.apiToken, {
        allowLoopbackWithoutToken: !config.requireApiTokenForLoopback,
      })
    ) {
      next();
      return;
    }
    trackSecurityEvent("http-forbidden-auth", {
      path: req?.path,
      method: req?.method,
      remoteAddress: normalizeAddress(req?.socket?.remoteAddress),
      tokenPresent: Boolean(readRequestToken(req)),
    });
    res.status(403).json({ ok: false, error: "forbidden" });
  });
  app.use(express.static(path.join(process.cwd(), "public")));

  app.get("/api/state", (_, res) => {
    res.json(statePayload());
  });

  app.post("/api/panels/:id/config", (req, res) => {
    try {
      const panel = panelManager.updatePanelConfig(req.params.id, req.body || {});
      res.json({ ok: true, panel });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/panels/:id/start", async (req, res) => {
    try {
      const panel = await panelManager.startPanel(req.params.id, req.body || {});
      res.json({ ok: true, panel });
    } catch (error) {
      const status = error.code === "MAX_PTYS_REACHED" ? 429 : 400;
      res.status(status).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/panels/:id/stop", async (req, res) => {
    try {
      const panel = await panelManager.stopPanel(req.params.id);
      res.json({ ok: true, panel });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/panels/:id/restart", async (req, res) => {
    try {
      const panel = await panelManager.restartPanel(req.params.id, req.body || {});
      res.json({ ok: true, panel });
    } catch (error) {
      const status = error.code === "MAX_PTYS_REACHED" ? 429 : 400;
      res.status(status).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/panels/:id/resize", (req, res) => {
    try {
      const panel = panelManager.resizePanel(req.params.id, req.body?.cols, req.body?.rows);
      res.json({ ok: true, panel });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/panels/start-all", async (req, res) => {
    try {
      const result = await panelManager.startAll(req.body?.overridesById || {});
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/panels/stop-all", async (_, res) => {
    try {
      const result = await panelManager.stopAll();
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/worksets", (_, res) => {
    res.json({ ok: true, worksets: toPublicWorksets(worksets) });
  });

  app.post("/api/worksets", async (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      res.status(400).json({ ok: false, error: "Workset name is required." });
      return;
    }

    const panels = panelManager.currentSessionSnapshot().panels.map((panel) => ({
      id: panel.id,
      label: panel.label,
      cwd: panel.cwd,
      command: config.persistCommandInWorkset ? panel.command : "",
      env: config.persistEnvInWorkset ? sanitizeEnvForStorage(panel.env, config) : {},
      autoRestart: panel.autoRestart,
      cols: panel.cols,
      rows: panel.rows,
      running: panel.running,
    }));

    const now = new Date().toISOString();
    const existing = worksets[name];
    worksets[name] = {
      name,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      panels,
    };

    await storage.saveWorksets(worksets);
    res.json({ ok: true, worksets: toPublicWorksets(worksets), saved: worksets[name] });
    broadcast({ type: "worksets_update", worksets: toPublicWorksets(worksets) });
  });

  app.delete("/api/worksets/:name", async (req, res) => {
    const name = req.params.name;
    if (!worksets[name]) {
      res.status(404).json({ ok: false, error: "Workset not found." });
      return;
    }
    delete worksets[name];
    await storage.saveWorksets(worksets);
    res.json({ ok: true, worksets: toPublicWorksets(worksets) });
    broadcast({ type: "worksets_update", worksets: toPublicWorksets(worksets) });
  });

  app.post("/api/worksets/:name/load", async (req, res) => {
    const workset = worksets[req.params.name];
    if (!workset) {
      res.status(404).json({ ok: false, error: "Workset not found." });
      return;
    }

    const startRunning = Boolean(req.body?.startRunning);
    const skippedPanels = [];
    await panelManager.stopAll();

    for (const panel of workset.panels || []) {
      if (!panelManager.getPanel(panel.id)) {
        skippedPanels.push(panel.id);
        continue;
      }

      panelManager.updatePanelConfig(panel.id, panel);
      if (panel.cols && panel.rows) {
        panelManager.resizePanel(panel.id, panel.cols, panel.rows);
      }
    }

    if (startRunning) {
      for (const panel of workset.panels || []) {
        if (!panelManager.getPanel(panel.id)) {
          continue;
        }
        if (!panel.running) {
          continue;
        }
        try {
          await panelManager.startPanel(panel.id);
        } catch (_) {
          // Continue starting remaining panels.
        }
      }
    }

    res.json({
      ok: true,
      state: statePayload(),
      loaded: workset.name,
      skippedPanels,
    });
  });

  app.post("/api/telemetry/toggle", (req, res) => {
    telemetry.setEnabled(Boolean(req.body?.enabled));
    res.json({ ok: true, telemetry: telemetry.summary() });
  });

  wss.on("connection", (socket, request) => {
    const remoteAddress = normalizeAddress(request?.socket?.remoteAddress);
    const origin = String(request?.headers?.origin || "").trim();
    if (!isTrustedOrigin(origin, allowedOrigins)) {
      trackSecurityEvent("ws-forbidden-origin", {
        origin,
        remoteAddress,
      });
      socket.close(1008, "forbidden-origin");
      return;
    }

    if (
      !isTrustedRequest(request, config.apiToken, {
        allowLoopbackWithoutToken: !config.requireApiTokenForLoopback,
      })
    ) {
      trackSecurityEvent("ws-forbidden-auth", {
        origin,
        remoteAddress,
        tokenPresent: Boolean(readRequestToken(request)),
      });
      socket.close(1008, "forbidden");
      return;
    }

    const wsRateState = {
      count: 0,
      resetAt: Date.now() + Math.max(1_000, Number(config.wsRateLimitWindowMs) || 60_000),
    };

    socket.send(
      JSON.stringify({
        type: "state",
        state: statePayload(),
      })
    );

    socket.on("message", (raw) => {
      const now = Date.now();
      if (now >= wsRateState.resetAt) {
        wsRateState.count = 0;
        wsRateState.resetAt =
          now + Math.max(1_000, Number(config.wsRateLimitWindowMs) || 60_000);
      }

      wsRateState.count += 1;
      const wsLimit = Math.max(20, Number(config.wsRateLimitMaxMessages) || 400);
      if (wsRateState.count > wsLimit) {
        trackSecurityEvent("ws-rate-limit-exceeded", {
          origin,
          remoteAddress,
          count: wsRateState.count,
        });
        socket.close(1008, "rate-limit-exceeded");
        return;
      }

      let payload = null;
      try {
        payload = JSON.parse(String(raw));
      } catch (_) {
        trackSecurityEvent("ws-invalid-json", {
          origin,
          remoteAddress,
        });
        return;
      }

      if (!payload || typeof payload !== "object") {
        return;
      }

      if (payload.type === "panel_input") {
        try {
          panelManager.writePanel(payload.panelId, payload.data);
        } catch (_) {
          // Ignore bad input payloads from stale clients.
        }
        return;
      }

      if (payload.type === "panel_resize") {
        try {
          panelManager.resizePanel(payload.panelId, payload.cols, payload.rows);
        } catch (_) {
          // Ignore bad resize payloads from stale clients.
        }
      }
    });
  });

  process.on("SIGINT", async () => {
    await panelManager.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await panelManager.shutdown();
    process.exit(0);
  });

  server.listen(config.port, config.host, () => {
    // eslint-disable-next-line no-console
    console.log(`Vibe Terminal server running on http://${config.host}:${config.port}`);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
