// Glance Button
// A Sine chrome script (browser.xhtml only). Its only job is to register the
// Reddit content actor once per browser session. The actor injects the
// in-page button and, on click, opens Glance from the parent process via
// gZenGlanceManager.openGlance() — the same call Zen's own
// context-zenOpenLinkInGlance menu item makes.

(function () {
  "use strict";

  if (window.__glanceButtonInit) {
    return;
  }
  window.__glanceButtonInit = true;

  function resolveModRoot() {
    try {
      throw new Error("glance-button-script-url");
    } catch (error) {
      const fileName = error.fileName || error.filename || "";
      const stack = `${fileName}\n${error.stack || ""}`;
      const match = stack.match(/chrome:\/\/sine\/content\/[^\s:)]+/);
      if (match) {
        const url = match[0].split(/[?#]/)[0];
        return url.replace(/\/[^/]+$/, "");
      }
    }
    return "chrome://sine/content/glance-button";
  }

  function startup() {
    try {
      const modRoot = resolveModRoot();
      const module = ChromeUtils.importESModule(
        `${modRoot}/actors/GlanceButtonParent.sys.mjs`
      );
      module.ensureGlanceButtonActor(modRoot);
    } catch (error) {
      console.error("[Glance Button] Could not register the Reddit actor:", error);
    }
  }

  if (document.readyState === "complete") {
    startup();
  } else {
    window.addEventListener("load", startup, { once: true });
  }
})();
