/*
 * Keep The Page — third-party widget remover.
 * Content script, document_start, isolated world.
 *
 * Removes in-page engagement/ad furniture that is not part of the article.
 * Unlike popout.js these are not floating, so there is no position:fixed gate —
 * removal is driven by the vendor's own id and class names.
 *
 * **By signature, never by site list.** This ran on euronews.com and
 * independent.co.uk only, from a four-entry `matches` list, while every
 * selector below is a Vuukle name that identifies the widget on any site that
 * embeds it. The list limited where the signature could fire and covered
 * nothing else; it is gone.
 *
 * Euronews ships one Vuukle block 1699px tall:
 *
 *     div.tp-vuukle
 *       div#vuukle-comments-<id>.js-vuukle-container
 *         div#vuukle-quiz-container-<id>        the "Quizzly" quiz
 *           div#vuukle-quiz-<id> > iframe#quiz-iframe-<id>   (cdn.vuukle.com)
 *         div.vuukle-ads  x2                    360px of ads inside the widget
 *
 * Script and quiz iframe both come from cdn.vuukle.com. Blocking that domain
 * is left to Pi-hole; this removes the block from the DOM either way, which
 * also clears the skeleton container that a blocked script leaves behind.
 *
 * Going everywhere splits the block in two. The quiz and the in-widget ads are
 * clutter and always go. The container holding the comments is a **comment
 * section**, so it obeys the one Comments switch and the user's comment
 * exceptions, exactly as comments.js does — on two hand-picked sites that
 * distinction never came up, on the open web it does. comments.js already
 * catches the inner `#vuukle-comments-<id>` by signature (`comments` as a word
 * of its own); this pair is the vendor's outer wrapping, which names no
 * comment word and would otherwise be left standing as an empty block.
 */
(() => {
  'use strict';

  const TAG = '[keep-the-page/clutter]';

  /* Vuukle's own names. Neither is ever article content, so neither waits. */
  const CLUTTER = [
    '.vuukle-ads',
    '[id^="vuukle-quiz-container"]'
  ];

  /* The comment block's wrapping. Removed only when comment removal is on for
   * this page. */
  const COMMENTS = [
    '.tp-vuukle',
    '.js-vuukle-container'
  ];

  /* The user's URL exceptions (Settings -> Comments), matched by except.js,
   * which the manifest loads first. Missing matcher = no exceptions. */
  const urlExcepted = self.ktpUrlExcepted || (() => false);

  const KEY = 'widgets';
  const EXCEPT = 'commentExceptions';
  let widgets = {};
  let except = [];

  /* Unlike comments.js, which hides and can un-hide, this removes — so it must
   * not act before it knows whether the page is excepted. `ready` stays false
   * until storage answers, and stays false forever if storage is unreachable:
   * for a removal that cannot be undone, the safe direction is to leave the
   * page alone. The clutter half does not wait, having no setting to obey. */
  let ready = false;

  const commentsOn = () =>
    ready &&
    widgets.comments !== false &&
    !urlExcepted(location.hostname, location.pathname, except);

  /* Every change made to the page is recorded with its undo, so a settings
   * change can give the page back without a reload: undo everything, then
   * sweep again under the new settings. A removed node goes back only where
   * it came from -- its parent still in the page, the sibling it sat before
   * still beside it -- so a region the site has re-rendered since is left as
   * the site made it, never doubled. The same function is in social.js,
   * portal.js and clutter.js; a test holds the three copies together. */
  const makeJournal = () => {
    let list = [];
    const push = (undo) => { list.push(undo); };
    const detach = (node) => {
      const parent = node.parentNode;
      const next = node.nextSibling;
      node.remove();
      push(() => {
        if (!parent || !parent.isConnected || node.isConnected) return;
        if (next && next.parentNode !== parent) return;
        parent.insertBefore(node, next);
      });
    };
    const setAttr = (el, name, value) => {
      const had = el.hasAttribute(name);
      const old = el.getAttribute(name);
      push(() => { if (had) el.setAttribute(name, old); else el.removeAttribute(name); });
      if (value === null) el.removeAttribute(name); else el.setAttribute(name, value);
    };
    const undoAll = () => {
      const l = list;
      list = [];
      for (let i = l.length - 1; i >= 0; i--) {
        try { l[i](); } catch (e) { /* the node has gone */ }
      }
      return l.length;
    };
    return { push, detach, setAttr, undoAll };
  };

  const journal = makeJournal();

  /* `undoable` is the comment half, which has a setting and so must be able
   * to come back when it changes. The clutter half has no switch to obey. */
  const remove = (list, undoable) => {
    for (const sel of list) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of nodes) {
        if (!el.isConnected) continue;
        console.debug(TAG, 'removed', sel, el.id || String(el.className).slice(0, 40));
        if (undoable) journal.detach(el); else el.remove();
      }
    }
  };

  const sweep = () => {
    remove(CLUTTER);
    if (commentsOn()) remove(COMMENTS, true);
  };

  /* Coalesced, because this now observes every page on the web rather than two.
   * A sweep per mutation batch was affordable on euronews; as a global
   * observer it is the same mistake social.js already made and fixed. */
  let queued = false;
  const queueSweep = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; sweep(); }, 200);
  };

  const observer = new MutationObserver(queueSweep);

  const start = () => {
    sweep();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });

  try {
    chrome.storage.sync.get([KEY, EXCEPT], (got) => {
      widgets = (got && got[KEY]) || {};
      except = (got && got[EXCEPT]) || [];
      ready = true;
      sweep();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !(changes[KEY] || changes[EXCEPT])) return;
      if (changes[KEY]) widgets = changes[KEY].newValue || {};
      if (changes[EXCEPT]) except = changes[EXCEPT].newValue || [];
      journal.undoAll();
      sweep();
    });
  } catch (e) { /* no storage: the comment half stays off */ }

  /* `commentsOn()` reads location.pathname on every call, so SPA navigation
   * on or off an excepted path is picked up by the next sweep with no URL
   * bookkeeping of its own. */
  document.addEventListener('DOMContentLoaded', sweep);
  window.addEventListener('load', sweep);
  setInterval(sweep, 2000);
})();
