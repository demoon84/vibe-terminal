const fs = require("node:fs");
const EventEmitter = require("node:events");

const SENSITIVE_KEY_RE = /(token|secret|password|passwd|authorization|api[_-]?key|credential)/i;

function redactSensitive(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      output[key] = "***";
      continue;
    }
    output[key] = redactSensitive(entry);
  }
  return output;
}

class Telemetry extends EventEmitter {
  constructor({ enabled, filePath }) {
    super();
    this.enabled = enabled;
    this.filePath = filePath;
    this.events = [];
    this.maxInMemoryEvents = 200;
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    this.emit("toggle", this.enabled);
  }

  async track(event, payload = {}) {
    const item = {
      event,
      payload: redactSensitive(payload),
      timestamp: new Date().toISOString(),
    };

    this.events.push(item);
    if (this.events.length > this.maxInMemoryEvents) {
      this.events.shift();
    }

    this.emit("event", item);

    if (!this.enabled) {
      return;
    }

    try {
      await fs.promises.appendFile(this.filePath, `${JSON.stringify(item)}\n`, "utf8");
    } catch (_) {
      // Telemetry failures should not break runtime behavior.
    }
  }

  summary() {
    return {
      enabled: this.enabled,
      recentEvents: this.events.slice(-20),
    };
  }
}

module.exports = {
  Telemetry,
};
