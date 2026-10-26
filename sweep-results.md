# Sweep results — 52 articles, 26 domains

Re-run against version `0.1.922.1925`, 2026-09-22, with a **render check**
added. Two articles per domain.

## Why this run exists

The previous sweep measured `innerText.length` and `children.length` and passed
everything. It was wrong: scotsman.com and yorkshirepost.co.uk were unstyled
markup — all the text present, every stylesheet stripped — and the probe could
not tell the difference. The user saw it on screen and said so.

This run records `document.styleSheets.length` and total CSS rule count on every
article. **A page with `styleSheets: 0` is broken no matter how much text it
has.**

## Result

**52 of 52 articles have `styleSheets > 0` and rendered.** No consent wall left
on screen, no scroll left locked, no reload loops (`nav: navigate` throughout).

## Consent-or-pay walls — Reach plc, Quantcast Choice via `cmp.inmobi.com`

`appeared -> removed`, then sheets/rules at end state.

| Domain | Article 1 | Article 2 | sheets / rules |
|---|---|---|---|
| dailyrecord.co.uk | 1454 -> 2451ms | 522 -> 1128ms | 76-81 / ~3000 |
| mirror.co.uk | outside window | 1094 -> 1230ms | 74-75 / ~3000 |
| liverpoolecho.co.uk | 729 -> 1135ms | 710 -> 1315ms | 76-77 / ~3050 |
| manchestereveningnews.co.uk | 818 -> 1119ms | 505 -> 1108ms | 77-81 / ~3000 |
| birminghammail.co.uk | 845 -> 1146ms | 563 -> 1166ms | 77 / ~3070 |
| chroniclelive.co.uk | 794 -> 1095ms | 523 -> 1126ms | 76-77 / ~3070 |
| dailystar.co.uk | outside window | outside window | 71-82 / 808-3089 |
| walesonline.co.uk | removed | removed | 24-25 / ~2320 |

"Outside window" means the CMP was built and removed before the probe's first
sample — the vendor script is present and the end state is clean. The wall
exists on all eight; catching the transition is a timing matter, not evidence of
absence.

## AdShield anti-adblock SDK

| Domain | `data-sdk` | sheets / rules | Notes |
|---|---|---|---|
| scotsman.com | `l/1.1.21` | 2 / 541, 2 / 550 | **fixed this run** |
| yorkshirepost.co.uk | `l/1.1.21` | 2 / 532, 2 / 554 | **fixed this run** |
| notebookcheck.net | `l/1.2.10` | 13 / 517, 5 / 465 | single load, no reload loop |
| listentotaxman.com | `l/1.1.10` | 11 / — | **fixed 2026-09-23**: recovery `confirm()` froze the tab; `loader-check` gate pinned, one navigation, no dialog or iframe, alive 33s |
| scotsman.com, yorkshirepost.co.uk | `l/1.1.21` | 3-4 / 992-995, 3-4 / 849-852 | **re-checked 2026-09-23 after the gate fix**: gate pinned, loader tag id unchanged (no fallback retry), no error iframe, one navigation to 21-22s, styled |
| whathifi.com | `l/1.2.10` | — | **seen 2026-09-23** while fixing its newsletter popup: armed, page intact. Probes awaiting `setTimeout` hang here (timer filter) |

Scotsman and Yorkshire Post were `styleSheets: 0` before `0.1.922.1925`. Their
CSS is now intact and held steady across 2s / 8s / 16s on Yorkshire Post. See
AGENTS.md, "The CSS stripper", for the mechanism.

## Sourcepoint present, message container never built

DNR rule blocking `/unified/wrapperMessagingWithoutDetection.js` stops it first.

theguardian.com (10-12 sheets), independent.co.uk (21-22), standard.co.uk (7),
techradar.com (55-58) — 2 articles each.

standard.co.uk has the lowest rule count in the sweep (479). Spot-checked by
screenshot: masthead, nav, headline, standfirst and image all render correctly.
Low sheet counts are a CSS-in-JS build, not damage.

## Newsquest — `adLight` pin holds

`window.adLight === true`, 11 sheets, ~3270-3310 rules on every load:
heraldscotland.com, thenorthernecho.co.uk, glasgowtimes.co.uk, theargus.co.uk,
oxfordmail.co.uk (2 articles each).

## No wall of any kind

inews.co.uk (40-55 sheets), metro.co.uk (21-22), engadget.com (3), pagesix.com
(81-82, OneTrust loaded but no banner), theverge.com (79-108), arstechnica.com
(10).

## Measurement notes

