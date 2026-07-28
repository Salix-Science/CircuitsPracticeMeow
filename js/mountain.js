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

  // ── Self-injected styles ────────────────────────────────────────────
  // Injected once so there's no separate stylesheet to wire up. Colours/fonts
  // come only from theme variables, so this tracks the live copper/graphite
  // theme automatically.
  const STYLE_ID = 'mtn-styles';
  const CSS = `
.mtn-wrap{padding:1.25rem 1rem 3rem;max-width:760px;margin:0 auto;}
.mtn-header{position:sticky;top:0;z-index:4;background:linear-gradient(var(--bg) 70%,transparent);padding:0 0 12px;margin-bottom:6px;}
.mtn-header-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;}
.mtn-h-title{font-family:var(--font-display);font-size:20px;font-weight:600;letter-spacing:.04em;color:var(--accent2);}
.mtn-h-sub{font-size:12px;color:var(--text3);margin-top:2px;font-family:var(--mono);}
.mtn-h-pct{font-family:var(--mono);font-size:26px;font-weight:700;color:var(--green);line-height:1;}
.mtn-h-pct span{font-size:13px;color:var(--text4);margin-left:1px;}
.mtn-bar{height:5px;border-radius:999px;background:var(--bg3);overflow:hidden;margin-top:10px;border:.5px solid var(--border);}
.mtn-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent3),var(--accent),var(--green));transition:width .5s cubic-bezier(.4,0,.2,1);}
.mtn-trail{position:relative;padding:8px 0 0;}
.mtn-spine{position:absolute;top:0;bottom:0;left:50%;width:3px;transform:translateX(-50%);background:repeating-linear-gradient(var(--border2) 0 8px,transparent 8px 15px);border-radius:3px;}
.mtn-summit{position:relative;text-align:center;padding-top:8px;margin-bottom:10px;color:var(--text4);}
.mtn-summit.is-solved{color:var(--green);}
.mtn-summit-svg{width:118px;height:auto;display:inline-block;}
.mtn-summit-label{font-family:var(--mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:currentColor;margin-top:4px;}
.mtn-base{position:relative;text-align:center;padding-top:12px;margin-top:6px;}
.mtn-base-dot{display:inline-block;width:14px;height:14px;border-radius:50%;background:var(--bg3);border:2px solid var(--border2);vertical-align:middle;}
.mtn-base-label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--text4);margin-top:6px;}
.mtn-camp{position:relative;display:flex;align-items:center;gap:10px;margin:6px 0;z-index:2;}
.mtn-camp-line{flex:1;height:.5px;background:var(--border);}
.mtn-camp-label{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-display);font-size:12px;font-weight:600;letter-spacing:.05em;color:var(--text2);background:var(--bg2);border:.5px solid var(--border);padding:5px 12px;border-radius:999px;white-space:nowrap;}
.mtn-camp-label i{color:var(--accent);font-size:12px;}
.mtn-camp-count{font-family:var(--mono);font-size:10px;color:var(--text4);font-weight:400;}
.mtn-node{position:relative;z-index:3;display:flex;align-items:center;gap:12px;width:calc(50% - 4px);box-sizing:border-box;padding:11px 14px;margin:10px 0;background:var(--bg2);border:.5px solid var(--border);border-radius:var(--r2);cursor:pointer;text-align:left;font-family:var(--font);color:var(--text2);transition:transform .15s,border-color .2s,background .2s,box-shadow .2s;}
.mtn-left{margin-right:auto;flex-direction:row;}
.mtn-right{margin-left:auto;flex-direction:row-reverse;text-align:right;}
.mtn-node:hover{transform:translateY(-1px);border-color:var(--border2);background:var(--bg3);}
.mtn-node:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
.mtn-branch{position:absolute;top:50%;height:2px;width:24px;background:var(--border2);transform:translateY(-50%);}
.mtn-left .mtn-branch{right:-24px;}
.mtn-right .mtn-branch{left:-24px;}
.mtn-dot{position:absolute;top:50%;width:9px;height:9px;border-radius:50%;background:var(--bg);border:2px solid var(--border2);transform:translateY(-50%);}
.mtn-left .mtn-dot{right:-28px;}
.mtn-right .mtn-dot{left:-28px;}
.mtn-marker{flex-shrink:0;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-family:var(--mono);font-size:13px;font-weight:700;background:var(--bg3);border:1.5px solid var(--border2);color:var(--text3);}
.mtn-body{display:flex;flex-direction:column;gap:2px;min-width:0;}
.mtn-title{font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mtn-meta{font-family:var(--mono);font-size:10px;color:var(--text4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mtn-node.is-solved{border-color:var(--green-border);background:var(--green-bg);}
.mtn-node.is-solved .mtn-marker{background:var(--green-bg);border-color:var(--green);color:var(--green);}
.mtn-node.is-solved .mtn-dot,.mtn-node.is-solved .mtn-branch{background:var(--green);border-color:var(--green);}
.mtn-node.is-solved .mtn-meta{color:var(--green);}
.mtn-node.is-next{border-color:var(--gold,var(--warn));box-shadow:0 0 0 3px rgba(232,201,107,.12);}
.mtn-node.is-next .mtn-marker{background:var(--bg3);border-color:var(--gold,var(--warn));color:var(--gold,var(--warn));animation:mtn-pulse 2s ease-in-out infinite;}
.mtn-node.is-next .mtn-meta{color:var(--gold,var(--warn));}
@keyframes mtn-pulse{0%,100%{box-shadow:0 0 0 0 rgba(232,201,107,.5);}50%{box-shadow:0 0 0 6px rgba(232,201,107,0);}}
.mtn-toggle{display:flex;gap:4px;padding:4px;margin-bottom:10px;background:var(--bg3);border:.5px solid var(--border);border-radius:var(--r2);}
.mtn-tg-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:6px 8px;border:none;border-radius:var(--r);background:transparent;color:var(--text3);cursor:pointer;font-family:var(--font);font-size:11px;font-weight:600;transition:all .2s;}
.mtn-tg-btn i{font-size:13px;}
.mtn-tg-btn:hover{color:var(--text2);}
.mtn-tg-btn.active{background:var(--bg);color:var(--accent2);box-shadow:var(--glow);}
.mtn-back{align-self:flex-start;margin-bottom:4px;}
.mtn-empty{text-align:center;padding:4rem 1.5rem;color:var(--text3);}
.mtn-empty-icon{font-size:40px;opacity:.6;}
.mtn-empty-title{font-family:var(--font-display);font-size:18px;color:var(--text2);margin-top:10px;}
.mtn-empty-sub{font-size:12px;color:var(--text4);margin-top:6px;max-width:340px;margin-inline:auto;}
.mtn-list-hint{display:flex;align-items:center;gap:8px;justify-content:center;padding:3rem 1rem;color:var(--text4);font-size:12px;font-family:var(--mono);}
@media(max-width:620px){
  .mtn-spine{left:19px;}
  .mtn-node{width:100%;margin-left:38px;flex-direction:row;text-align:left;}
  .mtn-right{flex-direction:row;text-align:left;}
  .mtn-left .mtn-branch,.mtn-right .mtn-branch{left:-19px;right:auto;width:19px;}
  .mtn-left .mtn-dot,.mtn-right .mtn-dot{left:-23px;right:auto;}
  .mtn-camp{margin-left:0;}
}
@media(prefers-reduced-motion:reduce){
  .mtn-node,.mtn-bar-fill{transition:none;}
  .mtn-node.is-next .mtn-marker{animation:none;}
}`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
    console.log(LOG, 'styles injected');
  }

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

  // ── Solve hook ──────────────────────────────────────────────────────
  // Called by practice.js the moment a problem is answered correctly, for
  // EVERY user. Previously the trail's only live signal was the
  // showDifficultyRating wrapper below, which practice.js gates behind
  // `!isAdmin` — so admins never advanced at all — and which is a UI side
  // effect rather than a solve event. This is the primary hook now; the
  // wrapper is kept as a harmless backstop.
  window.onProblemSolved = function onProblemSolved(probId, prob) {
    if (!probId) { console.warn(LOG, 'onProblemSolved called with no probId'); return; }
    window._mtnSolved.add(probId);
    console.log(LOG, 'solve recorded:', probId, (prob && prob.title) || '',
      '· session solves:', window._mtnSolved.size);

    // Warn if this problem isn't on the trail at all — a solve that can never
    // light a peak (problem disabled, or in no folder).
    const onTrail = (window.DB?.folders || []).some(f =>
      (f.problemIds || []).includes(probId));
    if (!onTrail) {
      console.warn(LOG, 'solved problem', probId, 'is not in any folder — ' +
        'it has no peak on the trail and progress will not change.');
    }

    // Repaint only if the trail itself is what's on screen — never yank a
    // student out of the problem card they just solved.
    if (document.getElementById('mtn-trail')) {
      window.renderMountain();
    }
  };

  // ── Diagnostics ─────────────────────────────────────────────────────
  // MTN.diag() in the console: shows exactly which signals mark each peak
  // solved, so a "why isn't this lit?" question is answerable in one call.
  window.MTN = {
    tag: 'mtn-2026-07-28-solvefix',
    diag() {
      const u = window.DB?.users?.[window.S?.user];
      const alog = Array.isArray(u?.attemptLog) ? u.attemptLog : [];
      const src = {
        session: [...window._mtnSolved],
        diffRatings: Object.keys(u?.diffRatings || {}),
        probRatings: Object.keys(u?.probRatings || {}),
        attemptLogCorrect: [...new Set(alog.filter(e => e && e.correct && e.probId).map(e => e.probId))],
        attemptLogPracticeCorrect: [...new Set(alog.filter(e => e && e.correct && e.probId && !e.assignId).map(e => e.probId))],
      };
      const solved = solvedSet();
      const nodes = orderedNodes().filter(n => n.kind === 'prob');
      console.group(LOG + ' diag');
      console.log('user:', window.S?.user, '· admin:', !!window.S?.isAdmin);
      console.log('solved signal sources:', src);
      console.log('peaks:', nodes.length, '· lit:', nodes.filter(n => solved.has(n.prob.id)).length);
      const ghosts = [...solved].filter(id => !nodes.some(n => n.prob.id === id));
      if (ghosts.length) console.warn('solved ids with no peak on the trail:', ghosts);
      if (!src.attemptLogPracticeCorrect.length && src.session.length) {
        console.warn('session solves exist but NOTHING is persisted for practice ' +
          'problems — the trail will reset on reload. (Practice solves must reach ' +
          'attemptLog via logAttempt.)');
      }
      console.table(nodes.map(n => ({
        title: n.prob.title, id: n.prob.id, folder: n.folder.name,
        lit: solved.has(n.prob.id),
      })));
      console.groupEnd();
      return { solved: [...solved], sources: src };
    },
  };

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
    const probNodes = nodes.filter(n => n.kind === 'prob');
    const counts = {};
    probNodes.forEach(n => { counts[n.prob.id] = (counts[n.prob.id] || 0) + 1; });
    const dups = Object.entries(counts).filter(([, c]) => c > 1);
    console.log(LOG, 'orderedNodes:', probNodes.length, 'peaks across', folders.length, 'folders');
    if (dups.length) {
      console.log(LOG, dups.length + ' problem(s) appear in multiple folders — each shows once per folder:',
        dups.map(([id, c]) => {
          const t = window.DB.problems.find(p => p.id === id);
          return `${t ? t.title : id} ×${c}`;
        }));
    }
    return nodes;
  }

  // ── Summit SVG — everything inside a positive viewBox, explicit size so it
  //    can never balloon even before styles apply. ─────────────────────────
  function summitSVG() {
    return `<svg class="mtn-summit-svg" width="120" height="80" viewBox="0 0 120 80" aria-hidden="true">
      <polygon points="60,22 100,76 20,76" fill="var(--bg3)" stroke="var(--border2)" stroke-width="1.5"/>
      <polygon points="60,22 74,44 60,38 46,44" fill="var(--bg5)"/>
      <line x1="60" y1="22" x2="60" y2="6" stroke="var(--gold, var(--warn))" stroke-width="2"/>
      <polygon points="60,6 60,17 79,11.5" fill="var(--gold, var(--warn))"/>
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

    // Number problems 1..total by TRAIL POSITION (ascending). A problem can
    // appear in several folders, so we number each occurrence by where it sits
    // on the climb — NOT by problem id (that made later copies steal numbers).
    let k = 0;
    nodes.forEach(n => { if (n.kind === 'prob') { k += 1; n._num = k; } });

    // "next" = the lowest-position unsolved occurrence = where the student is.
    const nextNode = probNodes.find(n => !solved.has(n.prob.id)) || null;
    const nextNum = nextNode ? nextNode._num : -1;
    console.log(LOG, `render: ${done}/${total} solved · next = ` +
      (nextNode ? `#${nextNum} ${nextNode.prob.title}` : '— (summit reached)'));

    // Build rows top→bottom visually, so reverse the ascending order.
    const visual = nodes.slice().reverse();

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
      const num = n._num;
      const isSolved = solved.has(p.id);
      const isNext = num === nextNum;
      const side = num % 2 === 0 ? 'right' : 'left';
      const stateCls = isSolved ? 'is-solved' : (isNext ? 'is-next' : 'is-todo');
      const marker = isSolved
        ? '<i class="ti ti-check"></i>'
        : (isNext ? '<i class="ti ti-hiking"></i>' : String(num));
      const meta = isSolved ? 'Cleared'
        : (isNext ? 'You are here' : escHtml(n.folder.name));
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
    injectStyles();
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

    return !!(window.buildPracticeSidebar?._mtnWrapped &&
              window.renderFolderProblem?._mtnWrapped &&
              window.showDifficultyRating?._mtnWrapped);
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
      const missing = ['buildPracticeSidebar', 'renderFolderProblem', 'showDifficultyRating']
        .filter(n => typeof window[n] !== 'function');
      console.warn(LOG, 'gave up waiting for practice.js globals after', tries,
        'tries · still missing:', missing.length ? missing : '(none — already wrapped?)');
      return;
    }
    setTimeout(waitForPractice, 50);
  })();

  injectStyles();
  console.log(LOG, 'module loaded');
})();
