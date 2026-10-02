#!/usr/bin/env bash
# Keep The Page — build the zip that goes to the Chrome Web Store.
#
# WHY THIS EXISTS, AND WHY IT IS NOT `zip -r`
#
# 1. The working tree is mostly prose. AGENTS.md, README.md and
#    sweep-results.md are ~135KB of the 166KB a naive zip produces, and
#    debug.js is a tracer that no content_scripts entry loads -- dead code
#    that patches window.confirm, which is exactly the file a reviewer reading
#    the bundle stops on. _metadata/ is Chrome's own signature directory and
#    must never be uploaded.
#
# 2. So the file list is DERIVED, never enumerated. Everything shipped is
#    reachable from manifest.json -- its content scripts, its rule resources,
#    its icons, its options page -- plus whatever that page itself loads, plus
#    the licence. Add a new doc tomorrow and it stays out by construction; add
#    a new content script and it ships without anyone remembering to edit a
#    list here. A stale exclude list is how the wrong file ships.
#
# 3. The store requires every upload to carry a version higher than the
#    published one, and bump.sh's 0.1.MMDD.HHMM carries no year: January
#    (0.1.105.x) sorts BELOW the previous December (0.1.1231.x), and the
#    second upload of the new year would be refused. bump.sh's own comment
#    says this "only matters if it is ever packed" -- publishing is packing.
#    The staged manifest is therefore restamped 0.<YYMM>.<DD>.<HHMM>, read
#    from version_name's real date, which rises forever and keeps HHMM as the
#    last component so the portal-early.js build stamp still matches. The
#    working tree keeps 0.1.MMDD.HHMM for unpacked reloads.
#
# 4. `key` is dropped from the staged manifest. It pins the unpacked id
#    during development; the store issues the published id from the publisher
#    account. Unverified: the docs do not say what the store does with a key
#    that is present. Nothing has been published yet, so there is no id to
#    preserve.
#
#    There is no `author` to drop: the key is gone from the manifest. Chrome
#    and the store have silently ignored it since February 2024, and the only
#    rule ever written about it -- that the address match the publishing
#    account -- cannot apply to a key nobody reads. All it did was put an
#    email address in a public repository. The strip below still names it, so
#    that re-adding the key cannot quietly ship one.
#
# Usage:
#   ./package.sh              build dist/keep-the-page-<version>.zip
#   ./package.sh --no-tests   build when gjs is missing and the suite cannot run
set -euo pipefail
cd "$(dirname "$0")"

RUN_TESTS=1
[ "${1:-}" = "--no-tests" ] && RUN_TESTS=0

# ---- the suite gates the build -------------------------------------------
# A package that has not been tested is not a package. gjs missing is an
# environment gap rather than a failure, but it has to be said out loud with
# --no-tests, never assumed.
if [ "$RUN_TESTS" = 1 ]; then
  if ! command -v gjs >/dev/null; then
    echo "package.sh: gjs is not installed, so ./test.sh cannot run." >&2
    echo "            Install gjs, or re-run as: ./package.sh --no-tests" >&2
    exit 1
  fi
  ./test.sh
else
  echo "package.sh: WARNING -- unit tests skipped at your request."
fi

OUT=dist
rm -rf "$OUT"
mkdir -p "$OUT/pkg"

# ---- work out what ships, and the store version --------------------------
python3 - "$OUT/pkg" <<'PY'
import json, os, re, shutil, sys

stage = sys.argv[1]
m = json.load(open('manifest.json'))

# Every path the manifest reaches.
want = {'manifest.json', 'LICENSE'}
for cs in m.get('content_scripts', []):
    want.update(cs.get('js', []))
    want.update(cs.get('css', []))
for rr in m.get('declarative_net_request', {}).get('rule_resources', []):
    want.add(rr['path'])
want.update(m.get('icons', {}).values())
for key in (m.get('options_ui', {}).get('page'),
            m.get('action', {}).get('default_popup')):
    if key:
        want.add(key)
