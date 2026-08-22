(() => {
  if (window.__aiGatewayClipboardEnabled) return;
  window.__aiGatewayClipboardEnabled = true;

  const nativeAddEventListener = EventTarget.prototype.addEventListener;
  const nativeRemoveEventListener = EventTarget.prototype.removeEventListener;
  const clipboardEvents = new Set([
    "copy",
    "cut",
    "paste",
    "contextmenu",
    "selectstart",
    "dragstart",
    "selectionchange"
  ]);
  const keyboardEvents = new Set(["keydown", "keyup", "keypress"]);
  const clipboardShortcutKeys = new Set(["a", "c", "v", "x"]);
  const wrappedListeners = new WeakMap();

  function isPageRoot(target) {
    return target === window || target === document ||
      target === document.documentElement || target === document.body;
  }

  function isClipboardShortcut(event) {
    if (!event || (!event.ctrlKey && !event.metaKey) || event.altKey) return false;
    return clipboardShortcutKeys.has(String(event.key || "").toLowerCase());
  }

  function wrappedListener(listener) {
    if (!listener || (typeof listener !== "function" && typeof listener.handleEvent !== "function")) return listener;
    if (wrappedListeners.has(listener)) return wrappedListeners.get(listener);
    const wrapped = function (event) {
      if (isClipboardShortcut(event)) return undefined;
      if (typeof listener === "function") return listener.call(this, event);
      return listener.handleEvent.call(listener, event);
    };
    wrappedListeners.set(listener, wrapped);
    return wrapped;
  }

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const eventType = String(type || "").toLowerCase();
    if (isPageRoot(this) && clipboardEvents.has(eventType)) return undefined;
    if (isPageRoot(this) && keyboardEvents.has(eventType)) {
      return nativeAddEventListener.call(this, type, wrappedListener(listener), options);
    }
    return nativeAddEventListener.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const eventType = String(type || "").toLowerCase();
    if (isPageRoot(this) && clipboardEvents.has(eventType)) return undefined;
    const effectiveListener = isPageRoot(this) && keyboardEvents.has(eventType)
      ? wrappedListeners.get(listener) || listener
      : listener;
    return nativeRemoveEventListener.call(this, type, effectiveListener, options);
  };

  function enableSelection() {
    if (!document.getElementById("ai-gateway-nptel-copy-style")) {
      const style = document.createElement("style");
      style.id = "ai-gateway-nptel-copy-style";
      style.textContent = "html, body, main, main * { -webkit-user-select: text !important; user-select: text !important; }";
      (document.head || document.documentElement).appendChild(style);
    }

    for (const target of [window, document, document.documentElement, document.body]) {
      if (!target) continue;
      for (const type of clipboardEvents) {
        if (target[`on${type}`]) target[`on${type}`] = null;
      }
    }
  }

  enableSelection();
  document.addEventListener("DOMContentLoaded", enableSelection, { once: true });
  window.addEventListener("load", enableSelection, { once: true });
  setInterval(enableSelection, 2500);
})();
