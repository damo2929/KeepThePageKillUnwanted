# Rules for this repo

`AGENTS.md` is the long form — the evidence, the failure log, the recipes.
Read it before changing anything. This file is the short list that must hold
every time, including after a context compact.

## Before you change code

**1. Prove the environment first.** Open the target site in Chrome, and again
in a Chrome incognito window, and confirm you can see and probe both. A symptom
seen before that baseline is established belongs to the environment — browser,
profile, resolver, automation session — not to this repo. Changing code against
a broken baseline fixes the wrong thing.

**2. An extension with nothing to do looks exactly like one that worked.** A
clean page proves nothing unless you know the wall was there first. Establish
the wall, then the fix.

**3. Do not change files to make progress visible.** Investigate until you can
name the defect and the line. No speculative edits, no scope you were not
asked for, no "while I'm here" refactors. If the fix turns out to be one
character, it is one character.

## When you do change it

- **Detect by signature, never by URL list.** SDK attributes, vendor class
  names and container ids, cookie names, handler source, element naming, text.
  Hostnames are for *scope* only, and only in `guard.js`, `portal.js`,
  `portal-early.js`. Never widen `guard.js` — it patches global prototypes.
- **Match the shape, not the literal.** `l/<n>.<n>`, never a version string.
  Never a build-hash class name (`css-p30qmo`, `_1t4dzfc`).
- **Latch positive, never cache negative.** The loader tag may not be parsed
  yet.
- **`./bump.sh` after any change on disk** — comment-only edits included.
- **`./test.sh`** (gjs, not node). Add a test, then break the thing it guards
  and watch it fail.
- Never write the user's employer or internal hostnames into this repo. It is
  public.

## When you report

- **Never name a cause you have not isolated.** This file's most repeated
  mistake, and it has shipped wrong twice in one session. Correlation across
  two different page types is not a cause.
- **Say plainly which half you did not test.** `chrome://` is unreachable, so
  the extension reload and the options page are always the user's half.
- **Two random articles per domain, minimum, before calling it a pass.** Never
  the front page alone — phoronix's wall fires on articles and not the front
  page, and a front-page check cleared it as clean. Pick them from the page's
  own links, not from memory.
- **Never sample a subscriber-only article.** A paywalled body and a body we
  broke look identical — headline, byline, no text. Screen candidates on
  `isAccessibleForFree` / `no-entitlement` (both in the served HTML, so `curl`
  does it) and pick again until two free ones are found. The flag is a
  pre-filter, not the verdict — CNN declares False and serves the whole body.
  Settle it by comparing visible paragraphs against total.
- **Scroll each article to the foot before passing it.** Walls, newsletter
  popups and consent overlays fire on scroll depth, dwell time and exit intent,
  not on load. Clean at the top is not clean.
- **Verify visually.** `document.styleSheets.length` plus a screenshot, never
  `innerText.length`. Sample at 2s/8s/16s/25s; a CMP can live 600ms.
- An empty console is not evidence — capture starts when the tool is first
  called, and load-time lines do not survive the navigation that produced them.
