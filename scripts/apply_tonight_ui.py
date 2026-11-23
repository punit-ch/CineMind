#!/usr/bin/env python3
"""Adds the Tonight screen to the existing dashboard files.

Run from the repository root:   python3 apply_tonight_ui.py

It edits public/dashboard.html, public/js/app.js and public/js/api.js using exact anchors.
All edits are computed first; if any anchor is missing nothing is written. Safe to re-run (idempotent).
"""
import re
import sys
from pathlib import Path

ROOT = Path.cwd()

NAV_ITEM = '''      <button class="nav-item" data-section="tonight">
        <span class="nav-icon">🌙</span> Tonight
      </button>
'''

QUICK_ACTION = '''        <div class="quick-action-card" data-navigate="tonight">
          <div class="quick-action-icon">🌙</div>
          <div class="quick-action-title">Decide for Me</div>
          <div class="quick-action-desc">Three spoiler-free picks for tonight, in seconds</div>
        </div>
'''

SECTION = '''    <!-- ── SECTION: Tonight ───────────────────────────────────────────────── -->
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


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Cannot apply: expected exactly one match for {label}, found {count}. Nothing was changed.")
    return text.replace(old, new, 1)


def insert_after(text, anchor, addition, label):
    return replace_once(text, anchor, anchor + addition, label)


def edit_html(html):
    if 'id="section-tonight"' in html:
        return html, False
    html = insert_after(
        html,
        '<link rel="stylesheet" href="/css/dashboard.css">\n',
        '  <link rel="stylesheet" href="/css/tonight.css">\n',
        'dashboard.css link',
    )
    home_btn = re.search(r'      <button class="nav-item active" data-section="home">.*?</button>\n', html, re.S)
    if not home_btn:
        raise SystemExit("Cannot apply: Home nav button not found. Nothing was changed.")
    html = html[: home_btn.end()] + NAV_ITEM + html[home_btn.end():]
    html = replace_once(
        html,
        '        <div class="quick-action-card" data-navigate="recommendations">\n',
        QUICK_ACTION + '        <div class="quick-action-card" data-navigate="recommendations">\n',
        'first quick-action card',
    )
    rec_comment = re.search(r'^[ \t]*<!-- ── SECTION: Recommendations.*?-->[ \t]*\n', html, re.M)
    if not rec_comment:
        raise SystemExit("Cannot apply: Recommendations section comment not found. Nothing was changed.")
    html = html[: rec_comment.start()] + SECTION + html[rec_comment.start():]
    return html, True


def edit_app(js):
    if "initTonight" in js:
        return js, False
    js = insert_after(
        js,
        "import { initCritic, initPlanner, initComparison } from './tools.js';\n",
        "import { initTonight } from './tonight.js';\n",
        "tools.js import",
    )
    js = insert_after(js, "  home: 'Home',\n", "  tonight: 'Tonight',\n", "TITLES home entry")
    js = replace_once(
        js,
        "    case 'recommendations': initRecommendations(el); break;\n",
        "    case 'tonight': initTonight(el); break;\n    case 'recommendations': initRecommendations(el); break;\n",
        "initSection recommendations case",
    )
    return js, True


def edit_api(js):
    if "tonight:" in js:
        return js, False
    js = insert_after(
        js,
        "  planNight: (data) => post('/ai/plan', data),\n",
        "  tonight: (params) => post('/ai/tonight', params),\n",
        "aiApi planNight entry",
    )
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
