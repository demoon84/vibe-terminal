function createTrustedRendererGuard({ getMainWindow }) {
  return function isTrustedRendererEvent(event) {
    const sender = event?.sender;
    if (!sender || sender.isDestroyed()) {
      return false;
    }

    const window = getMainWindow?.();
    if (!window || window.isDestroyed()) {
      return false;
    }

    if (sender.id !== window.webContents.id) {
      return false;
    }

    const currentUrl = String(sender.getURL?.() || event?.senderFrame?.url || "");
    return currentUrl.startsWith("file://");
  };
}

module.exports = {
  createTrustedRendererGuard,
};
