#!/usr/bin/env python3
"""Adds the Tonight and Library screens to the existing dashboard files.

Run from the repository root:   python3 scripts/apply_tonight_ui.py

It edits public/dashboard.html, public/js/app.js and public/js/api.js using exact anchors.
Each feature (Tonight, Library) is applied only if it is missing, so it is safe to run again and also works
if you already applied the Tonight part from an earlier version. All edits are computed first; if any anchor
is missing nothing is written.
"""
import re
import sys
from pathlib import Path

ROOT = Path.cwd()

# ── Tonight ───────────────────────────────────────────────────────────────────
TONIGHT_NAV = '''      <button class="nav-item" data-section="tonight">
        <span class="nav-icon">🌙</span> Tonight
      </button>
'''

TONIGHT_QUICK = '''        <div class="quick-action-card" data-navigate="tonight">
          <div class="quick-action-icon">🌙</div>
          <div class="quick-action-title">Decide for Me</div>
          <div class="quick-action-desc">Three spoiler-free picks for tonight, in seconds</div>
        </div>
'''

TONIGHT_SECTION = '''    <!-- ── SECTION: Tonight ───────────────────────────────────────────────── -->
    <div class="section-page" id="section-tonight">
      <div class="section-page-header">
        <h1>Tonight</h1>
        <p>Three picks for right now. No scrolling required.</p>
      </div>

      <div class="rec-form tonight-form">
        <div class="tonight-field">
          <span class="input-label" id="tonight-type-label">What are you after?</span>
          <div class="tonight-segment" id="tonight-type" role="radiogroup" aria-labelledby="tonight-type-label"></div>
        </div>
        <div class="tonight-field">
          <span class="input-label" id="tonight-time-label">How much time do you have? <span class="text-muted">(movies only)</span></span>
          <div class="tonight-segment" id="tonight-time" role="radiogroup" aria-labelledby="tonight-time-label"></div>
        </div>
        <div class="tonight-field">
          <span class="input-label" id="tonight-mood-label">Mood <span class="text-muted">(optional)</span></span>
          <div class="tonight-chips" id="tonight-moods" role="group" aria-labelledby="tonight-mood-label"></div>
          <input type="text" class="input-field" id="tonight-mood-input" maxlength="60"
                 placeholder="or describe it, e.g. something warm and funny" aria-labelledby="tonight-mood-label">
        </div>
        <div>
          <button class="btn btn-primary" id="tonight-go">🌙 Pick for tonight</button>
        </div>
      </div>
      <p class="tonight-note text-muted body-sm">Spoiler-free: plot details are left out on purpose.</p>

      <div id="tonight-results" aria-live="polite"></div>
      <div class="tonight-more hidden" id="tonight-more">
        <button class="btn btn-secondary" id="tonight-again">↻ Different picks</button>
      </div>
    </div>

'''

# ── Library ───────────────────────────────────────────────────────────────────
LIBRARY_NAV = '''      <button class="nav-item" data-section="library">
        <span class="nav-icon">📚</span> Library
      </button>
'''

LIBRARY_SECTION = '''    <!-- ── SECTION: Library ───────────────────────────────────────────────── -->
    <div class="section-page" id="section-library">
      <div class="section-page-header">
        <h1>Library</h1>
        <p>Your queues and viewing diary. Saved in this browser.</p>
      </div>

      <div class="lib-tabs" id="lib-tabs" role="tablist" aria-label="Library sections"></div>

      <div class="lib-add">
        <label class="input-label" for="lib-search">Find a title</label>
        <div class="lib-add__row">
          <div class="lib-segment" id="lib-search-type" role="radiogroup" aria-label="Search in"></div>
          <input type="search" class="input-field" id="lib-search" maxlength="100" autocomplete="off"
                 placeholder="Search to add to your queue or log a viewing">
        </div>
        <div id="lib-results" aria-live="polite"></div>
      </div>

      <div id="lib-log" class="hidden"></div>
      <div id="lib-panel"></div>
      <p class="lib-muted body-sm" id="lib-status" role="status"></p>
    </div>

'''


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Cannot apply: expected exactly one match for {label}, found {count}. Nothing was changed.")
    return text.replace(old, new, 1)


def insert_after(text, anchor, addition, label):
    return replace_once(text, anchor, anchor + addition, label)


