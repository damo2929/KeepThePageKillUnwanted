/*
 * Keep The Page — comment section removal.
 * Content script, ISOLATED world, document_start, all sites, top frame.
 *
 * Asked for by the user ("kill comments"), by signature, never by hostname.
 *
 * The signature is the element's own naming. id and class strings are split
 * into words -- on punctuation and on camelCase, as social.js does for share
 * rows -- and matched word by word:
 *
 *   comments | disqus               on its own     comments-section, post-comments,
 *                                                  commentsContainer, disqus_thread
 *   comment  + a structural word    section, area, list, thread, form, count, ...
 *                                                  comment-count, commentList
 *
 * A control that carries no such name is read by its accessible name
 * instead -- aria-label or title -- and only when it has no words of its own.
 * That is the whole signature on YouTube's Shorts rail. A label is the page's
 * own language, so that half reaches an English UI only -- the id and class
 * rules above do not care, and still do most of the work.
 *
 * Seen on real pages: ign.com (section#comments.comments-section,
 * .comment-count on every related card, a "271 comments" link to #comments),
 * petapixel.com (div#comments.post-comments, the Disqus mount).
 *
 * The guards matter more than the words. WordPress puts `comments-open` on
 * <body>, so a word match alone would hide every WordPress site. Never
 * html/body/main/article, and never anything that contains the page's <h1>,
 * <main> or <article> -- a comment section sits beside the article, not
 * around it.
 *
 * IGN's comments are first-party (mollusk.apis.ign.com/graphql, the same
 * endpoint as the rest of the site), so unlike Disqus they cannot be blocked
 * at the network. This hides; the comment data is still fetched.
 */
