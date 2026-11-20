/**
 * Content side of the Reddit Glance button.
 *
 * Injects one button per post into the action row, immediately before the
 * repost button. Clicking it asks the parent actor to open the post
 * permalink in Glance.
 *
 * Current Reddit renders row actions as open light-DOM `rpl-cab` buttons
 * identified by data-post-click-location ("repost-button", ...). The votes
 * themselves live in closed shadow roots, so the repost button — the first
 * open-DOM row anchor — is used instead. The button is cloned from the
 * repost button, so it inherits Reddit's current padding, radius, and hover
 * styling in both themes.
 */

const EYE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="20" height="20" ' +
  'aria-hidden="true" style="flex:none;fill:currentColor">' +
  '<path fill-rule="evenodd" d="M8 2.9C4.4 2.9 1.6 5.3.7 8c.9 2.7 3.7 5.1 7.3 5.1s6.4-2.4 7.3-5.1C15.3 5.3 12.5 2.9 8 2.9zm0 8.2a3.1 3.1 0 1 1 0-6.2 3.1 3.1 0 0 1 0 6.2zm0-1.7a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z"/></svg>';

function findRowAnchor(post) {
  return post.querySelector('button[data-post-click-location="repost-button"]');
}

export class GlanceButtonChild extends JSWindowActorChild {
  #started = false;
  #scanTimer = 0;

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
    for (const post of doc.querySelectorAll("shreddit-post")) {
      if (post.querySelector("[data-glance-button]")) {
        continue;
      }
      const anchor = findRowAnchor(post);
      if (anchor) {
        this.#inject(post, doc, anchor);
      }
    }
  }

  #inject(post, doc, anchor) {
    const parent = anchor.parentElement;
    if (!parent) {
      return;
    }

    // Clone the anchor so we inherit the exact rpl-cab styling.
    const btn = anchor.cloneNode(true);
    for (const attr of [
      "id",
      "name",
      "data-testid",
      "disabled",
      "hidden",
      "slot",
      "aria-expanded",
      "aria-haspopup",
      "actioned",
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
    btn.innerHTML = EYE_SVG;

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

    parent.insertBefore(btn, anchor);
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
