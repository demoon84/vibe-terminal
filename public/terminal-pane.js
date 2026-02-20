import { Terminal } from "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/+esm";
import { FitAddon } from "https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/+esm";

const FIT_DEBOUNCE_MS = 50;
const RESIZE_FLUSH_MS = 40;
const TERMINAL_SCROLLBACK = 20000;
const CTRL_C_CONFIRM_WINDOW_MS = 1200;

function shouldBlockShortcut(event) {
  const key = String(event.key || "").toLowerCase();
  const ctrlOrCmd = event.ctrlKey || event.metaKey;
  const closeTab = ctrlOrCmd && !event.altKey && key === "w";
  const reopenTab = ctrlOrCmd && event.shiftKey && key === "t";
  return closeTab || reopenTab;
}

function isCopyShortcut(event) {
  const key = String(event.key || "").toLowerCase();
  const ctrlOrCmd = event.ctrlKey || event.metaKey;
  return ctrlOrCmd && !event.shiftKey && !event.altKey && key === "c";
}

function isCopyInsertShortcut(event) {
  const key = String(event.key || "").toLowerCase();
  return event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && key === "insert";
}

function isPasteShortcut(event) {
  const key = String(event.key || "").toLowerCase();
  const ctrlOrCmd = event.ctrlKey || event.metaKey;
  const primaryPaste = ctrlOrCmd && !event.shiftKey && !event.altKey && key === "v";
  const shiftInsert =
    !event.ctrlKey && !event.metaKey && event.shiftKey && !event.altKey && key === "insert";
  return primaryPaste || shiftInsert;
}

function isSoftLineBreakShortcut(event) {
  const key = String(event.key || "").toLowerCase();
  return event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && key === "enter";
}

function isImeCompositionEvent(event) {
  if (!event) {
    return false;
  }

  if (event.isComposing) {
    return true;
  }

  const key = String(event.key || "").toLowerCase();
  const code = Number(event.keyCode);
  return key === "process" || key === "hangulmode" || key === "junjamode" || code === 229;
}

function getTerminalMouseTrackingMode(terminal) {
  const mode = String(terminal?.modes?.mouseTrackingMode || "none").trim().toLowerCase();
  return mode || "none";
}

function hasTerminalScrollbackHistory(terminal) {
  const baseY = Number(terminal?.buffer?.active?.baseY);
  return Number.isFinite(baseY) && baseY > 0;
}

function shouldConsumeWheelWithoutInputForwarding(terminal) {
  if (getTerminalMouseTrackingMode(terminal) !== "none") {
    return false;
  }

  const activeBufferType = String(terminal?.buffer?.active?.type || "normal").toLowerCase();
  const scrollback = Number(terminal?.options?.scrollback);
  const scrollbackEnabled = Number.isFinite(scrollback) ? scrollback > 0 : true;
  const hasScrollbackCapability =
    activeBufferType !== "alternate"
    && scrollbackEnabled
    && hasTerminalScrollbackHistory(terminal);
  return !hasScrollbackCapability;
}

function handleTerminalWheelScroll(event, pane) {
  const terminal = pane?.terminal;
  if (!event || !terminal) {
    return true;
  }

  if (shouldConsumeWheelWithoutInputForwarding(terminal)) {
    event.preventDefault();
    return false;
  }
  return true;
}

function handleTerminalHostWheelCapture(event, pane) {
  const handled = handleTerminalWheelScroll(event, pane);
  if (handled === false) {
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }
  return handled;
}

export class TerminalPane {
  constructor({ panelId, host, sendMessage, onFocusChange }) {
    this.panelId = panelId;
    this.host = host;
    this.sendMessage = sendMessage;
    this.onFocusChange = onFocusChange;

    this.fitDebounceTimer = null;
    this.fitRaf = null;
    this.resizeFlushTimer = null;

    this.pendingResize = null;
    this.lastSentResize = null;
    this.lastBuffer = "";
    this.isFocused = false;
    this.pendingSigintExpiresAt = 0;
    this.pendingSigintTimer = null;

    this.terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: false,
      fontFamily: '"D2Coding", "Cascadia Mono", "Consolas", "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      rescaleOverlappingGlyphs: false,
      scrollback: TERMINAL_SCROLLBACK,
      theme: {
        background: "#050d18",
        selectionBackground: "rgba(127, 178, 255, 0.32)",
        selectionInactiveBackground: "rgba(127, 178, 255, 0.32)",
        overviewRulerBorder: "#050d18",
      },
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.host);

    this.onPanelPointerDown = () => {
      this.focus();
    };

