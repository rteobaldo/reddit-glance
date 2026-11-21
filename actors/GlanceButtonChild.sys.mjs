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
 * inserted as that div's first child — next to the vote pill — and
 * mirrors the expand chevron's rpl-cab pill classes in the darker
 * button-secondary variant, matching the vote pill. Fallbacks for degraded
 * SSR: the row host's "whitespace" slot, then before the repost button.
 */

const EYE_SVG =
  '<span class="rpl-cab--leading-icon flex items-center"><span class="flex text-body-1">' +
  '<svg xmlns="http://www.w3.org/2000/svg" rpl="" fill="currentColor" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" style="flex:none">' +
  '<path fill-rule="evenodd" d="M8 2.9C4.4 2.9 1.6 5.3.7 8c.9 2.7 3.7 5.1 7.3 5.1s6.4-2.4 7.3-5.1C15.3 5.3 12.5 2.9 8 2.9zm0 8.2a3.1 3.1 0 1 1 0-6.2 3.1 3.1 0 0 1 0 6.2zm0-1.7a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z"/></svg>' +
  '</span></span>';

/**
 * Find where the button goes and which element must be its direct parent.
 * A button found elsewhere in the post is a stale remnant of an earlier
 * anchor and gets removed before re-injection.
 *
 * @returns {{before: Element, scope: Element, slot: string|null}|null}
 */
function findRowParts(post) {
  // The row renders inside this div, slotted through the post's root into
  // rpl-action-bar's row region, right of the vote pill. Card view keeps
  // the div inside the post's own (open) shadow root; compact view keeps
  // it in the light DOM. Check both.
  const root = post.shadowRoot;
  const div =
    post.querySelector('div[slot="overflow-menu-bar"]') ||
    (root && root.querySelector('div[slot="overflow-menu-bar"]'));
  const first = div?.firstElementChild;
  if (div && first) {
    // The row host is block-level; without this the pill renders on its
    // own line above the row. One centered flex line lays them out flat.
    div.style.display = "flex";
    div.style.alignItems = "center";
    return { before: first, scope: div, slot: null };
  }
  // Card view (logged out) builds the row directly inside rpl-action-bar's
  // light DOM, in the post's shadow root: the vote pill is the first child
  // of div[data-testid="action-row"]. Anchor immediately right of it.
  const cardRow = root?.querySelector(
    'rpl-action-bar div[data-testid="action-row"]'
  );
  const afterVotes = cardRow?.firstElementChild?.nextElementSibling;
  if (cardRow && afterVotes) {
    return { before: afterVotes, scope: cardRow, slot: null };
  }
  const host = post.querySelector("unpacking-overflow-menu");
  const loader = host?.querySelector(":scope > faceplate-loader");
  if (loader && host?.shadowRoot?.querySelector('slot[name="whitespace"]')) {
    // Inside the upgraded row host only slotted children render;
    // "whitespace" is its leftmost slot, next to the vote pill.
    return { before: loader, scope: host, slot: "whitespace" };
  }
  const repost = post.querySelector(
    'button[data-post-click-location="repost-button"]'
  );
  if (repost) {
    // Degraded SSR: the row host has not rendered yet.
    return { before: repost, scope: repost.parentElement || post, slot: null };
  }
  return null;
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

    // Reddit's card-level delegation sees clicks anywhere in the post and
    // navigates to the permalink before a button-level listener could stop
    // it. One capture-phase listener on the document intercepts clicks on
    // any Glance button — the earliest propagation point — so no per-button
    // listeners accumulate across re-injections and infinite scroll.
    doc.addEventListener(
      "click",
      (event) => {
        // The button may live inside the post's shadow root (card view):
        // event.target is retargeted to the host at the boundary, so match
        // against the composed path, then walk out via the shadow host.
        const path = event.composedPath?.() ?? [];
        const btn = path.find((node) => node?.closest?.("[data-glance-button]"))
          ?.closest("[data-glance-button]");
        if (!btn) {
          return;
        }
        // No instanceof: page nodes live in another compartment, so
        // instanceof checks against this module's globals are always
        // false. A ShadowRoot is identified by its host property instead.
        const post =
          btn.closest("shreddit-post") ?? btn.getRootNode?.()?.host ?? null;
        if (!post?.matches?.("shreddit-post")) {
          return;
        }
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
      for (const staleRoot of [post, post.shadowRoot]) {
        if (!staleRoot) {
          continue;
        }
        for (const stale of staleRoot.querySelectorAll("[data-glance-button]")) {
          if (stale.parentElement !== parts.scope) {
            stale.remove();
          }
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
      this.#inject(doc, parts);
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

  #inject(doc, { before, slot }) {
    const parent = before.parentElement;
    if (!parent) {
      return;
    }

    // Mirror the expand chevron button's rpl-cab pill classes with the
    // button-secondary variant — the same darker background the vote pill
    // group uses — so the button matches the vote control's look; the
    // vote pill's own DOM sits in a closed shadow root we cannot clone.
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.setAttribute("rpl", "");
    btn.className =
      "button rpl-cab border-sm flex flex-row justify-center items-center " +
      "h-xl font-semibold relative text-label-2 button-secondary " +
      "inline-flex items-center px-sm py-xs";
    btn.style.height = "var(--size-button-sm-h)";

    btn.setAttribute("aria-label", "Open in Glance");
    btn.setAttribute("title", "Open in Glance");
    btn.dataset.glanceButton = "1";
    if (slot) {
      btn.setAttribute("slot", slot);
    }
    btn.innerHTML = EYE_SVG;
    // The row region is a centered flex line; keep Reddit's 2xs gap.
    btn.style.marginInlineEnd = "4px";

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