for ic in (m.get('action', {}).get('default_icon') or {}).values():
    want.add(ic)

# Whatever those pages load. An options page that pulls in options.js is the
# whole reason this is not just the manifest's own list.
for page in [p for p in list(want) if p.endswith('.html')]:
    html = open(page).read()
    for ref in re.findall(r'(?:src|href)\s*=\s*["\']([^"\']+)["\']', html):
        if re.match(r'[a-z]+:|//|#|data:', ref):
            continue                      # external or in-page: not ours to ship
        want.add(os.path.normpath(os.path.join(os.path.dirname(page), ref)))

missing = sorted(p for p in want if not os.path.isfile(p))
if missing:
    sys.exit('package.sh: manifest references files that do not exist: ' + ', '.join(missing))

# The store version. version_name carries the real date; bump.sh writes both,
# so disagreeing with it means bump.sh has not been run.
vn = m.get('version_name', '')
d = re.search(r'(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})', vn)
if not d:
    sys.exit('package.sh: version_name has no date -- run ./bump.sh first: ' + vn)
yy, mm, dd, hh, mi = (int(x) for x in d.groups())
store_version = '0.%d.%d.%d' % (yy % 100 * 100 + mm, dd, hh * 100 + mi)

# The build stamp in portal-early.js must match the version it ships beside,
# or a diagnosis gets read off the wrong build. bump.sh keeps them in step.
stamp = re.search(r"const VERSION = '(\d+)';", open('portal-early.js').read())
if not stamp:
    sys.exit('package.sh: portal-early.js has no VERSION stamp')
if stamp.group(1) != m['version'].rsplit('.', 1)[-1]:
    sys.exit('package.sh: portal-early.js stamps %s, manifest ends %s -- run ./bump.sh'
             % (stamp.group(1), m['version'].rsplit('.', 1)[-1]))

for p in sorted(want):
    dest = os.path.join(stage, p)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(p, dest)

staged = json.load(open(os.path.join(stage, 'manifest.json')))
for dev_only in ('key', 'author'):      # author should not exist; belt and braces
    staged.pop(dev_only, None)
staged['version'] = store_version
assert 'key' not in staged and 'author' not in staged, 'dev-only keys survived staging'
json.dump(staged, open(os.path.join(stage, 'manifest.json'), 'w'), indent=2)
open(os.path.join(stage, 'manifest.json'), 'a').write('\n')

# The zip is named from the manifest, not from a string typed here: the item
# has been renamed once already, and a file called after the old name is the
# kind of thing that gets uploaded to the wrong listing.
slug = re.sub(r'[^a-z0-9]+', '-', m['name'].lower()).strip('-')
open(os.path.join(stage, '..', 'VERSION'), 'w').write(store_version + '\n')
open(os.path.join(stage, '..', 'SLUG'), 'w').write(slug + '\n')
print('store version : %s   (dev %s)' % (store_version, m['version']))
print('name          : %s' % m['name'])
print('files         : %d' % len(want))
PY

VERSION=$(cat "$OUT/VERSION")
ZIP="$OUT/$(cat "$OUT/SLUG")-$VERSION.zip"

# Chrome reserves names beginning with "_" for itself; _metadata is its own
# signature directory and makes an upload fail. Nothing derived from the
# manifest should produce one, so this is a tripwire, not a filter.
if find "$OUT/pkg" -name '_*' -print -quit | grep -q .; then
  echo "package.sh: a reserved _name reached the staging tree" >&2
  exit 1
fi

( cd "$OUT/pkg" && zip -q -r -X "../$(basename "$ZIP")" . )

echo
echo "wrote $ZIP  ($(du -h "$ZIP" | cut -f1))"
echo
echo "contents:"
( cd "$OUT/pkg" && find . -type f | sed 's|^\./|  |' | sort )
echo
echo "Next: upload at https://chrome.google.com/webstore/devconsole"
echo "      SUBMISSION.md has the dashboard answers and the listing copy."
