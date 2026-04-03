const {
  PRESET_IDS,
  PRESET_LAYOUT_SPEC,
  getPresetDefinition,
  getMaxPanelCount,
  isPresetId,
  clonePlainObject,
  createId,
} = require("../shared/models");

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTrackSizes(trackSizes, expectedLength) {
  if (!Array.isArray(trackSizes) || trackSizes.length !== expectedLength) {
    return null;
  }

  const safe = trackSizes.map((value) => asNumber(value, 0)).map((value) => (value > 0 ? value : 0));
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return null;
  }

  return safe.map((value) => (value / total) * 100);
}

function sortBySlot(a, b) {
  return a.slotIndex - b.slotIndex;
}

function getDefaultGridShapeForPreset(presetId) {
  const preset = getPresetDefinition(presetId);
  return {
    columns: preset.columns,
    rows: preset.rows,
  };
}

function getAllowedGridShapesForPreset(presetId) {
  const preset = getPresetDefinition(presetId);
  switch (preset.panelCount) {
    case 1:
      return [{ columns: 1, rows: 1 }];
    case 2:
      return [
        { columns: 2, rows: 1 },
        { columns: 1, rows: 2 },
      ];
    case 3:
      return [
        { columns: 3, rows: 1 },
        { columns: 1, rows: 3 },
        { columns: 2, rows: 2 },
      ];
    case 4:
      return [
        { columns: 2, rows: 2 },
        { columns: 4, rows: 1 },
        { columns: 1, rows: 4 },
        { columns: 3, rows: 2 },
        { columns: 2, rows: 3 },
      ];
    default:
      return [getDefaultGridShapeForPreset(presetId)];
  }
}

function normalizeGridShape(gridShape, presetId) {
  const fallback = getDefaultGridShapeForPreset(presetId);
  if (!gridShape || typeof gridShape !== "object") {
    return fallback;
  }

  const columns = Math.max(1, Math.floor(asNumber(gridShape.columns, 0)));
  const rows = Math.max(1, Math.floor(asNumber(gridShape.rows, 0)));
  const match = getAllowedGridShapesForPreset(presetId).find(
    (shape) => shape.columns === columns && shape.rows === rows,
  );
  return match ? { columns: match.columns, rows: match.rows } : fallback;
}

function getAllowedLayoutVariantsForPreset(presetId) {
  const preset = getPresetDefinition(presetId);
  switch (preset.panelCount) {
    case 1:
      return ["single"];
    case 2:
      return ["row", "column"];
    case 3:
      return ["row", "column", "stack-left", "stack-right", "stack-top", "stack-bottom"];
    case 4:
      return ["grid", "row", "column", "stack-left", "stack-right", "stack-top", "stack-bottom"];
    default:
      return ["grid"];
  }
}

function getGridShapeForLayoutVariant(layoutVariant, presetId) {
  const preset = getPresetDefinition(presetId);
  switch (preset.panelCount) {
    case 1:
      return { columns: 1, rows: 1 };
    case 2:
      return layoutVariant === "column"
        ? { columns: 1, rows: 2 }
        : { columns: 2, rows: 1 };
    case 3:
      if (layoutVariant === "column") {
        return { columns: 1, rows: 3 };
      }
      if (layoutVariant === "stack-left" || layoutVariant === "stack-right" || layoutVariant === "stack-top" || layoutVariant === "stack-bottom") {
        return { columns: 2, rows: 2 };
      }
      return { columns: 3, rows: 1 };
    case 4:
      if (layoutVariant === "row") {
        return { columns: 4, rows: 1 };
      }
      if (layoutVariant === "column") {
        return { columns: 1, rows: 4 };
      }
      if (layoutVariant === "stack-left" || layoutVariant === "stack-right") {
        return { columns: 3, rows: 2 };
      }
      if (layoutVariant === "stack-top" || layoutVariant === "stack-bottom") {
        return { columns: 2, rows: 3 };
      }
      return { columns: 2, rows: 2 };
    default:
      return {
        columns: preset.columns,
        rows: preset.rows,
      };
  }
}

