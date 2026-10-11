#!/usr/bin/env gjs
/*
 * Keep The Page — unit tests.   Run with:  ./test.sh
 *
 * There is no node on this box, so these run under gjs (SpiderMonkey).
 *
 * The tests load the REAL walls.js and guard.js, not copies of their patterns.
 * That is the whole point: if someone edits CSS_STRIPPER or CONSENT_NAME, the
 * test exercises the edited version and fails. A test that re-declares the
 * regex would pass forever while production broke.
 *
 * How: walls.js is an IIFE that reads browser globals at load time. It is
 * evaluated with `new Function('window','document',...)`, whose parameters
 * shadow the globals, so the shim below stands in for the DOM.
 *
 * WHAT THIS DOES NOT COVER, and deliberately so:
 *   - looksLikeWall() / cmpShowing(): these depend on real layout —
 *     getComputedStyle, getBoundingClientRect, stacking contexts. A shim would
 *     only test the shim. Those stay covered by the browser sweep, recorded in
 *     sweep-results.md.
 *   - bridge.js and options.js: they are chrome.storage plumbing; there is no
 *     chrome.* here.
 * Passing these tests means the decision logic is right. It does not mean a
 * page renders — that has fooled this project once already.
 */

const GLib = imports.gi.GLib;
const System = imports.system;

/* ---------- tiny test framework ----------------------------------------- */

let passed = 0;
const failures = [];
let current = '';

const test = (name, fn) => {
  current = name;
  try {
    fn();
    passed++;
    print('  ok   ' + name);
  } catch (e) {
    failures.push(name + '\n       ' + (e && e.message ? e.message : String(e)));
    print('  FAIL ' + name + '\n       ' + (e && e.message ? e.message : String(e)));
  }
};

const eq = (actual, expected, what) => {
  if (actual !== expected) {
    throw new Error((what || 'value') + ': expected ' + JSON.stringify(expected) +
                    ', got ' + JSON.stringify(actual));
  }
};
const ok = (cond, what) => { if (!cond) throw new Error(what || 'expected truthy'); };

const read = (path) => {
  const [okRead, bytes] = GLib.file_get_contents(path);
  if (!okRead) throw new Error('cannot read ' + path);
  return imports.byteArray.toString(bytes);
};
const exists = (path) => GLib.file_test(path, GLib.FileTest.EXISTS);

/* ---------- DOM shim ----------------------------------------------------- */

function makeSandbox() {
  const logs = [];
  const scheduled = [];

  function Element() {}
  Element.prototype.remove = function () { this.__removed = true; };
  function Node() {}
  Node.prototype.removeChild = function (c) { c.__removed = true; return c; };
  Node.prototype.appendChild = function (c) { (this.inserted = this.inserted || []).push(c); return c; };
  Node.prototype.insertBefore = function (c) { (this.inserted = this.inserted || []).push(c); return c; };

  /* A real accessor pair, so the cookie guard installs over it. */
  function Document() {}
  const cookieJar = { value: '' };
  Object.defineProperty(Document.prototype, 'cookie', {
    configurable: true,
    enumerable: true,
    get() { return cookieJar.value; },
    set(v) { cookieJar.value = String(v); }
  });

  function Storage() {}
  const store = {};
  Storage.prototype.setItem = function (k, v) { store[String(k)] = String(v); };
  Storage.prototype.getItem = function (k) {
    return Object.prototype.hasOwnProperty.call(store, String(k)) ? store[String(k)] : null;
  };

  const makeEl = (tag) => {
    const el = Object.create(Element.prototype);
    el.localName = tag;
    el.tagName = tag.toUpperCase();
    el.nodeName = el.tagName;
    el.children = [];
    el.childNodes = [];
    el.attrs = {};
    el.isConnected = true;
    el.getAttribute = (n) => (Object.prototype.hasOwnProperty.call(el.attrs, n) ? el.attrs[n] : null);
    el.setAttribute = (n, v) => { el.attrs[n] = String(v); };
    el.removeAttribute = (n) => { delete el.attrs[n]; };
    el.appendChild = (c) => { el.children.push(c); el.childNodes.push(c); return c; };
    el.querySelectorAll = () => [];
    el.getBoundingClientRect = () => ({ width: 0, height: 0 });
    el.innerText = '';
    el.textContent = '';
    el.style = { setProperty() {} };
    el.classList = { contains: () => false, remove() {} };
    return el;
  };

  const html = makeEl('html');
  const document = Object.create(Document.prototype);
  document.documentElement = html;
  document.body = null;
  document.querySelectorAll = () => [];
  const reports = [];
  const listeners = {};
  document.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  document.dispatchEvent = (ev) => {
    if (ev && ev.type === 'ktp-report') reports.push(ev.detail);
    (listeners[ev.type] || []).forEach((fn) => fn(ev));
    return true;
  };
  document.createElement = makeEl;

  const window = {
    Storage,
    HTMLDialogElement: undefined,
    addEventListener: () => {},
    setTimeout: function (fn, d) { scheduled.push({ kind: 'timeout', fn, d }); return 1; },
    setInterval: function (fn, d) { scheduled.push({ kind: 'interval', fn, d }); return 2; }
  };

  const nativeSetTimeout = window.setTimeout;
  const nativeSetInterval = window.setInterval;

  const console = { debug: (...a) => logs.push(a.join(' ')) };

  const sandbox = {
    window, document, Element, Node, Document, Storage,
    MutationObserver: function (cb) {
      this.observe = (target, opts) => { this.opts = opts; };
      this.disconnect = () => { this.off = true; };
      this.cb = cb;
      sandbox.observers.push(this);
    },
    observers: [],
    getComputedStyle: () => ({
      display: 'block', visibility: 'visible', opacity: '1', position: 'static',
      overflow: 'visible', overflowY: 'visible', zIndex: 'auto'
    }),
    innerWidth: 1280, innerHeight: 800,
    location: { hostname: 'test.invalid' },
    console,
    setInterval: (fn) => { sandbox.tick = fn; return 3; },
    /* test handles */
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    logs, scheduled, cookieJar, store, html, reports, nativeSetTimeout, nativeSetInterval
  };
  return sandbox;
}

function load(path, sandbox) {
  const src = read(path);
  const names = ['window', 'document', 'Element', 'Node', 'Document', 'Storage',
                 'MutationObserver', 'getComputedStyle', 'innerWidth', 'innerHeight',
                 'location', 'console', 'setInterval', 'CustomEvent'];
  const fn = new Function(names.join(','), src);
  fn.apply(null, names.map((n) => sandbox[n]));
  return sandbox;
}

/* ---------- the suite ---------------------------------------------------- */

const DIR = ARGV[0] || '.';
const file = (n) => DIR + '/' + n;

print('\nwalls.js — stylesheet stripper filter');

const STRIPPER_REAL =
  "()=>i.querySelectorAll('link,style').forEach((e=>e.remove()))";

test('drops the exact stripper seen on National World titles', () => {
  const s = load(file('walls.js'), makeSandbox());
  const before = s.scheduled.length;
  const r = s.window.setInterval(new Function('return ' + STRIPPER_REAL)(), 100);
  eq(r, 0, 'return value (0 means dropped)');
  eq(s.scheduled.length, before, 'native scheduler must not be reached');
});

test('drops quoting and ordering variants', () => {
  const variants = [
    '()=>d.querySelectorAll("style, link").forEach(e=>e.remove())',
    '() => document.querySelectorAll(`link , style`).forEach(function(e){ e.remove(); })',
    "()=>{ q.querySelectorAll('link,style').forEach(function(n){ n.remove() }) }"
  ];
  for (const v of variants) {
    const s = load(file('walls.js'), makeSandbox());
    const r = s.window.setTimeout(new Function('return ' + v)(), 0);
    eq(r, 0, 'variant not dropped: ' + v);
  }
});

test('leaves benign handlers alone', () => {
  const benign = [
    "()=>document.querySelectorAll('.ad').forEach(e=>e.remove())",
    "()=>{ const s=document.querySelectorAll('link'); return s.length }",
    "()=>document.querySelector('style').textContent=''",
    '()=>{ tick() }'
  ];
  for (const b of benign) {
    const s = load(file('walls.js'), makeSandbox());
    const before = s.scheduled.length;
    s.window.setTimeout(new Function('return ' + b)(), 5);
    eq(s.scheduled.length, before + 1, 'benign handler was dropped: ' + b);
  }
});

test('passes through a non-function handler', () => {
  const s = load(file('walls.js'), makeSandbox());
  const before = s.scheduled.length;
  s.window.setTimeout('console.log(1)', 5);
  eq(s.scheduled.length, before + 1, 'string handler must reach the native scheduler');
});

print('\nwalls.js — consent record is refused');

const setCookie = (s, v) => { s.document.cookie = v; };

test('refuses the known consent cookie names', () => {
  for (const name of ['euconsent-v2', 'euconsent', 'eupubconsent-v2', 'addtl_consent',
                      'consentUUID', 'consentDate', 'OptanonConsent',
                      'OptanonAlertBoxClosed', 'didomi_token', 'CookieConsent',
                      'notice_gdpr_prefs', 'FCCDCF', '_sp_id.1234',
                      'cookieyes-consent']) {
    const s = load(file('walls.js'), makeSandbox());
    s.cookieJar.value = '';
    setCookie(s, name + '=SOMEVALUE; path=/');
    eq(s.cookieJar.value, '', 'consent cookie was stored: ' + name);
  }
});

test('does NOT block Spotify session cookies (sp_ vs _sp_)', () => {
  /* The regression this guards: a bare `sp_` prefix would match sp_dc / sp_t
   * and break logging in to Spotify. */
  for (const name of ['sp_dc', 'sp_t', 'sp_key']) {
    const s = load(file('walls.js'), makeSandbox());
    s.cookieJar.value = '';
    setCookie(s, name + '=abc; path=/');
    ok(s.cookieJar.value.indexOf(name + '=abc') === 0, 'wrongly blocked ' + name);
  }
});

test('leaves ordinary cookies alone', () => {
  for (const c of ['session=abc', 'theme=dark', 'cart_id=99', 'consentimiento=si']) {
    const s = load(file('walls.js'), makeSandbox());
    s.cookieJar.value = '';
    setCookie(s, c);
    ok(s.cookieJar.value.indexOf(c) === 0, 'wrongly blocked: ' + c);
  }
});

test('refuses consent records in localStorage but not other keys', () => {
  const s = load(file('walls.js'), makeSandbox());
  const ls = Object.create(s.Storage.prototype);
  ls.setItem('didomi_token', 'x');
  ls.setItem('euconsent-v2', 'x');
  eq(s.store['didomi_token'], undefined, 'didomi_token was stored');
  eq(s.store['euconsent-v2'], undefined, 'euconsent-v2 was stored');
  ls.setItem('theme', 'dark');
  eq(s.store['theme'], 'dark', 'ordinary key was blocked');
});

print('\nwalls.js — tracing is off unless switched on');

test('silent with no data-ktp-trace attribute', () => {
  const s = load(file('walls.js'), makeSandbox());
  s.window.setInterval(new Function('return ' + STRIPPER_REAL)(), 100);
  eq(s.logs.length, 0, 'logged with tracing off: ' + s.logs.join(' | '));
});

test('logs on an enabled channel, stays silent on a disabled one', () => {
  const s = load(file('walls.js'), makeSandbox());
  s.html.setAttribute('data-ktp-trace', 'timers');
  GLib.usleep(300000);                       /* traced() caches for 250ms */
  s.window.setInterval(new Function('return ' + STRIPPER_REAL)(), 100);
  eq(s.logs.length, 1, 'timers channel did not log');
  ok(s.logs[0].indexOf('[keep-the-page]') === 0, 'missing tag: ' + s.logs[0]);

  const s2 = load(file('walls.js'), makeSandbox());
  s2.html.setAttribute('data-ktp-trace', 'dom,consent');
  GLib.usleep(300000);
  s2.window.setInterval(new Function('return ' + STRIPPER_REAL)(), 100);
  eq(s2.logs.length, 0, 'logged on a channel that was not enabled');
});

test('"all" enables every channel', () => {
  const s = load(file('walls.js'), makeSandbox());
  s.html.setAttribute('data-ktp-trace', 'all');
  GLib.usleep(300000);
  s.window.setInterval(new Function('return ' + STRIPPER_REAL)(), 100);
  eq(s.logs.length, 1, '"all" did not enable the timers channel');
});

print('\nguard.js — Newsquest adLight pin');

test('pins adLight true and swallows the page assignment', () => {
  const s = makeSandbox();
  load(file('guard.js'), s);
  eq(s.window.adLight, true, 'adLight not pinned');
  s.window.adLight = false;                  /* what the page's own script does */
  eq(s.window.adLight, true, 'page was able to set adLight false');
});

test('adLight is non-configurable so it cannot be redefined away', () => {
  const s = makeSandbox();
  load(file('guard.js'), s);
  const d = Object.getOwnPropertyDescriptor(s.window, 'adLight');
  eq(d.configurable, false, 'adLight must be non-configurable');
});

test('forces __adblocker to false however the page writes it', () => {
  const s = makeSandbox();
  load(file('guard.js'), s);
  s.cookieJar.value = '';
  s.document.cookie = '__adblocker=true; path=/';
  ok(s.cookieJar.value.indexOf('__adblocker=false') === 0,
     'expected __adblocker=false, got: ' + s.cookieJar.value);
});

print('\nconsent is answered "no", not left undefined');

test('does not define __tcfapi on a site with no CMP', () => {
  const s = load(file('walls.js'), makeSandbox());
  s.tick();
  eq(typeof s.window.__tcfapi, 'undefined', 'stub installed on a clean site');
});

test('answers an existing __tcfapi with every purpose denied', () => {
  const s = makeSandbox();
  s.window.__tcfapi = function () {};      /* a TCF CMP is present */
  load(file('walls.js'), s);
  s.tick();
  let data = null, ok2 = null;
  s.window.__tcfapi('getTCData', 2, (d, success) => { data = d; ok2 = success; });
  eq(ok2, true, 'callback reported failure');
  ok(data && data.gdprApplies === true, 'gdprApplies must be true');
  eq(JSON.stringify(data.purpose.consents), '{}', 'no purpose may be consented');
  eq(JSON.stringify(data.vendor.consents), '{}', 'no vendor may be consented');
  eq(JSON.stringify(data.specialFeatureOptins), '{}', 'no special feature opt-ins');
  eq(data.tcString, '', 'must not present a consent string');
  eq(data.eventStatus, 'tcloaded', 'pages wait forever unless this is tcloaded');
});

test('ping reports a loaded CMP so page code does not stall', () => {
  const s = makeSandbox();
  s.window.__tcfapi = function () {};
  load(file('walls.js'), s);
  s.tick();
  let p = null;
  s.window.__tcfapi('ping', 2, (d) => { p = d; });
  ok(p && p.cmpLoaded === true, 'ping must report cmpLoaded');
  eq(p.displayStatus, 'disabled', 'no UI is being shown');
});

test('the CMP cannot replace our answer', () => {
  const s = makeSandbox();
  s.window.__tcfapi = function () {};
  load(file('walls.js'), s);
  s.tick();
  const ours = s.window.__tcfapi;
  s.window.__tcfapi = function () { throw new Error('CMP took it back'); };
  eq(s.window.__tcfapi, ours, 'assignment was allowed to win');
});

print('\nCookieYes: refused through the preference centre, never accepted');

/* A fake CookieYes as observed on lesoleil.com and lenouvelliste.ca: a first
 * layer with no refusal button, a panel whose legitimate-interest switches
 * ship ON, vendor rows that are only built after the panel opens, and a footer
 * of "save" and "accept all". */
