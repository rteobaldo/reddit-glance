/**
 * Parent side of the Reddit Glance button.
 *
 * The content actor injects a button into each post's action row and sends
 * GlanceButton:Open when it is clicked. Opening Glance is a chrome-side
 * operation, so it happens here: gZenGlanceManager.openGlance(), the same
 * call Zen's own "Open Link in Glance" context menu item makes.
 */

let actorRegistered = false;

/**
 * Register the content actor once per browser session.
 * `modRoot` is chrome://sine/content/<installed-folder>.
 *
 * @param {string} modRoot
 * @returns {boolean} True when the actor is registered (or already was).
 */
export function ensureGlanceButtonActor(modRoot) {
  if (actorRegistered) {
    return true;
  }

  try {
    ChromeUtils.registerWindowActor("GlanceButton", {
      parent: {
        esModuleURI: `${modRoot}/actors/GlanceButtonParent.sys.mjs`,
      },
      child: {
        esModuleURI: `${modRoot}/actors/GlanceButtonChild.sys.mjs`,
        events: {
          // Spawn on load, and again on SPA navigations / first interaction
          // so tabs that were already open when the mod loaded get covered.
          DOMContentLoaded: {},
          pageshow: {},
          mouseover: { capture: true },
        },
      },
      allFrames: false,
      matches: [
        "*://reddit.com/*",
        "*://*.reddit.com/*",
        "*://redd.it/*",
        "*://*.redd.it/*",
      ],
      messageManagerGroups: ["browsers"],
      safeForUntrustedWebProcess: true,
    });
    actorRegistered = true;
  } catch (error) {
    const message = String(error?.message || error);
    if (/already registered|already exists/i.test(message)) {
      actorRegistered = true;
    } else {
      console.warn("[Reddit Glance Button] Could not register the Reddit actor:", error);
    }
  }

  return actorRegistered;
}

export class GlanceButtonParent extends JSWindowActorParent {
  receiveMessage(message) {
    if (message?.name !== "GlanceButton:Open") {
      return;
    }

    const win = this.browsingContext?.topChromeWindow;
    if (!win) {
      return;
    }

    // Only accept opens from Reddit pages, and only web URLs.
    const senderHost = this.browsingContext.currentURI?.host || "";
    if (!/(^|\.)reddit\.com$|(^|\.)redd\.it$/.test(senderHost)) {
      return;
    }
    let url;
    try {
      url = new win.URL(message.data?.url);
    } catch {
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return;
    }

    if (!Services.prefs.getBoolPref("zen.glance.enabled", true)) {
      return;
    }

    const manager = win.gZenGlanceManager;
    if (!manager || typeof manager.openGlance !== "function") {
      console.warn("[Reddit Glance Button] gZenGlanceManager.openGlance is not available.");
      return;
    }

    const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);
    // Rect is in content coordinates, which is the space openGlance uses
    // for its open animation. triggeringPrincipal is required by current
    // Zen; older builds ignore it.
    manager.openGlance({
      url: url.href,
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      clientX: num(message.data?.clientX, 0),
      clientY: num(message.data?.clientY, 0),
      width: num(message.data?.width, 32) || 32,
      height: num(message.data?.height, 32) || 32,
    });
  }
}