(() => {
  'use strict';

  const KEY = 'widgets';
  const EARLY = 'ktp-comments-css';
  const MARK = 'data-ktp-comments';

  /* ---- trace --------------------------------------------------------------
   * Channel `widgets`, shared with social.js and newsletter.js. Off by
   * default, and silent when off, like every other channel.
   *
   * Read straight from storage, not through bridge.js's <html> attribute.
   * That attribute exists because walls.js and guard.js run in the MAIN world
   * and cannot reach chrome.storage; this script can, it is already reading
   * two keys, and one fewer moving part means the trace cannot go quiet
   * merely because bridge.js has not run. It also keeps the "nothing on the
   * page unless you asked for it" property without needing the attribute.
   *
   * What it is for is the one question a clean page cannot answer: whether
   * this module was on for the page at all. An extension with nothing to do
   * looks exactly like one that worked. So apply() logs on or off, and names
   * which of the two reasons it was off for, every time it runs. */
  const TAG = '[keep-the-page/comments]';
  const TRACE = 'trace';
  const CHANNEL = 'widgets';
  let tracing = false;
  const traceOn = (t) => !!(t && t.enabled && Array.isArray(t.channels) &&
    (t.channels.indexOf(CHANNEL) !== -1 || t.channels.indexOf('all') !== -1));
  const log = (...a) => {
    if (tracing) console.debug(TAG, Math.round(performance.now()) + 'ms', ...a);
  };

  /* Installed at document_start, before any sweep can run, so the commonest
   * mounts never paint. The sweep below finds the rest. */
  const SELECTORS = [
    '#comments',
    '.comments-section',
    '#disqus_thread',
    '.comment-count',
    'a[href$="#comments"]'
  ];
  const CSS = SELECTORS.join(',') + ',[' + MARK + ']{display:none!important}';

  const COMMENT_WORD = /^(comments|disqus)$/;
  const COMMENT_PART = /^(section|sections|area|list|thread|threads|form|container|wrapper|widget|block|box|count|counter|link|links|respond|reply|replies|feed|stream|module)$/;
  const NEVER_TAG = /^(HTML|BODY|HEAD|MAIN|ARTICLE|H1|SCRIPT|STYLE|TEMPLATE)$/;

  const words = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2')
                         .toLowerCase().split(/[^a-z]+/).filter(Boolean);

  /* Pure, so a test pins the rules rather than a page.
   * { tag, id, cls, label, wraps } -> true when this is comment furniture.
   * `wraps` is true when the element contains the page's h1/main/article.
   * `label` is the accessible name, and is supplied for controls only --
   * see controlVerdict below for why it is not read for everything. */
  /* Each class name is judged on its own. Jira renders every comment and the
   * description as `ak-renderer-wrapper is-comment`: pooled, "wrapper" from
   * one class and "comment" from the other made a match, and every ticket
   * lost its text. The pair must come from one name (comment-count,
   * commentList), never from two names that happen to sit together. */
  const commentVerdict = (e) => {
    if (NEVER_TAG.test(String(e.tag || '').toUpperCase()) || e.wraps) return false;
    const names = [String(e.id || ''), String(e.label || '')]
                    .concat(String(e.cls || '').split(/\s+/));
    return names.some((n) => {
      const w = words(n);
      if (w.some((x) => COMMENT_WORD.test(x))) return true;
      return w.indexOf('comment') !== -1 && w.some((x) => COMMENT_PART.test(x));
    });
  };

  /* A control carries its name where a section carries an id. YouTube's
   * Shorts rail is the case that found this: the comment button is
   * <button aria-label="View 750 comments"> with an empty id, and every class
   * on it and on every ancestor up to the overlay is a component-shape name
   * -- ytSpecButtonShapeNextHost,
   * ytwReelActionBarViewModelHostDesktopActionButton -- shared with like,
   * share and remix. The id/class query could never see it, so the panel was
   * hidden while the button that opens it stayed on the rail.
   *
   * Two limits, because a label is a sentence and these word rules are built
   * for names:
   *   controls only   a <section aria-label="Comments"> is the section
   *                   itself, and the naming rules above already have it.
   *   wordless only   a control with words of its own is something else that
   *                   mentions comments -- a feedback form's "Submit
   *                   comments". social.js draws the same line for links: a
   *                   bare icon contributes no words. A count is not words.
   *
   * Deliberately not in the early stylesheet: that matches by selector alone,
   * with none of these guards, which is what hid techpowerup's share bar. */
  const CONTROL = 'a[href],button,[role="button"]';
  const COUNT = /^[\d.,]+\s*[kmb]?$/i;
  const bare = (s) => { const t = String(s || '').trim(); return t === '' || COUNT.test(t); };

  /* Pure, like commentVerdict. { tag, label, text, wraps } -> true when this
   * control is comment furniture. The label goes in as one more name, judged
   * on its own and never pooled with id or class -- the Jira rule. */
  const controlVerdict = (e) => bare(e.text) &&
        commentVerdict({ tag: e.tag, id: '', cls: '', label: e.label, wraps: e.wraps });

  const CONTROL_Q = CONTROL.split(',')
    .map((s) => s + '[aria-label*="omment" i],' + s + '[title*="omment" i]').join(',');

  let on = true;

  /* The page's own content, not every <article>: the HTML spec recommends
   * <article> for each comment, and techpowerup.com does exactly that --
   * section.comments > article.forumpost x25 -- so "contains an article" kept
   * its comment section on screen. What must never be hidden is the h1, a
   * <main>, or the article that holds the h1. */
  const wrapsContent = (el) => {
    try {
      const h1 = document.querySelector('h1');
      if (h1 && el.contains(h1)) return true;
      if (el.querySelector('main')) return true;
      const own = h1 && h1.closest('article');
      return !!(own && el.contains(own));
    } catch (e) { return true; }
  };

  /* A wrapper left holding nothing but a hidden comment section keeps its own
   * height: ign.com's div.bottom-content stayed 636px tall and empty above the
   * footer. So the frame goes too -- at most two levels, only while every
   * child is already hidden and it has no text of its own, and never past the
   * same guards as the section itself. */
  const hidden = (n) => {
    if (n.hasAttribute && n.hasAttribute(MARK)) return true;
    try { return getComputedStyle(n).display === 'none'; } catch (e) { return false; }
  };

  const collapse = (el) => {
    let n = el;
    for (let i = 0; i < 2; i++) {
      const p = n.parentElement;
      if (!p || p === document.body || NEVER_TAG.test(p.tagName) || wrapsContent(p)) return;
      for (const c of p.childNodes) {
        if (c.nodeType === 3 && c.textContent.trim() !== '') return;
        if (c.nodeType === 1 && !hidden(c)) return;
      }
      p.setAttribute(MARK, '');
      log('collapsed', p.tagName + (p.id ? '#' + p.id : ''));
      n = p;
    }
  };

  /* The control is only half the item. YouTube puts the count in a sibling of
   * the button, so marking the button alone left a bare "750" floating where
   * the icon had been -- seen on the rail, not predicted. So the mark widens
   * to the largest wrapper holding this control and nothing else: no second
   * control, and no text of its own beyond a count. Two levels, the ceiling
   * collapse() uses -- here button -> label -> view-model, stopping at the
   * rail that holds like, share and remix. */
  const alone = (p, keep) => {
    for (const c of p.childNodes) {
      if (c === keep) continue;
      if (c.nodeType === 3) { if (!bare(c.textContent)) return false; continue; }
      if (c.nodeType !== 1) continue;
      if (!bare(c.textContent)) return false;
      try { if (c.matches(CONTROL) || c.querySelector(CONTROL)) return false; } catch (e) { return false; }
    }
    return true;
  };

  const widen = (el) => {
    let n = el;
    for (let i = 0; i < 2; i++) {
      const p = n.parentElement;
      if (!p || p === document.body || NEVER_TAG.test(p.tagName) ||
          wrapsContent(p) || !alone(p, n)) return n;
      n = p;
    }
    return n;
  };

  const sweep = () => {
    if (!on || !document.body) return;
    let nodes;
    try { nodes = document.body.querySelectorAll('[id*="omment" i],[class*="omment" i],[id*="disqus" i],[class*="disqus" i]'); }
    catch (e) { return; }
    for (const el of nodes) {
      if (el.hasAttribute(MARK)) continue;
      let cls = el.className;
      if (cls && typeof cls !== 'string') cls = cls.baseVal || '';
      if (!commentVerdict({ tag: el.tagName, id: el.id, cls, wraps: false })) continue;
      if (wrapsContent(el)) continue;
      el.setAttribute(MARK, '');
      log('name', el.tagName + (el.id ? '#' + el.id : ''), String(cls).slice(0, 40));
    }
    /* Controls named only by their accessible name. Its own query: what
     * defines these is that they carry no comment word in id or class. */
    try {
      for (const el of document.body.querySelectorAll(CONTROL_Q)) {
        if (el.hasAttribute(MARK) || el.closest('[' + MARK + ']')) continue;
        const label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        if (!controlVerdict({ tag: el.tagName, text: el.textContent,
                              wraps: wrapsContent(el), label: label })) continue;
        const t = widen(el);
        t.setAttribute(MARK, '');
        log('label', JSON.stringify(label.slice(0, 60)), '->', t.tagName);
      }
    } catch (e) { /* ignore */ }
    /* After marking, so a sibling marked later in the same pass counts. The
     * early stylesheet's targets are included -- #comments is hidden before it
     * is ever marked. */
    try {
      for (const el of document.querySelectorAll('[' + MARK + '],' + SELECTORS.join(','))) {
        if (el.tagName !== 'A' && !el.closest('[' + MARK + '] [' + MARK + ']')) collapse(el);
      }
    } catch (e) { /* ignore */ }
  };

  const install = () => {
    try {
      if (document.getElementById(EARLY)) return;
      const s = document.createElement('style');
      s.id = EARLY;
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* ignore */ }
  };

  const uninstall = () => {
    try { const s = document.getElementById(EARLY); if (s) s.remove(); } catch (e) { /* ignore */ }
    try { for (const el of document.querySelectorAll('[' + MARK + ']')) el.removeAttribute(MARK); } catch (e) { /* ignore */ }
  };

  /* The user's URL exceptions (Settings -> Comments), matched by except.js,
   * which the manifest loads first. Missing matcher = no exceptions. */
  const urlExcepted = self.ktpUrlExcepted || (() => false);

  const EXCEPT = 'commentExceptions';
  let widgets = {};
  let except = [];

  const apply = () => {
    const sw = widgets.comments !== false;
    const ex = urlExcepted(location.hostname, location.pathname, except);
    on = sw && !ex;
    log(on ? 'on' : ('off: ' + (ex ? 'url exception' : 'switch')),
        location.hostname + location.pathname);
    if (on) { install(); sweep(); } else uninstall();
  };

  /* A path exception must follow SPA navigation, which changes the URL with no
   * reload -- including off an excepted path, when `on` is still false. */
  let href = location.href;
  let queued = false;
  const queue = () => {
    if (location.href !== href) { href = location.href; apply(); }
    if (queued || !on) return;
    queued = true;
    setTimeout(() => { queued = false; sweep(); }, 250);
  };

  /* On by default, and installed before storage answers: an install that
   * never opened settings must behave like one where the box is ticked, and
   * waiting for storage would let the section paint first. */
  install();
  try {
    chrome.storage.local.get([KEY, EXCEPT, TRACE], (got) => {
      widgets = (got && got[KEY]) || {};
      except = (got && got[EXCEPT]) || [];
      tracing = traceOn(got && got[TRACE]);
      apply();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(changes[KEY] || changes[EXCEPT] || changes[TRACE])) return;
      if (changes[KEY]) widgets = changes[KEY].newValue || {};
      if (changes[EXCEPT]) except = changes[EXCEPT].newValue || [];
      if (changes[TRACE]) tracing = traceOn(changes[TRACE].newValue);
      apply();
    });
  } catch (e) { /* no storage: keep the default */ }

  try {
    new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* no observer */ }
  document.addEventListener('DOMContentLoaded', sweep);
})();
