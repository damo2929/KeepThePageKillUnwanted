# Chrome Web Store submission

Everything the dashboard asks for, written down once so the answers do not get
improvised at the upload screen. Build the package with `./package.sh`; it
derives the file list from the manifest and restamps the version (see the
header of that script for why both).

## Before you start

- [ ] A Chrome Web Store developer account, with **2-Step Verification on** —
      the store requires it, and a publisher without it cannot submit.
- [ ] The one-off developer registration fee paid.
- [ ] Signed in as the Google account that will own the listing. Which
      account is deliberately not recorded here -- this repository is public.
      It does not have to match anything in the manifest. The one rule ever
      written about `author` -- that the address match the publishing account
      -- governs a key Chrome and the store have silently ignored since
      February 2024, so it is dead letter, and the key has been removed
      rather than carry an email address in a public repository.
- [ ] The developer contact email set in the dashboard. That is a separate
      field from the sign-in, and it is where store alerts arrive, so it
      wants to be an address that gets read.
- [ ] `PRIVACY.md` reachable at a public URL. The repository copy works:
      `https://github.com/damo2929/KeepThePageKillUnwanted/blob/main/PRIVACY.md`

## Build and upload

```sh
./bump.sh          # stamp the dev version (required after ANY change on disk)
./test.sh          # must pass; package.sh refuses to build without it
./package.sh       # writes dist/keep-the-page-<version>.zip
```

Upload the zip at <https://chrome.google.com/webstore/devconsole>. The zip
contains only what the manifest reaches — no documentation, no tests, no
`debug.js`, no `_metadata/`.

## Store listing

**Name**

```
Keep The Page Kill Unwanted
```

**Summary** (132 characters maximum; this is the manifest `description`, and
after the first upload the manifest metadata can no longer be edited in the
dashboard)

```
Stops anti-adblock walls from hiding pages, and removes pop-out video ads and third-party widget clutter.
```

**Category:** Productivity → Tools.
**Language:** English (UK).

**Detailed description**

```
Some sites will not show you the article. A wall appears over it — "turn off
your ad blocker", "accept tracking or pay" — or the page quietly deletes its
own stylesheets so there is nothing left to read. Keep The Page Kill Unwanted puts the
article back.

It works by signature, not by a list of sites. It looks for what the wall
actually is: the consent SDK's own attributes, the vendor's container ids, the
cookie it tries to write, the shape of the script that installed it. A site
that has never been tested is handled the same way as one that has, and a site
that changes its class names tomorrow keeps working.

What it removes, each with its own switch in Settings:

• Anti-adblock walls and the overlays and dialogs that carry them
• Consent-or-pay walls — the consent framework is answered with every purpose
  and vendor denied, and no consent record is written
• Scheduled stylesheet deletion, the trick that empties a page a second after
  it loads
• Pop-out video players that follow you down the page
• Social sharing rows, follow buttons and platform icons
• Comment sections, comment counts and Disqus
• Newsletter sign-up pop-ups and in-article email boxes
• MSN and Bing feed tiles, cards and section tabs

Every feature can be switched off, and comments, social furniture and
newsletter removal each take a list of sites to leave alone.

It collects nothing. It sends nothing. There is no account, no analytics and
no server — the only storage is your own settings, which Chrome syncs to your
other machines if you use Chrome sync. The
source is public and unminified: github.com/damo2929/KeepThePageKillUnwanted
```

## Images

| Asset | Size | Status |
| --- | --- | --- |
| Store icon | 128×128, mark 96×96 | in the package, `icons/icon128.png` |
| Small promo tile | 440×280 | `store/promo-440x280.png` |
| Screenshot (≥1, ≤5) | 1280×800 or 640×400, full bleed | `store/screenshot-settings-1280x800.png` |
| Marquee promo tile | 1400×560 | not made; only needed for featured placement |

The screenshot is the real settings page, captured from the loaded extension
and laid out in four columns so the whole of it fits 1280x800 edge to edge --
nothing is mocked up, and nothing is padded.

A before-and-after screenshot of a real news site would sell it better than
the settings page does, but it would put another publisher's masthead and
article text in the listing. That is a judgement call to make deliberately,
not by accident.

## Privacy practices tab

**Single purpose**

```
Keep The Page Kill Unwanted removes the obstructions that stop an article being read: walls
that cover it, scripts that empty it, and the pop-ups, pop-out players and
third-party widgets that crowd it. Every feature serves that one purpose, and
each one can be switched off individually.
```

**Permission justifications**

- `storage`

  ```
  Stores the user's own settings — which protections are on, which social
  platforms to neutralise, and the per-feature lists of sites to leave alone —
  in chrome.storage.sync, so they follow the user's Chrome profile, plus a
  local log of the extension's own errors in chrome.storage.local. The
  extension itself transmits nothing.
  ```

- `declarativeNetRequest`

  ```
  Three static rule sets that block requests and nothing else: the Sourcepoint
  anti-adblock messaging script, two MSN widget endpoints that re-inject feed
  tiles, and Disqus. declarativeNetRequest is used in preference to webRequest
  precisely because it cannot report back what the user loaded — the rules are
  declared in the package and the extension is never told what matched.
  ```

- Host access (`http://*/*`, `https://*/*` in `content_scripts`)

  ```
  Walls, pop-out players, social furniture, comment widgets and newsletter
  pop-ups appear on any site, and the extension detects them by signature
  rather than from a list of hostnames, so the code that removes them has to
  be able to run anywhere. No host_permissions are requested beyond what the
  content scripts need, and there is no tabs, history, cookies, webRequest or
  scripting permission. Nothing about any page is recorded or transmitted.
  ```

  The one hostname-scoped script, `guard.js`, is narrower than this and is
  listed against the ~270 Newsquest titles it applies to, because it patches
  global prototypes and must not run anywhere it is not needed.

**Data use** — tick nothing. The extension collects none of the listed
categories. Settings are in `chrome.storage.sync`, which Chrome Sync carries
between the user's own devices; the developer never receives them. Treating
that as not collected is our reading of the user-data FAQ, and has not been
checked against current policy text. If review disagrees, the lists of sites
the user typed would come under "Website content" or "Web history". Then certify all three statements: not being sold to third
parties, not used or transferred for any purpose unrelated to the single
purpose, not used or transferred to determine creditworthiness or for lending.

**Privacy policy URL** — the `PRIVACY.md` link above.

## Two things review may question

Neither is a known violation. Both are worth having an answer ready for.

1. **Single purpose breadth.** The policy wants a purpose that is "narrow and
   easy to understand". Walls, pop-out ads, social links, comments, newsletter
   pop-ups and MSN feed tiles are one purpose if the purpose is "clear the
   obstructions off an article", which is how the listing and the single
   purpose statement above both frame it. The MSN/Bing feed cleanup is the
   part that looks least like the rest; if a reviewer pushes, it is the piece
   to argue for on those terms or to split out.

2. **Consent-or-pay.** Answering the consent framework with everything denied,
   and removing a pay-or-consent overlay, is the behaviour most likely to be
   asked about. It is disclosed plainly in the listing and in the privacy
   policy rather than buried, which is the right side of the "no surprises"
   rule. No policy clause prohibiting it was found when this was checked
   against the program policies on 2 October 2026.