function normalizeLayoutVariant(layoutVariant, presetId, gridShape) {
  const allowedVariants = getAllowedLayoutVariantsForPreset(presetId);
  const normalizedVariant = typeof layoutVariant === "string" ? layoutVariant.trim() : "";
  if (allowedVariants.includes(normalizedVariant)) {
    return normalizedVariant;
  }

  const preset = getPresetDefinition(presetId);
  const shape = normalizeGridShape(gridShape, presetId);
  switch (preset.panelCount) {
    case 1:
      return "single";
    case 2:
      return shape.rows > shape.columns ? "column" : "row";
    case 3:
      if (shape.columns === 1 && shape.rows === 3) {
        return "column";
      }
      if (shape.columns === 2 && shape.rows === 2) {
        return "stack-left";
      }
      return "row";
    case 4:
      if (shape.columns === 1 && shape.rows === 4) {
        return "column";
      }
      if (shape.columns === 4 && shape.rows === 1) {
        return "row";
      }
      if (shape.columns === 3 && shape.rows === 2) {
        return "stack-left";
      }
      if (shape.columns === 2 && shape.rows === 3) {
        return "stack-top";
      }
      return "grid";
    default:
      return allowedVariants[0] || "grid";
  }
}

function getGroupIdByPositionIndexForGridShape(positionIndex, gridShape, presetId) {
  const columns = Math.max(
    1,
    Math.floor(asNumber(gridShape?.columns, getDefaultGridShapeForPreset(presetId).columns)),
  );
  const row = Math.floor(Math.max(0, asNumber(positionIndex, 0)) / columns);
  return `row-${row + 1}`;
}

class LayoutManager {
  constructor(options = {}) {
    const { sessionManager, defaultPresetId = PRESET_IDS.ONE_BY_TWO } = options;
    if (!sessionManager) {
      throw new Error("LayoutManager requires sessionManager");
    }

    this.sessionManager = sessionManager;
    this.defaultPresetId = isPresetId(defaultPresetId) ? defaultPresetId : PRESET_IDS.ONE_BY_TWO;
    this.maxPaneCount = getMaxPanelCount();
    this.activeLayout = {
      presetId: this.defaultPresetId,
      panes: this._createEmptyPanes(),
      layoutVariant: normalizeLayoutVariant(null, this.defaultPresetId, null),
      gridShape: getDefaultGridShapeForPreset(this.defaultPresetId),
      gridTracks: null,
    };
  }

  snapshotLayout() {
    const sessionIds = this.activeLayout.panes
      .map((pane) => pane.sessionId)
      .filter((sessionId) => typeof sessionId === "string" && sessionId.length > 0);

    return {
      presetId: this.activeLayout.presetId,
      panes: this.activeLayout.panes.map((pane) => clonePlainObject(pane)),
      layoutVariant: this.activeLayout.layoutVariant,
      gridShape: clonePlainObject(this.activeLayout.gridShape),
      sessions: this.sessionManager.snapshotSessions(sessionIds),
      gridTracks: this.activeLayout.gridTracks
        ? {
            columns: [...this.activeLayout.gridTracks.columns],
            rows: [...this.activeLayout.gridTracks.rows],
          }
        : null,
      presetSpec: clonePlainObject(PRESET_LAYOUT_SPEC),
    };
  }