function cookieYes(opts) {
  opts = opts || {};
  const s = makeSandbox();
  const clicks = [];
  const btn = (cls, text, fn) => ({
    className: cls, textContent: text,
    click() { clicks.push(cls); if (fn) fn(); }
  });
  const box = (id, checked, stuck) => ({
    id, checked, disabled: false,
    click() { clicks.push('box'); if (!stuck) this.checked = !this.checked; }
  });
  const boxes = [
    box('ckySwitchanalytics', false),
    box('ckyIABPNFSection1Item2ToggleLegitimate', true, !!opts.stuck),
    box('ckyIABPNFSection1Item2ToggleConsent', false)
  ];
  /* What the panel builds late, one tick after it is opened. */
  const lateRows = [
    box('ckyIABVendorSection1Item1ToggleLegitimate', true),
    box('ckyIABVendorSection1Item2ToggleLegitimate', true),
    box('ckyIABVendorSection1Item1ToggleConsent', false)
  ];
  const save = btn(opts.saveClass || 'cky-btn cky-btn-preferences', 'Enregistrer mes préférences');
  const panelBtns = {
    '.cky-btn-preferences': save,
    '.cky-btn-close': btn('cky-btn-close', ''),
    '.cky-btn-accept': btn('cky-btn cky-btn-accept', 'Accepter tout')
  };
  const panel = {
    querySelector: (sel) => {
      if (panelBtns[sel]) return panelBtns[sel];
      if (/VendorSection/.test(sel)) return boxes.find((b) => /VendorSection\d+Item/.test(b.id)) || null;
      return null;
    },
    querySelectorAll: (sel) => (/checkbox/.test(sel) ? boxes : [])
  };
  const buildLate = () => { if (!opts.neverBuilds) boxes.push(...lateRows); };
  let opened = false;
  const firstLayer = [btn('cky-btn cky-btn-customize', 'Personnaliser', () => { opened = true; }),
                      btn('cky-btn cky-btn-accept', 'Accepter tout')];
  const banner = s.document.createElement('div');
  banner.className = 'cky-consent-container cky-popup-center';
  banner.matches = (sel) => sel === '.cky-consent-container';
  banner.querySelector = (sel) => (sel === '.cky-btn-customize' ? firstLayer[0] : null);
  banner.querySelectorAll = () => firstLayer;       /* what clickReject scans */
  banner.getBoundingClientRect = () => ({ width: 440, height: 608 });

  s.document.body = s.document.createElement('body');
  s.document.querySelector = (sel) => (sel === '.cky-modal' ? panel : null);
  s.document.querySelectorAll = (sel) =>
    (banner.__removed ? [] : (/cky-consent-container/.test(sel) ? [banner] : []));
  /* CookieYes hides its first layer once the panel is open. */
  s.getComputedStyle = (el) => ({
    display: el === banner && opened ? 'none' : 'block', visibility: 'visible', opacity: '1',
    position: el === banner ? 'fixed' : 'static',
    overflow: 'visible', overflowY: 'visible', zIndex: '99999999'
  });
  load(file('walls.js'), s);
  /* One sweep, then the late rows appear, the way the real panel behaves. */
  const tick = () => { const wasOpen = opened; s.tick(); if (!wasOpen && opened) buildLate(); };
  return { s, tick, clicks, boxes, banner };
}

const saved = (clicks) => clicks.indexOf('cky-btn cky-btn-preferences') !== -1;

test('opens the panel first, and does not save on the same tick', () => {
  const { tick, clicks } = cookieYes();
  tick();
  eq(clicks[0], 'cky-btn cky-btn-customize', 'must open the preference centre first');
  ok(!saved(clicks), 'saved before the panel had finished building');
});

test('waits for the late vendor rows, then turns every switch off and saves', () => {
  /* The lenouvelliste.ca bug: saving on the opening tick left all 39 vendor
   * legitimate-interest switches on, because their rows did not exist yet. */
  const { tick, clicks, boxes, banner } = cookieYes();
  for (let i = 0; i < 5 && !saved(clicks); i++) tick();
  ok(saved(clicks), 'never saved');
  ok(boxes.some((b) => /VendorSection\d+Item/.test(b.id)), 'fixture: vendor rows never built');
  eq(boxes.filter((b) => b.checked).length, 0,
     'left on: ' + boxes.filter((b) => b.checked).map((b) => b.id).join(', '));
  ok(!banner.__removed, 'removed the banner instead of answering it');
});

test('never presses accept, on either layer', () => {
  const { tick, clicks } = cookieYes();
  for (let i = 0; i < 12; i++) tick();
  ok(clicks.every((c) => !/accept/.test(c)), 'clicked accept: ' + clicks.join(', '));
});

test('saves nothing if the vendor rows never appear', () => {
  const { tick, clicks, banner } = cookieYes({ neverBuilds: true });
  for (let i = 0; i < 14; i++) tick();
  ok(!saved(clicks), 'saved without the vendor rows');
  ok(clicks.indexOf('cky-btn-close') !== -1, 'left the panel open');
  ok(banner.__removed, 'banner was not removed after giving up');
});

test('saves nothing if a switch will not turn off, and falls back to removal', () => {
  const { tick, clicks, banner } = cookieYes({ stuck: true });
  for (let i = 0; i < 6; i++) tick();
  ok(!saved(clicks), 'saved with a legitimate-interest switch still on');
  ok(clicks.indexOf('cky-btn-close') !== -1, 'left the panel open');
  ok(banner.__removed, 'banner was not removed after the refusal failed');
});

test('refuses to press a save button that looks like accept', () => {
  const { tick, clicks } = cookieYes({ saveClass: 'cky-btn cky-btn-accept' });
  for (let i = 0; i < 6; i++) tick();
  ok(clicks.every((c) => !/accept/.test(c)), 'clicked accept: ' + clicks.join(', '));
});

print('\nerror reporting');

test('a guard failure is reported out as a JSON string, not an object', () => {
  /* Objects do not cross the MAIN/ISOLATED boundary reliably; strings do.
   * If someone "tidies" detail into an object, bridge.js silently stops
   * collecting, so pin it here. */
  const s = makeSandbox();
  /* Make the cookie guard throw while installing, which report() must catch. */
  Object.defineProperty(s.Document.prototype, 'cookie', {
    configurable: false, enumerable: true,
    get() { return ''; }, set() {}
  });
  load(file('walls.js'), s);
  eq(s.reports.length, 1, 'no error reported for a failed cookie guard');
  eq(typeof s.reports[0], 'string', 'detail must be a string');
  const e = JSON.parse(s.reports[0]);
  eq(e.where, 'cookie guard', 'wrong "where"');
  ok(typeof e.message === 'string' && e.message.length > 0, 'no message');
  eq(e.host, 'test.invalid', 'host not recorded');
  ok(typeof e.at === 'number' && e.at > 0, 'no timestamp');
});

test('nothing is reported when the guards install cleanly', () => {
  const s = load(file('walls.js'), makeSandbox());
  eq(s.reports.length, 0, 'reported: ' + s.reports.join(' | '));
});

print('\nwalls.js — AdShield recovery gate');

/* The SDK's own gate, verbatim from the scotsman.com loader's onerror handler
 * (l/1.1.21), with `n` bound to the sandbox window. listentotaxman's l/1.1.10
 * obfuscates the same computation. If this returns true, the recovery script
 * returns before any fallback, error iframe, confirm() or reload. */
const SDK_GATE = "const e=e=>{let t=0;for(let r=0,o=e.length;r<o;r++){t=(t<<5)-t+e.charCodeAt(r),t|=0}return t},t=Date.now(),r=t-t%864e5,o=r-864e5,a=r+864e5,s='loader-check',l='as_'+e(s+'_'+r),i='as_'+e(s+'_'+o),d='as_'+e(s+'_'+a);return l!==i&&l!==d&&i!==d&&!!(n[l]||n[i]||n[d])";
const sdkGate = (win) => new Function('n', SDK_GATE)(win);

const parse = (s, el) => {
  const w = s.observers.find((o) => o.opts && o.opts.subtree);
  ok(w, 'no subtree observer watching the parse');
  el.nodeType = 1;
  w.cb([{ addedNodes: [el] }]);
  return w;
};

const loaderTag = (s, attrs) => {
  const el = s.document.createElement('script');
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  el.src = attrs.src || '';
  return el;
};

test('a parsed l/1.1.10 loader tag pins the gate the SDK checks', () => {
  const s = load(file('walls.js'), makeSandbox());
  eq(sdkGate(s.window), false, 'gate set before any loader was seen');
  const w = parse(s, loaderTag(s, { 'data-sdk': 'l/1.1.10', src: 'https://html-load.com/loader.min.js' }));
  eq(sdkGate(s.window), true, 'recovery gate not pinned');
  ok(w.off, 'watcher kept running after the loader was found');
});

test('a loader identified by host alone also pins the gate', () => {
  const s = load(file('walls.js'), makeSandbox());
  parse(s, loaderTag(s, { src: 'https://fb.content-loader.com/loader.min.js' }));
  eq(sdkGate(s.window), true, 'recovery gate not pinned');
});

test('any l/<n>.<n> version arms, never a literal one', () => {
  /* The version moves -- four seen so far -- so the match must be by shape. */
  for (const v of ['l/1.1.10', 'l/1.1.21', 'l/1.2.10', 'wp-l/1.1.11', 'l/1.9.99', 'l/2.0.1']) {
    const s = load(file('walls.js'), makeSandbox());
    parse(s, loaderTag(s, { 'data-sdk': v }));
    eq(sdkGate(s.window), true, v + ' did not arm');
  }
  for (const v of ['l/1', 'gtm', 'html/1.2', 'ctrl/1.1']) {
    const s = load(file('walls.js'), makeSandbox());
    parse(s, loaderTag(s, { 'data-sdk': v }));
    eq(sdkGate(s.window), false, v + ' armed');
  }
});

test('ordinary scripts leave no gate on the page', () => {
  const s = load(file('walls.js'), makeSandbox());
  parse(s, loaderTag(s, { src: 'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.5.1/jquery.min.js' }));
  parse(s, loaderTag(s, { 'data-sdk': 'gtm', src: '' }));
  eq(sdkGate(s.window), false, 'gate pinned on a clean page');
  eq(Object.keys(s.window).filter((k) => /^as_/.test(k)).length, 0, 'as_ globals leaked');
});

test('the gate is not pinned with anti-adblock switched off', () => {
  const s = makeSandbox();
  s.html.setAttribute('data-ktp-off', 'walls');
  load(file('walls.js'), s);
  parse(s, loaderTag(s, { 'data-sdk': 'l/1.1.10' }));
  eq(sdkGate(s.window), false, 'gate pinned although walls is off');
});

print('\nwalls.js — AdShield e/ loader refused at insertion');

/* The phoronix bootstrap builds this tag and calls document.head.appendChild.
 * Every later stage hangs off its `error` event, so a refused insertion is the
 * whole fix: nothing fetched, nothing fails, no mirror, no WebSocket. */
const insertInto = (s, method, el) => {
  const head = Object.create(s.Node.prototype);
  const back = s.Node.prototype[method].call(head, el, null);
  return { head, back };
};

test('a script carrying data-sdk e/<n>.<n> is never inserted', () => {
  for (const method of ['appendChild', 'insertBefore']) {
    for (const v of ['e/1.0.8', 'e/1.0.13', 'e/2.1', 'wp-e/1.0.8']) {
      const s = load(file('walls.js'), makeSandbox());
      const el = loaderTag(s, { 'data-sdk': v, src: 'https://loader.invalid/script/d3d3.js' });
      el.nodeType = 1;
      const { head, back } = insertInto(s, method, el);
      eq((head.inserted || []).length, 0, v + ' inserted via ' + method);
      eq(back, el, method + ' did not hand the node back');
    }
  }
});

test('everything else is inserted untouched', () => {
  const s = load(file('walls.js'), makeSandbox());
  const cases = [
    loaderTag(s, { src: 'https://a.pub.network/site/pubfig.min.js' }),
    loaderTag(s, { 'data-sdk': 'l/1.1.21' }),      /* the l/ line keeps its gate, section 0 */
    loaderTag(s, { 'data-sdk': 'gtm' }),
    loaderTag(s, { 'data-sdk': 'e/1' }),
    loaderTag(s, { 'data-sdk': 'core/1.0' }),
    s.document.createElement('div')
  ];
  const div = cases[cases.length - 1];
  div.setAttribute('data-sdk', 'e/1.0.8');        /* the signature only counts on a SCRIPT */
  for (const el of cases) {
    el.nodeType = 1;
    const { head } = insertInto(s, 'appendChild', el);
    eq((head.inserted || []).length, 1, (el.getAttribute('data-sdk') || el.src || el.localName) + ' refused');
  }
});

test('the e/ loader is inserted with anti-adblock switched off', () => {
  const s = makeSandbox();
  s.html.setAttribute('data-ktp-off', 'walls');
  load(file('walls.js'), s);
  const el = loaderTag(s, { 'data-sdk': 'e/1.0.8' });
  el.nodeType = 1;
  eq((insertInto(s, 'appendChild', el).head.inserted || []).length, 1, 'refused although walls is off');
});

print('\nsocial.js — host matching and what must survive');

/* social.js is an IIFE with no exports, and its matching is pure string work,
 * so the two functions are lifted out of the real source and evaluated. If
 * someone edits them, the test edits with them. */
const socialSrc = read(file('social.js'));
const lift = (name) => {
  const i = socialSrc.indexOf('const ' + name + ' =');
  ok(i !== -1, 'cannot find ' + name + ' in social.js');
  const end = socialSrc.indexOf('\n\n', i);
  return socialSrc.slice(i, end);
};
const socialMatch = new Function(
  lift('GROUPS').replace('const GROUPS', 'var GROUPS') + ';' +
  lift('hostsFor').replace('const hostsFor', 'var hostsFor') + ';' +
  lift('DEFAULTS').replace('const DEFAULTS', 'var DEFAULTS') + ';' +
  lift('hostOf').replace('const hostOf', 'var hostOf') + ';' +
  lift('isSocialHost').replace('const isSocialHost', 'var isSocialHost') + ';' +
  lift('KEEP').replace('const KEEP', 'var KEEP') + ';' +
  lift('DEAD').replace('const DEAD', 'var DEAD') + ';' +
  lift('FURNITURE_TEXT').replace('const FURNITURE_TEXT', 'var FURNITURE_TEXT') + ';' +
  lift('FURNITURE_LABEL').replace('const FURNITURE_LABEL', 'var FURNITURE_LABEL') + ';' +
  lift('FURNITURE_WORD').replace('const FURNITURE_WORD', 'var FURNITURE_WORD') + ';' +
  lift('words').replace('const words', 'var words') + ';' +
  lift('isFurnitureCtx').replace('const isFurnitureCtx', 'var isFurnitureCtx') + ';' +
  lift('isFurnitureText').replace('const isFurnitureText', 'var isFurnitureText') + ';' +
  lift('inProse').replace('const inProse', 'var inProse') + ';' +
  lift('furnitureVerdict').replace('const furnitureVerdict', 'var furnitureVerdict') + ';' +
  lift('BUTTON_PLATFORM').replace('const BUTTON_PLATFORM', 'var BUTTON_PLATFORM')
    .replace('const BUTTON_X', 'var BUTTON_X').replace('const BUTTON_KEEP', 'var BUTTON_KEEP') + ';' +
  lift('buttonPlatform').replace('const buttonPlatform', 'var buttonPlatform') + ';' +
  lift('shareButtonVerdict').replace('const shareButtonVerdict', 'var shareButtonVerdict') + ';' +
  lift('LOGIN_WORD').replace('const LOGIN_WORD', 'var LOGIN_WORD').replace('const hasLoginWord', 'var hasLoginWord') + ';' +
  lift('loginButtonVerdict').replace('const loginButtonVerdict', 'var loginButtonVerdict') + ';' +
  'return { hostOf: hostOf, GROUPS: GROUPS, hostsFor: hostsFor, DEFAULTS: DEFAULTS,' +
  '         isSocialHost: function (h) { return isSocialHost(h, hostsFor(null)); },' +
  '         isSocialHostIn: isSocialHost, KEEP: KEEP, DEAD: DEAD,' +
  '         isFurnitureText: isFurnitureText, isFurnitureCtx: isFurnitureCtx,' +
  '         inProse: inProse, FURNITURE_LABEL: FURNITURE_LABEL,' +
  '         verdict: furnitureVerdict, shareButton: shareButtonVerdict,' +
  '         loginButton: loginButtonVerdict };'
)();

