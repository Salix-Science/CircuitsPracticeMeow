/* ═══════════════════════════════════════════
   practice.js — Practice view, SVG circuits,
   problem cards, folder navigation
   ═══════════════════════════════════════════ */

// ── Helpers ──────────────────────────────────
function rnd(v, dp = 3) { return parseFloat(v.toFixed(dp)); }
function rand(lo, hi, step) {
  const s = Math.floor((hi - lo) / step);
  return lo + Math.floor(Math.random() * s) * step;
}
function unitForType(t) { return { R: 'kΩ', V: 'V', I: 'mA', C: 'μF' }[t] || ''; }

function substituteText(tpl, vals, unitMap) {
  return tpl.replace(/\{(\w+)\}/g, (m, n) =>
    vals[n] !== undefined ? `${vals[n]}${unitMap[n] ? ' ' + unitMap[n] : ''}` : m
  );
}

function toggleEl(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

// ── Built-in topic metadata ───────────────────
const BUILTIN = {
  kvl:      { label: 'KVL / KCL',         icon: 'ti-current-ac' },
  divider:  { label: 'Voltage divider',    icon: 'ti-circuit-voltmeter' },
  thevenin: { label: 'Thévenin / Norton',  icon: 'ti-circuit-resistor' },
  nodal:    { label: 'Nodal analysis',     icon: 'ti-topology-star' },
};

// ── Built-in problem generators ───────────────
function genBuiltin(key) {
  const vs = rand(6,24,3), r1 = rand(1,8,1), r2 = rand(1,8,1),
        r3 = rand(1,8,1), is = rand(2,10,2);
  if (key === 'kvl') {
    const vr2 = rnd(vs / (r1+r2+r3) * r2, 3);
    return { id:'bi-kvl', title:'Find V across R2', topicKey:'kvl', tags:['KVL','DC'],
      question:`R1 = ${r1} kΩ, R2 = ${r2} kΩ, R3 = ${r3} kΩ in series with ${vs} V. Find the voltage across R2.`,
      hint:`Current I = ${vs}/${r1+r2+r3} = ${rnd(vs/(r1+r2+r3),3)} mA. V = I × R2.`,
      answer: vr2, unit:'V', tol:0.02, circuit: svgSeries(vs,r1,r2,r3) };
  }
  if (key === 'divider') {
    const vout = rnd(vs * r2 / (r1+r2), 3);
    return { id:'bi-div', title:'Find Vout', topicKey:'divider', tags:['Voltage divider'],
      question:`Vs = ${vs} V, R1 = ${r1} kΩ (top), R2 = ${r2} kΩ (bottom). No load. Find Vout.`,
      hint:`Vout = Vs × R2/(R1+R2) = ${vs} × ${r2}/${r1+r2}`,
      answer: vout, unit:'V', tol:0.02, circuit: svgDivider(vs,r1,r2) };
  }
  if (key === 'thevenin') {
    const vth = rnd(vs * r2 / (r1+r2), 3);
    return { id:'bi-the', title:'Find Vth at A-B', topicKey:'thevenin', tags:['Thévenin'],
      question:`Vs = ${vs} V, R1 = ${r1} kΩ series, R2 = ${r2} kΩ shunt. Find Vth.`,
      hint:`Vth = Vs × R2/(R1+R2). Rth = R1∥R2 = ${rnd(r1*r2/(r1+r2),2)} kΩ.`,
      answer: vth, unit:'V', tol:0.02, circuit: svgThevenin(vs,r1,r2) };
  }
  if (key === 'nodal') {
    const v1 = rnd(is * r1 * r2 / (r1+r2), 3);
    return { id:'bi-nod', title:'Find node voltage V1', topicKey:'nodal', tags:['Nodal','KCL'],
      question:`Is = ${is} mA drives R1 = ${r1} kΩ and R2 = ${r2} kΩ in parallel to ground. Find V1.`,
      hint:`KCL: V1 = Is × R1∥R2 = ${v1} V`,
      answer: v1, unit:'V', tol:0.02, circuit: svgNodal(is,r1,r2) };
  }
}

// ── SVG circuit helpers ───────────────────────
function svgBase(body, w = 310, h = 100) {
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .w{stroke:#5a4490;stroke-width:1.5;fill:none}
    .c{stroke:#7c5fc0;stroke-width:1.2;fill:#1a1430}
    .lb{font-size:10px;fill:#b8a8e8;text-anchor:middle;font-family:'IBM Plex Mono',monospace}
    .hi{fill:#fbbf24;font-size:9px;text-anchor:middle;font-family:'IBM Plex Mono',monospace}
    .nd{fill:#9d7de8}
  </style>
  ${body}
</svg>`;
}

function svgSeries(vs, r1, r2, r3) {
  return svgBase(`
    <line x1="26" y1="20" x2="26"  y2="84" class="w"/>
    <line x1="26" y1="20" x2="288" y2="20" class="w"/>
    <line x1="288" y1="20" x2="288" y2="84" class="w"/>
    <line x1="26"  y1="84" x2="288" y2="84" class="w"/>
    <circle cx="26" cy="52" r="13" class="c"/>
    <text x="26"  y="55" class="lb" style="fill:#ede8ff">${vs}V</text>
    <rect x="46"  y="13" width="54" height="14" rx="3" class="c"/>
    <text x="73"  y="11" class="lb">${r1}kΩ</text>
    <rect x="118" y="13" width="54" height="14" rx="3" style="stroke:#c4a8ff;stroke-width:1.2;fill:#1a1430"/>
    <text x="145" y="11" class="lb" style="fill:#c4a8ff">${r2}kΩ</text>
    <rect x="190" y="13" width="54" height="14" rx="3" class="c"/>
    <text x="217" y="11" class="lb">${r3}kΩ</text>
    <text x="145" y="97" class="hi">V = ?</text>
  `, 310, 100);
}

function svgDivider(vs, r1, r2) {
  return svgBase(`
    <line x1="36"  y1="16" x2="150" y2="16" class="w"/>
    <line x1="36"  y1="16" x2="36"  y2="84" class="w"/>
    <line x1="36"  y1="84" x2="150" y2="84" class="w"/>
    <circle cx="36" cy="50" r="13" class="c"/>
    <text x="36"  y="53" class="lb" style="fill:#ede8ff">${vs}V</text>
    <line x1="150" y1="16" x2="150" y2="32" class="w"/>
    <rect x="130" y="32" width="40" height="14" rx="3" class="c"/>
    <text x="150" y="30" class="lb">${r1}kΩ</text>
    <line x1="150" y1="46" x2="150" y2="62" class="w"/>
    <rect x="130" y="62" width="40" height="14" rx="3" style="stroke:#c4a8ff;stroke-width:1.2;fill:#1a1430"/>
    <text x="150" y="60" class="lb" style="fill:#c4a8ff">${r2}kΩ</text>
    <line x1="150" y1="76" x2="150" y2="84" class="w"/>
    <circle cx="150" cy="62" r="3" class="nd"/>
    <text x="183"  y="66" class="hi">Vout=?</text>
    <line x1="168" y1="62" x2="180" y2="62" class="w" style="stroke-dasharray:3,2"/>
  `, 220, 100);
}

function svgThevenin(vs, r1, r2) {
  return svgBase(`
    <line x1="26" y1="20" x2="26"  y2="84" class="w"/>
    <line x1="26" y1="20" x2="66"  y2="20" class="w"/>
    <circle cx="26" cy="52" r="13" class="c"/>
    <text x="26"  y="55" class="lb" style="fill:#ede8ff">${vs}V</text>
    <line x1="66" y1="20" x2="66"  y2="34" class="w"/>
    <rect x="46"  y="34" width="40" height="14" rx="3" class="c"/>
    <text x="66"  y="32" class="lb">${r1}kΩ</text>
    <line x1="66" y1="48" x2="66"  y2="62" class="w"/>
    <rect x="46"  y="62" width="40" height="14" rx="3" style="stroke:#c4a8ff;stroke-width:1.2;fill:#1a1430"/>
    <text x="66"  y="60" class="lb" style="fill:#c4a8ff">${r2}kΩ</text>
    <line x1="66" y1="76" x2="66"  y2="84" class="w"/>
    <line x1="26" y1="84" x2="180" y2="84" class="w"/>
    <line x1="66" y1="20" x2="180" y2="20" class="w"/>
    <circle cx="180" cy="20" r="3" class="nd"/>
    <circle cx="180" cy="84" r="3" class="nd"/>
    <text x="191" y="23" style="font-size:11px;fill:#9d7de8;font-family:'IBM Plex Mono'">A</text>
    <text x="191" y="87" style="font-size:11px;fill:#9d7de8;font-family:'IBM Plex Mono'">B</text>
    <text x="215" y="55" class="hi">Vth=?</text>
  `, 240, 100);
}

function svgNodal(is, r1, r2) {
  return svgBase(`
    <line x1="34"  y1="20" x2="34"  y2="84" class="w"/>
    <circle cx="34" cy="52" r="16" class="c"/>
    <text x="34"  y="48" class="lb" style="fill:#ede8ff;font-size:9px">${is}mA↑</text>
    <line x1="34"  y1="20" x2="190" y2="20" class="w"/>
    <line x1="34"  y1="84" x2="190" y2="84" class="w"/>
    <line x1="105" y1="20" x2="105" y2="34" class="w"/>
    <rect x="85"   y="34" width="40" height="14" rx="3" class="c"/>
    <text x="105"  y="32" class="lb">${r1}kΩ</text>
    <line x1="105" y1="48" x2="105" y2="84" class="w"/>
    <line x1="190" y1="20" x2="190" y2="34" class="w"/>
    <rect x="170"  y="34" width="40" height="14" rx="3" class="c"/>
    <text x="190"  y="32" class="lb">${r2}kΩ</text>
    <line x1="190" y1="48" x2="190" y2="84" class="w"/>
    <circle cx="190" cy="20" r="3" class="nd"/>
    <text x="204"  y="23" class="hi">V1=?</text>
  `, 240, 100);
}

// ── Sidebar ───────────────────────────────────
function buildPracticeSidebar() {
  const sb = document.getElementById('practice-sidebar');
  sb.innerHTML = '';

  const addLbl = t => {
    const el = document.createElement('div');
    el.className = 'sidebar-label';
    el.textContent = t;
    sb.appendChild(el);
  };

  addLbl('Built-in topics');
  Object.entries(BUILTIN).forEach(([key, meta]) => {
    const btn = document.createElement('button');
    btn.className = 'sb-btn';
    btn.dataset.key = key;
    btn.innerHTML = `<i class="ti ${meta.icon}"></i>${meta.label}<span class="sb-score" id="sc-${key}">—</span>`;
    btn.onclick = () => loadBuiltinPractice(key, btn);
    sb.appendChild(btn);
  });

  // Only folders with at least one enabled problem
  const foldersWithEnabled = window.DB.folders.filter(f =>
    f.problemIds.some(pid => {
      const p = window.DB.problems.find(pr => pr.id === pid);
      return p && p.enabled !== false;
    })
  );

  if (foldersWithEnabled.length) {
    addLbl('Topic folders');
    foldersWithEnabled.forEach(f => {
      const fold = document.createElement('div');
      fold.className = 'sb-folder';

      const head = document.createElement('button');
      head.className = 'sb-folder-head';
      head.innerHTML = `<i class="ti ti-folder" style="font-size:13px;color:var(--text4)"></i>${f.name}<i class="ti ti-chevron-right" style="font-size:11px;margin-left:auto;color:var(--text4)" id="fchev-${f.id}"></i>`;

      const children = document.createElement('div');
      children.className = 'sb-folder-children';
      children.style.display = 'none';

      head.onclick = () => {
        const open = children.style.display === 'none';
        children.style.display = open ? 'flex' : 'none';
        document.getElementById(`fchev-${f.id}`).style.transform = open ? 'rotate(90deg)' : '';
      };

      fold.appendChild(head);

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

      fold.appendChild(children);
      sb.appendChild(fold);
    });
  }

  refreshSidebarScores();
  sb.querySelector('.sb-btn')?.click();
}

function refreshSidebarScores() {
  const u = window.DB.users[window.S.user];
  if (!u) return;
  Object.keys(BUILTIN).forEach(k => {
    const el = document.getElementById(`sc-${k}`);
    if (!el) return;
    const sc = u.scores[k];
    if (sc?.attempted) {
      el.textContent = `${sc.correct}/${sc.attempted}`;
      el.className = 'sb-score ok';
    }
  });
}

// ── Built-in practice ─────────────────────────
function loadBuiltinPractice(key, btn) {
  window.S.activeBuiltin = key;
  window.S.activeFolderId = null;
  document.querySelectorAll('.sb-btn, .sb-child-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  window.S.currentBuiltinProb = genBuiltin(key);
  renderSingleProblem(window.S.currentBuiltinProb, true, false);
}

function shuffleBuiltin() {
  window.S.currentBuiltinProb = genBuiltin(window.S.activeBuiltin);
  renderSingleProblem(window.S.currentBuiltinProb, true, false);
}

// ── Folder practice ───────────────────────────
function loadFolderPractice(folderId, startPid, btn) {
  const folder = window.DB.folders.find(f => f.id === folderId);
  if (!folder) return;

  const enabledIds = folder.problemIds.filter(pid => {
    const p = window.DB.problems.find(pr => pr.id === pid);
    return p && p.enabled !== false;
  });
  if (!enabledIds.length) return;

  window.S.activeFolderId = folderId;
  window.S.activeBuiltin  = null;
  window.S.folderProblems = enabledIds
    .map(pid => { const p = window.DB.problems.find(pr => pr.id === pid); return p ? genAuthoredVariant(p) : null; })
    .filter(Boolean);
  window.S.folderIdx = Math.max(0, enabledIds.indexOf(startPid));

  document.querySelectorAll('.sb-btn, .sb-child-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  renderFolderProblem();
}

function renderFolderProblem() {
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
      <div class="topic-title">${folder?.name || 'Problems'}</div>
      <div class="topic-sub">${n} problem${n !== 1 ? 's' : ''} in this folder</div>
    </div>
    <div class="prob-progress">
      <div class="prog-track"><div class="prog-fill" style="width:${n > 1 ? (i / (n-1)) * 100 : 100}%"></div></div>
      <span class="prog-label">${i + 1} / ${n}</span>
      <div class="nav-arrows">
        <button class="btn btn-sm" onclick="folderNav(-1)" ${i === 0 ? 'disabled style="opacity:.3"' : ''}><i class="ti ti-chevron-left"></i></button>
        <button class="btn btn-sm" onclick="folderNav(1)"  ${i === n-1 ? 'disabled style="opacity:.3"' : ''}><i class="ti ti-chevron-right"></i></button>
      </div>
    </div>`;
  pane.appendChild(buildProbCardEl(p, false, true));
  main.appendChild(pane);
}

function folderNav(dir) {
  window.S.folderIdx = Math.max(0, Math.min(window.S.folderProblems.length - 1, window.S.folderIdx + dir));
  renderFolderProblem();
}

function shuffleFolderProb() {
  const folder = window.DB.folders.find(f => f.id === window.S.activeFolderId);
  if (!folder) return;
  const enabledIds = folder.problemIds.filter(pid => {
    const p = window.DB.problems.find(pr => pr.id === pid);
    return p && p.enabled !== false;
  });
  const pid = enabledIds[window.S.folderIdx];
  const authored = window.DB.problems.find(pr => pr.id === pid);
  if (authored) window.S.folderProblems[window.S.folderIdx] = genAuthoredVariant(authored);
  renderFolderProblem();
}

// ── Single problem render (builtin) ───────────
function renderSingleProblem(p, isBuiltin, isFolder) {
  const meta = BUILTIN[window.S.activeBuiltin];
  const main = document.getElementById('practice-main');
  main.innerHTML = '';
  const pane = document.createElement('div');
  pane.className = 'practice-pane';
  pane.innerHTML = `
    <div>
      <div class="topic-title">${meta?.label || p.title}</div>
      <div class="topic-sub">Numbers reshuffle on each attempt</div>
    </div>`;
  pane.appendChild(buildProbCardEl(p, isBuiltin, isFolder));
  main.appendChild(pane);
}

// ── Problem card element ──────────────────────
function buildProbCardEl(p, isBuiltin, isFolder) {
  const card = document.createElement('div');
  card.className = 'prob-card';
  const tags = (p.tags || []).map(t => `<span class="pill pill-purple">${t}</span>`).join('');

  card.innerHTML = `
    <div class="prob-head">
      <span class="prob-title-el">${p.title}</span>
      <div style="display:flex;gap:6px">${tags}</div>
    </div>
    <div class="prob-body">
      <div class="circuit-wrap">${p.circuit || '<span style="font-size:12px;color:var(--text4)">No diagram</span>'}</div>
      <p class="question-text">${p.question}</p>
      <div class="answer-row">
        <input class="mono" type="number" step="any" placeholder="0.000" id="main-ans" style="width:120px"/>
        <select id="main-unit" style="width:78px">
          <option value="1"     ${p.unit==='V'  ?'selected':''}>V</option>
          <option value="0.001" ${p.unit==='mV' ?'selected':''}>mV</option>
          <option value="1000"  ${p.unit==='kV' ?'selected':''}>kV</option>
          <option value="1"     ${p.unit==='A'  ?'selected':''}>A</option>
          <option value="0.001" ${p.unit==='mA' ?'selected':''}>mA</option>
          <option value="1"     ${p.unit==='Ω'  ?'selected':''}>Ω</option>
          <option value="1000"  ${p.unit==='kΩ' ?'selected':''}>kΩ</option>
          <option value="1"     ${p.unit==='W'  ?'selected':''}>W</option>
        </select>
        <span style="font-size:12px;color:var(--text3)">${p.unit}</span>
      </div>
      <div class="action-row">
        <button class="btn btn-accent btn-sm" id="main-check" onclick="checkMainAnswer()"><i class="ti ti-send"></i> Check</button>
        ${p.hint ? `<button class="btn btn-sm" onclick="toggleEl('main-hint')"><i class="ti ti-bulb"></i> Hint</button>` : ''}
        ${isBuiltin ? `<button class="btn btn-sm shuffle-btn" onclick="shuffleBuiltin()"><i class="ti ti-refresh"></i> Shuffle</button>` : ''}
        ${isFolder  ? `<button class="btn btn-sm shuffle-btn" onclick="shuffleFolderProb()"><i class="ti ti-refresh"></i> Shuffle</button>` : ''}
        <button class="btn btn-sm" onclick="sendPrompt('Walk me through this circuits problem step by step: ${p.question.replace(/'/g, "\\'").replace(/\n/g,' ')}')">
          <i class="ti ti-sparkles"></i> Explain ↗
        </button>
      </div>
      <div class="feedback" id="main-fb"></div>
      ${p.hint ? `<div class="hint-box" id="main-hint">${p.hint}</div>` : ''}
    </div>`;

  window._currentMainProb = p;
  return card;
}

// ── Answer checking ───────────────────────────
function checkMainAnswer() {
  const p = window._currentMainProb;
  if (!p) return;
  const raw  = parseFloat(document.getElementById('main-ans')?.value);
  const mult = parseFloat(document.getElementById('main-unit')?.value) || 1;
  const fb   = document.getElementById('main-fb');

  if (isNaN(raw)) {
    fb.textContent = 'Enter a number first.';
    fb.className   = 'feedback wrong';
    fb.style.display = 'block';
    return;
  }

  const submitted = raw * mult;
  const tol = Math.abs(p.answer) * p.tol + 0.001;
  const ok  = Math.abs(submitted - p.answer) <= tol;

  const u = window.DB.users[window.S.user];
  if (u && !p._answered) {
    p._answered = true;
    const key = p.topicKey || 'custom';
    if (!u.scores[key]) u.scores[key] = { correct: 0, attempted: 0 };
    u.scores[key].attempted++;
    if (ok) u.scores[key].correct++;
    if (ok) u.streak = (u.streak || 0) + 1;
    else    u.streak = 0;
    document.getElementById('streak-val').textContent = u.streak;
    saveDB();
    refreshSidebarScores();
  }

  fb.className = `feedback ${ok ? 'correct' : 'wrong'}`;
  fb.innerHTML = ok
    ? `✓ Correct! Answer: ${p.answer} ${p.unit}`
    : `✗ Expected ≈ ${p.answer} ${p.unit} (±${((p.tol || 0.02) * 100).toFixed(0)}%). Try the hint!`;
  fb.style.display = 'block';

  const chk = document.getElementById('main-check');
  if (chk) chk.disabled = true;
}

// ── Authored variant generator ────────────────
function genAuthoredVariant(prob) {
  if (!prob) return null;
  const vals = {};
  prob.vars.forEach(v => {
    vals[v.name] = Math.round(
      (parseFloat(v.min) + Math.random() * (parseFloat(v.max) - parseFloat(v.min))) * 10
    ) / 10;
  });
  const unitMap = {};
  prob.vars.forEach(v => { unitMap[v.name] = unitForType(v.type); });

  let answer = null;
  try {
    const fn = new Function(...Object.keys(vals), `return (${prob.formula})`);
    answer = rnd(fn(...Object.values(vals)), 4);
  } catch (e) {}

  return {
    id: prob.id,
    probId: prob.id,
    title: prob.title,
    topicKey: prob.topic || 'Custom',
    tags: [prob.topic || 'Custom'],
    question: substituteText(prob.question, vals, unitMap),
    hint:     substituteText(prob.hint || '', vals, unitMap),
    answer,
    unit: prob.unit,
    tol: (parseFloat(prob.tol) || 2) / 100,
    circuit: prob.imgDataUrl ? `<img src="${prob.imgDataUrl}" alt="Circuit"/>` : null,
    vals,
  };
}