  setPreset(options = {}) {
    const {
      presetId,
      sessionDefaults = {},
      preferredSessionIds = [],
      minPanelCount = 0,
    } = options;
    if (!isPresetId(presetId)) {
      throw new Error(`Unsupported preset: ${presetId}`);
    }

    const nextPreset = getPresetDefinition(presetId);
    const nextLayoutVariant = normalizeLayoutVariant(null, presetId, null);
    const nextGridShape = getGridShapeForLayoutVariant(nextLayoutVariant, presetId);
    const panes = this.activeLayout.panes;
    const requestedMinimum = Math.max(0, Math.floor(asNumber(minPanelCount, 0)));
    const preferredIdSet = new Set(
      Array.isArray(preferredSessionIds)
        ? preferredSessionIds
            .filter((sessionId) => typeof sessionId === "string")
            .map((sessionId) => sessionId.trim())
            .filter((sessionId) => sessionId.length > 0)
        : [],
    );
    const preferredPaneCount = panes.filter(
      (pane) =>
        typeof pane?.sessionId === "string" &&
        pane.sessionId.length > 0 &&
        preferredIdSet.has(pane.sessionId),
    ).length;
    const requiredPanelCount = Math.max(requestedMinimum, preferredPaneCount);
    if (requiredPanelCount > nextPreset.panelCount) {
      throw new Error(
        `Preset ${presetId} cannot fit running panes (${requiredPanelCount} > ${nextPreset.panelCount})`,
      );
    }

    const visible = panes.filter((pane) => pane.state === "visible").sort(sortBySlot);
    const hidden = panes.filter((pane) => pane.state === "hidden").sort(sortBySlot);
    const terminated = panes.filter((pane) => pane.state === "terminated").sort(sortBySlot);

    const nextVisible = [];
    const nextVisibleIds = new Set();
    const pushNextVisible = (pane) => {
      if (!pane || nextVisible.length >= nextPreset.panelCount || nextVisibleIds.has(pane.id)) {
        return;
      }
      nextVisible.push(pane);
      nextVisibleIds.add(pane.id);
    };

    if (preferredIdSet.size > 0) {
      const preferredPanes = panes
        .filter(
          (pane) =>
            typeof pane?.sessionId === "string" &&
            pane.sessionId.length > 0 &&
            preferredIdSet.has(pane.sessionId),
        )
        .sort(sortBySlot);
      for (const pane of preferredPanes) {
        pushNextVisible(pane);
      }
    }

    for (const pane of visible) {
      pushNextVisible(pane);
    }
    for (const pane of hidden) {
      pushNextVisible(pane);
    }
    for (const pane of terminated) {
      pushNextVisible(pane);
    }

    const overflowVisible = visible.filter((pane) => !nextVisibleIds.has(pane.id));
    const overflowIds = new Set(overflowVisible.map((pane) => pane.id));

    for (const pane of panes) {
      if (nextVisibleIds.has(pane.id)) {
        continue;
      }

      if (overflowIds.has(pane.id)) {
        pane.state = "hidden";
      } else if (pane.state !== "terminated") {
        pane.state = "hidden";
      }

      pane.positionIndex = pane.slotIndex;
      pane.groupId = getGroupIdByPositionIndexForGridShape(pane.positionIndex, nextGridShape, presetId);
    }

    nextVisible.forEach((pane, index) => {
      pane.state = "visible";
      pane.positionIndex = index;
      pane.groupId = getGroupIdByPositionIndexForGridShape(index, nextGridShape, presetId);
      if (!pane.sessionId) {
        pane.sessionId = this._createSession(sessionDefaults).id;
      }
    });

    this.activeLayout.presetId = presetId;
    this.activeLayout.layoutVariant = nextLayoutVariant;
    this.activeLayout.gridShape = nextGridShape;
    this.activeLayout.gridTracks = null;
    return this.snapshotLayout();
  }

  saveLayout(options = {}) {
    const { presetId, panes, layoutVariant, gridShape, gridTracks } = options;
    if (isPresetId(presetId)) {
      this.activeLayout.presetId = presetId;
    }

    this.activeLayout.layoutVariant = normalizeLayoutVariant(
      layoutVariant || this.activeLayout.layoutVariant,
      this.activeLayout.presetId,
      gridShape || this.activeLayout.gridShape,
    );
    this.activeLayout.gridShape = getGridShapeForLayoutVariant(
      this.activeLayout.layoutVariant,
      this.activeLayout.presetId,
    );

    if (Array.isArray(panes) && panes.length > 0) {
      this.activeLayout.panes = this._mergePanesFromPayload(
        panes,
        this.activeLayout.presetId,
        this.activeLayout.gridShape,
      );
    }

    this.activeLayout.gridTracks = this._normalizeGridTracks(
      gridTracks,
      this.activeLayout.gridShape,
    );

    return this.snapshotLayout();
  }

