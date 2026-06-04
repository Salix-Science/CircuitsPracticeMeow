/* practice.js — Practice view, problem cards, folder navigation
   - No built-in topics; only authored folder problems
   - Folders draggable in sidebar
*/

// ── Helpers ───────────────────────────────────
window.rnd = function rnd(v, dp = 3) { return parseFloat(v.toFixed(dp)); }
window.unitForType = function unitForType(t)  { return { R:'kΩ', V:'V', I:'mA', C:'μF' }[t] || ''; }

window.substituteText = function substituteText(tpl, vals, unitMap) {
  return tpl.replace(/\{(\w+)\}/g, (m, n) =>
    vals[n] !== undefined ? `${vals[n]}${unitMap[n] ? ' ' + unitMap[n] : ''}` : m
  );
}
window.toggleEl = function toggleEl(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

// ── Answer expansion ──────────────────────────
// Turns a problem into a flat list of gradable answer definitions
// (row-major for tables) plus an optional table layout used only for
// rendering. Grading code stays identical for boxes and tables because
// it just iterates the flat list by index.
window.expandProblemAnswers = function expandProblemAnswers(prob) {
  if (prob.answerMode === 'table' && prob.table &&
      (prob.table.rows||[]).length && (prob.table.cols||[]).length) {
    const t = prob.table;
    const answerDefs = [];
    const cellIndex  = [];                 // cellIndex[r][c] = flat answer index
    t.rows.forEach((row, r) => {
      cellIndex[r] = [];
      t.cols.forEach((col, c) => {
        cellIndex[r][c] = answerDefs.length;
        answerDefs.push({
          id:      `tbl-${r}-${c}`,
          label:   `${row.label || 'Row '+(r+1)} · ${col.label || 'Col '+(c+1)}`,
          formula: (row.cells && row.cells[c]) || '',
          unit:    row.unit || '',
          tol:     t.tol || '2',
        });
      });
    });
    const table = {
      corner: t.corner || '',
      cols:   t.cols.map(c => ({ label: c.label || '' })),
      rows:   t.rows.map(r => ({ label: r.label || '', unit: r.unit || '' })),
      cellIndex,
    };
    return { answerDefs, table };
  }
  // boxes / legacy single-answer
  const answerDefs = (prob.answers && prob.answers.length)
    ? prob.answers
    : [{ id:'ans0', label:'Answer', formula: prob.formula, unit: prob.unit, tol: prob.tol }];
  return { answerDefs, table: null };
}

// ── Sidebar ───────────────────────────────────
// Folders are shown in DB order and are draggable to reorder.
let _sbDragSrc = null; // index of folder being dragged

window.buildPracticeSidebar = function buildPracticeSidebar() {
  window.track?.("page_view", { page: "practice" });
  const sb = document.getElementById('practice-sidebar');
  sb.innerHTML = '';

  const folders = window.DB.folders.filter(f =>
    f.problemIds.some(pid => {
      const p = window.DB.problems.find(pr => pr.id === pid);
      return p && p.enabled !== false;
    })
  );

  if (!folders.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:2rem 1rem;text-align:center;font-size:12px;color:var(--text4)';
    empty.textContent = 'No topic folders yet. Create one in the Editor.';
    sb.appendChild(empty);
    return;
  }

  const lbl = document.createElement('div');
  lbl.className = 'sidebar-label';
  lbl.textContent = 'Topic folders';
  sb.appendChild(lbl);

  folders.forEach((f, fi) => {
    const wrap = document.createElement('div');
    wrap.className = 'sb-folder';
    wrap.draggable = true;
    wrap.dataset.fid = f.id;

    // Drag events for reordering folders in sidebar
    wrap.addEventListener('dragstart', e => {
      _sbDragSrc = fi;
      wrap.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    wrap.addEventListener('dragend', () => {
      wrap.style.opacity = '';
      sb.querySelectorAll('.sb-folder').forEach(el => el.classList.remove('sb-drag-over'));
    });
    wrap.addEventListener('dragover', e => {
      e.preventDefault();
      wrap.classList.add('sb-drag-over');
    });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('sb-drag-over'));
    wrap.addEventListener('drop', async e => {
      e.preventDefault();
      wrap.classList.remove('sb-drag-over');
      if (_sbDragSrc === null || _sbDragSrc === fi) return;
      // Reorder in DB (using the visible-only folders index → real DB index)
      const srcId  = folders[_sbDragSrc].id;
      const dstId  = folders[fi].id;
      const srcIdx = window.DB.folders.findIndex(x => x.id === srcId);
      const dstIdx = window.DB.folders.findIndex(x => x.id === dstId);
      const [moved] = window.DB.folders.splice(srcIdx, 1);
      window.DB.folders.splice(dstIdx, 0, moved);
      _sbDragSrc = null;
      await saveDB();
      buildPracticeSidebar();
    });

    const head = document.createElement('button');
    head.className = 'sb-folder-head';
    head.innerHTML = `<i class="ti ti-grip-vertical" style="font-size:12px;color:var(--text4);cursor:grab"></i>
      <i class="ti ti-folder" style="font-size:13px;color:var(--text4)"></i>${f.name}
      <i class="ti ti-chevron-right" style="font-size:11px;margin-left:auto;color:var(--text4)" id="fchev-${f.id}"></i>`;

    const children = document.createElement('div');
    children.className = 'sb-folder-children';
    children.style.display = 'none';

    head.onclick = () => {
      const open = children.style.display === 'none';
      children.style.display = open ? 'flex' : 'none';
      const chev = document.getElementById(`fchev-${f.id}`);
      if (chev) chev.style.transform = open ? 'rotate(90deg)' : '';
    };

    f.problemIds.forEach(pid => {
      const p = window.DB.problems.find(pr => pr.id === pid);
      if (!p || p.enabled === false) return;
      const btn = document.createElement('button');
      btn.className = 'sb-child-btn';
      btn.dataset.pid = pid;
      btn.innerHTML = `<i class="ti ti-circle" style="font-size:8px"></i>${p.title}`;
      btn.onclick = () => loadFolderPractice(f.id, pid, btn);
      children.appendChild(btn);
    });

    wrap.appendChild(head);
    wrap.appendChild(children);
    sb.appendChild(wrap);
  });

  // Auto-open the first folder
  const firstHead = sb.querySelector('.sb-folder-head');
  if (firstHead) firstHead.click();
}

// ── Folder practice ───────────────────────────
window.loadFolderPractice = function loadFolderPractice(folderId, startPid, btn) {
  const folder = window.DB.folders.find(f => f.id === folderId);
  if (folder) window.track?.("open_folder", { folder_name: folder.name });
  if (!folder) return;

  const enabledIds = folder.problemIds.filter(pid => {
    const p = window.DB.problems.find(pr => pr.id === pid);
    return p && p.enabled !== false;
  });
  if (!enabledIds.length) return;

  window.S.activeFolderId = folderId;
  window.S.folderProblems = enabledIds
    .map(pid => { const p = window.DB.problems.find(pr => pr.id === pid); return p ? genAuthoredVariant(p) : null; })
    .filter(Boolean);
  window.S.folderIdx = Math.max(0, enabledIds.indexOf(startPid));

  document.querySelectorAll('.sb-child-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  renderFolderProblem();
}

window.renderFolderProblem = function renderFolderProblem() {
  const p = window.S.folderProblems[window.S.folderIdx];
  if (!p) return;
  const folder = window.DB.folders.find(f => f.id === window.S.activeFolderId);
  const n = window.S.folderProblems.length;
  const i = window.S.folderIdx;
  const main = document.getElementById('practice-main');
  main.innerHTML = '';

  const pane = document.createElement('div');
  pane.className = 'practice-pane';
  pane.innerHTML = `
    <div>
      <div class="topic-title">${escHtml(folder?.name || 'Problems')}</div>
      <div class="topic-sub">${n} problem${n !== 1 ? 's' : ''} in this folder</div>
    </div>
    <div class="prob-progress">
      <div class="prog-track"><div class="prog-fill" style="width:${n > 1 ? (i/(n-1))*100 : 100}%"></div></div>
      <span class="prog-label">${i+1} / ${n}</span>
      <div class="nav-arrows">
        <button class="btn btn-sm" onclick="folderNav(-1)" ${i===0 ? 'disabled style="opacity:.3"' : ''}><i class="ti ti-chevron-left"></i></button>
        <button class="btn btn-sm" onclick="folderNav(1)"  ${i===n-1 ? 'disabled style="opacity:.3"' : ''}><i class="ti ti-chevron-right"></i></button>
      </div>
    </div>`;
  pane.appendChild(buildProbCardEl(p, true));
  main.appendChild(pane);
  window.typeset?.(main);
}

window.folderNav = function folderNav(dir) {
  window.S.folderIdx = Math.max(0, Math.min(window.S.folderProblems.length - 1, window.S.folderIdx + dir));
  renderFolderProblem();
}

window.shuffleFolderProb = function shuffleFolderProb() {
  const folder = window.DB.folders.find(f => f.id === window.S.activeFolderId);
  if (!folder) return;
  const enabledIds = folder.problemIds.filter(pid => {
    const p = window.DB.problems.find(pr => pr.id === pid);
    return p && p.enabled !== false;
  });
  const pid = enabledIds[window.S.folderIdx];
  const authored = window.DB.problems.find(pr => pr.id === pid);
  if (authored) {
    window.track?.("shuffle_problem", { prob_id: authored.id, title: authored.title });
    delete window._attemptCounts[authored.id];
    window.S.folderProblems[window.S.folderIdx] = genAuthoredVariant(authored, true);
  }
  renderFolderProblem();
}

// ── Problem card ──────────────────────────────
window._attemptCounts = window._attemptCounts || {};

// Renders an answer table (grid of inputs) shared by practice + assignments.
// idFor(ai) -> input element id; iconFor(ai) -> icon span id.
window.buildAnswerTableHTML = function buildAnswerTableHTML(table, idFor, iconFor) {
  iconFor = iconFor || (ai => `${idFor(ai)}-icon`);
  const head = `<tr>
      <th class="at-corner">${escHtml(table.corner || '')}</th>
      ${table.cols.map(c => `<th>${escHtml(c.label || '')}</th>`).join('')}
      <th class="at-unit-h">Unit</th>
    </tr>`;
  const body = table.rows.map((row, r) => {
    const cells = table.cols.map((col, c) => {
      const ai = table.cellIndex[r][c];
      const id = idFor(ai);
      return `<td>
        <div class="at-cell">
          <input class="mono" type="number" step="any" placeholder="0.000" id="${id}"/>
          <span class="at-icon" id="${iconFor(ai)}"></span>
        </div></td>`;
    }).join('');
    return `<tr>
      <th class="at-rowlabel">${escHtml(row.label || '')}</th>
      ${cells}
      <td class="at-unit">${escHtml(row.unit || '')}</td>
    </tr>`;
  }).join('');
  return `<div class="answer-table-wrap"><table class="answer-table">
    <thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

window.buildProbCardEl = function buildProbCardEl(p, isFolder) {
  const card = document.createElement('div');
  card.className = 'prob-card';
  const tags = (p.tags || []).map(t => `<span class="pill pill-purple">${escHtml(t)}</span>`).join('');

  const maxAtt = p.maxAttempts || 0;
  const used   = window._attemptCounts[p.id] || 0;
  const locked = maxAtt > 0 && used >= maxAtt;

  const attBadge = maxAtt > 0
    ? `<span class="pill ${locked ? 'pill-red' : used > 0 ? 'pill-warn' : 'pill-purple'}" style="font-size:10px">
        ${locked ? 'No attempts left' : `${used} / ${maxAtt} attempts`}
       </span>`
    : '';

  // Build answer inputs — table grid OR stacked boxes
  const answerInputsHTML = p.table
    ? window.buildAnswerTableHTML(p.table, ai => `main-ans-${ai}`, ai => `main-ans-icon-${ai}`)
    : (p.answers || [{id:'ans0',label:'Answer',answer:p.answer,unit:p.unit,tol:p.tol}]).map((a,ai) =>
    `<div class="multi-ans-row">
      ${p.answers && p.answers.length > 1 ? `<div class="multi-ans-label">${a.label}</div>` : ''}
      <div class="answer-row" style="margin-bottom:6px;align-items:center">
        <div style="position:relative;display:inline-flex;align-items:center">
          <input class="mono" type="number" step="any" placeholder="0.000"
            id="main-ans-${ai}" style="width:140px"/>
          <span id="main-ans-icon-${ai}" style="position:absolute;right:-22px;font-size:14px;display:none"></span>
        </div>
        <span style="font-size:13px;color:var(--text2);font-weight:500;margin-left:28px">${a.unit}</span>
      </div>
    </div>`
  ).join('');

  const revealedHTML = (p.answers || [{answer:p.answer,unit:p.unit,label:'Answer'}]).map(a =>
    `<div>${(p.answers && p.answers.length > 1) || p.table ? `<strong>${a.label}:</strong> ` : ''}${a.answer} ${a.unit}</div>`
  ).join('');

  card.innerHTML = `
    <div class="prob-head">
      <span class="prob-title-el">${escHtml(p.title)}</span>
      <div style="display:flex;gap:6px;align-items:center">${tags}${attBadge}</div>
    </div>
    <div class="prob-body">
      <div class="circuit-wrap">${p.circuit || '<span style="font-size:12px;color:var(--text4)">No diagram</span>'}</div>
      <p class="question-text">${p.question}</p>
      ${locked ? `
        <div class="feedback wrong" style="display:block">
          No attempts remaining. The answer was: ${revealedHTML}
        </div>
        ${isFolder ? `
        <div class="action-row" style="margin-top:10px">
          <button class="btn btn-sm shuffle-btn" onclick="shuffleFolderProb()">
            <i class="ti ti-refresh"></i> Shuffle for new numbers &amp; reset attempts
          </button>
        </div>` : ''}` : `
        ${answerInputsHTML}
        <div class="action-row">
          <button class="btn btn-accent btn-sm" id="main-check" onclick="checkMainAnswer()">
            <i class="ti ti-send"></i> Check
          </button>
          ${p.hint ? `<button class="btn btn-sm" onclick="toggleEl('main-hint')"><i class="ti ti-bulb"></i> Hint</button>` : ''}
          ${isFolder ? `<button class="btn btn-sm shuffle-btn" onclick="shuffleFolderProb()"><i class="ti ti-refresh"></i> Shuffle</button>` : ''}
        </div>
        <div class="feedback" id="main-fb"></div>
        ${p.hint ? `<div class="hint-box" id="main-hint">${p.hint}</div>` : ''}`}
    </div>`;

  window._currentMainProb = p;
  // Inject difficulty rating widget after card is built
  if (typeof injectRatingWidget === 'function') injectRatingWidget(card, p);
  return card;
}

// ── Answer checking ───────────────────────────
window.checkMainAnswer = function checkMainAnswer() {
  const p = window._currentMainProb; if (!p) return;
  const fb = document.getElementById('main-fb');
  const answers = p.answers || [{ id:'ans0', label:'Answer', answer:p.answer, unit:p.unit, tol:p.tol||0.02 }];
  const isAdmin = window.S.isAdmin;

  // Collect all inputs
  const results = answers.map((a, ai) => {
    const raw = parseFloat(document.getElementById(`main-ans-${ai}`)?.value);
    if (isNaN(raw)) return { missing: true, label: a.label, ai };
    const tol = Math.abs(a.answer) * (a.tol || 0.02) + 0.001;
    const ok  = Math.abs(raw - a.answer) <= tol;
    return { ok, raw, label: a.label, answer: a.answer, unit: a.unit, tol: a.tol || 0.02, missing: false, ai };
  });

  // Helper: style an individual input box
  function markInput(ai, state) {
    const input = document.getElementById(`main-ans-${ai}`);
    const icon  = document.getElementById(`main-ans-icon-${ai}`);
    if (!input) return;
    if (state === 'correct') {
      input.style.borderColor = 'var(--green)';
      input.style.boxShadow   = '0 0 0 3px rgba(74,222,128,0.15)';
      if (icon) { icon.textContent = '✓'; icon.style.color = 'var(--green)'; icon.style.display = 'inline'; }
    } else if (state === 'wrong') {
      input.style.borderColor = 'var(--red)';
      input.style.boxShadow   = '0 0 0 3px rgba(248,113,113,0.15)';
      if (icon) { icon.textContent = '✗'; icon.style.color = 'var(--red)'; icon.style.display = 'inline'; }
    } else {
      input.style.borderColor = '';
      input.style.boxShadow   = '';
      if (icon) { icon.style.display = 'none'; }
    }
  }

  if (results.some(r => r.missing)) {
    results.forEach(r => { if (r.missing) markInput(r.ai, 'wrong'); });
    fb.textContent = 'Fill in all answer boxes first.';
    fb.className   = 'feedback wrong';
    fb.style.display = 'block';
    return;
  }

  const allOk  = results.every(r => r.ok);
  const maxAtt = p.maxAttempts || 0;
  window._attemptCounts[p.id] = (window._attemptCounts[p.id] || 0) + 1;
  const used   = window._attemptCounts[p.id];
  window.track?.("practice_attempt", { topic: p.topicKey || "custom", correct: allOk, attempt_num: used });
  const noMore = maxAtt > 0 && used >= maxAtt;

  // Always mark each box immediately
  results.forEach(r => markInput(r.ai, r.ok ? 'correct' : 'wrong'));

  // Save score
  const u = window.DB.users[window.S.user];
  if (u && (allOk || noMore) && !p._scored) {
    p._scored = true;
    const key = p.topicKey || 'custom';
    // Update local cache for immediate UI feedback
    if (!u.scores[key]) u.scores[key] = { correct:0, attempted:0 };
    u.scores[key].attempted++;
    if (allOk) u.scores[key].correct++;
    if (allOk) u.streak = (parseInt(u.streak) || 0) + 1; else u.streak = 0;
    document.getElementById('streak-val').textContent = u.streak;
    // Write to Firestore using atomic increment — client can't fake the value
    window.recordScore(key, allOk);
    window.recordStreak(allOk);
  }

  if (allOk) {
    fb.className = 'feedback correct';
    // Admins see the actual answer value; students just get a ✓
    if (isAdmin && answers.length > 1) {
      fb.innerHTML = '✓ All correct! ' + results.map(r=>`${r.label}: ${r.answer} ${r.unit}`).join(' · ');
    } else if (isAdmin) {
      fb.innerHTML = `✓ Correct! Answer: ${results[0].answer} ${results[0].unit}`;
    } else {
      fb.innerHTML = answers.length > 1 ? '✓ All correct!' : '✓ Correct!';
    }
    fb.style.display = 'block';
    document.getElementById('main-check')?.setAttribute('disabled', '');
    // Show difficulty rating for non-admins after solving
    if (!isAdmin && p.probId) showDifficultyRating(p.probId);

  } else if (noMore) {
    fb.className = 'feedback wrong';
    // Students don't see the expected answer — only admins do
    if (isAdmin) {
      fb.innerHTML = '✗ No attempts remaining. Answers: ' +
        results.map(r => `${answers.length>1?r.label+': ':''}${r.answer} ${r.unit}`).join(' · ');
    } else {
      fb.innerHTML = '✗ No attempts remaining.';
    }
    fb.style.display = 'block';
    document.getElementById('main-check')?.setAttribute('disabled', '');

  } else {
    const rem = maxAtt > 0 ? ` · ${maxAtt-used} attempt${maxAtt-used!==1?'s':''} left` : '';
    // Per-box feedback: admins see expected value, students just see ✓/✗
    const detail = results.map(r => {
      if (r.ok) return answers.length > 1 ? `${r.label}: ✓` : null;
      if (isAdmin) return `${answers.length>1?r.label+': ':''}✗ expected ≈${r.answer} ${r.unit}`;
      return answers.length > 1 ? `${r.label}: ✗` : null;
    }).filter(Boolean).join(' · ');
    fb.className = 'feedback wrong';
    fb.innerHTML = (detail ? detail + rem : `✗ Not quite.${rem}`);
    fb.style.display = 'block';
  }
}

// ── Authored variant generator ────────────────
window.genAuthoredVariant = function genAuthoredVariant(prob, bustCache = false) {
  if (!prob) return null;

  // Use sessionStorage to keep the same numbers for this problem
  // until the student explicitly shuffles (bustCache = true).
  // Key includes username so different accounts on the same browser get different numbers.
  const cacheKey = `prob_vals_${window.S.user || 'anon'}_${prob.id}`;
  let vals = {};
  if (!bustCache) {
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) vals = JSON.parse(cached);
    } catch(e) {}
  }

  // Generate fresh values for any variable not already cached
  prob.vars.forEach(v => {
    if (vals[v.name] === undefined) {
      vals[v.name] = Math.round(
        (parseFloat(v.min) + Math.random() * (parseFloat(v.max) - parseFloat(v.min))) * 10
      ) / 10;
    }
  });
  // Remove stale keys (variable was renamed or deleted)
  const validNames = new Set(prob.vars.map(v => v.name));
  Object.keys(vals).forEach(k => { if (!validNames.has(k)) delete vals[k]; });

  // Persist to sessionStorage
  try { sessionStorage.setItem(cacheKey, JSON.stringify(vals)); } catch(e) {}
  const unitMap = {};
  prob.vars.forEach(v => { unitMap[v.name] = v.unit || unitForType(v.type); });

  let answer = null;
  try {
    const fn = new Function(...Object.keys(vals), `return (${prob.formula})`);
    answer = rnd(fn(...Object.values(vals)), 4);
  } catch(e) {}

  // Compute all answer boxes (supports multi-answer + table problems)
  const { answerDefs, table: tableLayout } = window.expandProblemAnswers(prob);

  const answers = answerDefs.map(a => {
    let ans = null;
    try {
      const fn = new Function(...Object.keys(vals), `return (${a.formula})`);
      ans = rnd(fn(...Object.values(vals)), 4);
    } catch(e) {}
    return { id: a.id, label: a.label, answer: ans, unit: a.unit, tol: (parseFloat(a.tol)||2)/100 };
  });

  return {
    id: prob.id, probId: prob.id,
    title: prob.title,
    topicKey: prob.topic || 'custom',
    tags: prob.topic ? [prob.topic] : [],
    question: substituteText(prob.question, vals, unitMap),
    hint:     substituteText(prob.hint || '', vals, unitMap),
    // Legacy single-answer (first box) for compatibility
    answer: answers[0]?.answer ?? null,
    unit:   answers[0]?.unit   ?? prob.unit,
    tol:    answers[0]?.tol    ?? 0.02,
    answers,
    table:   tableLayout,
    maxAttempts: parseInt(prob.maxAttempts) || 0,
    circuit: prob.imgDataUrl ? `<img src="${prob.imgDataUrl}" alt="Circuit"/>` : null,
    vals,
  };
}

// ── Difficulty rating ─────────────────────────
window.showDifficultyRating = function showDifficultyRating(probId) {
  if (window._rated?.[probId]) return;
  const fb = document.getElementById('main-fb');
  if (!fb) return;

  // Build DOM directly — no onclick splicing
  const wrap = document.createElement('div');
  wrap.id = 'diff-rating-wrap';
  wrap.style.cssText = 'margin-top:10px;padding-top:10px;border-top:0.5px solid rgba(74,222,128,.2)';

  const label = document.createElement('div');
  label.style.cssText = 'font-size:11px;color:var(--text3);margin-bottom:6px';
  label.textContent = 'How difficult was this problem?';
  wrap.appendChild(label);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;align-items:center';

  [1,2,3,4,5].forEach(n => {
    const btn = document.createElement('button');
    btn.id = `star-${n}`;
    btn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:22px;padding:2px;transition:transform .1s;color:var(--text4)';
    btn.textContent = '★';
    btn.addEventListener('click', () => submitDifficultyRating(probId, n));
    btn.addEventListener('mouseover', () => highlightStars(n));
    btn.addEventListener('mouseout',  () => highlightStars(0));
    row.appendChild(btn);
  });

  const hint = document.createElement('span');
  hint.style.cssText = 'font-size:10px;color:var(--text4);margin-left:6px';
  hint.textContent = '1=easy · 5=hard';
  row.appendChild(hint);

  wrap.appendChild(row);
  fb.insertAdjacentElement('afterend', wrap);
}

window.highlightStars = function highlightStars(n) {
  for (let i = 1; i <= 5; i++) {
    const s = document.getElementById(`star-${i}`);
    if (s) s.style.color = i <= n ? 'var(--warn)' : 'var(--text4)';
  }
}

window.submitDifficultyRating = async function submitDifficultyRating(probId, rating) {
  if (!window._rated) window._rated = {};
  window._rated[probId] = rating;

  // Save to Firestore: average rating stored on the problem doc
  // We store each user's rating in their own doc to avoid write conflicts
  const u = window.DB.users[window.S.user];
  if (!u) return;
  if (!u.diffRatings) u.diffRatings = {};
  u.diffRatings[probId] = rating;
  await saveUserOnly();

  // Also update the problem's aggregate rating in Firestore
  await updateProblemRating(probId, rating);

  // Replace the stars with a thank-you
  const wrap = document.getElementById('diff-rating-wrap');
  if (wrap) wrap.innerHTML = `<div style="font-size:11px;color:var(--text3);margin-top:8px">
    Thanks! You rated this <span style="color:var(--warn)">${'★'.repeat(rating)}${'☆'.repeat(5-rating)}</span>
  </div>`;
}

window.updateProblemRating = async function updateProblemRating(probId, newRating) {
  // Fetch all users to recompute the average (admin only) — for students,
  // just append their vote and let the admin panel show the computed average.
  // We store ratings in a lightweight subcollection-free way: each user's rating
  // is in their own doc, average computed in the editor.
  // Signal the editor to refresh if open.
  if (typeof renderPmList === 'function') renderPmList();
}
