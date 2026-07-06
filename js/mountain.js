/* mountain.js — Practice "mountain" view.
   A single continuous ascending trail across ALL folders (DB order), in
   chronological study order. Every peak is clickable; progress is shown but
   nothing is locked. Becomes the practice landing, with a toggle back to the
   classic list.

   DESIGN CONSTRAINTS (why this file is additive-only):
   - Never rewrites practice.js. It wraps three globals (buildPracticeSidebar,
     renderFolderProblem, showDifficultyRating) once they exist.
   - Reads colors/fonts only from CSS variables, so it tracks the live theme.
   - No new persisted Firestore fields, so firebase.js whitelists are untouched.

   Wiring (done outside this file):
   1. main.js  → add 'js/mountain.js' to the parallel featureScripts array.
   2. app.js   → in showView(), add:  if(v==='practice') window.enterPracticeView?.();
*/

(function () {
  'use strict';

  const LOG = '[mountain]';
  const MODE_KEY = 'mtn_view_mode';           // 'mountain' | 'list'
  window._mtnSolved = window._mtnSolved || new Set();  // session solves
  window._fromMountain = window._fromMountain || false;

  // ── Mode persistence ────────────────────────────────────────────────
  function getMode() {
    let m = 'mountain';
    try { m = localStorage.getItem(MODE_KEY) || 'mountain'; } catch (e) {}
    return m === 'list' ? 'list' : 'mountain';
  }
  function setMode(m) {
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
    console.log(LOG, 'mode →', m);
  }

  // ── Progress signal ─────────────────────────────────────────────────
  // A problem counts as solved if ANY of these are true:
  //   • solved this session (captured via showDifficultyRating wrapper)
  //   • the user rated its difficulty (rating UI only appears after a solve)
  //   • an assignment attemptLog entry for it is marked correct
  function solvedSet() {
    const s = new Set(window._mtnSolved);
    const u = window.DB?.users?.[window.S?.user];
    if (u) {
      if (u.probRatings && typeof u.probRatings === 'object') {
        Object.keys(u.probRatings).forEach(pid => s.add(pid));
      }
      if (u.diffRatings && typeof u.diffRatings === 'object') {
        Object.keys(u.diffRatings).forEach(pid => s.add(pid));
      }
      if (Array.isArray(u.attemptLog)) {
        u.attemptLog.forEach(e => { if (e && e.correct && e.probId) s.add(e.probId); });
      }
    }
    return s;
  }

  // ── Ordered nodes: every enabled problem, folder-grouped, ascending ──
  // index 0 = first thing to study (rendered at the BOTTOM = trailhead).
  function orderedNodes() {
    const folders = (window.DB?.folders || []).filter(f =>
      (f.problemIds || []).some(pid => {
        const p = window.DB.problems.find(pr => pr.id === pid);
        return p && p.enabled !== false;
      })
    );
    const nodes = [];
    folders.forEach(f => {
      const probs = (f.problemIds || [])
        .map(pid => window.DB.problems.find(pr => pr.id === pid))
        .filter(p => p && p.enabled !== false);
      if (!probs.length) return;
      nodes.push({ kind: 'folder', folder: f, count: probs.length });
      probs.forEach(p => nodes.push({ kind: 'prob', prob: p, folder: f }));
    });
    console.log(LOG, 'orderedNodes:', nodes.filter(n => n.kind === 'prob').length,
      'problems across', folders.length, 'folders');
    return nodes;
  }

  // ── Summit SVG (uses currentColor so it inherits the peak state colour) ─
  function summitSVG() {
    return `<svg class="mtn-summit-svg" viewBox="0 0 120 64" aria-hidden="true">
      <polygon points="60,4 96,60 24,60" fill="var(--bg3)" stroke="var(--border2)" stroke-width="1.5"/>
      <polygon points="60,4 74,26 60,20 46,26" fill="var(--bg5)"/>
      <line x1="60" y1="4" x2="60" y2="-14" stroke="var(--gold, var(--warn))" stroke-width="2"/>
      <polygon points="60,-14 60,-4 76,-9" fill="var(--gold, var(--warn))"/>
    </svg>`;
  }

  // ── Main render ─────────────────────────────────────────────────────
  window.renderMountain = function renderMountain() {
    const main = document.getElementById('practice-main');
    if (!main) { console.warn(LOG, 'no #practice-main'); return; }

    const nodes = orderedNodes();
    const solved = solvedSet();
    const probNodes = nodes.filter(n => n.kind === 'prob');
    const total = probNodes.length;
    const done = probNodes.filter(n => solved.has(n.prob.id)).length;

    if (!total) {
      main.innerHTML = `<div class="mtn-empty">
        <div class="mtn-empty-icon">⛰</div>
        <div class="mtn-empty-title">No trail yet</div>
        <div class="mtn-empty-sub">Add problems to a topic folder in the Editor and they'll appear here as a climb.</div>
      </div>`;
      console.log(LOG, 'render: empty');
      return;
    }

    // "next" = the lowest-index unsolved problem = where the student is headed.
    const nextNode = probNodes.find(n => !solved.has(n.prob.id)) || null;
    const nextId = nextNode ? nextNode.prob.id : null;
    console.log(LOG, `render: ${done}/${total} solved · next =`,
      nextNode ? nextNode.prob.title : '— (summit reached)');

    // Build rows top→bottom visually, so reverse the ascending order.
    const visual = nodes.slice().reverse();

    // Number problems 1..total in ascending order for stable markers.
    const numById = {};
    let k = 0;
    nodes.forEach(n => { if (n.kind === 'prob') { k += 1; numById[n.prob.id] = k; } });

    const rowsHTML = visual.map(n => {
      if (n.kind === 'folder') {
        return `<div class="mtn-camp">
          <span class="mtn-camp-line"></span>
          <span class="mtn-camp-label">
            <i class="ti ti-flag"></i>${escHtml(n.folder.name)}
            <span class="mtn-camp-count">${n.count} peak${n.count !== 1 ? 's' : ''}</span>
          </span>
          <span class="mtn-camp-line"></span>
        </div>`;
      }
      const p = n.prob;
      const num = numById[p.id];
      const isSolved = solved.has(p.id);
      const isNext = p.id === nextId;
      const side = num % 2 === 0 ? 'right' : 'left';
      const stateCls = isSolved ? 'is-solved' : (isNext ? 'is-next' : 'is-todo');
      const marker = isSolved
        ? '<i class="ti ti-check"></i>'
        : (isNext ? '<i class="ti ti-hiking"></i>' : String(num));
      const meta = isSolved ? 'Cleared'
        : (isNext ? 'You are here' : `Peak ${num}`);
      return `<button type="button"
          class="mtn-node mtn-${side} ${stateCls}"
          data-fid="${escHtml(n.folder.id)}"
          data-pid="${escHtml(p.id)}"
          ${isNext ? 'data-next="1"' : ''}
          aria-label="Open ${escHtml(p.title)}${isSolved ? ' (cleared)' : ''}">
        <span class="mtn-branch"></span>
        <span class="mtn-dot"></span>
        <span class="mtn-marker">${marker}</span>
        <span class="mtn-body">
          <span class="mtn-title">${escHtml(p.title)}</span>
          <span class="mtn-meta">${meta}</span>
        </span>
      </button>`;
    }).join('');

    const pct = total ? Math.round((done / total) * 100) : 0;
    const summitState = done >= total ? 'is-solved' : 'is-todo';

    main.innerHTML = `
      <div class="mtn-wrap">
        <div class="mtn-header">
          <div class="mtn-header-top">
            <div>
              <div class="mtn-h-title">The Climb</div>
              <div class="mtn-h-sub">${done} of ${total} peaks cleared${nextNode ? ` · next: ${escHtml(nextNode.prob.title)}` : ' · summit reached'}</div>
            </div>
            <div class="mtn-h-pct">${pct}<span>%</span></div>
          </div>
          <div class="mtn-bar"><div class="mtn-bar-fill" style="width:${pct}%"></div></div>
        </div>

        <div class="mtn-trail" id="mtn-trail">
          <div class="mtn-spine"></div>

          <div class="mtn-summit ${summitState}">
            ${summitSVG()}
            <div class="mtn-summit-label">${done >= total ? 'Summit cleared' : 'Summit'}</div>
          </div>

          ${rowsHTML}

          <div class="mtn-base">
            <span class="mtn-base-dot"></span>
            <span class="mtn-base-label">Trailhead — start here</span>
          </div>
        </div>
      </div>`;

    // Click handlers (addEventListener, not inline — per the codebase's XSS posture)
    main.querySelectorAll('.mtn-node').forEach(btn => {
      btn.addEventListener('click', () => {
        const fid = btn.getAttribute('data-fid');
        const pid = btn.getAttribute('data-pid');
        openFromMountain(fid, pid);
      });
    });

    // Bring "you are here" into view (or the summit if everything's cleared).
    requestAnimationFrame(() => {
      const target = main.querySelector('.mtn-node[data-next="1"]') ||
                     main.querySelector('.mtn-summit');
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ block: 'center', behavior: 'auto' });
        console.log(LOG, 'scrolled to', target.classList.contains('mtn-summit') ? 'summit' : 'next peak');
      }
    });
  };

  // ── Open a problem from a peak ──────────────────────────────────────
  function openFromMountain(folderId, probId) {
    console.log(LOG, 'open peak', { folderId, probId });
    if (typeof window.loadFolderPractice !== 'function') {
      console.warn(LOG, 'loadFolderPractice missing — cannot open peak');
      return;
    }
    window._fromMountain = true;
    window.loadFolderPractice(folderId, probId, null);
  }

  // ── Sidebar view toggle (Trail / List) ──────────────────────────────
  function injectToggle() {
    const sb = document.getElementById('practice-sidebar');
    if (!sb) return;
    if (sb.querySelector('.mtn-toggle')) return; // already present
    const mode = getMode();
    const wrap = document.createElement('div');
    wrap.className = 'mtn-toggle';
    wrap.innerHTML = `
      <button type="button" class="mtn-tg-btn ${mode === 'mountain' ? 'active' : ''}" data-mode="mountain">
        <i class="ti ti-mountain"></i>Trail
      </button>
      <button type="button" class="mtn-tg-btn ${mode === 'list' ? 'active' : ''}" data-mode="list">
        <i class="ti ti-list"></i>List
      </button>`;
    wrap.querySelectorAll('.mtn-tg-btn').forEach(b => {
      b.addEventListener('click', () => {
        const m = b.getAttribute('data-mode');
        setMode(m);
        wrap.querySelectorAll('.mtn-tg-btn').forEach(x =>
          x.classList.toggle('active', x === b));
        applyMode();
      });
    });
    sb.insertBefore(wrap, sb.firstChild);
    console.log(LOG, 'toggle injected · mode =', mode);
  }

  function applyMode() {
    const main = document.getElementById('practice-main');
    if (!main) return;
    if (getMode() === 'mountain') {
      window._fromMountain = false;
      window.renderMountain();
    } else {
      // List mode: hand control back to the classic flow. Empty until the
      // student picks a problem in the sidebar (original behaviour).
      main.innerHTML = `<div class="mtn-list-hint">
        <i class="ti ti-arrow-left"></i> Pick a problem from a folder to begin.
      </div>`;
      console.log(LOG, 'list mode active');
    }
  }

  // Called from app.js showView('practice').
  window.enterPracticeView = function enterPracticeView() {
    console.log(LOG, 'enterPracticeView');
    injectToggle();
    applyMode();
  };

  // ── Wrap existing globals once they exist ───────────────────────────
  function installWrappers() {
    // buildPracticeSidebar rebuilds the sidebar (innerHTML=''), wiping our
    // toggle. Re-inject it after every rebuild, and repaint the trail if the
    // practice view is currently showing in mountain mode.
    if (typeof window.buildPracticeSidebar === 'function' && !window.buildPracticeSidebar._mtnWrapped) {
      const orig = window.buildPracticeSidebar;
      window.buildPracticeSidebar = function () {
        const r = orig.apply(this, arguments);
        try {
          injectToggle();
          const view = document.getElementById('view-practice');
          const visible = view && !view.classList.contains('hidden');
          if (visible && getMode() === 'mountain') window.renderMountain();
        } catch (e) { console.warn(LOG, 'sidebar wrap error', e); }
        return r;
      };
      window.buildPracticeSidebar._mtnWrapped = true;
      console.log(LOG, 'wrapped buildPracticeSidebar');
    }

    // renderFolderProblem paints a single problem. When we arrived from the
    // trail, drop a "Back to the trail" button at the top of the pane.
    if (typeof window.renderFolderProblem === 'function' && !window.renderFolderProblem._mtnWrapped) {
      const orig = window.renderFolderProblem;
      window.renderFolderProblem = function () {
        const r = orig.apply(this, arguments);
        try {
          if (window._fromMountain) {
            const pane = document.querySelector('#practice-main .practice-pane');
            if (pane && !pane.querySelector('.mtn-back')) {
              const back = document.createElement('button');
              back.type = 'button';
              back.className = 'btn btn-sm mtn-back';
              back.innerHTML = '<i class="ti ti-arrow-back-up"></i> Back to the trail';
              back.addEventListener('click', () => {
                window._fromMountain = false;
                console.log(LOG, 'back to trail');
                window.renderMountain();
              });
              pane.insertBefore(back, pane.firstChild);
            }
          }
        } catch (e) { console.warn(LOG, 'folder-problem wrap error', e); }
        return r;
      };
      window.renderFolderProblem._mtnWrapped = true;
      console.log(LOG, 'wrapped renderFolderProblem');
    }

    // showDifficultyRating fires exactly when a practice problem is solved.
    // Use it to record a session solve so the trail updates without a refresh.
    if (typeof window.showDifficultyRating === 'function' && !window.showDifficultyRating._mtnWrapped) {
      const orig = window.showDifficultyRating;
      window.showDifficultyRating = function (probId) {
        try {
          if (probId) {
            window._mtnSolved.add(probId);
            console.log(LOG, 'session solve recorded:', probId,
              '(total session solves:', window._mtnSolved.size + ')');
          }
        } catch (e) { console.warn(LOG, 'solve-capture error', e); }
        return orig.apply(this, arguments);
      };
      window.showDifficultyRating._mtnWrapped = true;
      console.log(LOG, 'wrapped showDifficultyRating');
    }

    return window.buildPracticeSidebar._mtnWrapped &&
           window.renderFolderProblem._mtnWrapped &&
           window.showDifficultyRating._mtnWrapped;
  }

  // Poll until practice.js has defined its globals (parallel load = no order
  // guarantee), then install wrappers. Give up quietly after ~5s.
  let tries = 0;
  (function waitForPractice() {
    if (installWrappers()) {
      console.log(LOG, 'all wrappers installed');
      return;
    }
    if (++tries > 100) {
      console.warn(LOG, 'gave up waiting for practice.js globals after', tries, 'tries');
      return;
    }
    setTimeout(waitForPractice, 50);
  })();

  console.log(LOG, 'module loaded');
})();
