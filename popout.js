/*
 * Keep The Page — floating video ad remover.
 * Content script, document_start, isolated world.
 *
 * Targets "pop-out" / picture-in-picture players that detach and follow you
 * down the page. On Euronews:
 *
 *     div.safePlayerDiv
 *       div#dailymotion-player.dailymotion-player-root
 *         div#dailymotion-pip.dailymotion-player-wrapper   position:fixed, z-index 2147483647
 *           button.dailymotion-player-close-compliant-button
 *           iframe.dailymotion-player                      (geo.dailymotion.com)
 *
 * Two layers, because the player script re-injects after removal:
 *
 *   1. A stylesheet written at document_start hides the pop-out wrapper before
 *      it can ever paint. This is what stops it "coming back" — a re-injected
 *      player is invisible from the first frame, with no flicker and no race.
 *   2. A sweep then blanks the iframe (so audio actually stops rather than
 *      playing on behind a hidden element) and removes the node.
 *
 * Removal is gated on computed position:fixed, so a player sitting in the
 * article in normal flow is never touched. The gate deliberately does NOT test
 * size: once layer 1 hides the element its rect is 0x0, while its computed
 * position is still "fixed".
 *
 * **By signature, never by site list.** This ran on euronews.com and
 * independent.co.uk only, from a four-entry `matches` list, while every
 * selector below is a vendor or layout name that identifies a popped-out
 * player wherever it is embedded. The list limited where the signature could
 * fire and covered nothing else; it is gone. What keeps this safe on every
 * other site is the position:fixed gate, not a hostname.
 */
(() => {
  'use strict';

  const TAG = '[keep-the-page/popout]';

  /* Only ids/classes that mean "popped out" by definition go in the CSS layer,
   * and running everywhere is what makes that line matter: a pre-paint hide
   * cannot test computed position, so a name that is merely *consistent* with
   * floating would take the page's own player with it. "pip" and
   * "floating-player" say popped out. "sticky" does not -- a sticky player is
   * very often the article's real player, which becomes fixed on scroll and
   * is the video the reader came for. Those moved to the sweep below, behind
   * the position:fixed gate, when the site list went. */
  const HIDE = [
    '#dailymotion-pip',
    '[id*="floating-player"]'
  ];

  /* Swept only when actually floating: the generic player wrapper, and the
   * names that can mean either. Cost of judging these at sweep time rather
   * than in CSS is that a re-injected one can flash for a frame; the
   * alternative is hiding players nobody asked us to hide. */
  const SWEEP = HIDE.concat([
    '.dailymotion-player-wrapper',
    '[class*="sticky-player"]',
    '[class*="sticky-video"]'      // independent.co.uk: .video-sticky-video
  ]);

  /* ---- layer 1: hide before first paint ---- */
  const css = HIDE.join(',\n') + ' {\n  display: none !important;\n}\n';
  const style = document.createElement('style');
  style.textContent = css;
  const attach = () => (document.head || document.documentElement).appendChild(style);
  if (document.documentElement) attach();
  else document.addEventListener('readystatechange', attach, { once: true });

  /* ---- layer 2: stop playback and remove ---- */
  const isFloating = (el) => getComputedStyle(el).position === 'fixed';

  const silence = (el) => {
    for (const frame of el.querySelectorAll('iframe')) {
      if (frame.src && frame.src !== 'about:blank') {
        try { frame.src = 'about:blank'; } catch (e) { /* ignore */ }
      }
    }
  };

  const sweep = () => {
    for (const sel of SWEEP) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of nodes) {
        if (!el.isConnected || !isFloating(el)) continue;
        silence(el);
        /* Take the player root when this wrapper is all it holds, so no empty
         * shell is left behind to be re-filled. */
        const root = el.parentElement;
        const target = (root && root.children.length === 1 && /player-root/.test(root.className)) ? root : el;
        console.debug(TAG, 'removed floating player:', sel, '->', target.id || target.className);
        target.remove();
      }
    }
  };

  const observer = new MutationObserver(sweep);

  const start = () => {
    sweep();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });

  document.addEventListener('DOMContentLoaded', sweep);
  window.addEventListener('load', sweep);
  window.addEventListener('scroll', sweep, { passive: true });
  setInterval(sweep, 1000);
})();
