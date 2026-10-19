/*
 * Keep The Page — options page.
 *
 * Settings live in chrome.storage.sync, so they follow the Chrome profile to
 * every machine signed into it. The tracing key is
 *
 *     trace: { enabled: <bool>, channels: [<string>, ...] }
 *
 * bridge.js reads it and publishes the enabled channels to the MAIN world.
 * Saving is immediate — there is no Save button, and no state that only exists
 * in this page. The one exception is `errors`, which stays in
 * chrome.storage.local: it is this machine's log, written on every failure,
 * and would run into sync's write-rate limit.
 */
(() => {
  'use strict';

  const KEY = 'trace';
  const DEFAULTS = { enabled: false, channels: ['walls', 'timers', 'consent'] };

  const enabled = document.getElementById('enabled');
  const group = document.getElementById('channels');
  const boxes = [].slice.call(document.querySelectorAll('.ch'));
  const saved = document.getElementById('saved');
  const about = document.getElementById('about');

  let savedTimer = null;
  /* Also the callback for every sync write, so a refused one (sync allows
   * 8 KB per key, which a long exception list can reach) says so instead of
   * flashing "Saved". */
  const flashSaved = () => {
    clearTimeout(savedTimer);
    if (chrome.runtime.lastError) {
      saved.textContent = 'Could not save: ' + chrome.runtime.lastError.message;
      saved.classList.add('on');
      return;
    }
    saved.textContent = 'Saved';
    saved.classList.add('on');
    savedTimer = setTimeout(() => saved.classList.remove('on'), 900);
  };

  const paintDisabled = () => {
    const off = !enabled.checked;
    group.setAttribute('aria-disabled', String(off));
    boxes.forEach((b) => { b.disabled = off; });
  };

  const read = () => ({
    enabled: enabled.checked,
    channels: boxes.filter((b) => b.checked).map((b) => b.value)
  });

  const save = () => {
    paintDisabled();
    chrome.storage.sync.set({ [KEY]: read() }, () => {
      if (chrome.runtime.lastError) {
        saved.textContent = 'Could not save: ' + chrome.runtime.lastError.message;
        saved.classList.add('on');
        return;
      }
      saved.textContent = 'Saved';
      flashSaved();
    });
  };

  /* Every block paints from a stored value through one function, called on
   * load and again by the sync listener at the foot of this file, so a change
   * made on another machine reaches an open page instead of being written
   * back over by its stale checkboxes on the next click. */
  const paint = {};

  paint[KEY] = (t) => {
    t = t || DEFAULTS;
    enabled.checked = !!t.enabled;
    const on = Array.isArray(t.channels) ? t.channels : [];
    boxes.forEach((b) => { b.checked = on.indexOf(b.value) !== -1; });
    paintDisabled();
  };
  chrome.storage.sync.get(KEY, (got) => paint[KEY](got && got[KEY]));

  enabled.addEventListener('change', save);
  boxes.forEach((b) => b.addEventListener('change', save));

  /* ---------- protections ------------------------------------------------
   * Every defence is on unless stored false, so an install that has never
   * opened this page behaves exactly like one where everything is ticked. The
   * Newsquest pin is not here: it runs before any setting can be read. */

  const PROTECT = 'protect';
  const defs = [...document.querySelectorAll('.def')];

  paint[PROTECT] = (p) => {
    p = p || {};
    defs.forEach((d) => { d.checked = p[d.value] !== false; });
  };
  chrome.storage.sync.get(PROTECT, (got) => paint[PROTECT](got && got[PROTECT]));

  defs.forEach((d) => d.addEventListener('change', () => {
    const p = {};
    defs.forEach((x) => { p[x.value] = x.checked; });
    chrome.storage.sync.set({ [PROTECT]: p }, flashSaved);
  }));

  /* ---------- social furniture ------------------------------------------ */

  /* These defaults repeat social.js's, deliberately. The content script must
   * behave identically whether or not this page has ever been opened, so
   * neither side may be the sole owner of them; a unit test pins the two
   * copies together. */
  const SOCIAL = 'social';
  const SOCIAL_DEFAULTS = {
    enabled: true,
    mode: 'remove',
    platforms: { facebook: true, instagram: true, x: true, tiktok: true,
                 linkedin: true, snapchat: true },
    keepLogins: true,
    keepText: false
  };

  const social = document.getElementById('social');
  const socialOpts = document.getElementById('socialopts');
  const plats = [...document.querySelectorAll('.plat')];
  const modes = [...document.querySelectorAll('input[name="mode"]')];
  const keepLogins = document.getElementById('keepLogins');
  const keepText = document.getElementById('keepText');

  const paintSocial = () => {
    socialOpts.setAttribute('aria-disabled', String(!social.checked));
    [...plats, ...modes, keepLogins, keepText].forEach((el) => {
      el.disabled = !social.checked;
    });
  };

  const saveSocial = () => {
    const platforms = {};
    plats.forEach((p) => { platforms[p.value] = p.checked; });
    const mode = (modes.find((m) => m.checked) || {}).value || 'remove';
    chrome.storage.sync.set({
      [SOCIAL]: {
        enabled: social.checked,
        mode,
        platforms,
        keepLogins: keepLogins.checked,
        keepText: keepText.checked
      }
    }, flashSaved);
    paintSocial();
  };

  paint[SOCIAL] = (s) => {
    const v = Object.assign({}, SOCIAL_DEFAULTS, s || {});
    const on = Object.assign({}, SOCIAL_DEFAULTS.platforms, v.platforms || {});
    social.checked = v.enabled !== false;
    plats.forEach((p) => { p.checked = on[p.value] !== false; });
    modes.forEach((m) => { m.checked = m.value === (v.mode || 'remove'); });
    keepLogins.checked = v.keepLogins !== false;
    keepText.checked = v.keepText === true;
    paintSocial();
  };
  chrome.storage.sync.get(SOCIAL, (got) => paint[SOCIAL](got && got[SOCIAL]));

  [social, keepLogins, keepText, ...plats, ...modes]
    .forEach((el) => el.addEventListener('change', saveSocial));

  /* ---------- msn.com and bing.com feeds ---------------------------------- */

  /* Mirrors DEFAULTS in portal.js; a test pins the two together. */
  const MSN = 'portal';
  const MSN_DEFAULTS = { comments: true, cards: true, tabs: true, feed: true };
  const portalComments = document.getElementById('portalComments');
  const portalCards = document.getElementById('portalCards');
  const portalTabs = document.getElementById('portalTabs');
  const portalFeed = document.getElementById('portalFeed');

  paint[MSN] = (s) => {
    const v = Object.assign({}, MSN_DEFAULTS, s || {});
    portalComments.checked = v.comments !== false;
    portalCards.checked = v.cards !== false;
    portalTabs.checked = v.tabs !== false;
    portalFeed.checked = v.feed !== false;
  };
  chrome.storage.sync.get(MSN, (got) => paint[MSN](got && got[MSN]));

  [portalComments, portalCards, portalTabs, portalFeed].forEach((el) => el.addEventListener('change', () => {
    chrome.storage.sync.set({
      [MSN]: {
        comments: portalComments.checked,
        cards: portalCards.checked,
        tabs: portalTabs.checked,
        feed: portalFeed.checked
      }
    }, flashSaved);
  }));

  /* ---------- reported errors ------------------------------------------- */

  const ERRORS = 'errors';
  const list = document.getElementById('errlist');
  const none = document.getElementById('errnone');
  const count = document.getElementById('errcount');
  const clear = document.getElementById('clear');

  const when = (ms) => {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  };

  const renderErrors = (rows) => {
    const items = Array.isArray(rows) ? rows : [];
    count.textContent = items.length ? '(' + items.length + ')' : '';
    none.hidden = items.length > 0;
    clear.hidden = items.length === 0;
    list.textContent = '';
    for (const e of items) {
      const li = document.createElement('li');
      const head = document.createElement('span');
      head.className = 'where';
      head.textContent = e.where || 'unknown';
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = '  ' + (e.host || '') + ' · ' + when(e.at) +
                         (e.count > 1 ? ' · ' + e.count + '\u00d7' : '');
      const msg = document.createElement('span');
      msg.className = 'msg';
      msg.textContent = e.message || '';
      li.appendChild(head); li.appendChild(meta); li.appendChild(msg);
      list.appendChild(li);
    }
  };

  chrome.storage.local.get(ERRORS, (got) => renderErrors(got && got[ERRORS]));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ERRORS]) renderErrors(changes[ERRORS].newValue);
    if (area !== 'sync') return;
    for (const k of Object.keys(changes)) {
      if (paint[k]) paint[k](changes[k].newValue);
    }
  });

  clear.addEventListener('click', () => {
    chrome.storage.local.set({ [ERRORS]: [] }, () => renderErrors([]));
  });

  /* ---------- comments ---------------------------------------------------
   * ONE switch, at the user's direction: it drives comments.js (hiding, via
   * storage) and the Disqus block, the static DNR ruleset `widgets`, which is
   * on in the manifest. Chrome keeps updateEnabledRulesets across restarts but
   * resets it on an extension update, so the stored choice is re-applied
   * every time this page opens. Between an update and the next visit here
   * Disqus is blocked -- the failure falls towards blocking. */
  const WIDGETS = 'widgets';
  const RULESET = 'widgets';

  const applyWidgets = (on) => {
    try {
      chrome.declarativeNetRequest.updateEnabledRulesets(
        on ? { enableRulesetIds: [RULESET] } : { disableRulesetIds: [RULESET] }
      ).catch((e) => console.error('widgets ruleset', e));
    } catch (e) { console.error('widgets ruleset', e); }
  };

  const hideComments = document.getElementById('hideComments');

  const hideNewsletter = document.getElementById('hideNewsletter');

  /* Paint only: a synced change reaches the ruleset through background.js,
   * so the repaint does not apply it a second time. */
  paint[WIDGETS] = (w) => {
    w = w || {};
    hideComments.checked = w.comments !== false;
    hideNewsletter.checked = w.newsletter !== false;
  };
  chrome.storage.sync.get(WIDGETS, (got) => {
    const w = got && got[WIDGETS];
    paint[WIDGETS](w);
    applyWidgets(!(w && w.comments === false));
  });

  /* Both keys written together: storing one alone would drop the other, and
   * the content scripts read a missing key as on. */
  const saveWidgets = () => chrome.storage.sync.set({
    [WIDGETS]: { comments: hideComments.checked, newsletter: hideNewsletter.checked }
  }, flashSaved);

  hideComments.addEventListener('change', () => { applyWidgets(hideComments.checked); saveWidgets(); });
  hideNewsletter.addEventListener('change', saveWidgets);

  /* URL exceptions, one box per feature, each list under its own storage key
   * (comments, social furniture, newsletter sign-ups). One entry per line,
   * stored as typed (trimmed, blanks dropped); except.js in the content
   * scripts does the forgiving parse, so the matching rules live in one
   * place. */
  const bindExceptions = (id, key) => {
    const box = document.getElementById(id);
    if (!box) return;
    const list = () => box.value.split('\n').map((s) => s.trim()).filter(Boolean);
    let timer = 0;
    /* A box being typed in keeps what is typed: its save is due, and is the
     * newer value. */
    paint[key] = (l) => {
      if (timer || document.activeElement === box) return;
      box.value = (Array.isArray(l) ? l : []).join('\n');
    };
    chrome.storage.sync.get(key, (got) => paint[key](got && got[key]));
    const save = () => { timer = 0; chrome.storage.sync.set({ [key]: list() }, flashSaved); };
    box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 500); });
    box.addEventListener('change', () => { clearTimeout(timer); save(); });
  };
  bindExceptions('commentsExcept', 'commentExceptions');
  bindExceptions('socialExcept', 'socialExceptions');
  bindExceptions('newsletterExcept', 'newsletterExceptions');

  /* ---------- reset to defaults -----------------------------------------
   * Removing a key IS the default: every reader treats a missing key as
   * "everything on, no exceptions". Local is cleared too, or a copy the
   * migration in background.js has not moved yet would be carried back into
   * sync at the next start. `errors` is a log, not a setting, and stays.
   * Two clicks rather than confirm(): the first arms it for a few seconds. */
  const RESET = [KEY, PROTECT, SOCIAL, MSN, WIDGETS,
                 'commentExceptions', 'socialExceptions', 'newsletterExceptions'];
  const reset = document.getElementById('reset');
  let armed = 0;
  reset.addEventListener('click', () => {
    if (!armed) {
      reset.textContent = 'Click again to reset everywhere';
      armed = setTimeout(() => { armed = 0; reset.textContent = 'Reset all settings'; }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = 0;
    chrome.storage.local.remove(RESET, () => {
      chrome.storage.sync.remove(RESET, () => {
        if (chrome.runtime.lastError) { flashSaved(); return; }
        location.reload();
      });
    });
  });

  /* ---------- backup: export to and import from JSON ----------------------
   * Removing the extension deletes its synced settings, and Chrome sends that
   * deletion to every machine in the profile, so sync is not a backup. This
   * is: a file the user keeps. It covers exactly RESET, the keys this page
   * saves; `errors` is this machine's log and is not a setting. */
  const BACKUP_APP = 'keep-the-page';
  const BACKUP_FORMAT = 1;
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  /* Pure: the file's parsed JSON in, the settings to write out, or an Error.
   * Checked whole before anything is written, so a bad file changes nothing.
   * Keys this build does not know are reported, never stored. */
  const importable = (data) => {
    if (!isObj(data) || data.app !== BACKUP_APP || !isObj(data.settings)) {
      throw new Error('not a Keep The Page settings file');
    }
    if (data.format !== BACKUP_FORMAT) {
      throw new Error('settings file format ' + data.format + ' is not supported');
    }
    const settings = {};
    const ignored = [];
    for (const k of Object.keys(data.settings)) {
      const v = data.settings[k];
      if (RESET.indexOf(k) === -1) { ignored.push(k); continue; }
      const ok = /Exceptions$/.test(k)
        ? Array.isArray(v) && v.every((s) => typeof s === 'string')
        : isObj(v);
      if (!ok) throw new Error('"' + k + '" in the file has the wrong shape');
      settings[k] = v;
    }
    return { settings, ignored, missing: RESET.filter((k) => !(k in settings)) };
  };

  const say = (text) => {
    clearTimeout(savedTimer);
    saved.textContent = text;
    saved.classList.add('on');
    savedTimer = setTimeout(() => saved.classList.remove('on'), 4000);
  };

  document.getElementById('export').addEventListener('click', () => {
    chrome.storage.sync.get(RESET, (got) => {
      if (chrome.runtime.lastError) { flashSaved(); return; }
      const data = {
        app: BACKUP_APP,
        format: BACKUP_FORMAT,
        version: chrome.runtime.getManifest().version,
        exported: new Date().toISOString(),
        settings: got || {}
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'],
                                               { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'keep-the-page-settings-' + data.exported.slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      say('Exported');
    });
  });

  /* A toolbar popup closes the moment the file picker takes focus, taking the
   * import with it, so from the popup this opens the page in a tab instead. */
  const inPopup = () => {
    try { return chrome.extension.getViews({ type: 'popup' }).indexOf(window) !== -1; }
    catch (e) { return false; }
  };

  const importFile = document.getElementById('importfile');
  document.getElementById('import').addEventListener('click', () => {
    if (inPopup()) {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html#backupbox') });
      window.close();
      return;
    }
    importFile.value = '';
    importFile.click();
  });

  importFile.addEventListener('change', () => {
    const f = importFile.files && importFile.files[0];
    if (!f) return;
    f.text().then((text) => {
      let got;
      try { got = importable(JSON.parse(text)); }
      catch (e) { say('Not imported: ' + e.message); return; }
      /* Write first, then remove what the file leaves out, so a refused write
       * (sync quota) removes nothing. The sync listener repaints the page. */
      chrome.storage.sync.set(got.settings, () => {
        if (chrome.runtime.lastError) { flashSaved(); return; }
        chrome.storage.sync.remove(got.missing, () => {
          if (chrome.runtime.lastError) { flashSaved(); return; }
          say('Imported' + (got.ignored.length ? '; ignored ' + got.ignored.join(', ') : ''));
        });
      });
    }, () => say('Not imported: the file could not be read'));
  });

  /* Build identity, read from the manifest so this page and the manifest can
   * never disagree. The author is deliberately NOT printed: a settings panel
   * is not the place for the maintainer's name or address. The repository
   * goes here instead -- it answers the same question, "who made this and
   * can I check it", and the answer it gives is the source. manifest.author
   * stays as it is, because the store matches it against the publishing
   * account; it is simply never rendered.
   *
   * Built with DOM calls rather than innerHTML: an extension page runs with
   * the extension's own privileges, and this one never needs string-to-HTML
   * for any reason. target=_blank because as a toolbar popup this page would
   * otherwise navigate itself and the settings would vanish mid-click. */
  try {
    const m = chrome.runtime.getManifest();
    about.textContent = '';
    if (m.homepage_url) {
      const a = document.createElement('a');
      a.href = m.homepage_url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = m.homepage_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      about.appendChild(a);
      about.appendChild(document.createTextNode(' — '));
    }
    about.appendChild(document.createTextNode('version ' + (m.version_name || m.version)));
  } catch (e) {
    about.textContent = '';
  }
})();