def insert_after_home_nav(html, addition):
    m = re.search(r'      <button class="nav-item active" data-section="home">.*?</button>\n', html, re.S)
    if not m:
        raise SystemExit("Cannot apply: Home nav button not found. Nothing was changed.")
    return html[: m.end()] + addition + html[m.end():]


def insert_before_recommendations_section(html, addition):
    m = re.search(r'^[ \t]*<!-- ── SECTION: Recommendations.*?-->[ \t]*\n', html, re.M)
    if not m:
        raise SystemExit("Cannot apply: Recommendations section comment not found. Nothing was changed.")
    return html[: m.start()] + addition + html[m.start():]


def edit_html(html):
    changed = False
    css_anchor = '<link rel="stylesheet" href="/css/dashboard.css">\n'
    if 'id="section-tonight"' not in html:
        html = insert_after(html, css_anchor, '  <link rel="stylesheet" href="/css/tonight.css">\n', 'dashboard.css link')
        html = insert_after_home_nav(html, TONIGHT_NAV)
        html = replace_once(
            html,
            '        <div class="quick-action-card" data-navigate="recommendations">\n',
            TONIGHT_QUICK + '        <div class="quick-action-card" data-navigate="recommendations">\n',
            'first quick-action card',
        )
        html = insert_before_recommendations_section(html, TONIGHT_SECTION)
        changed = True
    if 'id="section-library"' not in html:
        if '/css/library.css' not in html:
            html = insert_after(html, css_anchor, '  <link rel="stylesheet" href="/css/library.css">\n', 'dashboard.css link')
        # Library goes right after the Tonight nav item if present, otherwise after Home
        tonight_nav = re.search(r'      <button class="nav-item" data-section="tonight">.*?</button>\n', html, re.S)
        if tonight_nav:
            html = html[: tonight_nav.end()] + LIBRARY_NAV + html[tonight_nav.end():]
        else:
            html = insert_after_home_nav(html, LIBRARY_NAV)
        html = insert_before_recommendations_section(html, LIBRARY_SECTION)
        changed = True
    return html, changed


def edit_app(js):
    changed = False
    if 'initTonight' not in js:
        js = insert_after(js, "import { initCritic, initPlanner, initComparison } from './tools.js';\n",
                          "import { initTonight } from './tonight.js';\n", "tools.js import")
        js = insert_after(js, "  home: 'Home',\n", "  tonight: 'Tonight',\n", "TITLES home entry")
        js = replace_once(js, "    case 'recommendations': initRecommendations(el); break;\n",
                          "    case 'tonight': initTonight(el); break;\n    case 'recommendations': initRecommendations(el); break;\n",
                          "initSection recommendations case")
        changed = True
    if 'initLibrary' not in js:
        js = insert_after(js, "import { initTonight } from './tonight.js';\n",
                          "import { initLibrary } from './library/libraryView.js';\n", "tonight.js import")
        js = insert_after(js, "  tonight: 'Tonight',\n", "  library: 'Library',\n", "TITLES tonight entry")
        js = replace_once(js, "    case 'tonight': initTonight(el); break;\n",
                          "    case 'tonight': initTonight(el); break;\n    case 'library': initLibrary(el); break;\n",
                          "initSection tonight case")
        changed = True
    return js, changed


def edit_api(js):
    if "tonight:" in js:
        return js, False
    js = insert_after(js, "  planNight: (data) => post('/ai/plan', data),\n",
                      "  tonight: (params) => post('/ai/tonight', params),\n", "aiApi planNight entry")
    return js, True


def main():
    targets = [
        (ROOT / 'public/dashboard.html', edit_html),
        (ROOT / 'public/js/app.js', edit_app),
        (ROOT / 'public/js/api.js', edit_api),
    ]
    results = []
    for path, fn in targets:
        if not path.exists():
            raise SystemExit(f"Cannot apply: {path} not found. Run this from the repository root.")
        original = path.read_text(encoding='utf-8')
        updated, changed = fn(original)
        results.append((path, updated, changed))
    for path, updated, changed in results:
        if changed:
            path.write_text(updated, encoding='utf-8')
        print(f"{'updated' if changed else 'already up to date'}: {path.relative_to(ROOT)}")


if __name__ == '__main__':
    sys.exit(main())