  restoreLayout(persistedLayout) {
    if (!persistedLayout || !Array.isArray(persistedLayout.panes) || persistedLayout.panes.length === 0) {
      return {
        restored: false,
        layout: null,
      };
    }

    this.sessionManager.cleanupAll("layout-restore");

    const presetId = isPresetId(persistedLayout.presetId)
      ? persistedLayout.presetId
      : PRESET_IDS.ONE_BY_TWO;
    const layoutVariant = normalizeLayoutVariant(
      persistedLayout.layoutVariant,
      presetId,
      persistedLayout.gridShape,
    );
    const gridShape = getGridShapeForLayoutVariant(layoutVariant, presetId);
    const panes = this._normalizePersistedPanes(persistedLayout.panes, presetId, gridShape);
    const sessionSnapshotById = new Map();

    for (const session of persistedLayout.sessions || []) {
      if (session?.id) {
        sessionSnapshotById.set(session.id, session);
      }
    }

    for (const pane of panes) {
      if (pane.state !== "visible") {
        pane.sessionId = null;
        continue;
      }

      if (!pane.sessionId) {
        pane.sessionId = this._createSession({}).id;
        continue;
      }

      const snapshot = sessionSnapshotById.get(pane.sessionId);
      if (!snapshot) {
        pane.sessionId = this._createSession({}).id;
        continue;
      }

      try {
        const recovered = this.sessionManager.recoverSession(snapshot);
        pane.sessionId = recovered.id;
      } catch (_error) {
        pane.sessionId = this._createSession({}).id;
      }
    }

    this._materializeVisiblePanes(panes, presetId, gridShape);

    this.activeLayout = {
      presetId,
      panes,
      layoutVariant,
      gridShape,
      gridTracks: this._normalizeGridTracks(persistedLayout.gridTracks, gridShape),
    };

    return {
      restored: true,
      layout: this.snapshotLayout(),
    };
  }

  _createEmptyPanes() {
    return Array.from({ length: this.maxPaneCount }, (_, index) => ({
      id: createId("pane"),
      slotIndex: index,
      positionIndex: index,
      groupId: getGroupIdByPositionIndexForGridShape(
        index,
        getDefaultGridShapeForPreset(this.defaultPresetId),
        this.defaultPresetId,
      ),
      state: "terminated",
      sessionId: null,
    }));
  }

  _killPaneSession(pane, reason) {
    if (!pane || !pane.sessionId) {
      return;
    }

    try {
      this.sessionManager.killSession(pane.sessionId, reason);
    } catch (_error) {
      // Ignore kill failures during transition.
    }
    pane.sessionId = null;
  }

  _createSession(sessionDefaults) {
    return this.sessionManager.createSession(sessionDefaults || {});
  }

  _materializeVisiblePanes(panes, presetId, gridShape = getDefaultGridShapeForPreset(presetId)) {
    const preset = getPresetDefinition(presetId);
    const byPosition = (a, b) => a.positionIndex - b.positionIndex;
    const visible = panes.filter((pane) => pane.state === "visible").sort(byPosition);

    if (visible.length < preset.panelCount) {
      const pickOrder = panes
        .filter((pane) => pane.state !== "visible")
        .sort(sortBySlot);

      for (const pane of pickOrder) {
        if (visible.length >= preset.panelCount) {
          break;
        }
        pane.state = "visible";
        if (!pane.sessionId) {
          pane.sessionId = this._createSession({}).id;
        }
        visible.push(pane);
      }
    }

    if (visible.length > preset.panelCount) {
      const overflow = visible
        .sort(byPosition)
        .slice(preset.panelCount);
      for (const pane of overflow) {
        pane.state = "hidden";
        pane.positionIndex = pane.slotIndex;
        pane.groupId = getGroupIdByPositionIndexForGridShape(pane.positionIndex, gridShape, presetId);
      }
    }

    const finalVisible = panes
      .filter((pane) => pane.state === "visible")
      .sort((a, b) => a.positionIndex - b.positionIndex);

    finalVisible.forEach((pane, index) => {
      pane.positionIndex = index;
      pane.groupId = getGroupIdByPositionIndexForGridShape(index, gridShape, presetId);
    });
  }

