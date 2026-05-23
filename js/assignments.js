/* assignments.js — Student assignment view
   Fixes:
   - Submit no longer collapses the accordion (updates only the affected problem row)
   - Late submission can be blocked per assignment (allowLate field)
   - Attempt limits enforced per problem
*/

if (!window._assignVals)     window._assignVals     = {};
if (!window._assignAttempts) window._assignAttempts = {};

// Generate a variant using a deterministic seed based on assignId + probId + username.
// This ensures the same student always sees the same numbers, even after a page refresh
// or switching devices — critical for exam integrity.
function genSeededVariant(prob, seedKey) {
  if (!prob) return null;

  // Simple seeded PRNG (mulberry32)
  function mulberry32(seed) {
    return function() {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Hash the seedKey into a 32-bit integer
  let hash = 0;
  for (let i = 0; i < seedKey.length; i++) {
    hash = Math.imul(31, hash) + seedKey.charCodeAt(i) | 0;
  }
  const rand = mulberry32(hash);

  const vals = {};
  prob.vars.forEach(v => {
    const min = parseFloat(v.min), max = parseFloat(v.max);
    vals[v.name] = Math.round((min + rand() * (max - min)) * 10) / 10;
  });

  const unitMap = {};
  prob.vars.forEach(v => { unitMap[v.name] = v.unit || ''; });

  let answer = null;
  try {
    const fn = new Function(...Object.keys(vals), `return (${prob.formula || (prob.answers?.[0]?.formula) || '0'})`);
    answer = Math.round(fn(...Object.values(vals)) * 10000) / 10000;
  } catch(e) {}

  const answerDefs = prob.answers && prob.answers.length
    ? prob.answers
    : [{ id:'ans0', label:'Answer', formula: prob.formula, unit: prob.unit, tol: prob.tol }];

  const answers = answerDefs.map(a => {
    let ans = null;
    try {
      const fn = new Function(...Object.keys(vals), `return (${a.formula})`);
      ans = Math.round(fn(...Object.values(vals)) * 10000) / 10000;
    } catch(e) {}
    return { id: a.id, label: a.label, answer: ans, unit: a.unit, tol: (parseFloat(a.tol)||2)/100 };
  });

  function substituteText(tpl, vals, unitMap) {
    return (tpl||'').replace(/\{(\w+)\}/g, (m, n) =>
      vals[n] !== undefined ? `${vals[n]}${unitMap[n] ? ' ' + unitMap[n] : ''}` : m
    );
  }

  return {
    id: prob.id, probId: prob.id,
    title: prob.title,
    question: substituteText(prob.question, vals, unitMap),
    hint:     substituteText(prob.hint || '', vals, unitMap),
    answer:   answers[0]?.answer ?? null,
    unit:     answers[0]?.unit ?? prob.unit,
    tol:      answers[0]?.tol ?? 0.02,
    answers,
    maxAttempts: parseInt(prob.maxAttempts) || 0,
    circuit: prob.imgDataUrl ? `<img src="${prob.imgDataUrl}" alt="Circuit"/>` : null,
    vals,
  };
}


// ── Main list ─────────────────────────────────
window.renderStudentAssignments = function renderStudentAssignments() {
  window.track?.("page_view", { page: "assignments" });

  // Restore persisted attempt counts from Firestore into memory
  const _u = window.DB.users[window.S.user];
  if (_u?.assignAttempts) {
    Object.assign(window._assignAttempts, _u.assignAttempts);
  }

  const wrap = document.getElementById('assign-student-list');
  wrap.innerHTML = '';
  const now = Date.now();
  const visible = window.DB.assignments
    .filter(a => !a.opens || new Date(a.opens).getTime() <= now);

  if (!visible.length) {
    wrap.innerHTML = '<div style="color:var(--text4);font-size:13px;padding:2rem;text-align:center">No assignments open right now.</div>';
    return;
  }

  visible.forEach(a => {
    const due      = a.due ? new Date(a.due) : null;
    const isLate   = due && Date.now() > due.getTime();
    const lateBlocked = isLate && a.allowLate === false;
    const u        = window.DB.users[window.S.user];
    const sub      = u?.assignSubmissions?.[a.id] || {};
    const answered = Object.keys(sub).length;
    const total    = a.problems.length;

    const card = document.createElement('div');
    card.className = 'assign-card';
    card.innerHTML = `
      <div class="assign-head" onclick="toggleAssignBody('ab-${a.id}')">
        <span class="assign-name">${escHtml(a.title)}</span>
        ${isLate ? `<span class="pill pill-warn">${lateBlocked ? 'Closed' : 'Late'}</span>` : ''}
        ${answered === total && total > 0
          ? '<span class="pill pill-green">Submitted</span>'
          : `<span class="pill pill-purple">${answered}/${total} done</span>`}
        <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">
          ${due ? 'Due: ' + due.toLocaleString() : ''}
        </span>
        <i class="ti ti-chevron-down" style="font-size:13px;color:var(--text4)"></i>
      </div>
      <div class="assign-body" id="ab-${a.id}">
        ${a.instructions ? `<p style="font-size:12px;color:var(--text3);margin-bottom:10px;padding-top:4px">${a.instructions}</p>` : ''}
        ${lateBlocked
          ? `<div style="font-size:12px;color:var(--text4);padding:8px 0">This assignment is closed — late submissions are not accepted.</div>`
          : `<div id="assign-probs-${a.id}"></div>`}
      </div>`;
    wrap.appendChild(card);

    if (!lateBlocked) {
      renderAssignProblems(a, card.querySelector(`#assign-probs-${a.id}`));
      window.typeset?.(card);
    }
  });
}

window.toggleAssignBody = function toggleAssignBody(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.toggle('open');
    if (el.classList.contains('open')) {
      const assign = window.DB.assignments.find(a => `ab-${a.id}` === id);
      if (assign) window.track?.("open_assignment", { title: assign.title });
    }
  }
}

// ── Render problems inside one assignment ──────
window.renderAssignProblems = function renderAssignProblems(assign, wrap) {
  const u   = window.DB.users[window.S.user];
  const sub = u?.assignSubmissions?.[assign.id] || {};
  const due     = assign.due ? new Date(assign.due) : null;
  const isLate  = due && Date.now() > due.getTime();

  assign.problems.forEach((ap, idx) => {
    const prob   = window.DB.problems.find(p => p.id === ap.probId);
    if (!prob) return;
    const varKey = `${assign.id}-${ap.probId}-${window.S.user}`;
    if (!window._assignVals[varKey]) window._assignVals[varKey] = genSeededVariant(prob, varKey);
    const p      = window._assignVals[varKey];
    if (!p) return;

    const rowId  = `assign-row-${assign.id}-${ap.probId}`;
    const row    = document.createElement('div');
    row.id       = rowId;
    row.style.cssText = 'border:0.5px solid var(--border);border-radius:var(--r2);padding:12px;margin-bottom:8px;background:var(--bg3)';
    buildProbRow(row, assign, ap, idx, p, sub, isLate);
    wrap.appendChild(row);
  });
}

// Build/rebuild a single problem row in place
window.buildProbRow = function buildProbRow(row, assign, ap, idx, p, sub, isLate) {
  const done    = sub[ap.probId];
  const varKey  = `${assign.id}-${ap.probId}-${window.S.user}`;
  const maxAtt  = p.maxAttempts || 0;
  const used    = window._assignAttempts[varKey] || 0;
  const locked  = !!done || (maxAtt > 0 && used >= maxAtt);

  const attBadge = maxAtt > 0 && !done
    ? `<span class="pill ${used >= maxAtt ? 'pill-red' : used > 0 ? 'pill-warn' : 'pill-purple'}" style="font-size:10px">
         ${used >= maxAtt ? 'No attempts left' : `${used}/${maxAtt} attempts`}
       </span>`
    : '';

  const answers = p.answers || [{ id:'ans0', label:'Answer', answer:p.answer, unit:p.unit, tol: p.tol||0.02 }];

  const inputsHTML = answers.map((a, ai) => `
    <div class="multi-ans-row">
      ${answers.length > 1 ? `<div class="multi-ans-label">${a.label}</div>` : ''}
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
        <input class="mono" type="number" step="any" placeholder="0.000"
          id="ai-${assign.id}-${ap.probId}-${ai}"
          style="width:120px;padding:6px 10px;font-size:12px"/>
        <span style="font-size:13px;font-weight:500;color:var(--text2)">${a.unit}</span>
      </div>
    </div>`).join('');

  const lateNote = isLate ? `<span class="pill pill-warn" style="font-size:9px">Late</span>` : '';

  row.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:600;color:var(--accent2)">${idx+1}. ${escHtml(p.title)}</span>
      <span style="font-size:11px;font-family:var(--mono);color:var(--text3)">${ap.points} pts</span>
      ${done ? `<span class="pill ${done.correct ? 'pill-green' : 'pill-red'}">${done.correct ? '✓ Correct' : '✗ Incorrect'}</span>` : ''}
      ${done && done.late ? lateNote : ''}
      ${attBadge}
      ${''/* No shuffle in assignments — students must work with the numbers they were given */}
    </div>
    ${p.circuit ? `<div class="circuit-wrap" style="margin-bottom:8px;min-height:60px">${p.circuit}</div>` : ''}
    <p style="font-size:12px;color:var(--text);margin-bottom:8px;line-height:1.7">${p.question}</p>
    ${locked
      ? done
        ? `<div class="feedback ${done.correct ? 'correct' : 'wrong'}" style="display:block">
             ${done.correct
               ? '✓ Correct!'
               : '✗ Incorrect' + (window.S.isAdmin ? ' — ' + (done.details || []).map(d => `${d.label}: expected ${d.answer} ${d.unit}`).join(' · ') : '')}
           </div>`
        : `<div class="feedback wrong" style="display:block">No attempts remaining.</div>`
      : `${inputsHTML}
         <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
           <button class="btn btn-sm btn-accent"
             onclick="submitAssignProb('${assign.id}','${ap.probId}')">
             <i class="ti ti-send"></i> Submit
           </button>
           ${p.hint ? `<button class="btn btn-sm" onclick="toggleEl('ahint-${assign.id}-${ap.probId}')"><i class="ti ti-bulb"></i></button>` : ''}
         </div>
         ${p.hint ? `<div class="hint-box" id="ahint-${assign.id}-${ap.probId}">${p.hint}</div>` : ''}
         <div class="feedback" id="afb-${assign.id}-${ap.probId}"></div>`}`;
}

// ── Reshuffle ─────────────────────────────────
window.reshuffleAssignProb = function reshuffleAssignProb(assignId, probId, varKey) {
  const prob = window.DB.problems.find(p => p.id === probId);
  if (!prob) return;
  try { sessionStorage.removeItem(`prob_vals_${window.S.user || 'anon'}_${probId}`); } catch(e) {}
  window._assignVals[varKey]    = genAuthoredVariant(prob, true);
  window._assignAttempts[varKey] = 0;
  // Rebuild just this problem's row, not the whole page
  const assign = window.DB.assignments.find(a => a.id === assignId);
  const ap     = assign?.problems.find(ap => ap.probId === probId);
  const idx    = assign?.problems.indexOf(ap);
  const u      = window.DB.users[window.S.user];
  const sub    = u?.assignSubmissions?.[assignId] || {};
  const due    = assign?.due ? new Date(assign.due) : null;
  const isLate = due && Date.now() > due.getTime();
  const row    = document.getElementById(`assign-row-${assignId}-${probId}`);
  if (row && ap !== undefined && idx !== undefined) {
    buildProbRow(row, assign, ap, idx, window._assignVals[varKey], sub, isLate);
  }
}

// ── Submit ────────────────────────────────────
window.submitAssignProb = async function submitAssignProb(assignId, probId) {
  // varKey is always deterministic — reconstruct it here rather than
  // passing it through an onclick attribute where it could be tampered with.
  const varKey = `${assignId}-${probId}-${window.S.user}`;
  const p      = window._assignVals[varKey]; if (!p) return;
  const assign = window.DB.assignments.find(a => a.id === assignId);
  const ap     = assign?.problems.find(ap => ap.probId === probId);
  const idx    = assign?.problems.indexOf(ap);
  const fb     = document.getElementById(`afb-${assignId}-${probId}`);
  const answers = p.answers || [{ id:'ans0', label:'Answer', answer:p.answer, unit:p.unit, tol:p.tol||0.02 }];

  // Collect inputs
  const results = answers.map((a, ai) => {
    const raw = parseFloat(document.getElementById(`ai-${assignId}-${probId}-${ai}`)?.value);
    if (isNaN(raw)) return { missing:true, label:a.label };
    const tol = Math.abs(a.answer) * (a.tol||0.02) + 0.001;
    return { ok: Math.abs(raw - a.answer) <= tol, raw, label:a.label, answer:a.answer, unit:a.unit, tol:a.tol||0.02, missing:false };
  });

  if (results.some(r => r.missing)) {
    if (fb) { fb.textContent = 'Fill in all answer boxes.'; fb.className = 'feedback wrong'; fb.style.display = 'block'; }
    return;
  }

  const allOk  = results.every(r => r.ok);
  window._assignAttempts[varKey] = (window._assignAttempts[varKey] || 0) + 1;
  const used   = window._assignAttempts[varKey];

  // Persist attempt count to Firestore so it survives page refresh
  const _u2 = window.DB.users[window.S.user];
  if (_u2) {
    if (!_u2.assignAttempts) _u2.assignAttempts = {};
    _u2.assignAttempts[varKey] = used;
    saveUserOnly().catch(e => console.error('[assignAttempts] save failed:', e));
  }
  const maxAtt = p.maxAttempts || 0;
  const noMore = maxAtt > 0 && used >= maxAtt;

  const due    = assign?.due ? new Date(assign.due) : null;
  const isLate = due && Date.now() > due.getTime();

  // Hard block — re-checked at submission time so keeping a tab open past
  // the deadline (or calling this from the console) doesn't bypass it.
  if (isLate && assign.allowLate === false) {
    const fb = document.getElementById(`afb-${assignId}-${probId}`);
    if (fb) {
      fb.className = 'feedback wrong';
      fb.textContent = 'This assignment is closed — the deadline has passed.';
      fb.style.display = 'block';
    }
    // Rebuild the row to remove the input form
    const row = document.getElementById(`assign-row-${assignId}-${probId}`);
    if (row && ap !== undefined && idx !== undefined) {
      buildProbRow(row, assign, ap, idx, p, sub, isLate);
    }
    return;
  }

  // ── Log this attempt (every attempt, win or lose, is recorded) ──
  const prob = window.DB.problems.find(p => p.id === probId);
  window.logAttempt({
    ts:         Date.now(),
    assignId,
    probId,
    probTitle:  prob?.title || probId,
    assignTitle: assign?.title || assignId,
    attemptNum: used,
    correct:    allOk,
    late:       isLate,
    answers: results.map(r => ({
      label:     r.label,
      submitted: rnd(r.raw, 4),
      expected:  r.answer,
      unit:      r.unit,
      ok:        r.ok,
    })),
  });

  if (!allOk && !noMore) {
    // Wrong but still has attempts — show feedback inline, don't re-render
    const remaining = maxAtt > 0 ? ` (${maxAtt - used} attempt${maxAtt-used!==1?'s':''} left)` : '';
    const detail = results.map(r =>
      r.ok
        ? `${answers.length > 1 ? r.label+': ' : ''}✓`
        : `${answers.length > 1 ? r.label+': ' : ''}✗${window.S.isAdmin ? ` expected ≈${r.answer} ${r.unit}` : ''}`
    ).join(' · ');
    if (fb) { fb.className='feedback wrong'; fb.innerHTML=`${detail}${remaining}`; fb.style.display='block'; }
    // Update attempt badge without rebuilding row
    const attBadges = document.querySelectorAll(`#assign-row-${assignId}-${probId} .pill`);
    attBadges.forEach(b => {
      if (b.textContent.includes('attempt')) {
        b.textContent = maxAtt > 0 && used >= maxAtt ? 'No attempts left' : `${used}/${maxAtt} attempts`;
        b.className   = `pill ${used >= maxAtt ? 'pill-red' : 'pill-warn'}`;
      }
    });
    return;
  }

  // Lock in submission
  const u = window.DB.users[window.S.user];
  if (!u.assignSubmissions)            u.assignSubmissions = {};
  if (!u.assignSubmissions[assignId])  u.assignSubmissions[assignId] = {};
  u.assignSubmissions[assignId][probId] = {
    correct: allOk,
    details: results.map(r => ({ label:r.label, answer:r.answer, unit:r.unit, submitted:rnd(r.raw,4), ok:r.ok })),
    timestamp: Date.now(),
    late: isLate,
  };
  window.track?.("assignment_submit", { assign_id: assignId, prob_id: probId, correct: allOk, late: isLate, attempt_num: used });
  await saveUserOnly();

  // Update header counts
  const sub   = u.assignSubmissions[assignId];
  const total = assign?.problems.length || 0;
  const done  = Object.keys(sub).length;
  const head  = document.querySelector(`#ab-${assignId}`)?.previousElementSibling;
  if (head) {
    const pill = head.querySelector('.pill-purple, .pill-green');
    if (pill) {
      pill.className = done === total ? 'pill pill-green' : 'pill pill-purple';
      pill.textContent = done === total ? 'Submitted' : `${done}/${total} done`;
    }
  }

  // Rebuild only this problem row in place — accordion stays open
  const row = document.getElementById(`assign-row-${assignId}-${probId}`);
  if (row && ap !== undefined && idx !== undefined) {
    buildProbRow(row, assign, ap, idx, p, u.assignSubmissions[assignId], isLate);
  }
}
