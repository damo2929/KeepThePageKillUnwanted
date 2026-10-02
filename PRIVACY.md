# Privacy policy — Keep The Page Kill Unwanted

**This extension does not use any of your data, and does not send it
anywhere.** That is the whole policy. Everything below is the detail the
Chrome Web Store asks for, and none of it adds a caveat to that sentence.

Last updated: 2 October 2026.
Contact: open an issue at <https://github.com/damo2929/KeepThePageKillUnwanted/issues>.

## The short version

Keep The Page Kill Unwanted collects nothing, sends nothing, and talks to no
server. It has no analytics, no telemetry, no crash reporting, no advertising
and no account. Nothing it stores ever leaves the machine it is stored on.

This policy exists because the Chrome Web Store requires one from any
extension that handles user data at all, including data that is only ever held
locally. That is the only kind this extension has.

## What is stored, and where

Your settings, and nothing else, in `chrome.storage.local` — Chrome's
per-extension storage on your own computer:

| What | Why |
| --- | --- |
| Which protections are switched on | So the choice survives a restart |
| Which social platforms to neutralise, and how | Same |
| Your URL exception lists for comments, social furniture and newsletter sign-ups | So a site you have excepted stays excepted |
| Whether tracing is on, and which channels | Debugging aid, off by default |

`chrome.storage.local` is local by design: it is not Chrome Sync, so these
settings do not travel between your devices and are not uploaded to Google or
to anyone else. Removing the extension removes them with it.

## What is not collected

No browsing history. No page content. No URLs you visit. No search terms. No
personal or financial information. No authentication information. No location.
No health information. No personal communications. No identifiers of any kind.
The extension cannot build such a record even accidentally, because it has no
code that sends anything anywhere.

The URL exception lists are the one place a site name is written down, and you
are the one who types it. It stays on your machine.

## What the extension does to pages

It runs on pages you visit in order to hide or remove things on them —
anti-adblock and consent-or-pay walls, pop-out video players, social sharing
furniture, comment sections, newsletter pop-ups, and feed tiles on MSN and
Bing. All of that happens inside your browser, on the page as it has already
been delivered to you. Nothing about the page is recorded, copied or
transmitted.

It also declines consent on your behalf where a TCF consent framework is
present, by answering every purpose and vendor as denied, and by refusing to
write a consent record. That is a refusal, not a collection.

## Network

The extension makes no network requests of its own. Its only effect on the
network is subtractive: three `declarativeNetRequest` rule sets that **block**
requests — a Sourcepoint messaging script, two MSN widget endpoints, and
Disqus. Blocking rules do not send anything anywhere, and the extension is not
told what matched them.

## Permissions, and why each one exists

- **`storage`** — to keep your settings, as described above.
- **`declarativeNetRequest`** — to block the requests listed above. This API
  is deliberately the one that *cannot* report back what you loaded; the rules
  are static and declared in the package.
- **Access to the sites you visit** (the content scripts' `http://*/*` and
  `https://*/*` matches) — walls, pop-ups and clutter appear on any site, so
  the code that removes them has to be able to run on any site. It is used for
  nothing else. There are no host permissions beyond what the content scripts
  need, and no `tabs`, `history`, `cookies`, `webRequest` or `scripting`
  permission.

## Limited Use

Keep The Page Kill Unwanted's use of information received from Google APIs adheres to the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
including the Limited Use requirements. In practice the commitment is simple:
the extension receives no user data, transfers no user data, sells no user
data, and uses no user data for advertising, credit assessment or any purpose
other than providing the single feature it describes.

## Third parties

None. No service providers, no SDKs, no bundled libraries, no remote code. The
whole extension is the source in this repository, which is public and
unminified.

## Children

The extension is not directed at children, and collects nothing from anyone.

## Changes

Any change to this policy will be committed to this repository, which is the
published location of this document, and the date above will change with it.

## Your rights

There is no data to request, correct, export or erase, because none is held
anywhere but your own computer, where you can remove it at any time by
uninstalling the extension or clearing the extension's storage. Questions go
in an issue at <https://github.com/damo2929/KeepThePageKillUnwanted/issues>.