- The Chrome extension disconnected once mid-sweep and two batches timed out
  while reporting; the navigations had landed, so the affected pages were
  re-probed individually rather than skipped.
- notebookcheck produced three CDP `Runtime.evaluate` timeouts. Each time the
  follow-up probe returned normally (~50s, 13121 / 21184 chars). Transient
  load-time busyness, not a wall — screenshot before concluding otherwise.

# Google News run — 50 links, 2026-09-22

Opened from `news.google.com/home?hl=en-GB&gl=GB`, against `0.1.922.2046`.
Unlike the 52-article sweep above, these were **not** chosen — they are whatever
the UK front page served, so they are a fair sample of what the extension meets
in ordinary use.

## Result

**50 links opened. Zero pages with `styleSheets: 0`.** No consent wall left on
screen (`cmp: 0`) except the one flagged below, no reload loops, no blank pages.

| Outcome | Count | Notes |
|---|---|---|
| Rendered normally | 45 | 3–114 stylesheets depending on the site |
| `chromewebdata`, 110 chars | 2 | Pi-hole-blocked domains — deliberate, not a fault |
| Hard paywall | 1 | thetimes.com: CSS fine (23 sheets), content gated. Not ours to open. |
| Duplicate landings | 2 | see "indices are not stable" below |

Publishers seen: BBC (×9), Manchester Evening News, Page Six, The Times, ESPN,
Forbes, Al Jazeera, Belfast Telegraph, Kent Online, Isle of Man Today (×3),
Northumberland Gazette, West Leeds Dispatch (×2), Gazette News, Plant Based
News, and others whose hostnames the automation layer redacted.

## The AdShield fix holding on sites never tested before

Three National World titles turned up that were not in any earlier list, all
carrying `data-sdk="l/1.1.21"` — the variant whose CSS stripper broke Scotsman
and Yorkshire Post:

    northumberlandgazette.co.uk   3 sheets / 579 rules   intact
    (Black Country title)         3 sheets / 580 rules   intact

Both render. The signature covers them with no per-site entry, which is the
whole point of matching the `l/<n>.<n>` shape rather than a version string.

## One finding worth following up

One article carried a `data-sdk` shape not seen before:

    data-sdk="wp-ls/di-1787867664770"      24 sheets, 4543 chars, cmp: 1

`SDK_ATTR` (`/(^|-)l\/\d+\.\d+/`) does **not** match it — `ls/di-…` is not
`l/<n>.<n>` — so `walls.js` never armed on that page. It rendered fine anyway,
and the `cmp: 1` was a consent container still present at probe time rather
than a wall over the article.

So: not a failure, but a gap worth knowing about. It is a different AdShield
product line, and if a site ever shows the stripper symptom (`styleSheets: 0`
with text present) while carrying `wp-ls/…`, this is the reason the defences
stayed asleep. Not fixed speculatively — coverage here is evidence-based, and
no damage has been observed from it.

## Method notes, because this was harder than it looks

**Google News `/read/` URLs are redacted by the automation layer**, so they
cannot be passed to `navigate`. The workaround is to jump from inside the page:
`location.href = list[i]`, scheduled in a `setTimeout` so the call returns
before navigation starts.

**A probe cannot share a tool call with the jump that precedes it.** CDP kills
any evaluation that spans a navigation (`Inspected target navigated or closed`),
and a spacer action is not enough. One article per call is the floor.

**The link list is lazy-loaded and unstable.** A freshly loaded front page
exposes ~22 links; scrolling grows it to ~65. Worse, the order is rebuilt on
every load, so index 33 and 34 returned the *same* article. Fixed by capturing
the list once into `localStorage` on news.google.com and indexing that.

**`cssRules` undercounts.** Cross-origin stylesheets throw on access, so the
rule count reads low — ESPN showed 4 sheets but 5 rules. The *sheet count* is
the reliable render signal; rule count is a bonus. The probe now counts the
cross-origin sheets separately rather than silently swallowing them.

## phoronix.com — added 2026-09-27

Article: `/news/Linux-LZ4-Clean-Resync`. Headed Chromium 154, user's own
profile and installed extension, tracing `walls,timers,consent`.

    before reload   fixedCount 2   #_1t4dzfc._11xu1x1 h=875 z=999999
                                   .gfe3d6 h=457  "It looks like your ad blocker is on."
                    marks 4, sheets 6, trace set -- extension running, wall untouched
                    console: nothing from walls.js (sweep logs only after WALL_TEXT passes)

    after reload    fixedCount 0, nagAnywhere 0, body overflow visible
                    elementFromPoint(centre) = DIV.content  (the article)
                    console: [keep-the-page] removed ad wall <div> z=999999
                    screenshot: article readable, no overlay

