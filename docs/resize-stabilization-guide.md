# PTY + xterm Resize Stabilization Guide

This guide describes the strategy used in `public/terminal-pane.js` to avoid unstable sizing and duplicate `resize` storms.

## Event Pipeline

1. Panel size changes (`ResizeObserver`, `window.resize`, `transitionend`).
2. `scheduleStableFit()` runs with debounce.
3. Fit runs inside `requestAnimationFrame` after layout settles.
4. `FitAddon.fit()` updates terminal `cols/rows`.
5. PTY resize requests (`panel_resize`) are merged and flushed once (trailing debounce).

## Why This Is Stable

- Debounce prevents fit jitter during rapid drag or CSS transition frames.
- `requestAnimationFrame` waits until browser layout is consistent.
- PTY resize uses last-value-wins flush, so only one final resize is sent.
- Duplicate `(cols, rows)` values are skipped.

## Recommended Constants

- `FIT_DEBOUNCE_MS = 40~80`
- `RESIZE_FLUSH_MS = 30~60`

Tune them based on your splitter speed and animation duration.

## Focus and Shortcut Handling

- Panel click (`pointerdown`) focuses xterm immediately.
- Capture-phase `keydown` blocks browser-level shortcuts while terminal is focused:
  - `Ctrl/Cmd + W`
  - `Ctrl/Cmd + Shift + T`
- `attachCustomKeyEventHandler` applies the same suppression at xterm level.

## Integration Checklist

- Keep exactly one xterm instance per panel card.
- Keep exactly one PTY session per panel ID on server.
- Route keyboard input with websocket `panel_input` to `panelManager.writePanel`.
- Route stable size updates with websocket `panel_resize` to `panelManager.resizePanel`.
- Dispose listeners, `ResizeObserver`, timers, and xterm when panel nodes are removed.