    this.onTransitionEnd = () => {
      this.scheduleStableFit();
    };

    this.onWindowResize = () => {
      this.scheduleStableFit();
    };

    this.onWindowKeyDown = (event) => {
      if (!this.isFocused || !shouldBlockShortcut(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleStableFit();
    });

    this.terminal.attachCustomKeyEventHandler((event) => {
      if (isImeCompositionEvent(event)) {
        return true;
      }

      if (this.isFocused && shouldBlockShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        return false;
      }

      if (event.type === "keydown" && (isCopyShortcut(event) || isCopyInsertShortcut(event))) {
        event.preventDefault();
        event.stopPropagation();

        if (this.copySelectionToClipboard()) {
          this.clearPendingSigint();
          return false;
        }

        const canSendSigint = this.pendingSigintExpiresAt > Date.now();
        if (canSendSigint) {
          this.sendMessage({
            type: "panel_input",
            panelId: this.panelId,
            data: "\u0003",
          });
          this.clearPendingSigint();
          return false;
        }

        this.armPendingSigint();
        return false;
      }

      if (event.type === "keydown" && isPasteShortcut(event)) {
        this.clearPendingSigint();
        event.preventDefault();
        event.stopPropagation();

        if (navigator.clipboard?.readText) {
          navigator.clipboard
            .readText()
            .then((text) => {
              if (!text) {
                return;
              }
              this.sendMessage({
                type: "panel_input",
                panelId: this.panelId,
                data: text,
              });
            })
            .catch(() => {});
        }
        return false;
      }

      if (event.type === "keydown" && isSoftLineBreakShortcut(event)) {
        this.clearPendingSigint();
        event.preventDefault();
        event.stopPropagation();

        if (typeof this.terminal?.paste === "function") {
          this.terminal.paste("\n");
        } else {
          this.sendMessage({
            type: "panel_input",
            panelId: this.panelId,
            data: "\n",
          });
        }
        return false;
      }

      if (
        event.type === "keydown" &&
        this.pendingSigintExpiresAt > 0 &&
        !["control", "meta", "shift", "alt"].includes(String(event.key || "").toLowerCase())
      ) {
        this.clearPendingSigint();
      }

      return true;
    });

    this.terminal.attachCustomWheelEventHandler((event) => handleTerminalWheelScroll(event, this));
    this.onTerminalHostWheelCapture = (event) => handleTerminalHostWheelCapture(event, this);
    this.host.addEventListener("wheel", this.onTerminalHostWheelCapture, {
      capture: true,
      passive: false,
    });

    this.focusDisposable = this.terminal.onFocus(() => {
      this.isFocused = true;
      if (this.onFocusChange) {
        this.onFocusChange(true);
      }
    });

    this.blurDisposable = this.terminal.onBlur(() => {
      this.isFocused = false;
      if (this.onFocusChange) {
        this.onFocusChange(false);
      }
    });

    this.inputDisposable = this.terminal.onData((data) => {
      this.sendMessage({
        type: "panel_input",
        panelId: this.panelId,
        data,
      });
    });

    this.host.addEventListener("pointerdown", this.onPanelPointerDown);
    this.host.addEventListener("transitionend", this.onTransitionEnd);
    window.addEventListener("resize", this.onWindowResize);
    window.addEventListener("keydown", this.onWindowKeyDown, true);

    this.resizeObserver.observe(this.host);
    this.scheduleStableFit();
  }

  focus() {
    this.terminal.focus();
  }

  queueResize(cols, rows) {
    const safeCols = Math.max(40, Math.floor(cols || 0));
    const safeRows = Math.max(10, Math.floor(rows || 0));

    if (!Number.isFinite(safeCols) || !Number.isFinite(safeRows)) {
      return;
    }

    this.pendingResize = { cols: safeCols, rows: safeRows };

    if (this.resizeFlushTimer !== null) {
      window.clearTimeout(this.resizeFlushTimer);
    }

    this.resizeFlushTimer = window.setTimeout(() => {
      this.resizeFlushTimer = null;
      this.flushResize();
    }, RESIZE_FLUSH_MS);
  }

  flushResize() {
    if (!this.pendingResize) {
      return;
    }

    const next = this.pendingResize;
    this.pendingResize = null;

    if (
      this.lastSentResize &&
      this.lastSentResize.cols === next.cols &&
      this.lastSentResize.rows === next.rows
    ) {
      return;
    }

    this.lastSentResize = next;
    this.sendMessage({
      type: "panel_resize",
      panelId: this.panelId,
      cols: next.cols,
      rows: next.rows,
    });
  }

