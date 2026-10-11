/*
 * Keep The Page — background service worker.
 *
 * Two jobs, both about settings living in chrome.storage.sync:
 *
 * 1. MIGRATION. Settings used to live in chrome.storage.local. On install,
 *    update and browser start, every settings key that is in local but not in
 *    sync is copied into sync. A key sync already has is never overwritten:
 *    that value came from this profile's other machines or from a later
 *    save, and either is newer than what local holds. Only once sync has
 *    accepted the copy are the settings keys removed from local, so a failed
 *    copy (quota, sync unavailable) deletes nothing and is retried at the
 *    next start. After that local holds no settings, and every later run
 *    finds nothing to do.
 *
 *    `errors` is deliberately not in the list: it is this machine's log and
 *    stays in local.
 *
 *    Content scripts that load before the copy lands see defaults for a
 *    moment, then pick the settings up through their onChanged('sync')
 *    listeners, so no page needs a reload.
 *
 * 2. THE DISQUS RULESET. The comments switch also drives the static DNR
 *    ruleset `widgets`. Chrome resets updateEnabledRulesets on an extension
 *    update, and a setting synced in from another machine never passes
 *    through the options page, so the stored choice is applied here too: on
 *    install, update, start, and whenever `widgets` changes in sync.
 */
'use strict';

const SETTINGS = ['trace', 'protect', 'social', 'portal', 'widgets',
                  'commentExceptions', 'socialExceptions', 'newsletterExceptions'];
const WIDGETS = 'widgets';
const RULESET = 'widgets';

const migrate = async () => {
  const local = await chrome.storage.local.get(SETTINGS);
  const found = SETTINGS.filter((k) => k in local);
  if (!found.length) return;
  const synced = await chrome.storage.sync.get(SETTINGS);
  const copy = {};
  for (const k of found) {
    if (!(k in synced)) copy[k] = local[k];
  }
  /* Rejects on a refused write, which leaves local untouched for next time. */
  if (Object.keys(copy).length) await chrome.storage.sync.set(copy);
  await chrome.storage.local.remove(found);
};

/* A missing key or a missing `comments` means on, as everywhere else. */
const applyWidgets = async (w) => {
  const on = !(w && w.comments === false);
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    on ? { enableRulesetIds: [RULESET] } : { disableRulesetIds: [RULESET] });
};

const settle = async () => {
  try { await migrate(); } catch (e) { console.error('settings migration', e); }
  try {
    const got = await chrome.storage.sync.get(WIDGETS);
    await applyWidgets(got[WIDGETS]);
  } catch (e) { console.error('widgets ruleset', e); }
};

chrome.runtime.onInstalled.addListener(settle);
chrome.runtime.onStartup.addListener(settle);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes[WIDGETS]) return;
  applyWidgets(changes[WIDGETS].newValue)
    .catch((e) => console.error('widgets ruleset', e));
});