  _normalizeGridTracks(gridTracks, gridShape) {
    if (!gridTracks || typeof gridTracks !== "object") {
      return null;
    }

    const columns = normalizeTrackSizes(gridTracks.columns, gridShape?.columns);
    const rows = normalizeTrackSizes(gridTracks.rows, gridShape?.rows);
    if (!columns || !rows) {
      return null;
    }

    return { columns, rows };
  }

  _mergePanesFromPayload(payloadPanes, presetId, gridShape = getDefaultGridShapeForPreset(presetId)) {
    const existingById = new Map(this.activeLayout.panes.map((pane) => [pane.id, pane]));
    const merged = this._normalizePersistedPanes(payloadPanes, presetId, gridShape);

    for (const pane of merged) {
      if (pane.sessionId) {
        continue;
      }
      const existing = existingById.get(pane.id);
      if (existing?.sessionId) {
        pane.sessionId = existing.sessionId;
      }
      if (!pane.groupId || typeof pane.groupId !== "string") {
        pane.groupId = getGroupIdByPositionIndexForGridShape(pane.positionIndex, gridShape, presetId);
      }
    }

    return merged;
  }

  _normalizePersistedPanes(
    panes,
    presetId = this.activeLayout.presetId,
    gridShape = getDefaultGridShapeForPreset(presetId),
  ) {
    const bySlot = new Map();

    panes.forEach((rawPane, index) => {
      const slotIndex = Math.floor(
        asNumber(rawPane?.slotIndex, asNumber(rawPane?.positionIndex, index)),
      );

      if (!Number.isFinite(slotIndex) || slotIndex < 0 || slotIndex >= this.maxPaneCount) {
        return;
      }

      if (bySlot.has(slotIndex)) {
        return;
      }

      const hasValidState = rawPane?.state === "visible" || rawPane?.state === "hidden" || rawPane?.state === "terminated";
      const hasSession = typeof rawPane?.sessionId === "string" && rawPane.sessionId.length > 0;

      const paneState = hasValidState ? rawPane.state : hasSession ? "visible" : "hidden";

      bySlot.set(slotIndex, {
        id: typeof rawPane?.id === "string" && rawPane.id.length > 0 ? rawPane.id : createId("pane"),
        slotIndex,
        positionIndex: Math.max(0, Math.floor(asNumber(rawPane?.positionIndex, slotIndex))),
        groupId:
          typeof rawPane?.groupId === "string" && rawPane.groupId.length > 0
            ? rawPane.groupId
            : getGroupIdByPositionIndexForGridShape(slotIndex, gridShape, presetId),
        state: paneState,
        sessionId: hasSession ? rawPane.sessionId : null,
      });
    });

    for (let slot = 0; slot < this.maxPaneCount; slot += 1) {
      if (!bySlot.has(slot)) {
        bySlot.set(slot, {
          id: createId("pane"),
          slotIndex: slot,
          positionIndex: slot,
          groupId: getGroupIdByPositionIndexForGridShape(slot, gridShape, presetId),
          state: "terminated",
          sessionId: null,
        });
      }
    }

    const normalized = [...bySlot.values()].sort(sortBySlot);
    const preset = getPresetDefinition(presetId);
    const visible = normalized.filter((pane) => pane.state === "visible").sort((a, b) => a.positionIndex - b.positionIndex);

    if (visible.length > preset.panelCount) {
      const overflow = visible.slice(preset.panelCount);
      for (const pane of overflow) {
        pane.state = "hidden";
        pane.positionIndex = pane.slotIndex;
        pane.groupId = getGroupIdByPositionIndexForGridShape(pane.positionIndex, gridShape, presetId);
      }
    }

    const updatedVisible = normalized.filter((pane) => pane.state === "visible").sort((a, b) => a.positionIndex - b.positionIndex);
    updatedVisible.forEach((pane, index) => {
      pane.positionIndex = index;
      pane.groupId = getGroupIdByPositionIndexForGridShape(index, gridShape, presetId);
    });

    return normalized;
  }
}

module.exports = {
  LayoutManager,
};