Front page sampled at 2/8/16/25s, with and without the extension: no wall
either way. The nag is article-only, and with `a.pub.network` NXDOMAIN the
Freestar stack never loads (`freestar.queue` 0, six 0-height slots).

Console capture was proven before trusting it: injected debug and log lines
both read back, and `console.debug.toString()` contains `native code`, so the
earlier silence was real rather than a capture artifact.

Not addressed: the byline's "Add A Comment" link survives `comments.js` on
article pages -- it points at `/forums/node/<id>`, so neither the `#comments`
selector nor the comment-word verdict reaches it.

## Incognito sweep — 2026-09-27

Throwaway profile, `--incognito`, extension enabled via
`extensions.settings.<id>.incognito` (see AGENTS.md). Fresh profile, so no
stored consent and tracing off. Sampled 2/8/16/25s, screenshot each.

| site | sheets | body text | fixed overlays | CMP standing | marks | verdict |
|---|---|---|---|---|---|---|
| walesonline.co.uk | 74 | 2921 | 0 | none | 12 | renders, see caveat below |
| thenorthernecho.co.uk | 16 | 6865 | 0 | none | 153 | renders |
| notebookcheck.net | 10 | 26550 | 0 | none | 0 | renders, no wall, no dialog |
| pagesix.com | 71 | 1865 | 0 | none | 0 | renders, no `<dialog>` wall |
| msn.com/en-gb | 9 | 0 | 0 | none | 0 | feed removed as intended |
| phoronix.com (article) | 6 | 5065 | 0 | n/a | 4 | ad wall removed |

**`tx: 0` on msn is shadow DOM, not a blank page.** The screenshot shows logo,
search box and quick links — the documented intended result of `feed`. This is
the exact reading that `innerText.length` cannot be trusted for.

**The walesonline CMP result does not demonstrate our sweep worked.** Polled at
100ms from `document_start` (injected with `Page.addScriptToEvaluateOnNewDocument`,
because a poll started after `Page.navigate` returns cannot prove it caught a
600ms wall): 77 samples, 0 to 8090ms, `peakNodes: 0` — the `qc-cmp2` container
never entered the DOM at all. The reason is upstream of us:

    <script src="cmp.inmobi.com/tcfv2/61/cmp2.js?referer=walesonline.co.uk">
    <script src="cmp.inmobi.com/choice/JYWDqeLS64fbt/walesonline.co.uk/choice.js">
    both:  duration 0, transferSize 0, responseStatus 0   -- failed, not served

`cmp.inmobi.com` resolves (CloudFront), so this is not the Pi-hole's DNS block;
the requests fail at the network. No `euconsent`/`addtl_consent` cookie was
written, which is the outcome we want, but it was not us that produced it.
`typeof __tcfapi === 'function'` is **not** evidence of `denyConsent()` either:
Reach inlines the standard TCF stub, and `denyConsent()` installs only where
`__tcfapi` is already a function or a container exists.

So on this machine the Reach CMP cannot currently be used to test the consent
sweep at all — same shape as the phoronix finding: a vendor that never loads
builds no wall, and an extension that had nothing to do looks identical to one
that worked. To exercise it, the CMP host has to be reachable.

**msn.com carries a notice we do not handle**: a blue in-flow bar, "We are
updating our Term…" with Dismiss / Learn more. Not a CMP, not fixed, so
`cmpShowing()` never sees it and `REJECT_TEXT` has nothing to press. Left alone
deliberately — dismissing it is accepting a terms notice on the user's behalf.

## Regression sweep — 2026-09-27, under the new sampling rules

Two random articles per domain, screened for paywalls first, scrolled to the
foot, sampled top and bottom. User's own Chrome 154, extension live.