  fitNow() {
    if (!this.host || this.host.clientWidth === 0 || this.host.clientHeight === 0) {
      return;
    }

    this.fitAddon.fit();
    this.queueResize(this.terminal.cols, this.terminal.rows);
  }

  scheduleStableFit() {
    if (this.fitDebounceTimer !== null) {
      window.clearTimeout(this.fitDebounceTimer);
    }

    if (this.fitRaf !== null) {
      window.cancelAnimationFrame(this.fitRaf);
    }

    this.fitDebounceTimer = window.setTimeout(() => {
      this.fitDebounceTimer = null;
      this.fitRaf = window.requestAnimationFrame(() => {
        this.fitRaf = null;
        this.fitNow();
      });
    }, FIT_DEBOUNCE_MS);
  }

  copySelectionToClipboard() {
    if (!this.terminal.hasSelection()) {
      return false;
    }

    const selectedText = this.terminal.getSelection();
    if (!selectedText) {
      return false;
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(selectedText).catch(() => {});
      return true;
    }

    return false;
  }

  clearPendingSigint() {
    if (this.pendingSigintTimer !== null) {
      window.clearTimeout(this.pendingSigintTimer);
      this.pendingSigintTimer = null;
    }
    this.pendingSigintExpiresAt = 0;
  }

  armPendingSigint() {
    this.clearPendingSigint();
    this.pendingSigintExpiresAt = Date.now() + CTRL_C_CONFIRM_WINDOW_MS;
    this.pendingSigintTimer = window.setTimeout(() => {
      this.pendingSigintTimer = null;
      this.pendingSigintExpiresAt = 0;
    }, CTRL_C_CONFIRM_WINDOW_MS);
  }

  writePreservingViewport(chunk) {
    const text = String(chunk || "");
    if (!text) {
      return;
    }

    const activeBuffer = this.terminal.buffer?.active;
    const viewportY = activeBuffer?.viewportY;
    const baseY = activeBuffer?.baseY;
    const keepViewport =
      typeof viewportY === "number" && typeof baseY === "number" && viewportY < baseY
        ? viewportY
        : null;

    this.terminal.write(text, () => {
      if (keepViewport === null) {
        return;
      }

      const nextBaseY = this.terminal.buffer?.active?.baseY;
      const targetLine =
        typeof nextBaseY === "number"
          ? Math.max(0, Math.min(keepViewport, nextBaseY))
          : Math.max(0, keepViewport);
      this.terminal.scrollToLine(targetLine);
    });
  }

  appendChunk(chunk, fullBuffer) {
    if (chunk) {
      this.writePreservingViewport(chunk);
    }

    if (typeof fullBuffer === "string") {
      this.lastBuffer = fullBuffer;
      return;
    }

    if (chunk) {
      this.lastBuffer += chunk;
    }
  }

  syncBuffer(nextBuffer) {
    const target = String(nextBuffer || "");
    if (target === this.lastBuffer) {
      return;
    }

    if (target.startsWith(this.lastBuffer)) {
      const delta = target.slice(this.lastBuffer.length);
      if (delta) {
        this.writePreservingViewport(delta);
      }
      this.lastBuffer = target;
      return;
    }

    this.terminal.reset();
    if (target) {
      this.writePreservingViewport(target);
    }
    this.lastBuffer = target;
  }

  dispose() {
    if (typeof this.onTerminalHostWheelCapture === "function") {
      this.host.removeEventListener("wheel", this.onTerminalHostWheelCapture, true);
    }
    this.host.removeEventListener("pointerdown", this.onPanelPointerDown);
    this.host.removeEventListener("transitionend", this.onTransitionEnd);
    window.removeEventListener("resize", this.onWindowResize);
    window.removeEventListener("keydown", this.onWindowKeyDown, true);

    this.resizeObserver.disconnect();

    if (this.focusDisposable) {
      this.focusDisposable.dispose();
    }
    if (this.blurDisposable) {
      this.blurDisposable.dispose();
    }
    if (this.inputDisposable) {
      this.inputDisposable.dispose();
    }

    if (this.fitDebounceTimer !== null) {
      window.clearTimeout(this.fitDebounceTimer);
      this.fitDebounceTimer = null;
    }

    if (this.fitRaf !== null) {
      window.cancelAnimationFrame(this.fitRaf);
      this.fitRaf = null;
    }

    if (this.resizeFlushTimer !== null) {
      window.clearTimeout(this.resizeFlushTimer);
      this.resizeFlushTimer = null;
    }

    this.clearPendingSigint();

    this.terminal.dispose();
  }
}
