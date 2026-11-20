/**
 * Content side of the Reddit Glance button.
 *
 * Injects one button per post into the action row, immediately to the right
 * of the vote pill. Clicking it asks the parent actor to open the post
 * permalink in Glance.
 *
 * Current Reddit renders the row inside nested shadow roots: the vote pill
 * lives in a closed root on `rpl-action-bar` (unreachable from page JS),
 * and the row proper is slotted into the bar's row region through the
 * light-DOM `div[slot="overflow-menu-bar"]` on the post. The button is
 * inserted as that div's first child, so it renders before the row — next
 * to the vote pill — and is cloned from the repost button so it inherits
 * Reddit's rpl-cab styling in both themes. Fallbacks for degraded SSR:
 * the row host's "whitespace" slot, then before the repost button.
 */

const EYE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="20" height="20" ' +
  'aria-hidden="true" style="flex:none;fill:currentColor">' +
  '<path fill-rule="evenodd" d="M8 2.9C4.4 2.9 1.6 5.3.7 8c.9 2.7 3.7 5.1 7.3 5.1s6.4-2.4 7.3-5.1C15.3 5.3 12.5 2.9 8 2.9zm0 8.2a3.1 3.1 0 1 1 0-6.2 3.1 3.1 0 0 1 0 6.2zm0-1.7a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z"/></svg>';

/**
 * Find where the button goes, what to clone for styling, and which
 * element must be its direct parent. A button found elsewhere in the post
 * is a stale remnant of an earlier anchor and gets removed before
 * re-injection.
 *
 * @returns {{before: Element, template: Element, scope: Element,
 *            slot: string|null}|null}
 */
function findRowParts(post) {
  const template = post.querySelector(
    'button[data-post-click-location="repost-button"]'
  );
  if (!template) {
    return null;
  }
  // The row renders inside this light-DOM div, slotted through the post's
  // root into rpl-action-bar's row region, right of the vote pill.
  const div = post.querySelector('div[slot="overflow-menu-bar"]');
  const first = div?.firstElementChild;
  if (div && first) {
    // The row host is block-level; without this the pill renders on its
    // own line above the row. One centered flex line lays them out flat.
    div.style.display = "flex";
    div.style.alignItems = "center";
    return { before: first, template, scope: div, slot: null };
  }
  const host = post.querySelector("unpacking-overflow-menu");
  const loader = host?.querySelector(":scope > faceplate-loader");
  const before = loader || template;
  const scope = host || before.parentElement || post;
  // Inside the upgraded row host only slotted children render.
  const slot = loader && host?.shadowRoot?.querySelector('slot[name="whitespace"]')
    ? "whitespace"
    : null;
  return { before, template, scope, slot };
}

export class GlanceButtonChild extends JSWindowActorChild {
  #started = false;
  #scanTimer = 0;
  #observedRoots = new WeakSet();

  handleEvent() {
    this.#start();
  }

  #start() {
    if (this.#started) {
      return;
    }
    const doc = this.document;
    const win = this.contentWindow;
    if (!doc || !win || doc.readyState === "loading") {
      return;
    }
    if (!/(^|\.)reddit\.com$|(^|\.)redd\.it$/.test(doc.location?.hostname || "")) {
      return;
    }
    this.#started = true;

    this.#scan(doc);
    // Reddit is an SPA: posts arrive via infinite scroll and client-side
    // navigation. Re-scan (debounced) whenever the DOM changes.
    const observer = new win.MutationObserver(() => {
      win.clearTimeout(this.#scanTimer);
      this.#scanTimer = win.setTimeout(() => this.#scan(doc), 200);
    });
    observer.observe(doc.body || doc.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  #scan(doc) {
    const win = this.contentWindow;
    for (const post of doc.querySelectorAll("shreddit-post")) {
      const parts = findRowParts(post);
      if (!parts) {
        continue;
      }
      // Shadow-root re-renders (Lit hydration, state changes) don't
      // propagate to the light-DOM observer; watch the roots that hold
      // the row so a wiped button gets re-injected.
      if (win && post.shadowRoot) {
        this.#observeRoot(win, post.shadowRoot);
      }
      if (win && parts.scope instanceof win.ShadowRoot) {
        this.#observeRoot(win, parts.scope);
      }
      // Remove stale buttons from earlier anchors (before hydration
      // finished, or from re-renders); they render 0x0 or misplaced.
      for (const stale of post.querySelectorAll("[data-glance-button]")) {
        if (stale.parentElement !== parts.scope) {
          stale.remove();
        }
      }
      const existing = parts.scope.querySelector(":scope > [data-glance-button]");
      if (existing) {
        // A button injected before the host upgraded keeps rendering
        // 0x0 afterwards; re-point its slot rather than skip.
        if (parts.slot) {
          if (existing.getAttribute("slot") !== parts.slot) {
            existing.setAttribute("slot", parts.slot);
          }
        } else if (existing.hasAttribute("slot")) {
          existing.removeAttribute("slot");
        }
        continue;
      }
      this.#inject(post, doc, parts);

    }
  }

  #observeRoot(win, root) {
    if (this.#observedRoots.has(root)) {
      return;
    }
    this.#observedRoots.add(root);
    const doc = this.document;
    new win.MutationObserver(() => {
      win.clearTimeout(this.#scanTimer);
      this.#scanTimer = win.setTimeout(() => this.#scan(doc), 200);
    }).observe(root, { childList: true, subtree: true });
  }

  #inject(post, doc, { before, template, slot }) {
    const parent = before.parentElement;
    if (!parent) {
      return;
    }

    // Clone the repost button so we inherit the exact rpl-cab styling.
    const btn = template.cloneNode(true);
    for (const attr of [
      "id",
      "name",
      "data-testid",
      "disabled",
      "hidden",
      "slot",
      "aria-expanded",
      "aria-haspopup",
      "aria-pressed",
      "actioned",
      "upvote",
      "downvote",
      "data-action-bar-action",
      "data-post-click-location",
      "data-post-click-text",
      "part",
    ]) {
      btn.removeAttribute(attr);
    }
    btn.type = "button";
    btn.setAttribute("aria-label", "Open in Glance");
    btn.setAttribute("title", "Open in Glance");
    btn.dataset.glanceButton = "1";
    if (slot) {
      btn.setAttribute("slot", slot);
    }
    btn.innerHTML = EYE_SVG;
    // The row region is a centered flex line; keep Reddit's 2xs gap.
    btn.style.marginInlineEnd = "4px";

    btn.addEventListener(
      "click",
      (event) => {
        // Keep Reddit's own delegated handlers from seeing this click.
        event.preventDefault();
        event.stopPropagation();
        const url = this.#postUrl(post, doc);
        if (!url) {
          return;
        }
        const rect = btn.getBoundingClientRect();
        this.sendAsyncMessage("GlanceButton:Open", {
          url,
          clientX: rect.left,
          clientY: rect.top,
          width: rect.width,
          height: rect.height,
        });
      },
      true
    );

    parent.insertBefore(btn, before);
  }

  #postUrl(post, doc) {
    const raw =
      post.getAttribute("permalink") ||
      post.getAttribute("content-href") ||
      post
        .querySelector('a[slot="title"], a[data-testid="post-title"], a[href*="/comments/"]')
        ?.getAttribute("href");
    if (!raw) {
      return null;
    }
    try {
      const url = new this.contentWindow.URL(raw, doc.location.href);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return null;
      }
      return url.href;
    } catch {
      return null;
    }
  }
}