print('\nsocial.js — consent-gated embeds');

const gate = new Function(
  lift('EMBED_PLATFORM').replace(/const (EMBED_\w+)/g, 'var $1') + ';' +
  lift('embedPlatform').replace('const embedPlatform', 'var embedPlatform') + ';' +
  lift('gateVerdict').replace('const gateVerdict', 'var gateVerdict') + ';' +
  'return { platform: embedPlatform, verdict: gateVerdict };')();

/* Verbatim from standard.co.uk, both boxes. */
const STD_X = 'Allow X (formerly Twitter) content This content is provided by X (formerly Twitter) ' +
  "and may use cookies or similar technologies. Please click 'Allow and Continue' " +
  'below to load the content. Allow and Continue';
const STD_EXT = 'Allow external content This content is provided by an external source and may ' +
  "use cookies or similar technologies. Please click 'Allow and Continue' below to load " +
  'the content. Allow and Continue';

test('a consent box names its platform in its own words', () => {
  eq(gate.platform(STD_X), 'x', 'standard.co.uk X box');
  eq(gate.platform('Allow Twitter content'), 'x', 'Twitter');
  eq(gate.platform('Allow Instagram content, provided by Meta and Facebook'), 'instagram',
     'first-named platform wins');
  eq(gate.platform('Allow TikTok content'), 'tiktok', 'TikTok');
  eq(gate.platform('Allow Snapchat content'), 'snapchat', 'Snapchat');
  for (const t of ['Allow YouTube content', 'Box X of 12', 'Allow and Continue', '']) {
    eq(gate.platform(t), '', JSON.stringify(t) + ' named a platform');
  }
});

test('gates are found by attribute, and by wording on any other site', () => {
  eq(gate.verdict({ attr: true, button: 'Allow and Continue', text: STD_X }), 'x', 'attr, X');
  eq(gate.verdict({ attr: true, button: 'Allow and Continue', text: STD_EXT }), 'external',
     'attr, unnamed service');
  /* The same wording with no attribute: the generic path. */
  eq(gate.verdict({ attr: false, button: 'Allow and Continue', text: STD_X }), 'x', 'wording, X');
  eq(gate.verdict({ attr: false, button: 'Accept and continue',
                    text: 'Allow YouTube content? This article contains content provided by ' +
                          'Google YouTube. Accept and continue' }), 'external', 'wording, YouTube');
});

test('banners, newsletters and articles are not gates', () => {
  const no = [
    { attr: false, button: 'Accept all', text: 'We value your privacy. We and our partners ' +
      'store and access information on your device. Accept all' },
    { attr: false, button: 'I Accept', text: 'Allow cookies? This content is provided by us. I Accept' },
    /* Gate-like wording, but the button is a blanket accept: a CMP banner. */
    { attr: false, button: 'Accept all', text: 'Some content on this site is provided by ' +
      'third parties who may set cookies. Accept all' },
    { attr: false, button: 'Agree', text: 'Allow personalised content? Agree' },
    { attr: false, button: 'Allow and Continue', text: 'Get our free weekly newsletter. Allow and Continue' },
    { attr: false, button: 'Subscribe', text: 'This content is provided by our partners. Subscribe' },
    { attr: false, button: 'Allow and Continue', text: 'This content is provided by X. ' + 'x'.repeat(700) },
    { attr: true, button: 'Allow and Continue', text: 'Get our free weekly newsletter.' }
  ];
  for (const g of no) eq(gate.verdict(g), '', JSON.stringify(g).slice(0, 90));
});

