const {
  PRESET_IDS,
  PRESET_LAYOUT_SPEC,
  PRESET_DEFINITIONS,
  getPresetDefinition,
  getMaxPanelCount,
  isPresetId,
  getGroupIdByPositionIndex,
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
      pane.groupId = getGroupIdByPositionIndex(pane.positionIndex, presetId);
    }

    nextVisible.forEach((pane, index) => {
      pane.state = "visible";
      pane.positionIndex = index;
      pane.groupId = getGroupIdByPositionIndex(index, presetId);
      if (!pane.sessionId) {
        pane.sessionId = this._createSession(sessionDefaults).id;
      }
    });

    this.activeLayout.presetId = presetId;
    this.activeLayout.gridTracks = null;
    return this.snapshotLayout();
  }

  saveLayout(options = {}) {
    const { presetId, panes, gridTracks } = options;
    if (isPresetId(presetId)) {
      this.activeLayout.presetId = presetId;
    }

    if (Array.isArray(panes) && panes.length > 0) {
      this.activeLayout.panes = this._mergePanesFromPayload(panes, this.activeLayout.presetId);
    }

    this.activeLayout.gridTracks = this._normalizeGridTracks(
      gridTracks,
      this.activeLayout.presetId,
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
    const panes = this._normalizePersistedPanes(persistedLayout.panes, presetId);
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

    this._materializeVisiblePanes(panes, presetId);

    this.activeLayout = {
      presetId,
      panes,
      gridTracks: this._normalizeGridTracks(persistedLayout.gridTracks, presetId),
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
      groupId: getGroupIdByPositionIndex(index, this.defaultPresetId),
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

  _materializeVisiblePanes(panes, presetId) {
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
        pane.groupId = getGroupIdByPositionIndex(pane.positionIndex, presetId);
      }
    }

    const finalVisible = panes
      .filter((pane) => pane.state === "visible")
      .sort((a, b) => a.positionIndex - b.positionIndex);

    finalVisible.forEach((pane, index) => {
      pane.positionIndex = index;
      pane.groupId = getGroupIdByPositionIndex(index, presetId);
    });
  }

  _normalizeGridTracks(gridTracks, presetId) {
    if (!gridTracks || typeof gridTracks !== "object") {
      return null;
    }

    const preset = getPresetDefinition(presetId);
    const columns = normalizeTrackSizes(gridTracks.columns, preset.columns);
    const rows = normalizeTrackSizes(gridTracks.rows, preset.rows);
    if (!columns || !rows) {
      return null;
    }

    return { columns, rows };
  }

  _mergePanesFromPayload(payloadPanes, presetId) {
    const existingById = new Map(this.activeLayout.panes.map((pane) => [pane.id, pane]));
    const merged = this._normalizePersistedPanes(payloadPanes, presetId);

    for (const pane of merged) {
      if (pane.sessionId) {
        continue;
      }
      const existing = existingById.get(pane.id);
      if (existing?.sessionId) {
        pane.sessionId = existing.sessionId;
      }
      if (!pane.groupId || typeof pane.groupId !== "string") {
        pane.groupId = getGroupIdByPositionIndex(pane.positionIndex, presetId);
      }
    }

    return merged;
  }

  _normalizePersistedPanes(panes, presetId = this.activeLayout.presetId) {
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
            : getGroupIdByPositionIndex(slotIndex, presetId),
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
          groupId: getGroupIdByPositionIndex(slot, presetId),
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
        pane.groupId = getGroupIdByPositionIndex(pane.positionIndex, presetId);
      }
    }

    const updatedVisible = normalized.filter((pane) => pane.state === "visible").sort((a, b) => a.positionIndex - b.positionIndex);
    updatedVisible.forEach((pane, index) => {
      pane.positionIndex = index;
      pane.groupId = getGroupIdByPositionIndex(index, presetId);
    });

    return normalized;
  }
}

module.exports = {
  LayoutManager,
  PRESET_LAYOUTS: PRESET_DEFINITIONS,
};