| domain | free articles | result |
|---|---|---|
| notebookcheck.net | 2/2 | 21-22 sheets, 0 dialogs, 0 overlays, stable 10s/20s |
| pagesix.com | 2/2 | 34/35 and 16/17 paragraphs visible, 2 `<dialog>` present but none open |
| walesonline.co.uk | 2/2 | 19/19 and 17/17 paragraphs, no CMP standing, no consent cookie written |
| scotsman.com | **1/2** | free article 12/12 paragraphs, 528 rules, styled -- CSS stripper still defeated |
| thenorthernecho.co.uk | **1/2** | `adLight` true, 16 sheets, no wall; second article blocked by extension site permission |
| phoronix.com | 2/2 | wall removed, regular and incognito |
| euronews.com | 2/2 | 27/35 and 11/19 paragraphs -- the rest are the site's own collapsed `c-featured-nav__item__content`, `ktp:false`. No PiP, no overlay |
| lesoleil.com | 2/2 | CookieYes refused: banner not visible, 0 of 25 switches on, no `euconsent`/`cookieyes` in localStorage, `__tcfapi` answering |
| edition.cnn.com | 2/2 | 24/24 and 14/14 paragraphs, no OneTrust banner built, no overlays |
| abc.net.au | 2/2 | 50/50 and 26/26 paragraphs, no CMP, no overlays |
| theguardian.com | 2/2 | 23/23 and 17/17 paragraphs, no Sourcepoint container, embeds intact |
| yorkshirepost.co.uk | 2/2 | `l/1.1.21` armed, 6-7 sheets / 536-563 rules, 21/21 and 15/15 paragraphs, styled -- CSS stripper defeated |

**The Scotsman "blank article" was the publisher's paywall, not a regression.**
Both articles drawn at random were premium, and a paywalled body reads exactly
like a broken one. Proven with no extension in the picture at all -- a plain
`curl` of each URL returns:

    "isAccessibleForFree": "False"
    class="ContentRoot__PremiumContent... no-entitlement ..."
    .dSHIcV.no-entitlement > :not(:first-child):not(:nth-child(2)) { display:none }
    "articleBody": <delivered in full, 3820 chars>

In the browser the rule hiding each paragraph was traced to the site's own
`<style>`; our three sheets are `ktp-comments-css`, `ktp-newsletter-css` and
`ktp-social-css`, and all 19 marks on the page were comment buttons and
newsletter boxes. A free Scotsman article renders every paragraph.

**Unresolved policy question, raised not acted on.** This project's stated
position is that content *delivered* then hidden on the reader's machine is the
objectionable act, while content withheld server-side is left alone. The
Scotsman delivers the whole article and hides it with CSS for want of an
entitlement -- structurally the same shape as an anti-adblock wall, but it is a
paywall, which this project deliberately does not touch. Those two positions
collide here and the collision is undecided.

**euronews carried no Vuukle block on either article** (`.tp-vuukle`,
`.js-vuukle-container`, `.vuukle-ads` all zero), so the clutter.js change that
took it from a two-site list to signature-only was **not exercised** by this
sweep. Either the site has dropped Vuukle or it sits on article types not
sampled. Do not read these two passes as covering that change.

**theverge.com could not be sampled**: all 14 candidates screened were
`isAccessibleForFree: False`. Its PMC privacy banner could still be checked on a
paywalled page -- the banner is independent of the body -- but body rendering
cannot be validated there at all.

**Not yet swept:** theverge, lesoleil, lenouvelliste, listentotaxman, msn/bing,
and thenorthernecho's second article (the extension refused the navigation:
"Navigation to this domain is not allowed", a site permission, not a code
fault).

**lesoleil's inline adblock notice is more intrusive than recorded.** AGENTS.md
describes it as a bar in the leaderboard slot. On articles it renders as a band
held in the middle of the viewport across scroll positions, with the copy behind
it faded. It is deliberately not handled, but the description understates it,
and the `body > *` x3 sweep depth did not reach it either -- `onScreenFixed`
came back empty while the band was plainly on screen in the screenshots.

**CNN declares a paywall it does not apply.** Both articles carried
`isAccessibleForFree: False` and rendered every paragraph. The screening rule
has been amended: the flag is a pre-filter, the visible-paragraph count is the
verdict.

## kucoin.com — fake geo-block, added 2026-10-26

Version `0.1 (2026-10-26 18:51:27)`, user's own Chrome profile, UK address.
Two articles picked from the first article's own "Featured" links.

    before   /news/flash/open-source-project-gpu-unlock-...   -> /restrict?code=PAGE_COMPLIANCE
             within 2s, both runs. Served HTML (curl): 200, whole article body.
             rules response: forbidden_pages, 58 paths, incl. /news, /news/:sub1, /news/:sub1/:sub2
             first reload attempt: JSON.parse native on example.com while remove()
             was wrapped -- old build still loaded, not a failed fix

    after    article 1  GPU Unlock          2/8/16/25s  path kept, sheets 12, paras 13/13
             article 2  Bitcoin ETFs $442M  2/8/16/25s  path kept, sheets 12, paras 28/28
             both scrolled to the footer: no fixed overlay, screenshots show text to the foot.
             KuCoin's own "not directed at UK persons" banner still shown -- left alone.

Not run: incognito.