test('the embed accept button is never pressed, and marked boxes are hidden', () => {
  for (const name of ['markConsentEmbeds', 'embedBox']) {
    const i = socialSrc.indexOf('const ' + name + ' =');
    const body = socialSrc.slice(i, socialSrc.indexOf('\n\n', i));
    ok(i !== -1 && body.length > 100, name + ' not found');
    ok(!/\.click\s*\(/.test(body), name + ' clicks something -- that would consent');
  }
  ok(/\[' \+ WAS \+ '\^="consent-embed:"\]/.test(socialSrc), 'CSS does not hide marked consent boxes');
  ok(socialSrc.indexOf("'data-social-consent-accept'") !== -1, 'signature attribute missing');
});

test('matches every platform and its short domains', () => {
  for (const u of ['https://www.facebook.com/someone',
                   'https://facebook.com/sharer/sharer.php?u=x',
                   'https://fb.me/abc', 'https://www.instagram.com/someone',
                   'https://twitter.com/someone', 'https://x.com/someone',
                   'https://t.co/abc', 'https://www.tiktok.com/@someone',
                   'https://vm.tiktok.com/abc', '//x.com/someone',
                   'https://www.linkedin.com/in/someone',
                   'https://uk.linkedin.com/company/someone', 'https://lnkd.in/abc',
                   'https://www.snapchat.com/add/someone', 'https://story.snapchat.com/p/abc']) {
    ok(socialMatch.isSocialHost(socialMatch.hostOf(u)), 'missed: ' + u);
  }
});

test('does NOT match hosts merely ending in x.com or fb.com', () => {
  /* The bug a substring selector would ship: href*="x.com" matches netflix. */
  for (const u of ['https://www.netflix.com/title/123', 'https://linux.com/news',
                   'https://phoenix.com', 'https://www.matrix.com',
                   'https://notfacebook.com', 'https://fbi.com',
                   'https://xtiktok.com', 'https://instagramm.com',
                   'https://mylinkedin.com', 'https://linkedin.com.evil.example',
                   'https://notsnapchat.com', 'https://snapchat.community']) {
    eq(socialMatch.isSocialHost(socialMatch.hostOf(u)), false, 'wrongly matched: ' + u);
  }
});

test('relative and non-http links are never social', () => {
  for (const u of ['/news/story', 'story.html', '#top', 'mailto:a@b.c',
                   'javascript:void(0)', '']) {
    eq(socialMatch.isSocialHost(socialMatch.hostOf(u)), false, 'wrongly matched: ' + u);
  }
});

test('sign-in and legal links are kept', () => {
  /* Removing "Continue with Facebook" locks people out of sites. */
  for (const u of ['https://www.facebook.com/v18.0/dialog/oauth?client_id=1',
                   'https://www.facebook.com/login.php?next=x',
                   'https://twitter.com/i/oauth2/authorize',
                   'https://www.linkedin.com/oauth/v2/authorization?client_id=1',
                   'https://www.linkedin.com/login',
                   'https://www.facebook.com/legal/terms',
                   'https://www.facebook.com/privacy/policy']) {
    ok(socialMatch.KEEP.test(u), 'would have removed a login/legal link: ' + u);
  }
});

test('share and profile links are not kept by the login rule', () => {
  for (const u of ['https://www.facebook.com/sharer/sharer.php?u=x',
                   'https://twitter.com/intent/tweet?url=x',
                   'https://www.instagram.com/thepaper',
                   'https://www.tiktok.com/@thepaper',
                   'https://www.linkedin.com/sharing/share-offsite/?url=x',
                   'https://www.linkedin.com/company/thepaper']) {
    eq(socialMatch.KEEP.test(u), false, 'wrongly kept: ' + u);
  }
});

test('rewritten links carry the removeme marker', () => {
  /* The path is what makes every target visible in one selector; the host is
   * what makes the link go nowhere. Both halves matter. */
  eq(socialMatch.DEAD, 'http://localhost/removeme');
  ok(/^http:\/\/localhost\//.test(socialMatch.DEAD), 'must stay on localhost');
});

test('the marker is what the hide rule selects on', () => {
  const src = read(file('social.js'));
  const css = /const CSS = ([^;]+);/.exec(src);
  ok(css, 'no CSS rule found in social.js');
  ok(css[1].indexOf('display:none!important') !== -1, 'the rule must hide');
  ok(css[1].indexOf('DEAD') !== -1, 'the rule must select on the marker, not a literal');
  /* Disposal is a second pass over what the first pass marked. */
  ok(src.indexOf("queryAll('a[href=\"' + DEAD + '\"]')") !== -1,
     'disposal must select marked links, not re-test every anchor');
});

test('share BUTTONS are caught by signature (lesoleil.com article bar)', () => {
  /* Six <button>s, no href. Observed ids and labels, verbatim. */
  const bar = (id, platformWrap, label) => ({
    id: id, testid: id, cls: 'ts-share-bar__button ts-share-bar__button--mod',
    label: label, parentCls: 'sharing-optionsstyled__StyledSocialMediaHeaderButtonContainer-sc-jkf32r-0 hroCZK ' + platformWrap
  });
  eq(socialMatch.shareButton(bar('article-share-facebook', 'facebook',
     "Partager l'article en cours via Facebook")), 'facebook', 'facebook button kept');
  eq(socialMatch.shareButton(bar('article-share-twitter', 'twitter',
     "Partager l'article en cours via Twitter")), 'x', 'twitter button kept');
  eq(socialMatch.shareButton(bar('article-share-linkedIn', 'linkedIn',
     "Partager l'article en cours via LinkedIn")), 'linkedin', 'linkedIn (camelCase) button kept');
  eq(socialMatch.shareButton({ id: '', testid: '', cls: 'btn', parentCls: '',
     label: 'Share on X' }), 'x', '"Share on X" kept');
});

test('share buttons that name no platform are left alone', () => {
  for (const [id, label] of [['article-share-email', "Partager l'article en cours via E-mail"],
                             ['article-share-link', "Partager l'article en cours via lien"],
                             ['article-share-share', "Partager l'article en cours via partager"]]) {
    eq(socialMatch.shareButton({ id: id, testid: id, cls: '', parentCls: 'x-wrap', label: label }),
       '', 'wrongly targeted ' + id);
  }
});

test('login buttons naming a platform survive', () => {
  for (const label of ['Continue with Facebook', 'Log in with Facebook', 'Sign in with LinkedIn',
                       'Connexion avec Facebook', 'Continuer avec Twitter']) {
    eq(socialMatch.shareButton({ id: 'fb-share', testid: '', cls: 'social-login', parentCls: 'share',
       label: label, ctx: true }), '', 'would have removed a login button: ' + label);
  }
});

test('follow icons are caught by signature wherever they point (lapresse.ca)', () => {
  /* Facebook and Instagram point at lapresse.ca's own explainer page, and
   * YouTube, Bluesky and Threads are not configured platforms. Observed. */
  const icon = (p) => ({ id: '', testid: '', label: 'Suivre La Presse sur ' + p,
    cls: 'mainNav__social_icon socials__icon socials-' + p.toLowerCase(), parentCls: 'socials' });
  eq(socialMatch.shareButton(icon('Facebook')), 'facebook', 'facebook follow icon');
  eq(socialMatch.shareButton(icon('Instagram')), 'instagram', 'instagram follow icon');
  for (const p of ['YouTube', 'Bluesky', 'Threads']) {
    eq(socialMatch.shareButton(icon(p)), 'other', p + ' follow icon');
  }
});

test('an icon beside other social icons is in a social row (journaldemontreal footer)', () => {
  /* li.footer-rs > a[title=Bluesky]: no social word, no follow label. The
   * DOM walk reports neighbours already marked as ctx. */
  const bsky = { id: '', testid: '', cls: 'item-sousmenu item-external', label: 'Bluesky', parentCls: 'footer-rs' };
  eq(socialMatch.shareButton(Object.assign({ ctx: true }, bsky)), 'other', 'beside marked icons');
  eq(socialMatch.shareButton(Object.assign({ ctx: false }, bsky)), '', 'alone, with no signal, must be left');
});

test('Snapchat is a platform of its own, not "other"', () => {
  /* It has its own switch, so a share button must map to it -- as 'other' it
   * would be removed even with the Snapchat switch off. */
  eq(socialMatch.shareButton({ id: 'share-snapchat', testid: '', cls: 'share-btn', label: 'Share on Snapchat',
     parentCls: 'share-bar' }), 'snapchat', 'share button');
  ok(socialMatch.GROUPS.snapchat && socialMatch.GROUPS.snapchat.indexOf('snapchat.com') !== -1, 'no host group');
  eq(socialMatch.DEFAULTS.platforms.snapchat, true, 'not on by default');
});

test('sign-in buttons are recognised by platform and login context (Disqus)', () => {
  /* Verbatim shape from disqus.com/embed/comments: ul.login-buttons >
   * li.auth-<p> > button.connect__button[data-action="auth:<p>"][title]. */
  /* label is aria-label || title, as markButtons reads it; Disqus sets
   * aria-label="Login with <P>", which the share lookup refuses outright. */
  const dq = (p, title) => ({ id: '', testid: '', cls: 'connect__button', action: 'auth:' + p,
                              label: 'Login with ' + title, parentCls: 'auth-' + p, ctx: true });
  eq(socialMatch.loginButton(dq('facebook', 'Facebook')), 'facebook', 'Disqus Facebook');
  eq(socialMatch.loginButton(dq('twitter', 'X (Twitter)')), 'x', 'Disqus X');
  eq(socialMatch.loginButton({ id: '', testid: '', cls: 'btn', action: '', label: 'Sign in with Facebook',
     parentCls: 'form-row', ctx: false }), 'facebook', 'login wording in the label alone');
  for (const [p, t] of [['google', 'Google'], ['microsoft', 'Microsoft'], ['apple', 'Apple'],
                        ['disqus', 'Disqus']]) {
    eq(socialMatch.loginButton(dq(p, t)), '', p + ' is not a configured platform');
  }
  /* A platform named with no login signal is not a sign-in button. */
  eq(socialMatch.loginButton({ id: 'facebook-feed-toggle', testid: '', cls: 'tab', action: '',
     label: 'Facebook', parentCls: 'tabs', ctx: false }), '', 'bare platform tab');
  /* 'other' platforms are never acted on this way. */
  eq(socialMatch.loginButton({ id: '', testid: '', cls: 'login-btn', action: '', label: 'YouTube',
     parentCls: 'auth-youtube', ctx: true }), '', 'YouTube sign-in');
});

test('sign-in buttons are only touched with "keep sign-in links" OFF', () => {
  const i = socialSrc.indexOf('const markButtons =');
  const body = socialSrc.slice(i, socialSrc.indexOf('\n\n', i));
  const gate = body.indexOf("cfg.keepLogins === false");
  const call = body.indexOf('loginButtonVerdict(');
  ok(gate !== -1 && call !== -1 && gate < call, 'loginButtonVerdict is not gated on keepLogins === false');
});

test('social.js runs in frames, where comment widgets live', () => {
  const m = JSON.parse(read(file('manifest.json')));
  const e = m.content_scripts.find((x) => x.js.indexOf('social.js') !== -1);
  eq(e.all_frames, true, 'Disqus renders its login row in a cross-origin iframe');
});

test('petapixel: Flipboard share and "Follow <name> on <platform>" icons', () => {
  eq(socialMatch.shareButton({ id: '', testid: '', cls: 'sharing-buttons__item sharing-buttons__item--flipboard',
     label: 'Share on Flipboard', parentCls: 'sharing-buttons__item-wrap' }), 'other', 'Flipboard share');
  for (const s of ['Follow PetaPixel on Threads', 'Follow PetaPixel on YouTube', 'Follow The Verge on X']) {
    ok(socialMatch.isFurnitureText(s), s + ' should be furniture wording');
  }
  /* A headline shaped like it must not be: the tail is one platform-like word. */
  for (const s of ['Follow the money on election night', 'Follow our live coverage on the day']) {
    ok(!socialMatch.isFurnitureText(s), s + ' is a headline, not an icon');
  }
});

test('a YouTube link inside an article is not furniture', () => {
  eq(socialMatch.shareButton({ id: '', testid: '', cls: '', label: '',
     parentCls: 'article-body__paragraph' }), '', 'no platform named, must be left');
  eq(socialMatch.shareButton({ id: '', testid: '', cls: 'youtube-embed-link', label: 'Watch on YouTube',
     parentCls: 'article-body' }), '', 'a platform named with no follow/share signal must be left');
});

test('a platform name alone, with no share signal, is not a share button', () => {
  eq(socialMatch.shareButton({ id: 'facebook-feed-toggle', testid: '', cls: 'tab',
     parentCls: 'tabs', label: 'Facebook' }), '', 'a bare platform tab was targeted');
  eq(socialMatch.shareButton({ id: '', testid: '', cls: 'btn', parentCls: 'toolbar',
     label: 'Box' }), '', '"x" inside a word must not count');
});

test('icon-only and share/follow labels are furniture', () => {
  for (const s of ['', 'Share', 'share', 'Tweet', 'Follow us', 'Share on Facebook',
                   'Share to X', 'Share this', 'Facebook', 'TikTok', '@thepaper']) {
    ok(socialMatch.isFurnitureText(s), 'not treated as furniture: ' + JSON.stringify(s));
  }
});

test('prose links are NOT furniture, so the words survive', () => {
  /* Deleting an inline anchor deletes article text with it. */
  for (const s of ['their Facebook post said the bridge would close',
                   'the video she shared on TikTok',
                   'Share prices fell sharply',
                   'a follow-up investigation']) {
    eq(socialMatch.isFurnitureText(s), false, 'would have deleted prose: ' + s);
  }
});

test('share and social containers are recognised, article ones are not', () => {
  /* socialarea and socialarea_facebook are notebookcheck's, observed live:
   * a boundary rule missed both and left the icons on screen. socialLinks is
   * the camelCase case the same rule missed. */
  for (const c of ['share-bar', 'social-links', 'article__share', 'follow-us',
                   'sharing tools', 'addtoany_list', 'socialarea',
                   'socialarea_facebook', 'socialLinks', 'articleShareTools']) {
    ok(socialMatch.isFurnitureCtx(c), 'missed container: ' + c);
  }
  /* Prefix matching needs its false friends named, or these go too. A bare
   * `share` or `social` word IS treated as furniture -- class="share" is the
   * commonest share-row name there is, and the cost of the rule is only that a
   * social link already rewritten to localhost is also deleted. Only real
   * English words that start the same way are excluded. */
  for (const c of ['article-body', 'shareholder-news', 'socialist-party',
                   'following-content', 'main-content', 'sharepoint-docs',
                   'socialism-explained', 'follower-count']) {
    eq(socialMatch.isFurnitureCtx(c), false, 'wrongly matched container: ' + c);
  }
});

test('a link with sentence text beside it counts as prose', () => {
  /* Observed live: "Posted by @someone earlier today." lost the handle and
   * read "Posted by  earlier today." because @handle matches the text rule. */
  const mkParent = (siblings) => {
    const a = { textContent: '@someone' };
    a.parentElement = { childNodes: [a].concat(siblings) };
    return a;
  };
  ok(socialMatch.inProse(mkParent([{ textContent: ' earlier today.' }])),
     'mid-sentence link must read as prose');
  ok(socialMatch.inProse(mkParent([{ textContent: 'Posted by ' }])));
  /* A share row of icons is not prose: the siblings carry no text. */
  eq(socialMatch.inProse(mkParent([{ textContent: '' }, { textContent: '\n  ' }])), false,
     'an icon row must not read as prose');
  eq(socialMatch.inProse({ textContent: 'x', parentElement: null }), false);
});

test('the furniture verdict resolves in the right order', () => {
  const v = socialMatch.verdict;
  /* Each line is a bug that shipped. Icon before prose: notebookcheck's
   * follow icons sit beside header text and survived when prose won. */
  eq(v({ ctx: false, text: '', label: '', prose: true }), true,
     'an icon next to text is still furniture');
  eq(v({ ctx: false, text: '@someone', label: '', prose: true }), false,
     'a handle inside a sentence must survive');
  eq(v({ ctx: true, text: 'Read more', label: '', prose: true }), true,
     'a share container wins outright');
  eq(v({ ctx: false, text: '@someone', label: '', prose: false }), true,
     'a standalone handle link is furniture');
  eq(v({ ctx: false, text: 'the full statement', label: '', prose: false }), false,
     'an ordinary link is not furniture');
  eq(v({ ctx: false, text: 'x', label: 'Click to share this post on Facebook', prose: false }), true,
     'a share label is furniture');
});

test('an icon-only link is furniture whatever its title says', () => {
  /* The defect this pins: reading title instead of the empty text turned
   * notebookcheck's share icons into content and left them on the page. */
  eq(socialMatch.isFurnitureText(''), true, 'empty text must be furniture');
  ok(socialMatch.FURNITURE_LABEL.test('Click to share this post on Facebook'),
     'a wordy share title must still read as furniture');
  ok(socialMatch.FURNITURE_LABEL.test('Follow us on Instagram'));
  eq(socialMatch.FURNITURE_LABEL.test('Read the full interview'), false);
});

test('turning a platform off drops exactly its hosts', () => {
  const all = socialMatch.hostsFor(null);
  const noX = socialMatch.hostsFor({ facebook: true, instagram: true, x: false, tiktok: true });
  for (const h of ['x.com', 'twitter.com', 't.co']) {
    ok(all.indexOf(h) !== -1, h + ' must be in the full list');
    eq(noX.indexOf(h), -1, h + ' must go when X is off');
  }
  /* ...and nothing else moves. */
  for (const h of ['facebook.com', 'fb.me', 'instagram.com', 'tiktok.com',
                   'linkedin.com', 'lnkd.in', 'snapchat.com']) {
    ok(noX.indexOf(h) !== -1, h + ' must survive turning X off');
  }
  eq(socialMatch.isSocialHostIn('x.com', noX), false);
  eq(socialMatch.isSocialHostIn('facebook.com', noX), true);
});

test('the content script and the options page share one set of defaults', () => {
  /* Two copies exist because the MAIN-world script cannot import from the
   * options page. A drift between them means an install that never opened
   * settings behaves differently from one that did. */
  const optSrc = read(file('options.js'));
  const block = /const SOCIAL_DEFAULTS = \{([\s\S]*?)\n  \};/.exec(optSrc);
  ok(block, 'no SOCIAL_DEFAULTS in options.js');
  const parsed = new Function('return {' + block[1] + '}')();
  const d = socialMatch.DEFAULTS;
  eq(parsed.enabled, d.enabled, 'enabled default differs');
  eq(parsed.mode, d.mode, 'mode default differs');
  eq(parsed.keepLogins, d.keepLogins, 'keepLogins default differs');
  eq(parsed.keepText, d.keepText, 'keepText default differs');
  for (const k of Object.keys(socialMatch.GROUPS)) {
    eq(parsed.platforms[k], d.platforms[k], 'platform default differs: ' + k);
  }
});

test('every platform in the settings page is one the script knows', () => {
  const html = read(file('options.html'));
  const shown = [...html.matchAll(/class="plat" value="([a-z]+)"/g)].map((m) => m[1]);
  const known = Object.keys(socialMatch.GROUPS);
  eq(shown.length, known.length, 'settings page lists ' + shown.length +
     ' platforms, script knows ' + known.length);
  for (const s of shown) ok(known.indexOf(s) !== -1, 'unknown platform in UI: ' + s);
  for (const k of known) ok(shown.indexOf(k) !== -1, 'platform missing from UI: ' + k);
  /* Mark-only mode is the reason the marker path exists; it must be offered. */
  for (const m of ['value="remove"', 'value="mark"', 'id="keepLogins"', 'id="keepText"']) {
    ok(html.indexOf(m) !== -1, 'settings page is missing ' + m);
  }
});

test('both passes reach into shadow DOM', () => {
  /* msn.com: 1 anchor in the light DOM, 73 across 161 open shadow roots.
   * A document-level query saw none of them. */
  const src = read(file('social.js'));
  ok(/const roots = \(\) => \{[\s\S]*?el\.shadowRoot/.test(src),
     'roots() must collect open shadow roots');
  ok(src.indexOf("queryAll('a[href]')") !== -1,
     'the marking pass must use the shadow-aware query');
  ok(src.indexOf('queryAll(WIDGET)') !== -1,
     'widget removal must use it too');
  eq(/document\.querySelectorAll\('a\[href\]'\)/.test(src), false,
     'no document-only anchor query may remain');
});

test('the hide rule is installed per root, not once', () => {
  /* A stylesheet in the document does not apply inside a shadow root, so a
   * marked link there would stay visible. */
  const src = read(file('social.js'));
  ok(/const styleRoot = \(root\)/.test(src), 'no styleRoot() in social.js');
  ok(src.indexOf('styleRoot(a.getRootNode())') !== -1,
     'a link left marked must have the rule installed in its own root');
});

test('the observer coalesces sweeps', () => {
  /* A sweep now walks every shadow root; running one per mutation batch on a
   * page like msn.com is not affordable. */
  const src = read(file('social.js'));
  ok(src.indexOf('new MutationObserver(queueSweep)') !== -1,
     'the observer must go through the debounced queue');
  ok(/let queued = false;/.test(src), 'no debounce flag');
});

test('portal.js and its settings page agree on defaults', () => {
  const msnSrc = read(file('portal.js'));
  const m = /const DEFAULTS = \{([^}]*)\}/.exec(msnSrc);
  ok(m, 'no DEFAULTS in portal.js');
  const d = new Function('return {' + m[1] + '}')();
  const o = /const MSN_DEFAULTS = \{([^}]*)\}/.exec(read(file('options.js')));
  ok(o, 'no MSN_DEFAULTS in options.js');
  const p = new Function('return {' + o[1] + '}')();
  for (const k of ['comments', 'cards', 'tabs', 'feed']) {
    eq(d[k], p[k], k + ' default differs between msn.js and options.js');
    eq(d[k], true, k + ' must be removed by default');
  }
});

test('the feed is only torn out on a portal homepage', () => {
  /* An article page has a river of related stories too, and a Bing search page
   * has its own furniture. This must never be what removes them. */
  const msnSrc = read(file('portal.js'));
  const m = /const isHomepage = \(\) => \{[\s\S]*?\n  \};/.exec(msnSrc);
  ok(m, 'no isHomepage() in portal.js');
  /* Evaluated with a fake location, so the real predicate is under test. */
  const build = new Function('location', m[0].replace('const isHomepage =', 'return'));
  const isHome = (host, path) => build({ hostname: host, pathname: path })();

  for (const [h, p2] of [['www.msn.com', '/'], ['www.msn.com', '/en-gb'],
                         ['www.msn.com', '/en-gb/'], ['www.bing.com', '/']]) {
    ok(isHome(h, p2), 'should be home: ' + h + p2);
  }
  for (const [h, p2] of [['www.msn.com', '/en-gb/news/uknews/story-abc'],
                         ['www.msn.com', '/en-gb/weather'],
                         ['www.msn.com', '/en-gb/feed/personalize/settings'],
                         ['www.bing.com', '/search'],
                         ['www.bing.com', '/images/search'],
                         ['www.bing.com', '/en-gb']]) {
    eq(isHome(h, p2), false, 'must NOT be treated as home: ' + h + p2);
  }
  ok(/const killFeed = cfg\.feed && isHomepage\(\);/.test(msnSrc),
     'the gate must be computed once per sweep');
  ok(/if \(killFeed && FEED\.indexOf\(n\) !== -1\)/.test(msnSrc),
     'the feed removal must test killFeed, not cfg.feed directly');
  ok(/if \(killFeed\) \{\n        for \(const el of queryAll\(FEED_SELECTOR\)\)/.test(msnSrc),
     "Bing's carousel strip must be behind the same gate");
  /* Bing rebuilds the strip on a page refresh; the rule stops it flashing back
   * between sweeps, and must itself be gated on the homepage test. */
  ok(/const FEED_CSS = FEED_SELECTOR \+ '\{display:none!important\}';/.test(msnSrc),
     'no hide rule for the rebuilt strip');
  ok(/if \(!\(cfg\.feed && isHomepage\(\)\)\) \{ if \(had\) had\.remove\(\); return; \}/.test(msnSrc),
     'the hide rule must be removed when the setting is off or off-homepage');
});


test('portal.js targets component names, not hashed classes', () => {
  /* MSN class names are per-build hashes (css-p30qmo); data-t names are not. */
  const msnSrc = read(file('portal.js'));
  ok(msnSrc.indexOf("queryAll('[data-t]')") !== -1, 'must select on data-t');
  for (const n of ['WeatherCardWC', 'MoneyInfo', 'SportsCard', 'TeamVsTeam',
                   'LeadGen.', 'meStripe.Games']) {
    ok(msnSrc.indexOf(n) !== -1, 'missing target: ' + n);
  }
  /* Names that were guessed and never observed in the feed. Coverage here is
   * evidence-based like everywhere else in this project. */
  for (const n of ['RecipeCard', 'AutosCard', 'TodaysMoment', 'CommunityCard']) {
    eq(msnSrc.indexOf(n) !== -1, false, 'unobserved name must not be shipped: ' + n);
  }
  eq(/css-[a-z0-9]{6}/.test(msnSrc), false, 'must not target a hashed class name');
  /* Everything on msn.com is in shadow DOM. */
  ok(/const roots = \(\) => \{[\s\S]*?el\.shadowRoot/.test(msnSrc),
     'portal.js must walk shadow roots');
});

test('portal.js is scoped to msn.com and bing.com only', () => {
  /* Read locally: this block runs before the manifest section declares its own. */
  const mf = JSON.parse(read(file('manifest.json')));
  const e = mf.content_scripts.find((c) => c.js.indexOf('portal.js') !== -1);
  ok(e, 'portal.js is not registered');
  eq(e.matches.slice().sort().join(','), '*://*.bing.com/*,*://*.msn.com/*',
     'portal.js must not run anywhere else');
  eq(e.world, undefined, 'portal.js needs chrome.storage, so not world:MAIN');
});

test('Disqus is blocked by a ruleset of its own, and disqus.com still works', () => {
  const mf = JSON.parse(read(file('manifest.json')));
  const sets = mf.declarative_net_request.rule_resources;
  const w = sets.find((s) => s.id === 'widgets');
  ok(w && w.enabled, 'widgets ruleset missing or not on by default');
  for (const s of sets) if (s !== w) ok(s.path !== w.path, 'widgets must not share ' + s.path);
  const rules = JSON.parse(read(file(w.path)));
  const filters = rules.map((r) => r.condition.urlFilter);
  for (const f of ['||disqus.com^', '||disquscdn.com^']) ok(filters.indexOf(f) !== -1, f + ' not blocked');
  for (const r of rules) {
    eq(r.action.type, 'block', 'block only, anything else needs host permissions');
    ok(/disqus(cdn)?\.com\^$/.test(r.condition.urlFilter), 'unexpected target ' + r.condition.urlFilter);
    ok((r.condition.excludedInitiatorDomains || []).indexOf('disqus.com') !== -1,
       'disqus.com must keep working on its own site');
    ok(r.condition.resourceTypes.indexOf('main_frame') === -1, 'never block navigating to Disqus');
    ok(r.condition.resourceTypes.indexOf('sub_frame') !== -1, 'the comment frame is the point');
  }
  /* The switch must drive this ruleset, and default to blocked. */
  const opt = read(file('options.js'));
  ok(opt.indexOf("const RULESET = 'widgets'") !== -1, 'options page does not name the ruleset');
  ok(/\.comments !== false/.test(opt), 'the comments switch must default to on');
  ok(opt.indexOf('applyWidgets(hideComments.checked)') !== -1,
     'the one comments switch must also drive the Disqus ruleset');
});

const commentsSrc = read(file('comments.js'));
const liftC = (name) => {
  const i = commentsSrc.indexOf('const ' + name + ' =');
  ok(i !== -1, 'cannot find ' + name + ' in comments.js');
  return commentsSrc.slice(i, commentsSrc.indexOf('\n\n', i)).replace(/const (\w+) =/g, 'var $1 =');
};
const commentVerdict = new Function(
  liftC('COMMENT_WORD') + ';' + liftC('words') + ';' + liftC('commentVerdict') + ';' +
  'return commentVerdict;')();

test('comment furniture is recognised by its own naming, on any site', () => {
  const yes = [
    { tag: 'SECTION', id: 'comments', cls: 'jsx-1120709024 comments-section' },   // ign.com
    { tag: 'DIV', id: 'comments', cls: 'post-comments' },                          // petapixel.com
    { tag: 'DIV', id: 'disqus_thread', cls: '' },
    { tag: 'DIV', id: '', cls: 'caption jsx-1762799490 comment-count data small' },  // ign cards
    { tag: 'DIV', id: '', cls: 'commentsContainer' },                              // camelCase
    { tag: 'OL', id: '', cls: 'commentList' },
    { tag: 'SPAN', id: '', cls: 'comments-link' },                                 // WordPress meta
    { tag: 'DIV', id: 'comment-form', cls: '' }
  ];
  for (const e of yes) ok(commentVerdict(e), 'missed ' + JSON.stringify(e));
});

test('comment rules never take the page, or words that merely resemble it', () => {
  const no = [
    /* WordPress puts this on <body>: a word match alone would blank the site. */
    { tag: 'BODY', id: '', cls: 'post-template single comments-open' },
    { tag: 'ARTICLE', id: 'post-1', cls: 'post comments-open' },
    { tag: 'MAIN', id: 'comments', cls: '' },
    /* A wrapper around the article is never a comment section. */
    { tag: 'DIV', id: 'comments', cls: '', wraps: true },
    /* Near misses. */
    { tag: 'DIV', id: '', cls: 'commentary' },
    { tag: 'DIV', id: '', cls: 'expert-commentary-box' },
    { tag: 'SPAN', id: '', cls: 'comment' },          // bare singular: too common a word
    { tag: 'DIV', id: '', cls: 'no-comment-policy' },
    { tag: 'DIV', id: '', cls: 'commented-code' },
    /* Jira's renderer for every comment AND the description: the pair is
     * split across two class names and must not combine. */
    { tag: 'DIV', id: '', cls: 'ak-renderer-wrapper is-comment css-pw7jst' },
    { tag: 'DIV', id: 'comment', cls: 'thread-list' }
  ];
  for (const e of no) eq(commentVerdict(e), false, 'wrongly matched ' + JSON.stringify(e));
});

/* A control that carries no comment word in id or class -- the whole of
 * YouTube's Shorts rail -- is read by its accessible name instead. */
const controlVerdict = new Function(
  liftC('COMMENT_WORD') + ';' + liftC('words') + ';' + liftC('commentVerdict') + ';' +
  liftC('CONTROL') + ';' + liftC('controlVerdict') + ';' + 'return controlVerdict;')();
const alone = new Function(liftC('CONTROL') + ';' + liftC('alone') + ';' + 'return alone;')();

test('a wordless control is read by its accessible name', () => {
  const yes = [
    /* youtube.com Shorts rail: id empty, every class a component-shape name
     * shared with like, share and remix. The label is all there is. */
    { tag: 'BUTTON', label: 'View 750 comments', text: '' },
    { tag: 'BUTTON', label: 'View 750 comments', text: '750' },
    { tag: 'A', label: '12 comments', text: '1.2k' },
    { tag: 'BUTTON', label: 'Comment thread', text: '' },
    { tag: 'DIV', label: 'Comments', text: '' }
  ];
  for (const e of yes) ok(controlVerdict(e), 'missed ' + JSON.stringify(e));
});

test('a control with words of its own is not judged by its label', () => {
  const no = [
    /* A feedback form's submit button: it mentions comments, it is not one. */
    { tag: 'BUTTON', label: 'Submit comments', text: 'Submit' },
    { tag: 'A', label: 'Read our comments policy', text: 'Comments policy' },
    /* Same word rules as a name: bare singular and near misses do not count. */
    { tag: 'BUTTON', label: 'Comment', text: '' },
    { tag: 'BUTTON', label: 'Add commentary', text: '' },
    { tag: 'BUTTON', label: '', text: '' },
    /* The page's own guards still apply to a control. */
    { tag: 'BODY', label: 'comments', text: '' },
    { tag: 'BUTTON', label: 'View 750 comments', text: '', wraps: true }
  ];
  for (const e of no) eq(controlVerdict(e), false, 'wrongly matched ' + JSON.stringify(e));
});

test('a marked control widens over its count caption and nothing else', () => {
  const node = (text, control) => ({ nodeType: 1, textContent: text,
                                     matches: () => control, querySelector: () => null });
  const text = (t) => ({ nodeType: 3, textContent: t });
  const keep = node('', true);
  /* YouTube puts the count in a sibling of the button: hiding the button
   * alone left a bare "750" on the rail. */
  ok(alone({ childNodes: [keep, node('750', false)] }, keep), 'a count caption belongs to the control');
  ok(alone({ childNodes: [keep, node('1.2k', false)] }, keep), 'a short-form count belongs to the control');
  eq(alone({ childNodes: [keep, node('', true)] }, keep), false, 'a second control stops the widen');
  eq(alone({ childNodes: [keep, text(' now')] }, keep), false, 'prose beside the control stops the widen');
  eq(alone({ childNodes: [keep, node('Share', false)] }, keep), false, 'a worded sibling stops the widen');
});

test('comments.js: the label rule is scoped to controls, and stays out of the early CSS', () => {
  /* The early stylesheet matches by selector alone, with none of the guards --
   * that is how it hid techpowerup's div#comments.social-share. A label match
   * needs the wordless and wraps guards, so it is swept, never pre-painted. */
  const si = commentsSrc.indexOf('const SELECTORS =');
  const sel = commentsSrc.slice(si, commentsSrc.indexOf('\n\n', si));
  ok(sel.indexOf('aria-label') === -1 && sel.indexOf('title') === -1,
     'the unguarded early stylesheet must not match controls by label');
  /* Only controls carry a label into the verdict. */
  ok(/CONTROL_Q/.test(commentsSrc), 'the control query is missing');
  ok(/const CONTROL = 'a\[href\],button,\[role="button"\]'/.test(commentsSrc),
     'the label rule must be limited to links and buttons');
  ok(commentsSrc.indexOf("el.getAttribute('aria-label') || el.getAttribute('title')") !== -1,
     'the control pass must read the accessible name');
  ok(!/commentVerdict\(\{ tag: el\.tagName, id: el\.id, cls, label/.test(commentsSrc),
     'the id/class pass must not read labels as well');
  /* The widen climbs, so it gets the same guards and the same hard bound. */
  const wi = commentsSrc.indexOf('const widen =');
  const wd = commentsSrc.slice(wi, commentsSrc.indexOf('\n\n', wi));
  ok(wi !== -1, 'widen() not found');
  ok(/for \(let i = 0; i < 2; i\+\+\)/.test(wd), 'widen must stop at two levels');
  for (const g of ['document.body', 'NEVER_TAG.test(p.tagName)', 'wrapsContent(p)', 'alone(p, n)']) {
    ok(wd.indexOf(g) !== -1, 'widen lacks guard: ' + g);
  }
});

const exceptSrc = read(file('except.js'));
const urlExcepted = new Function((() => {
  const i = exceptSrc.indexOf('const urlExcepted =');
  ok(i !== -1, 'cannot find urlExcepted in except.js');
  return exceptSrc.slice(i, exceptSrc.indexOf('\n\n', i));
})() + '; return urlExcepted;')();

test('comment URL exceptions: sites, subdomains, path prefixes, pasted URLs', () => {
  const L = ['example.com', 'https://www.news.org/forum/?x=1', '*.tools.net', ' ', 'erp.co:8443/'];
  const yes = [
    ['example.com', '/'], ['app.example.com', '/a/b'],
    ['news.org', '/forum'], ['news.org', '/forum/thread/9'], ['www.news.org', '/forum/'],
    ['a.tools.net', '/'], ['erp.co', '/tasks'], ['EXAMPLE.COM.', '/']
  ];
  const no = [
    ['notexample.com', '/'], ['example.com.evil.io', '/'],
    ['news.org', '/'], ['news.org', '/forumx'], ['news.org', '/other/forum'],
    ['tools.network', '/'], ['', '/']
  ];
  for (const [h, p] of yes) ok(urlExcepted(h, p, L), 'should except ' + h + p);
  for (const [h, p] of no) eq(urlExcepted(h, p, L), false, 'wrongly excepted ' + h + p);
  eq(urlExcepted('example.com', '/', undefined), false, 'no list must mean no exception');
  /* Chrome match-pattern forms, as the user typed them after reading the
   * manifest: a trailing /* is a wildcard, not a literal path. */
  for (const e of ['*://*.atlassian.net/*', '*.atlassian.net/*', 'https://*.atlassian.net/*',
                   '(*.atlassian.net)', 'atlassian.net/', '"atlassian.net",']) {
    ok(urlExcepted('example.atlassian.net', '/jira/servicedesk/projects/CS', [e]), 'missed pattern ' + e);
  }
  ok(urlExcepted('news.org', '/forum/x', ['*://news.org/forum/*']), 'path pattern with wildcard');
  eq(urlExcepted('news.org', '/other', ['*://news.org/forum/*']), false, 'wildcard must keep its path');
});

test('comment URL exceptions: own storage key, read by comments.js, written by options', () => {
  const opt = read(file('options.js'));
  ok(commentsSrc.indexOf("const EXCEPT = 'commentExceptions'") !== -1, 'comments.js must read commentExceptions');
  ok(opt.indexOf("bindExceptions('commentsExcept', 'commentExceptions')") !== -1, 'options.js must write commentExceptions');
  ok(opt.indexOf('commentsExcept') !== -1 && read(file('options.html')).indexOf('id="commentsExcept"') !== -1,
     'the exceptions box is missing from the settings page');
  ok(!/\[WIDGETS\]:\s*\{[^}]*xcept/.test(opt), 'exceptions must not be folded into the widgets key');
  ok(/location\.href !== href\) \{[^}]*apply\(\)/.test(commentsSrc),
     'a path exception must be re-checked on SPA navigation');
});

test('comments.js: early stylesheet first, default on, settings saved together', () => {
  const first = commentsSrc.indexOf('\n  install();');
  const get = commentsSrc.indexOf('chrome.storage.sync.get');
  ok(first !== -1 && first < get, 'stylesheet must be installed before settings are read');
  ok(/\.comments !== false/.test(commentsSrc), 'only an explicit false may turn it off');
  ok(commentsSrc.indexOf('wrapsContent(el)') !== -1, 'the live sweep must apply the wraps guard');
  /* Comments are <article>s by the spec (techpowerup: section.comments >
   * article.forumpost), so the guard is the page's h1/main/own article, never
   * "any article". */
  const wi = commentsSrc.indexOf('const wrapsContent =');
  const wr = commentsSrc.slice(wi, commentsSrc.indexOf('\n\n', wi));
  ok(!/querySelector\([^)]*\barticle\b/.test(wr), 'wraps guard must not refuse any container of an <article>');
  ok(wr.indexOf("h1.closest('article')") !== -1 && wr.indexOf('el.contains(h1)') !== -1,
     "wraps guard must protect the page's h1 and the article holding it");
  /* The empty-frame collapse (ign.com's 636px div.bottom-content) climbs, so
   * it gets the same guards, a hard bound, and no text of its own. */
  const ci = commentsSrc.indexOf('const collapse =');
  const col = commentsSrc.slice(ci, commentsSrc.indexOf('\n\n', ci));
  ok(ci !== -1, 'collapse() not found');
  ok(/for \(let i = 0; i < 2; i\+\+\)/.test(col), 'collapse must stop at two levels');
  for (const g of ['document.body', 'NEVER_TAG.test(p.tagName)', 'wrapsContent(p)', "textContent.trim() !== ''"]) {
    ok(col.indexOf(g) !== -1, 'collapse lacks guard: ' + g);
  }
  const opt = read(file('options.js'));
  /* One setting for all comment removal, at the user's direction. */
  const html = read(file('options.html'));
  eq((html.match(/id="hideComments"/g) || []).length, 1, 'exactly one comments switch');
  ok(html.indexOf('blockDisqus') === -1 && opt.indexOf('blockDisqus') === -1,
     'no separate Disqus switch');
  const mf = JSON.parse(read(file('manifest.json')));
  const cs = mf.content_scripts.find((x) => x.js.indexOf('comments.js') !== -1);
  ok(cs && cs.run_at === 'document_start', 'comments.js must run at document_start');
});

const newsSrc = read(file('newsletter.js'));
const liftN = (name) => {
  const i = newsSrc.indexOf('const ' + name + ' =');
  ok(i !== -1, 'cannot find ' + name + ' in newsletter.js');
  return newsSrc.slice(i, newsSrc.indexOf('\n\n', i)).replace(/const (\w+) =/g, 'var $1 =');
};
const news = new Function(
  liftN('NEWS_WORD') + ';' + liftN('words') + ';' + liftN('namedNewsletter') + ';' +
  liftN('overlayVerdict') + ';' +
  'return { named: namedNewsletter, overlay: overlayVerdict };')();

test('newsletter sign-ups are recognised by their own naming (whathifi)', () => {
  for (const e of [{ id: 'newsletter-capture-modal', cls: '' },
                   { id: 'slice-container-newsletterForm-articleInbodyContent-x', cls: 'slice-container newsletter-inbodyContent-slice' },
                   { id: '', cls: 'newsletter-form__wrapper' },
                   { id: '', cls: 'newsletterSignup' }]) {
    ok(news.named(e), 'missed ' + JSON.stringify(e));
  }
  for (const e of [{ id: '', cls: 'news-letterbox' }, { id: '', cls: 'latest-news' }, { id: 'main', cls: '' }]) {
    eq(news.named(e), false, 'wrongly matched ' + JSON.stringify(e));
  }
});

test('an unnamed popup counts only as a fixed overlay with an email field asking to subscribe', () => {
  const t = 'The latest hi-fi, home cinema and tech news, direct to your inbox. Your Email Address SIGN ME UP';
  eq(news.overlay({ fixed: true, hasEmail: true, hasPassword: false, text: t }), true, 'whathifi popup copy');
  eq(news.overlay({ fixed: false, hasEmail: true, hasPassword: false, text: t }), false, 'not fixed: not a popup');
  eq(news.overlay({ fixed: true, hasEmail: false, hasPassword: false, text: t }), false, 'no email field');
  eq(news.overlay({ fixed: true, hasEmail: true, hasPassword: true, text: t }), false, 'a login form');
  eq(news.overlay({ fixed: true, hasEmail: true, hasPassword: false,
                    text: 'Contact support. Your email. Send message' }), false, 'a contact form');
  eq(news.overlay({ fixed: true, hasEmail: true, hasPassword: false, text: 'subscribe ' + 'x'.repeat(1600) }),
     false, 'a page-sized overlay is not a popup');
});

test('newsletter.js: never login forms, unlock only for popups, settings saved together', () => {
  ok(newsSrc.indexOf("form.querySelector('input[type=\"password\"]')") !== -1, 'password forms must be skipped');
  ok(newsSrc.indexOf("'[' + MARK + '=\"overlay\"]'") !== -1, 'scroll unlock must be limited to marked overlays');
  ok(newsSrc.indexOf('wrapsContent(n)') !== -1, 'the climb must stop at page content');
  const opt = read(file('options.js'));
  ok(/comments: hideComments\.checked, newsletter: hideNewsletter\.checked/.test(opt),
     'options page must save comments and newsletter together');
  ok(/\.newsletter !== false/.test(newsSrc) && /\.newsletter !== false/.test(opt), 'must default to on');
});

test('the portal rules are a separate ruleset, block-only', () => {
  /* Separate on purpose: adding a redirect action to the shared ruleset once
   * invalidated the whole thing and silently killed rule 1 on 269 Newsquest
   * sites. A mistake here cannot reach that file. */
  const mf = JSON.parse(read(file('manifest.json')));
  const sets = mf.declarative_net_request.rule_resources;
  const portal = sets.find((s) => s.id === 'portal');
  const sp = sets.find((s) => s.id === 'sourcepoint');
  ok(portal, 'no portal ruleset');
  ok(sp && sp.enabled, 'the Sourcepoint ruleset must stay enabled');
  ok(portal.path !== sp.path, 'the portal rules must live in their own file');

  const rules = JSON.parse(read(file(portal.path)));
  ok(rules.length > 0, 'portal ruleset is empty');
  for (const r of rules) {
    eq(r.action.type, 'block', 'block only — anything else needs host permissions');
    ok(Array.isArray(r.condition.initiatorDomains),
       'every rule must name its initiator, or it applies to the whole web');
    for (const d of r.condition.initiatorDomains) {
      ok(['bing.com', 'msn.com'].indexOf(d) !== -1, 'unexpected initiator: ' + d);
    }
  }
  /* The two endpoints measured this session. */
  const filters = rules.map((r) => r.condition.urlFilter).join(' ');
  ok(filters.indexOf('/pcs/api/widget/') !== -1, "Bing's feed endpoint is not blocked");
  ok(filters.indexOf('/service/segments/recoitems/') !== -1,
     "MSN's card data endpoint is not blocked");
  /* Never the image hosts: th.bing.com also serves image search, and
   * img-s-msn-com serves article photos. */
  for (const host of ['th.bing.com', 'img-s-msn-com', 'akamaized']) {
    eq(filters.indexOf(host) !== -1, false,
       'blocking ' + host + ' would break search results and article images');
  }
});

test('permissions did not grow for the new rules', () => {
  /* A block action needs no host access. If this ever fails, something asked
   * for a redirect. */
  const mf = JSON.parse(read(file('manifest.json')));
  eq(mf.permissions.slice().sort().join(','), 'declarativeNetRequest,storage');
  eq(mf.host_permissions, undefined, 'no host permissions, ever');
});

print('\nportal-early.js — hidden before first paint');

const earlySrc = read(file('portal-early.js'));

test('it runs in the MAIN world at document_start', () => {
  /* Both are load-bearing: Element.prototype belongs to the page, and a root
   * created before we patch attachShadow is one we never see. */
  const mf = JSON.parse(read(file('manifest.json')));
  const e = mf.content_scripts.find((c) => c.js.indexOf('portal-early.js') !== -1);
  ok(e, 'portal-early.js is not registered');
  eq(e.run_at, 'document_start');
  eq(e.world, 'MAIN');
  eq(e.matches.slice().sort().join(','), '*://*.bing.com/*,*://*.msn.com/*');
  /* It must come before the isolated half, which listens for nothing and
   * simply sweeps. */
  const iEarly = mf.content_scripts.findIndex((c) => c.js.indexOf('portal-early.js') !== -1);
  const iLate = mf.content_scripts.findIndex((c) => c.js.indexOf('portal.js') !== -1);
  ok(iEarly < iLate, 'the early script must be registered before portal.js');
});

test('it patches attachShadow rather than querying for roots', () => {
  /* At document_start there are no roots to find, and closed roots can never
   * be found at all. */
  ok(/Element\.prototype\.attachShadow = function/.test(earlySrc),
     'attachShadow must be patched');
  ok(/const root = native\.call\(this, init\);/.test(earlySrc),
     'the native root must still be created and returned');
  ok(/adopt\(root\);\s*\n\s*return root;/.test(earlySrc),
     'the root must be returned after adopting, not swallowed');
});

test('the selectors match component names exactly, LeadGen by prefix', () => {
  /* data-t is JSON: {"n":"WeatherCardWC","t":8}. The closing quote is what
   * makes a substring match exact. */
  ok(earlySrc.indexOf('\'"n":"Comments"\'') !== -1, 'Comments selector is not exact');
  ok(earlySrc.indexOf('\'"n":"LeadGen.') !== -1, 'LeadGen must match by prefix');
  ok(earlySrc.indexOf('#scroll_cont') !== -1, "Bing's strip must be covered");
  /* Every name the sweep removes must also be hidden early, or it flashes. */
  const portalSrc = read(file('portal.js'));
  for (const n of ['WeatherCardWC', 'MoneyInfo', 'SportsCard', 'TeamVsTeam',
                   'PivotsNav', 'WaterfallViewFeed', 'BingHomepageFeed', 'Comments']) {
    ok(portalSrc.indexOf(n) !== -1, portal_missing(n, 'portal.js'));
    ok(earlySrc.indexOf('"n":"' + n + '"') !== -1, portal_missing(n, 'portal-early.js'));
  }
});

function portal_missing(n, where) { return n + ' is missing from ' + where; }

test('declarative shadow DOM is covered too', () => {
  /* The flash survived the first attempt because of this: MSN serves
   * <template shadowrootmode>, the parser builds those roots itself, and
   * attachShadow is never called for them. */
  ok(/new MutationObserver\(queueScan\)/.test(earlySrc),
     'parsed-in shadow roots must be picked up by an observer');
  /* The host is appended BEFORE its <template shadowrootmode> is parsed, so
   * host.shadowRoot is null at mutation time. Scanning only addedNodes misses
   * every declarative root — which is exactly what kept the flash alive. */
  ok(/const scanInner = \(\) => \{[\s\S]*?document\.querySelectorAll\('\*'\)/.test(earlySrc),
     'the whole tree must be re-scanned, not just the added nodes');
  eq(/for \(const node of rec\.addedNodes\) adoptFrom\(node\)/.test(earlySrc), false,
     'an addedNodes-only walk cannot see a declarative root');
  ok(/if \(Date\.now\(\) < until && document\.readyState !== 'complete'\)/.test(earlySrc),
     'scanning must continue while the document is still parsing');
});

test('a plain <style> backs up the adopted sheets', () => {
  /* Assigning document.adoptedStyleSheets replaces the array, so the page can
   * drop ours without meaning to. */
  ok(/id = 'ktp-portal-early';/.test(earlySrc), 'no backup style element');
  ok(/const el = document\.getElementById\('ktp-portal-early'\);/.test(earlySrc),
     'the backup must follow the settings like the sheets do');
});

test('structural selectors match before any attribute is read', () => {
  /* Tag and id selectors hit at parse time; a data-t match needs the attribute
   * to be present and correct. Belt and braces, homepage only. */
  for (const s of ['#scroll_cont', '#widget_container', '.peregrine-widgets',
                   'cs-responsive-feed-layout']) {
    ok(earlySrc.indexOf(s) !== -1, 'missing structural selector: ' + s);
  }
  ok(/const FEED_EXTRA = \[/.test(earlySrc), 'structural selectors must be grouped');
  ok(/name === 'feed' && isHomepage\(\)/.test(earlySrc),
     'they must stay behind the homepage gate');
});

test('the feed rule is never applied off the homepage', () => {
  ok(/if \(name === 'feed' && !isHomepage\(\)\) return '';/.test(earlySrc),
     'an article page must not get the feed rule');
});

test('the two halves agree, and the config crosses as a string', () => {
  /* An object does not survive the MAIN/ISOLATED boundary reliably. */
  const portalSrc = read(file('portal.js'));
  ok(/detail: JSON\.stringify\(cfg\)/.test(portalSrc), 'config must cross as a string');
  ok(/JSON\.parse\(ev\.detail\)/.test(earlySrc), 'the early half must parse it back');
  const early = /const GROUPS = \{([\s\S]*?)\n  \};/.exec(earlySrc);
  ok(early, 'no GROUPS in portal-early.js');
  for (const k of ['comments', 'cards', 'tabs', 'feed']) {
    ok(early[1].indexOf(k + ':') !== -1, 'early half is missing group: ' + k);
  }
});

test('the early half leaves a readable marker, only while tracing', () => {
  /* Console output does not survive the navigation that produced it, so the
   * counters are also written to <html> where they can be read at any time —
   * but only when the portal channel is on, or a normal install would be
   * writing a permanent marker to every MSN page. */
  ok(/data-ktp-early/.test(earlySrc), 'no marker attribute');
  ok(/const mark = \(extra\) => \{\n    if \(!traced\(\)\) return;/.test(earlySrc),
     'the marker must be behind the same trace gate as the log');
  ok(/peakVis/.test(earlySrc), 'the marker must carry the peak visible count');
  const v = /const VERSION = '(\d+)';/.exec(earlySrc);
  ok(v, 'no VERSION in the marker');
  const mf = JSON.parse(read(file('manifest.json')));
  ok(mf.version.endsWith(v[1]),
     'marker version ' + v[1] + ' does not match manifest ' + mf.version +
     ' — bump.sh ran without updating it, so the marker would lie about the build');
});

test('both portal halves log through the trace gate', () => {
  /* Console output is how this gets diagnosed; a bare console.log would also
   * write on a page with tracing off. */
  for (const [name, src] of [['portal-early.js', earlySrc],
                             ['portal.js', read(file('portal.js'))]]) {
    ok(/data-ktp-trace/.test(src), name + ' does not read the trace attribute');
    ok(/indexOf\('portal'\) !== -1/.test(src), name + ' does not use the portal channel');
    const bare = (src.match(/console\.(log|debug|warn|info)/g) || []);
    eq(bare.length, 1, name + ' must have exactly one console call, inside log()');
  }
});

print('\nprotections — defaults and the wiring that carries them');

const wallsSrc = read(file('walls.js'));
const bridgeSrc = read(file('bridge.js'));
const optHtml = read(file('options.html'));

test('the wall pattern matches the walls we have actually seen', () => {
  /* Lifted from walls.js so these are the production strings. Every "yes" here
   * is copy observed in a live wall; phoronix.com is why this test exists --
   * `disable (your |the )?ad ?block` never matched "by disabling your ad
   * blocker", so looksLikeWall() failed on its last gate while every other
   * gate passed, and the modal stayed on screen with the extension running. */
  const m = /const WALL_TEXT = new RegExp\(\[([\s\S]*?)\]\.join\('\|'\), 'i'\)/.exec(wallsSrc);
  ok(m, 'no WALL_TEXT in walls.js');
  const RE = new RegExp(new Function('return [' + m[1] + ']')().join('|'), 'i');

  for (const yes of [
    'Ads help keep Page Six content free',
    'ALLOW ADS ON PAGE SIX',
    'Please disable the ad blocker to continue',
    'Please support Phoronix by disabling your ad blocker.',
    'It looks like your ad blocker is on.',
    'Please turn off your adblocker',
    'Please whitelist us to continue']) {
    ok(RE.test(yes), 'should be seen as a wall: ' + yes);
  }

  /* It gates a removal, so ordinary page copy must not trip it. A consent
   * banner is not an anti-adblock wall (clicking one is how msn.com went
   * wrong), and a newsletter box is newsletter.js's job. */
  for (const no of [
    'We value your privacy',
    'This site uses cookies to improve your experience',
    'Accept all cookies',
    'Take control of your privacy',
    'Subscribe to our newsletter for the latest news',
    'Sign in to continue reading',
    'Join Phoronix Premium for ad-free viewing',
    'Support independent journalism']) {
    eq(RE.test(no), false, 'must NOT be treated as a wall: ' + no);
  }
});

test('the refusal pattern never matches an accept button', () => {
  /* The one mistake that would matter: clicking "I Accept" on the user's
   * behalf. The pattern is lifted from walls.js so it is the real one. */
  const m = /const REJECT_TEXT = new RegExp\('\^\(' \+ \[([\s\S]*?)\]\.join/.exec(wallsSrc);
  ok(m, 'no REJECT_TEXT in walls.js');
  const RE = new RegExp('^(' + new Function('return [' + m[1] + ']')().join('|') + ')$', 'i');
  for (const yes of ['Reject All', 'reject all', 'Decline', 'Only essential',
                     'Necessary only', 'Continue without accepting']) {
    ok(RE.test(yes), 'should refuse: ' + yes);
  }
  for (const no of ['I Accept', 'Accept All', 'Accept', 'Manage Preferences',
                    'Got it', 'OK', 'Agree and close', 'Allow all',
                    'Subscribe', 'Pay £2.99/mo', 'Privacy statement',
                    'List of partners (vendors)']) {
    eq(RE.test(no), false, 'must NOT click: ' + no);
  }
});

test('clicking a refusal does not arm the wall defences', () => {
  /* Caught in the trace on msn.com: arming switched on the body protection and
   * the extension started blocking the page's own removals. A cookie banner is
   * not an anti-adblock wall. */
  const m = /const label = clickReject\(el\);[\s\S]*?continue;\n        \}/.exec(wallsSrc);
  ok(m, 'cannot find the click branch in sweepConsent');
  eq(/armed = true/.test(m[0]), false,
     'the click branch must not set armed');
});

test('the marker says what is actually on screen, not just what we hide', () => {
  /* peakVis=0 through a whole load, with the feed still visibly flashing, says
   * the painting element is not one of our targets. Naming it is the only way
   * to stop guessing. */
  ok(/const biggest = \(\) => \{/.test(earlySrc), 'no biggest() probe');
  ok(/firstBig/.test(earlySrc), 'the first large painted block must be recorded');
  ok(/if \(traced\(\) && !firstBig\)/.test(earlySrc),
     'it must only run while tracing, and only until the first hit');
});

test('the early scan cannot die silently', () => {
  /* It did: one throw ended the loop, the counters froze at 889ms, and nothing
   * said why. */
  ok(/const scan = \(\) => \{\n    try \{ scanInner\(\); \} catch \(e\) \{/.test(earlySrc),
     'scan must catch its own errors');
  ok(/lastError = String/.test(earlySrc), 'the reason must be recorded');
  ok(/mark\('ERROR '/.test(earlySrc), 'and reported in the marker');
  ok(/traced\(\) \? stillVisible\(\) : 0/.test(earlySrc),
     'the visibility walk must only run while tracing');
});

test('refusal is tried before removal, and only once', () => {
  ok(wallsSrc.indexOf('askedToReject') !== -1, 'no one-shot guard for the click');
  const order = wallsSrc.indexOf('clickReject(el)') < wallsSrc.indexOf('dropNode(el);\n      found = true;');
  ok(order, 'the click must be attempted before the container is removed');
  ok(/if \(!askedToReject\.has\(el\)\)/.test(wallsSrc),
     'a banner must not be clicked repeatedly');
});

test('the Microsoft consent banner is in the CMP list', () => {
  /* msn.com: div#cmp-banner-sdk, position:fixed, 189px, inside
   * #mscmp-banner-container. Found by walking the stack at the bottom of the
   * viewport -- it matched none of the existing vendor ids. */
  for (const id of ['#mscmp-banner-container', '#cmp-banner-sdk']) {
    ok(wallsSrc.indexOf(id) !== -1, 'CMP_SELECTOR is missing ' + id);
  }
});

test('every defence defaults to ON', () => {
  /* The whole design: bridge.js publishes what is turned OFF, so an untouched
   * install writes no attribute and every defence runs. A default of "on"
   * cannot be spelled wrong here without this failing. */
  const m = /const off = DEFENCES\.filter\(\(d\) => p && p\[d\] === (false|true)\)/.exec(bridgeSrc);
  ok(m, 'bridge.js no longer computes the disabled list the expected way');
  eq(m[1], 'false', 'a defence must be off only when explicitly stored false');
  ok(bridgeSrc.indexOf('if (off.length === 0) root.removeAttribute(OFF_ATTR);') !== -1,
     'with nothing disabled the attribute must be removed, not written empty');
});

test('active() treats a missing attribute as everything on', () => {
  const body = /const active = \(name\) => \{[\s\S]*?\n  \};/.exec(wallsSrc);
  ok(body, 'no active() in walls.js');
  ok(body[0].indexOf('if (!offSpec) return true;') !== -1,
     'no attribute must mean every defence is active');
  ok(body[0].indexOf("indexOf(name) === -1") !== -1,
     'a named defence must be the one switched off');
});

test('each defence is actually gated on its own name', () => {
  /* A settings page that toggles nothing is worse than no settings page.
   * `timers` is absent on purpose: it is always on and must never be gated. */
  for (const [name, count] of [['walls', 2], ['consent', 2],
                               ['cookies', 2], ['dom', 1]]) {
    const hits = (wallsSrc.match(new RegExp("active\\('" + name + "'\\)", 'g')) || []).length;
    ok(hits >= count, name + ' is gated in ' + hits + ' place(s), expected at least ' + count);
  }
});

test('the settings page offers exactly the defences bridge.js carries', () => {
  const carried = /const DEFENCES = \[([^\]]+)\]/.exec(bridgeSrc);
  ok(carried, 'no DEFENCES list in bridge.js');
  const names = carried[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  const shown = [...optHtml.matchAll(/class="def" value="([a-z]+)"/g)].map((m) => m[1]);
  eq(shown.length, names.length, 'settings page shows ' + shown.length +
     ' defences, bridge carries ' + names.length);
  for (const n of names) ok(shown.indexOf(n) !== -1, 'defence missing from settings page: ' + n);
});

test('what cannot be switched is shown as unswitchable, not as a choice', () => {
  /* Both act before any setting can be read, so a working-looking checkbox
   * would be a lie. Two entries, both disabled and both saying "always on". */
  const fixed = optHtml.match(/<input type="checkbox" checked disabled>/g) || [];
  eq(fixed.length, 2, 'expected exactly two always-on entries (timers, adLight)');
  eq((optHtml.match(/always on/g) || []).length, 2, 'both must say so in words');
  const guardSrc = read(file('guard.js'));
  eq(/active\(/.test(guardSrc), false, 'guard.js must not pretend to read the setting');
  /* The timer filter must not acquire a gate later. */
  eq(/active\('timers'\)/.test(wallsSrc), false,
     'the timer filter must stay ungated — it runs before settings arrive');
});

test('the widgets channel gates comments, social and newsletter alike', () => {
  const html = read(file('options.html'));
  ok(/class="ch" value="widgets"/.test(html), 'the widgets channel is missing from the settings page');
  for (const f of ['comments.js', 'social.js', 'newsletter.js']) {
    const src = read(file(f));
    ok(/const CHANNEL = 'widgets';/.test(src), f + ' does not use the widgets channel');
    ok(/const TAG = '\[keep-the-page\//.test(src), f + ' has no log tag');
    /* Off by default and silent when off: the logger must be behind the gate,
     * and the gate must require both the master switch and the channel. */
    ok(/if \(tracing\) console\.debug\(TAG/.test(src), f + ' logs without checking the gate');
    ok(/t && t\.enabled && Array\.isArray\(t\.channels\)/.test(src),
       f + ' must require the master tracing switch, not the channel alone');
    /* Read from storage, not from bridge.js's attribute: these run in the
     * isolated world and are already reading the key beside it. */
    ok(src.indexOf('data-ktp-trace') === -1, f + ' must not depend on the bridge attribute');
    ok(/chrome\.storage\.sync\.get\(\[KEY, EXCEPT, TRACE\]/.test(src),
       f + ' does not read the trace setting');
    ok(/changes\[KEY\] \|\| changes\[EXCEPT\] \|\| changes\[TRACE\]/.test(src),
       f + ' does not follow a live change to the trace setting');
  }
  /* The one line that must be there even when nothing was found. */
  for (const f of ['comments.js', 'newsletter.js']) {
    ok(/log\(on \? 'on' : \('off: '/.test(read(file(f))),
       f + ' must say whether it was on for the page');
  }
  ok(/log\(!cfg\.enabled \? 'off: switch'/.test(read(file('social.js'))),
     'social.js must say whether it was on for the page');
});

test('trace channels and defence names are the same list', () => {
  const chans = [...optHtml.matchAll(/class="ch" value="([a-z]+)"/g)].map((m) => m[1]);
  const defs = [...optHtml.matchAll(/class="def" value="([a-z]+)"/g)].map((m) => m[1]);
  /* newsquest and timers trace but cannot be switched: both act earlier than
   * any setting can arrive. They are the only differences. */
  /* Channels with no switch of their own: newsquest and timers are always-on
   * defences, portal is a site cleanup with its own settings block. */
  /* `widgets` is the third of that kind: comments, social and newsletters are
   * switched in their own settings blocks, not under Protections. */
  const FIXED = ['newsquest', 'timers', 'portal', 'widgets'];
  eq(chans.filter((c) => FIXED.indexOf(c) === -1).sort().join(','),
     defs.slice().sort().join(','),
     'what you can switch off must be what you can trace');
  for (const f of FIXED) ok(chans.indexOf(f) !== -1, f + ' must still be traceable');
});

print('\nsettings in chrome.storage.sync');

/* Settings follow the Chrome profile; only the per-machine error log stays in
 * local. A reader left on local would see defaults forever once the
 * migration has emptied it, so this is checked per file, per line. */
const SYNCED_READERS = ['bridge.js', 'clutter.js', 'comments.js', 'newsletter.js',
                        'social.js', 'portal.js', 'options.js'];

test('settings are read and written in sync; only errors stays local', () => {
  for (const f of SYNCED_READERS) {
    const lines = read(file(f)).split('\n');
    lines.forEach((l, i) => {
      if (/chrome\.storage\.local\./.test(l)) {
        /* The reset clears local too, so an unmigrated copy cannot come back. */
        ok(/ERRORS/.test(l) || /chrome\.storage\.local\.remove\(RESET,/.test(l),
           f + ':' + (i + 1) + ' uses local for something other than errors');
      }
      if (/area !== 'local'/.test(l)) {
        throw new Error(f + ':' + (i + 1) + ' listens to local, settings change in sync');
      }
    });
  }
  for (const f of ['clutter.js', 'comments.js', 'newsletter.js', 'social.js', 'portal.js']) {
    ok(/area !== 'sync'/.test(read(file(f))), f + ' does not follow live changes in sync');
  }
  const bridge = read(file('bridge.js'));
  ok(/chrome\.storage\.sync\.get\(\[KEY, PROTECT\]/.test(bridge), 'bridge.js must read settings from sync');
  ok(/chrome\.storage\.local\.set\(\{ \[ERRORS\]/.test(bridge), 'the error log must stay in local');
});

const bgSrc = read(file('background.js'));

test('the migration list is exactly the keys the settings page saves', () => {
  const opt = read(file('options.js'));
  const saved = [...opt.matchAll(/const (?:KEY|PROTECT|SOCIAL|MSN|WIDGETS) = '(\w+)'/g)].map((m) => m[1])
    .concat([...opt.matchAll(/bindExceptions\('\w+', '(\w+)'\)/g)].map((m) => m[1]));
  const list = /const SETTINGS = \[([^\]]*)\]/.exec(bgSrc);
  ok(list, 'background.js has no SETTINGS list');
  const migrated = [...list[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  eq(migrated.slice().sort().join(','), saved.slice().sort().join(','),
     'a key saved to sync but not migrated is lost on upgrade');
  ok(migrated.indexOf('errors') === -1, 'errors is per-machine and must not be migrated');
});

test('reset removes exactly the migrated settings, from sync and local, never errors', () => {
  const opt = read(file('options.js'));
  const consts = {};
  for (const m of opt.matchAll(/const ([A-Z]+) = '(\w+)';/g)) consts[m[1]] = m[2];
  const r = /const RESET = \[([^\]]*)\]/.exec(opt);
  ok(r, 'options.js has no RESET list');
  const reset = r[1].split(',').map((x) => x.trim()).filter(Boolean)
    .map((x) => /^'(\w+)'$/.test(x) ? x.slice(1, -1) : consts[x]);
  const migrated = [.../const SETTINGS = \[([^\]]*)\]/.exec(bgSrc)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  eq(reset.slice().sort().join(','), migrated.slice().sort().join(','),
     'reset and migration must cover the same keys');
  ok(reset.indexOf('errors') === -1, 'reset must leave the error log alone');
  ok(/chrome\.storage\.sync\.remove\(RESET,/.test(opt), 'reset must clear sync');
  ok(/chrome\.storage\.local\.remove\(RESET,/.test(opt),
     'reset must clear local too, or the migration copies old values back');
  ok(!/\bconfirm\([^)]/.test(opt), 'no blocking confirm() dialog');
  ok(/id="reset"/.test(read(file('options.html'))), 'the reset button is missing from the settings page');
});

/* Runs the real background.js against fake storage areas. Each area's methods
 * return promises, as the MV3 API does; a GLib main loop drains them. */
const runBackground = (local, sync, opts) => {
  const o = opts || {};
  const listeners = {};
  const area = (store, refuse) => ({
    get: (keys) => Promise.resolve([].concat(keys).reduce((acc, k) => {
      if (k in store) acc[k] = JSON.parse(JSON.stringify(store[k]));
      return acc;
    }, {})),
    set: (items) => refuse ? Promise.reject(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'))
                           : Promise.resolve(Object.assign(store, items)),
    remove: (keys) => Promise.resolve([].concat(keys).forEach((k) => { delete store[k]; }))
  });
  const rulesets = [];
  const chrome = {
    storage: {
      local: area(local), sync: area(sync, o.refuseSync),
      onChanged: { addListener: (fn) => { listeners.changed = fn; } }
    },
    runtime: {
      onInstalled: { addListener: (fn) => { listeners.installed = fn; } },
      onStartup: { addListener: (fn) => { listeners.startup = fn; } }
    },
    declarativeNetRequest: {
      updateEnabledRulesets: (r) => { rulesets.push(r); return Promise.resolve(); }
    }
  };
  const quiet = { error: () => {}, log: () => {} };
  new Function('chrome', 'console', bgSrc)(chrome, quiet);
  ok(listeners.installed && listeners.startup, 'migration must run on install/update and on start');
  const loop = GLib.MainLoop.new(null, false);
  let failed = null;
  listeners.installed().then(() => loop.quit(), (e) => { failed = e; loop.quit(); });
  loop.run();
  if (failed) throw failed;
  return { rulesets, listeners };
};

test('migration copies local settings into sync, then removes them from local', () => {
  const local = { protect: { walls: false }, commentExceptions: ['example.com'],
                  errors: [{ where: 'x' }] };
  const sync = {};
  runBackground(local, sync);
  eq(JSON.stringify(sync.protect), '{"walls":false}', 'protect was not copied');
  eq(JSON.stringify(sync.commentExceptions), '["example.com"]', 'exceptions were not copied');
  eq('protect' in local, false, 'protect must be removed from local once synced');
  eq('commentExceptions' in local, false, 'exceptions must be removed from local once synced');
  ok(Array.isArray(local.errors), 'the error log must never be touched');
  eq('errors' in sync, false, 'the error log must never reach sync');
});

test('migration never overwrites a value sync already has', () => {
  const local = { social: { enabled: true } };
  const sync = { social: { enabled: false } };
  runBackground(local, sync);
  eq(sync.social.enabled, false, 'a synced value was clobbered by stale local data');
  eq('social' in local, false, 'the superseded local copy must still be removed');
});

test('a refused sync write keeps the local settings for the next start', () => {
  const local = { socialExceptions: ['a.example'] };
  const sync = {};
  runBackground(local, sync, { refuseSync: true });
  ok(Array.isArray(local.socialExceptions), 'local was emptied although sync refused the copy');
});

test('the Disqus ruleset follows the synced comments switch', () => {
  const off = runBackground({}, { widgets: { comments: false } });
  eq(JSON.stringify(off.rulesets[0]), '{"disableRulesetIds":["widgets"]}', 'switched off but still blocking');
  const on = runBackground({}, {});
  eq(JSON.stringify(on.rulesets[0]), '{"enableRulesetIds":["widgets"]}', 'default must block');
  on.listeners.changed({ widgets: { newValue: { comments: false } } }, 'sync');
  eq(JSON.stringify(on.rulesets[1]), '{"disableRulesetIds":["widgets"]}',
     'a change synced in from another machine must reach the ruleset');
});

print('\nmanifest.json');

const manifest = JSON.parse(read(file('manifest.json')));

test('the extension id is pinned, and the private key stays out of the repo', () => {
  /* Without a key, Chrome derives the id from the folder's absolute path:
   * move or rename the directory and every setting and exception list is
   * silently gone, because chrome.storage is per-id. */
  ok(typeof manifest.key === 'string' && /^[A-Za-z0-9+/]{300,}={0,2}$/.test(manifest.key),
     'manifest.key must carry the public key, or the id follows the folder path');
  /* This repo is public. The matching .pem lives outside it; the ignore file
   * is the second line of defence, not the first. */
  const ig = read(file('.gitignore'));
  for (const pat of ['*.pem', '*.crx']) {
    ok(ig.indexOf(pat) !== -1, '.gitignore must refuse ' + pat);
  }
});

test('bump.sh always moves the version, even twice in one minute', () => {
  const bump = read(file('bump.sh'));
  /* The failure this fixes: the files changed and the version did not, which
   * is indistinguishable from a bump that never ran. */
  ok(/if int\(last\) < floor:/.test(bump),
     'bump.sh must nudge the version when two bumps land in the same minute');
  ok(/floor = int\(cur\.rsplit/.test(bump),
     'the nudge must floor at the current version, or it walks backwards');
  ok(/%H:%M:%S/.test(bump), 'version_name must carry seconds');
  ok(/'key'/.test(bump), 'the reorder must keep manifest.key in the head block');
});

test('version is 1-4 integers, 0-65535, no leading zeros', () => {
  const parts = manifest.version.split('.');
  ok(parts.length >= 1 && parts.length <= 4, 'wrong number of parts: ' + manifest.version);
  for (const p of parts) {
    ok(/^(0|[1-9][0-9]*)$/.test(p), 'bad part "' + p + '" (Chrome rejects leading zeros)');
    const n = parseInt(p, 10);
    ok(n >= 0 && n <= 65535, 'part out of range: ' + p);
  }
});

test('no email address is written into this repository', () => {
  /* The repository is public. `author` carried one until the store audit
   * asked what it was for: Chrome and the store have ignored the key since
   * February 2024, so all it did was publish an address. It is gone, and the
   * sweep below is what stops one coming back through a doc, a comment or a
   * contact line. Contact routes go through the issue tracker instead.
   *
   * The pattern is deliberately crude. A false positive on some future
   * example address is a one-line exclusion; a false negative is an address
   * on the internet forever. */
  ok(manifest.author === undefined, 'the author key is back, and with it an address');
  const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const swept = ['manifest.json', 'options.html', 'options.js', 'PRIVACY.md',
                 'README.md', 'SUBMISSION.md', 'AGENTS.md', 'CLAUDE.md',
                 'package.sh', 'bump.sh', 'test.sh'];
  for (const cs of manifest.content_scripts) for (const j of cs.js) {
    if (swept.indexOf(j) === -1) swept.push(j);
  }
  for (const name of swept) {
    if (!exists(file(name))) continue;
    const hit = read(file(name)).match(ADDRESS);
    ok(!hit, name + ' carries an email address: ' + (hit ? hit[0] : ''));
  }
});

test('icons are declared at every size the store and the browser ask for', () => {
  /* The Web Store rejects a listing with no icon, and 128 is what the install
   * dialog shows. 48 is the extensions page, 16 the page favicon, 32 the one
   * Windows picks. Declared and missing is worse than absent -- Chrome loads
   * the extension and draws a blank. */
  ok(manifest.icons, 'icons key missing -- the store rejects a listing without one');
  for (const size of ['16', '32', '48', '128']) {
    const path = manifest.icons[size];
    ok(typeof path === 'string' && path, 'no ' + size + 'px icon declared');
    ok(/\.png$/.test(path), size + 'px icon is not a .png: ' + path);
    ok(exists(file(path)), 'declared but missing: ' + path);
  }
});

test('permissions stay minimal and host_permissions absent', () => {
  const perms = manifest.permissions.slice().sort();
  eq(JSON.stringify(perms), JSON.stringify(['declarativeNetRequest', 'storage']),
     'permissions drifted');
  eq(manifest.host_permissions, undefined, 'host_permissions must stay absent');
});

test('DNR rules use block only — a redirect action would need host access', () => {
  /* This one has bitten: adding `redirect` with only `declarativeNetRequest`
   * silently invalidated the entire ruleset. */
  const rules = JSON.parse(read(file('rules.json')));
  for (const r of rules) {
    eq(r.action.type, 'block', 'rule ' + r.id + ' uses a non-block action');
  }
});

test('every file the manifest references exists', () => {
  const wanted = [];
  for (const cs of manifest.content_scripts) for (const j of cs.js) wanted.push(j);
  for (const rr of manifest.declarative_net_request.rule_resources) wanted.push(rr.path);
  if (manifest.options_ui) wanted.push(manifest.options_ui.page);
  if (manifest.background) wanted.push(manifest.background.service_worker);
  if (manifest.action && manifest.action.default_popup) wanted.push(manifest.action.default_popup);
  for (const k in (manifest.icons || {})) wanted.push(manifest.icons[k]);
  for (const w of wanted) ok(exists(file(w)), 'missing file: ' + w);
});

test('bridge.js runs in the isolated world, before walls.js', () => {
  const cs = manifest.content_scripts;
  const bridge = cs.findIndex((e) => e.js.indexOf('bridge.js') !== -1);
  const walls = cs.findIndex((e) => e.js.indexOf('walls.js') !== -1);
  ok(bridge !== -1, 'bridge.js is not registered');
  ok(walls !== -1, 'walls.js is not registered');
  ok(bridge < walls, 'bridge.js must be injected before walls.js');
  eq(cs[bridge].world, undefined, 'bridge.js needs chrome.*, so it must NOT be world:MAIN');
  eq(cs[walls].world, 'MAIN', 'walls.js must run in the MAIN world');
});

test('incognito mode is declared, and is spanning', () => {
  eq(manifest.incognito, 'spanning', 'incognito mode missing or changed');
});

test('the toolbar action opens the settings page', () => {
  ok(manifest.action && manifest.action.default_popup === 'options.html',
     'action.default_popup must point at options.html');
});

test('social.js excludes the platforms own sites', () => {
  /* Without exclude_matches, visiting facebook.com would strip facebook.com. */
  const cs = manifest.content_scripts;
  const e = cs.find((x) => x.js.indexOf('social.js') !== -1);
  ok(e, 'social.js is not registered');
  eq(e.world, undefined, 'social.js needs chrome.storage, so not world:MAIN');
  const ex = (e.exclude_matches || []).join(' ');
  for (const h of ['facebook.com', 'instagram.com', 'twitter.com', 'x.com',
                   'tiktok.com', 'linkedin.com', 'snapchat.com']) {
    ok(ex.indexOf(h) !== -1, 'missing exclude_matches for ' + h);
  }
});

test('page-cleanup scripts stay off the user\'s business tools', () => {
  /* comments.js blanked every Jira comment and description: in a work tool the
   * comments ARE the content. Walls/consent still run there. */
  const cs = manifest.content_scripts;
  /* comments.js has none: the user's URL exceptions (commentExceptions)
   * cover it, and the user adds the tools there. */
  for (const f of ['newsletter.js', 'social.js']) {
    const e = cs.find((x) => x.js.indexOf(f) !== -1);
    ok(e, f + ' is not registered');
    const ex = e.exclude_matches || [];
    for (const t of ['*://*.atlassian.net/*']) {
      ok(ex.indexOf(t) !== -1, f + ' must exclude ' + t);
    }
  }
});

test('URL exceptions: one matcher, loaded first, one list per feature', () => {
  const opt = read(file('options.js'));
  const html = read(file('options.html'));
  for (const [f, key, box] of [['comments.js', 'commentExceptions', 'commentsExcept'],
                               ['social.js', 'socialExceptions', 'socialExcept'],
                               ['newsletter.js', 'newsletterExceptions', 'newsletterExcept']]) {
    const e = manifest.content_scripts.find((x) => x.js.indexOf(f) !== -1);
    ok(e && e.js[0] === 'except.js', f + ' must load except.js first');
    const src = read(file(f));
    ok(src.indexOf("const EXCEPT = '" + key + "'") !== -1, f + ' must read ' + key);
    ok(src.indexOf('self.ktpUrlExcepted') !== -1, f + ' must use the shared matcher');
    ok(!/const urlExcepted = \(host/.test(src), f + ' must not carry its own copy of the matcher');
    ok(opt.indexOf("bindExceptions('" + box + "', '" + key + "')") !== -1, 'options must bind ' + key);
    ok(html.indexOf('id="' + box + '"') !== -1, 'settings page is missing the ' + box + ' box');
  }
  /* social.js gates on active(), never cfg.enabled alone, or the list is ignored. */
  const soc = read(file('social.js'));
  ok(/const sweep = \(\) => \{\s*if \(!active\(\)\) return;/.test(soc), 'social sweep must honour the exceptions');
});

test('comments.js carries no hard-coded site exclusions', () => {
  const e = manifest.content_scripts.find((x) => x.js.indexOf('comments.js') !== -1);
  eq((e.exclude_matches || []).length, 0, 'comment exceptions belong in the settings list');
});

test('guard.js scope is exactly the recorded domain list', () => {
  /* guard.js carries the one URL list rule 8 permits, so it is the one most
   * able to grow quietly. newsquest-domains.txt was a second copy of it with
   * nothing tying the two together, and had already drifted by two hosts
   * before anyone looked. This is what ties them.
   *
   * Anything in guard.js scope that is not a Newsquest title belongs here,
   * with the reason it is in scope. */
  const EXTRA = {
    /* Not Newsquest, so no adLight. In scope for the other thing guard.js
     * does: pinning __adblocker=false against the npttech bait-file detector.
     * Their walls themselves moved to walls.js and are armed by signature
     * (eval-timer filter / overlay sweep), so whether either still needs
     * guard.js at all has not been re-verified since. */
    'notebookcheck.net': 'npttech bait-cookie pin',
    'pagesix.com': 'npttech bait-cookie pin'
  };

  const listed = read(file('newsquest-domains.txt')).split('\n')
    .map((l) => l.replace(/#.*$/, '').trim().toLowerCase())
    .filter((l) => l.length !== 0);
  ok(listed.length > 200, 'the domain list looks truncated: ' + listed.length);

  const e = manifest.content_scripts.find((x) => x.js.indexOf('guard.js') !== -1);
  ok(e, 'guard.js is not registered');

  const seen = {};
  for (const m of e.matches) {
    const parsed = /^\*:\/\/(\*\.)?([^/]+)\/\*$/.exec(m);
    ok(parsed, 'unexpected match pattern: ' + m);
    const h = parsed[2].toLowerCase();
    seen[h] = (seen[h] || 0) + 1;
  }

  const wanted = listed.concat(Object.keys(EXTRA)).sort();
  const got = Object.keys(seen).sort();

  for (const h of got) {
    eq(seen[h], 2, h + ' needs both the bare and the *. form');
    ok(wanted.indexOf(h) !== -1,
       h + ' is in guard.js scope but recorded nowhere — add it to ' +
       'newsquest-domains.txt, or to EXTRA here with the reason it is in scope');
  }
  for (const h of wanted) {
    ok(got.indexOf(h) !== -1, h + ' is recorded but is not in guard.js scope');
  }
  eq(got.length, wanted.length, 'the recorded list has duplicates');
});

test('detection is scoped by signature, not by a site list', () => {
  /* AGENTS.md rule 8. Only three entries may name a host, and each has a
   * documented reason: guard.js pins adLight before any signature can be
   * observed, and the portal pair is one product's widget stack in the MAIN
   * world. Anything else naming a host is a site list pretending to be scope. */
  const ALLOWED = ['guard.js', 'portal-early.js', 'portal.js'];
  const GLOBAL = ['http://*/*', 'https://*/*'];
  for (const cs of manifest.content_scripts) {
    if (cs.js.some((j) => ALLOWED.indexOf(j) !== -1)) continue;
    for (const m of cs.matches) {
      ok(GLOBAL.indexOf(m) !== -1,
         cs.js.join('+') + ' is scoped to ' + m + ' — cover it by signature instead');
    }
  }
});

test('popout.js and clutter.js run everywhere, and load the matcher first', () => {
  /* They were pinned to euronews.com and independent.co.uk while every
   * selector inside them was already a vendor name. */
  const e = manifest.content_scripts.find((x) => x.js.indexOf('clutter.js') !== -1);
  ok(e, 'clutter.js is not registered');
  ok(e.js.indexOf('popout.js') !== -1, 'popout.js and clutter.js share one entry');
  eq(e.js[0], 'except.js', 'clutter.js needs the shared exception matcher');
  eq(e.world, undefined, 'they need chrome.storage, so not world:MAIN');
  const joined = e.matches.join(' ');
  ok(joined.indexOf('euronews') === -1 && joined.indexOf('independent') === -1,
     'the site list is back');
});

test('the pre-paint hide covers only names that mean "popped out"', () => {
  /* CSS cannot test computed position, so a name that merely *might* be
   * floating would hide the page's own player. "sticky" is that name: it is
   * usually the article's real video, and it belongs in the swept list where
   * the position:fixed gate can judge it. */
  const src = read(file('popout.js'));
  const hide = /const HIDE = \[([\s\S]*?)\];/.exec(src);
  const sweep = /const SWEEP = HIDE\.concat\(\[([\s\S]*?)\]\);/.exec(src);
  ok(hide, 'HIDE list not found');
  ok(sweep, 'SWEEP list not found');
  ok(hide[1].indexOf('sticky') === -1, 'a "sticky" name must never be hidden before paint');
  ok(sweep[1].indexOf('sticky-player') !== -1, 'sticky-player must still be swept');
  ok(sweep[1].indexOf('sticky-video') !== -1, 'sticky-video must still be swept');
  ok(/isFloating|position === 'fixed'/.test(src), 'the swept list needs its position gate');
});

test('clutter.js removes a comment block only under the Comments switch', () => {
  /* Going global turned "remove the Vuukle block" into comment removal on
   * every site that embeds it, which belongs to the one Comments switch and
   * the user's exceptions -- not to a second, silent path. */
  const src = read(file('clutter.js'));
  const comments = /const COMMENTS = \[([\s\S]*?)\];/.exec(src);
  const clutter = /const CLUTTER = \[([\s\S]*?)\];/.exec(src);
  ok(comments && clutter, 'CLUTTER / COMMENTS lists not found');
  ok(comments[1].indexOf('tp-vuukle') !== -1, 'the comment wrapper must be gated');
  ok(clutter[1].indexOf('tp-vuukle') === -1, 'the comment wrapper must not be unconditional');
  ok(clutter[1].indexOf('vuukle-ads') !== -1, 'the in-widget ads are always clutter');
  ok(/if \(commentsOn\(\)\) remove\(COMMENTS\)/.test(src), 'COMMENTS must sit behind commentsOn()');
  ok(src.indexOf("const EXCEPT = 'commentExceptions'") !== -1, 'must read the comment exceptions');
  ok(src.indexOf('self.ktpUrlExcepted') !== -1, 'must use the shared matcher');
  ok(!/const urlExcepted = \(host/.test(src), 'must not carry its own copy of the matcher');
  /* A removal cannot be undone, so it must not run before storage answers. */
  ok(/ready &&/.test(src), 'commentsOn() must wait for storage');
});

test('the published name is one name, in every place it shows', () => {
  /* The name appears in the install dialog, chrome://extensions, the store
   * listing, the toolbar tooltip and the settings page. They are five copies
   * of one string, and the only way they stay one string is to check. The
   * 75-character ceiling is Chrome's documented limit on the key. */
  const name = manifest.name;
  ok(typeof name === 'string' && name.length > 0, 'name missing');
  ok(name.length <= 75, 'name is over Chrome\'s 75-character limit: ' + name.length);
  eq(manifest.action.default_title, name, 'the toolbar tooltip has drifted from the name');
  /* 12 is the documented recommendation for short_name, and it is what gets
   * shown where the full name will not fit. */
  ok(manifest.short_name && manifest.short_name.length <= 12,
     'short_name missing or over the recommended 12 characters: ' + manifest.short_name);
  const html = read(file('options.html'));
  ok(html.indexOf('<h1>' + name + '</h1>') !== -1,
     'the settings page heading is not the published name');
  ok(html.indexOf('<title>' + name + ' — settings</title>') !== -1,
     'the settings page title is not the published name');
});

test('the settings footer carries the repository, never the author', () => {
  /* The author's address was printed here until it was asked for and taken
   * out. A settings panel is the one surface a stranger sees without going
   * looking, and the repository answers "who made this" better than a name
   * does. manifest.author stays -- the store matches it against the
   * publishing account -- so this guards the rendering, not the key. */
  const src = read(file('options.js'));
  ok(src.indexOf('m.author') === -1 && src.indexOf('author.email') === -1,
     'options.js reads the author back into the page');
  ok(src.indexOf('homepage_url') !== -1, 'options.js does not render the repository link');
  ok(/^https:\/\/[^\s]+$/.test(manifest.homepage_url || ''),
     'homepage_url must be an https URL for the footer to link to: ' + manifest.homepage_url);
});

test('debug.js stays out of the build', () => {
  /* It is a tracer: it patches window.confirm and writes every event to
   * sessionStorage, and its own header says "remove when done". package.sh
   * derives the shipped file list from the manifest, so the only way it can
   * reach a store package is if someone registers it. Nobody should. */
  for (const cs of manifest.content_scripts) {
    ok(cs.js.indexOf('debug.js') === -1, 'debug.js is registered as a content script');
  }
  ok(read(file('options.html')).indexOf('debug.js') === -1,
     'options.html loads debug.js');
});

test('the release path exists', () => {
  /* A zip of the working tree would ship 135KB of prose, the tracer and
   * Chrome's own _metadata directory. package.sh is how that is avoided, so
   * its absence is a release bug, not a missing nicety. */
  ok(exists(file('package.sh')), 'package.sh is missing');
  ok(exists(file('PRIVACY.md')), 'PRIVACY.md is missing -- the store requires a policy');
});

test('options page is registered', () => {
  ok(manifest.options_ui && manifest.options_ui.page === 'options.html', 'options_ui missing');
});

/* ---------- report ------------------------------------------------------- */

print('');
if (failures.length === 0) {
  print(passed + ' passed, 0 failed');
  System.exit(0);
} else {
  print(passed + ' passed, ' + failures.length + ' FAILED:');
  for (const f of failures) print('  - ' + f);
  System.exit(1);
}
