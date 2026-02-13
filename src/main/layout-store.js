const fs = require("fs");
const path = require("path");
const { clonePlainObject } = require("../shared/models");

class LayoutStore {
  constructor(baseDirectory) {
    this.baseDirectory = baseDirectory;
    this.filePath = path.join(this.baseDirectory, "layout-state.json");
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return clonePlainObject(parsed);
    } catch (_error) {
      return null;
    }
  }

  save(layoutState) {
    fs.mkdirSync(this.baseDirectory, { recursive: true });
    const payload = {
      ...clonePlainObject(layoutState),
      updatedAt: Date.now(),
    };
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf8");
    return payload;
  }
}

module.exports = {
  LayoutStore,
};
