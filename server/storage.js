const fs = require("node:fs");
const path = require("node:path");

class Storage {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.worksetsPath = path.join(dataDir, "worksets.json");
    this.telemetryPath = path.join(dataDir, "telemetry.log");
  }

  async init() {
    await fs.promises.mkdir(this.dataDir, { recursive: true });
  }

  async readJson(filePath, fallback) {
    try {
      const text = await fs.promises.readFile(filePath, "utf8");
      return JSON.parse(text);
    } catch (error) {
      if (error.code === "ENOENT") {
        return fallback;
      }
      throw error;
    }
  }

  async writeJson(filePath, data) {
    const tempPath = `${filePath}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
    await fs.promises.rename(tempPath, filePath);
  }

  async getWorksets() {
    const payload = await this.readJson(this.worksetsPath, { worksets: {} });
    return payload.worksets || {};
  }

  async saveWorksets(worksets) {
    await this.writeJson(this.worksetsPath, {
      updatedAt: new Date().toISOString(),
      worksets,
    });
  }

}

module.exports = {
  Storage,
};
