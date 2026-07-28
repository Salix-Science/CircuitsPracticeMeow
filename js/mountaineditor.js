/* mountaineditor.js — Admin editor for the practice trail structure.

   Lets an admin author the exact order of the mountain: which problems appear,
   where blog posts sit as "trail notes", and where the route is broken up by
   milestones. The result is persisted to config/mountain and consumed by
   mountain.js.

   DESIGN CONSTRAINTS (why this file is additive-only):
   - index.html is untouched. The tab button and its panel are injected into
     the existing .editor-shell at runtime.
   - firebase.js is untouched. Persistence goes through window.MTN.saveStructure,
     which mountain.js implements against config/mountain — no new whitelist
     fields, no change to saveDB().
   - editor.js is untouched. This reuses its CSS classes but none of its JS.

   Wiring (done outside this file):
   1. main.js → add 'js/mountaineditor.js' to the featureScripts array.
   2. Firestore rules → allow read on config/mountain for signed-in users,
      write for admins.

   Console API: MTNED.diag() · MTNED.draft() · MTNED.reload()
*/

(function () {
  'use strict';

  const LOG = '[mtn-editor]';
  const TAG = 'mtned-2026-07-28-a';

  // Working copy. null until the editor is first opened.
  let _draft = null;
  // Index into _draft AFTER which new items get inserted. null = append at the
  // summit (end of array). Visually "insert above the selected row".
  let _cursor = null;
  let _paletteTab = 'posts';   // posts | problems | folders
  let _dragIdx = null;
  let _dirty = false;

  const uid = () => `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  // ── Styles ──────────────────────────────────────────────────────────
  const STYLE_ID = 'mtned-styles';
  const CSS = `
.mtned-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:16px;align-items:start;}
@media(max-width:900px){.mtned-grid{grid-template-columns:1fr;}}
.mtned-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;}
.mtned-mode{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:4px 9px;border-radius:999px;border:.5px solid var(--border);color:var(--text3);background:var(--bg3);}
.mtned-mode.is-authored{color:var(--accent2);border-color:var(--accent);}
.mtned-dirty{font-family:var(--mono);font-size:10px;color:var(--warn);}
.mtned-hint{font-size:11px;color:var(--text4);margin-bottom:10px;line-height:1.5;}
.mtned-warn{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;margin-bottom:12px;border-radius:var(--r2);background:rgba(251,191,36,.07);border:.5px solid rgba(251,191,36,.28);font-size:11.5px;color:var(--text2);line-height:1.5;}
.mtned-warn i{color:var(--warn);font-size:14px;flex-shrink:0;margin-top:1px;}
.mtned-warn button{margin-top:6px;}
.mtned-list{display:flex;flex-direction:column;gap:5px;max-height:60vh;overflow-y:auto;padding:4px 4px 4px 0;}
.mtned-row{display:flex;align-items:center;gap:9px;padding:8px 10px;background:var(--bg2);border:.5px solid var(--border);border-radius:var(--r2);cursor:pointer;transition:border-color .15s,background .15s;}
.mtned-row:hover{border-color:var(--border2);background:var(--bg3);}
.mtned-row.is-cursor{border-color:var(--accent);box-shadow:var(--glow);}
.mtned-row.drag-over{border-color:var(--accent2);border-style:dashed;}
.mtned-row.is-broken{border-color:var(--red);background:rgba(248,113,113,.05);}
.mtned-grip{color:var(--text4);font-size:13px;cursor:grab;flex-shrink:0;}
.mtned-kind{flex-shrink:0;width:24px;height:24px;border-radius:var(--r);display:grid;place-items:center;font-size:13px;background:var(--bg3);border:1px solid var(--border);}
.mtned-k-problem{color:var(--text2);}
.mtned-k-post{color:var(--accent2);}
.mtned-k-folder{color:var(--accent);}
.mtned-k-milestone{color:var(--gold,var(--warn));}
.mtned-row-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}
.mtned-row-title{font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mtned-row-meta{font-family:var(--mono);font-size:9.5px;color:var(--text4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mtned-row-acts{display:flex;gap:2px;flex-shrink:0;}
.mtned-anchor{display:flex;align-items:center;gap:8px;padding:5px 2px;font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--text4);}
.mtned-anchor span{flex:1;height:.5px;background:var(--border);}
.mtned-cursor-line{display:flex;align-items:center;gap:8px;padding:1px 2px;}
.mtned-cursor-line span{flex:1;height:1.5px;background:var(--accent);border-radius:2px;}
.mtned-cursor-line em{font-family:var(--mono);font-size:9px;font-style:normal;letter-spacing:.12em;text-transform:uppercase;color:var(--accent2);}
.mtned-pal-tabs{display:flex;gap:4px;padding:4px;margin-bottom:10px;background:var(--bg3);border:.5px solid var(--border);border-radius:var(--r2);}
.mtned-pal-tab{flex:1;padding:6px 8px;border:none;border-radius:var(--r);background:transparent;color:var(--text3);cursor:pointer;font-family:var(--font);font-size:11px;font-weight:600;}
.mtned-pal-tab.active{background:var(--bg);color:var(--accent2);box-shadow:var(--glow);}
.mtned-pal-list{display:flex;flex-direction:column;gap:4px;max-height:44vh;overflow-y:auto;padding-right:4px;}
.mtned-pal-row{display:flex;align-items:center;gap:8px;padding:7px 9px;background:var(--bg2);border:.5px solid var(--border);border-radius:var(--r2);}
.mtned-pal-row.is-placed{opacity:.5;}
.mtned-pal-body{flex:1;min-width:0;}
.mtned-pal-title{font-size:11.5px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mtned-pal-meta{font-family:var(--mono);font-size:9px;color:var(--text4);}
.mtned-empty{padding:2rem 1rem;text-align:center;color:var(--text4);font-size:12px;}
.mtned-prev{background:var(--bg3);border:.5px solid var(--border);border-radius:var(--r2);padding:12px;max-height:56vh;overflow-y:auto;}
.mtned-prev-row{display:flex;align-items:center;gap:8px;font-size:11px;padding:3px 0;color:var(--text3);}
.mtned-prev-num{font-family:var(--mono);font-size:9px;width:20px;text-align:right;color:var(--text4);flex-shrink:0;}
.mtned-prev-camp{font-family:var(--font-display);font-size:10.5px;font-weight:600;letter-spacing:.06em;color:var(--text2);text-transform:uppercase;padding:8px 0 3px;}
.mtned-prev-post{color:var(--accent2);}
`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
    console.log(LOG, 'styles injected');
  }

  // ── Panel + tab injection ───────────────────────────────────────────
  function injectPanel() {
    const tabs  = document.querySelector('.editor-top-tabs');
    const shell = document.querySelector('.editor-shell');
    if (!tabs || !shell) return false;
    if (document.getElementById('etab-mountain')) return true;   // already in

    // Tab button — placed right after "Folders", since the trail is folder-adjacent.
    const btn = document.createElement('button');
    btn.className = 'editor-top-tab';
    btn.textContent = 'Mountain';
    btn.addEventListener('click', () => {
      if (typeof window.showEdTab !== 'function') {
        console.warn(LOG, 'showEdTab missing'); return;
      }
      window.showEdTab('mountain', btn);
      renderMountainEditor();
    });
    const folderTab = [...tabs.children].find(b => /folders/i.test(b.textContent || ''));
    if (folderTab && folderTab.nextSibling) tabs.insertBefore(btn, folderTab.nextSibling);
    else tabs.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'editor-view';
    panel.id = 'etab-mountain';
    panel.innerHTML = '<div class="mtned-empty">Loading trail…</div>';
    shell.appendChild(panel);

    console.log(LOG, 'tab + panel injected');
    return true;
  }

  // ── Draft helpers ───────────────────────────────────────────────────

  // Build an authored node list that reproduces exactly what the derived
  // (folder-order) trail shows today. This is the migration path: an admin
  // seeds from what students already see, then rearranges.
  function seedFromFolders() {
    const nodes = [];
    (window.DB?.folders || []).forEach(f => {
      const live = (f.problemIds || []).filter(pid => {
        const p = (window.DB.problems || []).find(pr => pr.id === pid);
        return p && p.enabled !== false;
      });
      if (!live.length) return;
      nodes.push({ id: uid(), kind: 'folder', refId: f.id, fid: null, label: '' });
    });
    console.log(LOG, 'seeded', nodes.length, 'folder nodes from current trail');
    return nodes;
  }

  function ensureDraft() {
    if (_draft) return _draft;
    const s = window.MTN?.structure;
    _draft = s ? s.map(n => ({ ...n })) : seedFromFolders();
    _dirty = !s;                       // seeded-but-unsaved counts as dirty
    console.log(LOG, 'draft initialised ·', _draft.length, 'nodes · from',
      s ? 'saved structure' : 'seed');
    return _draft;
  }

  function insertNode(node) {
    ensureDraft();
    const at = (_cursor === null) ? _draft.length : _cursor + 1;
    _draft.splice(at, 0, node);
    _cursor = at;                      // keep inserting upward from here
    _dirty = true;
    console.log(LOG, 'inserted', node.kind, node.refId || node.label, 'at index', at);
    renderMountainEditor();
  }

  // Everything the authored trail currently covers, for the orphan check.
  function placedIds(draft) {
    const s = new Set();
    draft.forEach(n => {
      if (n.kind === 'problem' || n.kind === 'post') s.add(n.refId);
      if (n.kind === 'folder') {
        const f = (window.DB?.folders || []).find(x => x.id === n.refId);
        (f?.problemIds || []).forEach(pid => s.add(pid));
      }
    });
    return s;
  }

  // ── Row description ─────────────────────────────────────────────────
  function describe(n) {
    if (n.kind === 'folder') {
      const f = (window.DB?.folders || []).find(x => x.id === n.refId);
      if (!f) return { title: n.refId, meta: 'FOLDER — MISSING', icon: 'ti-folder-off', broken: true };
      const live = (f.problemIds || []).filter(pid => {
        const p = (window.DB.problems || []).find(pr => pr.id === pid);
        return p && p.enabled !== false;
      }).length;
      return { title: f.name, meta: `folder · ${live} peak${live !== 1 ? 's' : ''}`, icon: 'ti-folder' };
    }
    if (n.kind === 'problem') {
      const p = (window.DB?.problems || []).find(x => x.id === n.refId);
      if (!p) return { title: n.refId, meta: 'PROBLEM — MISSING', icon: 'ti-alert-triangle', broken: true };
      return {
        title: p.title,
        meta: `problem · ${p.topic || 'no topic'}${p.enabled === false ? ' · DISABLED (hidden)' : ''}`,
        icon: 'ti-mountain', broken: p.enabled === false,
      };
    }
    if (n.kind === 'post') {
      const po = (window.DB?.posts || []).find(x => x.id === n.refId);
      if (!po) return { title: n.refId, meta: 'POST — MISSING', icon: 'ti-alert-triangle', broken: true };
      return {
        title: po.title,
        meta: `trail note · ${po.category || 'uncategorised'}${po.status === 'draft' ? ' · draft (admins only)' : ''}`,
        icon: 'ti-book-2',
      };
    }
    return { title: n.label || 'Milestone', meta: 'milestone', icon: 'ti-map-pin' };
  }

  // ── Main render ─────────────────────────────────────────────────────
  window.renderMountainEditor = function renderMountainEditor() {
    if (!window.S?.isAdmin) { console.warn(LOG, '[security] renderMountainEditor blocked'); return; }
    injectStyles();
    injectPanel();
    const panel = document.getElementById('etab-mountain');
    if (!panel) { console.warn(LOG, 'no #etab-mountain panel'); return; }

    const draft = ensureDraft();
    const esc = window.escHtml || (s => String(s));
    const mode = window.MTN?.mode || 'derived';

    // Orphan check — problems and published posts nowhere on the trail.
    const placed = placedIds(draft);
    const orphanProbs = (window.DB?.problems || []).filter(p => p.enabled !== false && !placed.has(p.id));
    const orphanPosts = (window.DB?.posts || []).filter(p => p.status !== 'draft' && !placed.has(p.id));

    panel.innerHTML = `
      <div class="mtned-bar">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em">Mountain route</div>
        <span class="mtned-mode ${mode === 'authored' ? 'is-authored' : ''}">${mode}</span>
        ${_dirty ? '<span class="mtned-dirty">● unsaved changes</span>' : ''}
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm" id="mtned-milestone"><i class="ti ti-map-pin"></i> Milestone</button>
          <button class="btn btn-sm" id="mtned-seed"><i class="ti ti-refresh"></i> Reseed from folders</button>
          <button class="btn btn-sm" id="mtned-revert"><i class="ti ti-arrow-back-up"></i> Revert to auto</button>
          <button class="btn btn-sm btn-accent" id="mtned-save"><i class="ti ti-device-floppy"></i> Save route</button>
        </div>
      </div>

      ${orphanProbs.length || orphanPosts.length ? `
        <div class="mtned-warn">
          <i class="ti ti-alert-triangle"></i>
          <div>
            ${orphanProbs.length ? `<strong>${orphanProbs.length}</strong> enabled problem${orphanProbs.length !== 1 ? 's are' : ' is'} not on the route and won't be reachable from the trail. ` : ''}
            ${orphanPosts.length ? `<strong>${orphanPosts.length}</strong> published post${orphanPosts.length !== 1 ? 's are' : ' is'} not placed (still visible in the Blog view). ` : ''}
            ${orphanProbs.length ? '<br><button class="btn btn-sm" id="mtned-append-orphans"><i class="ti ti-plus"></i> Append missing problems at the summit</button>' : ''}
          </div>
        </div>` : ''}

      <div class="mtned-hint">
        Top of this list is the <strong>summit</strong>; bottom is the trailhead. Drag to reorder.
        Click a row to set the insert point — new items land directly above it.
      </div>

      <div class="mtned-grid">
        <div>
          <div class="mtned-anchor"><span></span>Summit<span></span></div>
          <div class="mtned-list" id="mtned-list"></div>
          <div class="mtned-anchor"><span></span>Trailhead<span></span></div>
        </div>

        <div>
          <div class="mtned-pal-tabs">
            <button class="mtned-pal-tab ${_paletteTab === 'posts' ? 'active' : ''}" data-pal="posts">Posts</button>
            <button class="mtned-pal-tab ${_paletteTab === 'problems' ? 'active' : ''}" data-pal="problems">Problems</button>
            <button class="mtned-pal-tab ${_paletteTab === 'folders' ? 'active' : ''}" data-pal="folders">Folders</button>
          </div>
          <input type="text" id="mtned-search" placeholder="Search…" value=""
                 style="width:100%;margin-bottom:8px;font-size:12px">
          <div class="mtned-pal-list" id="mtned-pal-list"></div>

          <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin:16px 0 8px">Preview</div>
          <div class="mtned-prev" id="mtned-prev"></div>
        </div>
      </div>`;

    renderList();
    renderPalette();
    renderPreview();

    // ── Toolbar wiring
    panel.querySelector('#mtned-milestone').addEventListener('click', () => {
      const label = prompt('Milestone label (e.g. "Base Camp: DC Analysis")');
      if (!label || !label.trim()) return;
      insertNode({ id: uid(), kind: 'milestone', refId: null, fid: null, label: label.trim().slice(0, 80) });
    });

    panel.querySelector('#mtned-seed').addEventListener('click', () => {
      if (!confirm('Replace the current route with the automatic folder order? Unsaved arrangement will be lost.')) return;
      _draft = seedFromFolders(); _cursor = null; _dirty = true;
      renderMountainEditor();
    });

    panel.querySelector('#mtned-revert').addEventListener('click', async () => {
      if (!confirm('Delete the authored route and go back to automatic folder order? Blog posts and milestones on the trail will be removed.')) return;
      const ok = await window.MTN.clearStructure();
      if (!ok) { alert('Could not clear the route — check the console.'); return; }
      _draft = null; _cursor = null; _dirty = false;
      if (typeof window.logAdminAction === 'function') window.logAdminAction('clear_mountain_route', {});
      renderMountainEditor();
      alert('Route cleared. The trail is back to automatic folder order.');
    });

    panel.querySelector('#mtned-save').addEventListener('click', async () => {
      const btn = panel.querySelector('#mtned-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      const ok = await window.MTN.saveStructure(_draft);
      btn.disabled = false;
      if (!ok) { alert('Save failed — check the console for the Firestore error.'); renderMountainEditor(); return; }
      _dirty = false;
      if (typeof window.logAdminAction === 'function') {
        window.logAdminAction('save_mountain_route', {
          nodes: _draft.length,
          posts: _draft.filter(n => n.kind === 'post').length,
          milestones: _draft.filter(n => n.kind === 'milestone').length,
        });
      }
      renderMountainEditor();
      console.log(LOG, 'saved · students will see the new route on their next visit to Practice');
    });

    const appendBtn = panel.querySelector('#mtned-append-orphans');
    if (appendBtn) appendBtn.addEventListener('click', () => {
      orphanProbs.forEach(p => _draft.push({ id: uid(), kind: 'problem', refId: p.id, fid: null, label: '' }));
      _dirty = true;
      console.log(LOG, 'appended', orphanProbs.length, 'orphan problems at the summit');
      renderMountainEditor();
    });

    panel.querySelectorAll('.mtned-pal-tab').forEach(b => {
      b.addEventListener('click', () => {
        _paletteTab = b.getAttribute('data-pal');
        renderMountainEditor();
      });
    });

    const search = panel.querySelector('#mtned-search');
    search.addEventListener('input', () => renderPalette(search.value));
  };

  // ── Trail list ──────────────────────────────────────────────────────
  function renderList() {
    const host = document.getElementById('mtned-list');
    if (!host) return;
    host.innerHTML = '';
    const esc = window.escHtml || (s => String(s));

    if (!_draft.length) {
      host.innerHTML = '<div class="mtned-empty">Route is empty. Add folders, problems or posts from the right.</div>';
      return;
    }

    // Displayed top→bottom = summit→trailhead, so walk the array backwards.
    for (let i = _draft.length - 1; i >= 0; i--) {
      const n = _draft[i];
      const d = describe(n);

      const row = document.createElement('div');
      row.className = `mtned-row${_cursor === i ? ' is-cursor' : ''}${d.broken ? ' is-broken' : ''}`;
      row.draggable = true;
      row.innerHTML = `
        <i class="ti ti-grip-vertical mtned-grip"></i>
        <span class="mtned-kind mtned-k-${esc(n.kind)}"><i class="ti ${esc(d.icon)}"></i></span>
        <span class="mtned-row-body">
          <span class="mtned-row-title">${esc(d.title)}</span>
          <span class="mtned-row-meta">${esc(d.meta)}</span>
        </span>
        <span class="mtned-row-acts">
          <button class="pm-icon-btn" data-act="up"   title="Move toward summit"><i class="ti ti-chevron-up"></i></button>
          <button class="pm-icon-btn" data-act="down" title="Move toward trailhead"><i class="ti ti-chevron-down"></i></button>
          <button class="pm-icon-btn del" data-act="del" title="Remove from route"><i class="ti ti-x"></i></button>
        </span>`;

      // Click row body = set insert point (toggles off if already selected)
      row.addEventListener('click', e => {
        if (e.target.closest('.mtned-row-acts')) return;
        _cursor = (_cursor === i) ? null : i;
        console.log(LOG, 'insert point →', _cursor === null ? 'summit (append)' : `above "${d.title}"`);
        renderList();
      });

      row.querySelectorAll('[data-act]').forEach(b => {
        b.addEventListener('click', e => {
          e.stopPropagation();
          const act = b.getAttribute('data-act');
          if (act === 'del') {
            _draft.splice(i, 1);
            if (_cursor !== null && _cursor >= i) _cursor = Math.max(0, _cursor - 1);
            console.log(LOG, 'removed', n.kind, d.title);
          } else {
            const j = act === 'up' ? i + 1 : i - 1;
            if (j < 0 || j >= _draft.length) return;
            [_draft[i], _draft[j]] = [_draft[j], _draft[i]];
            _cursor = j;
          }
          _dirty = true;
          renderMountainEditor();
        });
      });

      // Drag reorder — same interaction as the folder problem rows in editor.js
      row.addEventListener('dragstart', e => {
        _dragIdx = i; row.style.opacity = '0.4'; e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        row.style.opacity = '';
        host.querySelectorAll('.mtned-row').forEach(r => r.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('drag-over'); });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', e => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (_dragIdx === null || _dragIdx === i) return;
        const [moved] = _draft.splice(_dragIdx, 1);
        _draft.splice(i, 0, moved);
        console.log(LOG, 'dragged', describe(moved).title, `${_dragIdx} → ${i}`);
        _dragIdx = null; _cursor = i; _dirty = true;
        renderMountainEditor();
      });

      host.appendChild(row);

      // Insert-point marker sits ABOVE the selected row, matching where the
      // next item will actually appear on the climb.
      if (_cursor === i) {
        const line = document.createElement('div');
        line.className = 'mtned-cursor-line';
        line.innerHTML = '<span></span><em>insert here</em><span></span>';
        host.insertBefore(line, row);
      }
    }
  }

  // ── Palette ─────────────────────────────────────────────────────────
  function renderPalette(searchVal) {
    const host = document.getElementById('mtned-pal-list');
    if (!host) return;
    const esc = window.escHtml || (s => String(s));
    const q = (searchVal || '').toLowerCase().trim();
    const placed = placedIds(_draft || []);

    let items = [];
    if (_paletteTab === 'posts') {
      items = (window.DB?.posts || [])
        .slice()
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map(p => ({
          id: p.id, title: p.title,
          meta: `${p.category || 'uncategorised'}${p.status === 'draft' ? ' · draft' : ''}`,
          kind: 'post',
        }));
    } else if (_paletteTab === 'problems') {
      items = (window.DB?.problems || [])
        .filter(p => p.enabled !== false)
        .map(p => ({ id: p.id, title: p.title, meta: p.topic || 'no topic', kind: 'problem' }));
    } else {
      items = (window.DB?.folders || []).map(f => ({
        id: f.id, title: f.name,
        meta: `${(f.problemIds || []).length} problem${(f.problemIds || []).length !== 1 ? 's' : ''}`,
        kind: 'folder',
      }));
    }

    const filtered = q ? items.filter(i => i.title.toLowerCase().includes(q)) : items;

    if (!filtered.length) {
      host.innerHTML = `<div class="mtned-empty">${q ? 'Nothing matches that search.' : 'Nothing here yet.'}</div>`;
      return;
    }

    host.innerHTML = '';
    filtered.forEach(it => {
      const isPlaced = placed.has(it.id);
      const row = document.createElement('div');
      row.className = `mtned-pal-row${isPlaced ? ' is-placed' : ''}`;
      row.innerHTML = `
        <span class="mtned-pal-body">
          <div class="mtned-pal-title">${esc(it.title)}</div>
          <div class="mtned-pal-meta">${esc(it.meta)}${isPlaced ? ' · on route' : ''}</div>
        </span>
        <button class="btn btn-sm" style="flex-shrink:0"><i class="ti ti-plus"></i></button>`;
      row.querySelector('button').addEventListener('click', () => {
        insertNode({ id: uid(), kind: it.kind, refId: it.id, fid: null, label: '' });
      });
      host.appendChild(row);
    });
  }

  // ── Preview ─────────────────────────────────────────────────────────
  // Runs the draft through the SAME resolver mountain.js uses, so what shows
  // here is exactly what a student would get — including dropped nodes.
  function renderPreview() {
    const host = document.getElementById('mtned-prev');
    if (!host) return;
    const esc = window.escHtml || (s => String(s));

    if (typeof window.MTN?.resolve !== 'function') {
      host.innerHTML = '<div class="mtned-empty">mountain.js not loaded — no preview.</div>';
      console.warn(LOG, 'window.MTN.resolve missing — is mountain.js loaded?');
      return;
    }

    const nodes = window.MTN.resolve(_draft);
    if (!nodes.length) { host.innerHTML = '<div class="mtned-empty">Nothing to preview.</div>'; return; }

    let k = 0;
    const rows = nodes.map(n => {
      if (n.kind === 'camp') {
        return `<div class="mtned-prev-camp"><i class="ti ${esc(n.icon)}"></i> ${esc(n.label)}</div>`;
      }
      if (n.kind === 'post') {
        return `<div class="mtned-prev-row mtned-prev-post"><span class="mtned-prev-num">—</span>
          <i class="ti ti-book-2"></i> ${esc(n.post.title)}</div>`;
      }
      k += 1;
      return `<div class="mtned-prev-row"><span class="mtned-prev-num">${k}</span>
        <i class="ti ti-mountain"></i> ${esc(n.prob.title)}</div>`;
    }).reverse().join('');

    host.innerHTML = `<div class="mtned-prev-camp" style="color:var(--gold,var(--warn))"><i class="ti ti-flag-3"></i> Summit</div>
      ${rows}
      <div class="mtned-prev-camp" style="color:var(--text4)"><i class="ti ti-circle"></i> Trailhead</div>`;
  }

  // ── Console diagnostics ─────────────────────────────────────────────
  window.MTNED = {
    tag: TAG,
    draft: () => _draft,
    reload() { _draft = null; _cursor = null; _dirty = false; renderMountainEditor(); },
    diag() {
      console.group(LOG + ' diag · ' + TAG);
      console.log('mode:', window.MTN?.mode, '· saved nodes:', window.MTN?.structure?.length ?? 0);
      console.log('draft nodes:', _draft ? _draft.length : '(not initialised)', '· dirty:', _dirty);
      console.log('insert point:', _cursor === null ? 'summit (append)' : `index ${_cursor}`);
      if (_draft) {
        console.table(_draft.map((n, i) => {
          const d = describe(n);
          return { i, kind: n.kind, title: d.title, meta: d.meta, broken: !!d.broken };
        }));
        const resolved = window.MTN?.resolve?.(_draft) || [];
        console.log('resolves to:', resolved.filter(n => n.kind === 'prob').length, 'peaks ·',
          resolved.filter(n => n.kind === 'post').length, 'waypoints ·',
          resolved.filter(n => n.kind === 'camp').length, 'camps');
        const dropped = _draft.length && !resolved.length;
        if (dropped) console.warn('every node was dropped during resolution — check for missing refIds above');
      }
      console.groupEnd();
      return { draft: _draft, dirty: _dirty, cursor: _cursor };
    },
  };

  // ── Boot ────────────────────────────────────────────────────────────
  // The editor shell exists in index.html from the start, but feature scripts
  // load in parallel with no order guarantee — poll briefly, same pattern
  // mountain.js uses for practice.js globals.
  let tries = 0;
  (function waitForShell() {
    if (injectStyles(), injectPanel()) {
      console.log(LOG, 'ready ·', TAG);
      return;
    }
    if (++tries > 100) {
      console.warn(LOG, 'gave up waiting for .editor-shell after', tries, 'tries — Mountain tab not installed');
      return;
    }
    setTimeout(waitForShell, 50);
  })();

  console.log(LOG, 'module loaded ·', TAG);
})();
