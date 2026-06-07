/* assignments.js — Student assignment view
   Fixes:
   - Submit no longer collapses the accordion (updates only the affected problem row)
   - Late submission can be blocked per assignment (allowLate field)
   - Attempt limits enforced per problem
*/

if (!window._assignVals)     window._assignVals     = {};
if (!window._assignAttempts) window._assignAttempts = {};

// Sync the in-memory attempt counter directly from Firestore.
// Called after login so attempt limits are always restored from the authoritative
// server value, not from the local DB mirror which may be stale after a refresh.
window.syncAssignAttempts = async function() {
  const uid = window.S?.uid;
  if (!uid) {
    console.warn('[syncAssignAttempts] no uid — skipping');
    return;
  }
  try {
    const snap = await window._getDoc(window._docRef('users', uid));
    if (!snap.exists()) {
      console.warn('[syncAssignAttempts] user doc not found in Firestore');
      return;
    }
    const stored = snap.data().assignAttempts || {};
    const keys   = Object.keys(stored);
    // Merge authoritative Firestore counts into in-memory tracker.
    // Always take the higher value so a count the CF already advanced is never lost.
    for (const [k, v] of Object.entries(stored)) {
      window._assignAttempts[k] = Math.max(window._assignAttempts[k] || 0, v);
    }
    // Also update the local DB mirror so buildProbRow reads correctly.
    const u = window.DB.users[window.S.user];
    if (u) {
      if (!u.assignAttempts) u.assignAttempts = {};
      for (const [k, v] of Object.entries(stored)) {
        u.assignAttempts[k] = Math.max(u.assignAttempts[k] || 0, v);
      }
    }
    console.log('[syncAssignAttempts] synced', keys.length,
                'key(s) from Firestore:', JSON.stringify(window._assignAttempts));
  } catch(e) {
    console.warn('[syncAssignAttempts] Firestore fetch failed — falling back to local DB:', e);
    // Fallback: use whatever the local DB mirror has (may be stale)
    const u = window.DB?.users?.[window.S?.user];
    if (u?.assignAttempts && typeof u.assignAttempts === 'object') {
      for (const [k, v] of Object.entries(u.assignAttempts)) {
        window._assignAttempts[k] = Math.max(window._assignAttempts[k] || 0, v);
      }
    }
  }
};

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
  const boxPts  = Array.isArray(ap.boxPoints) ? ap.boxPoints : null;

  const inputsHTML = answers.map((a, ai) => {
    const pts = boxPts && boxPts[ai] != null ? boxPts[ai].points : null;
    const ptsBadge = (pts != null && answers.length > 1)
      ? `<span style="font-size:10px;color:var(--text4);font-family:var(--mono)">${pts}pt</span>`
      : '';
    return `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        ${answers.length > 1 ? `<label style="font-size:11px;color:var(--text3);min-width:60px">${escHtml(a.label)}</label>` : ''}
        <input type="number" step="any"
          id="ai-${assign.id}-${ap.probId}-${ai}"
          style="width:120px;font-size:12px;font-family:var(--mono)"
          placeholder="Answer"/>
        <span style="font-size:11px;color:var(--text4)">${escHtml(a.unit||'')}</span>
        ${ptsBadge}
      </div>`;
  }).join('');

  const maxPts = (() => {
    if (boxPts) return boxPts.reduce((s, b) => s + (b?.points || 0), 0) + ' pts';
    return (ap.points || 1) + ' pt' + ((ap.points || 1) !== 1 ? 's' : '');
  })();

  const lateNote = '<span class="pill pill-warn" style="font-size:10px">Late</span>';

  const doneStatusPill = done
    ? `<span class="pill ${done.correct ? 'pill-green' : 'pill-red'}" style="font-size:10px">${done.correct ? '✓ Correct' : '✗ Incorrect'}</span>`
    : '';

  const doneFeedback = done
    ? (done.details && done.details.length > 1
        ? `<div class="feedback ${done.correct ? 'correct' : 'wrong'}" style="display:block">
             ${done.correct ? '✓ All correct!' : '✗ Some answers incorrect'}
             ${(done.details||[]).map(d=>`<div style="font-size:11px;margin-top:2px">${escHtml(d.label)}: ${d.ok?'<span style="color:var(--green)">✓</span>':'<span style="color:var(--red)">✗</span>'}${window.S.isAdmin && !d.ok ? ` <span style="color:var(--text4)">(expected ≈${d.answer ?? d.expected} ${escHtml(d.unit||'')})</span>`:''}</div>`).join('')}
           </div>`
        : `<div class="feedback ${done.correct ? 'correct' : 'wrong'}" style="display:block">
             ${done.correct
               ? '✓ Correct!'
               : '✗ Incorrect' + (window.S.isAdmin ? ' — ' + (done.details || []).map(d => `${escHtml(d.label)}: expected ${d.answer ?? d.expected} ${escHtml(d.unit||'')}`).join(' · ') : '')}
           </div>`)
    : '';

  row.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:600;color:var(--accent2)">${idx+1}. ${escHtml(p.title)}</span>
      <span style="font-size:11px;font-family:var(--mono);color:var(--text3)">${maxPts}</span>
      ${doneStatusPill}
      ${done && done.late ? lateNote : ''}
      ${attBadge}
    </div>
    ${p.circuit ? `<div class="circuit-wrap" style="margin-bottom:8px;min-height:60px">${p.circuit}</div>` : ''}
    <p style="font-size:12px;color:var(--text);margin-bottom:8px;line-height:1.7">${p.question}</p>
    ${locked
      ? doneFeedback
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
  window._assignVals[varKey]     = genSeededVariant(prob, varKey + '_reshuffled_' + Date.now());
  window._assignAttempts[varKey] = 0;
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

// ── Submit (server-side verification via Cloud Function) ──────────────────
window.submitAssignProb = async function submitAssignProb(assignId, probId) {
  const varKey = `${assignId}-${probId}-${window.S.user}`;
  const p      = window._assignVals[varKey]; if (!p) return;
  const assign = window.DB.assignments.find(a => a.id === assignId);
  const ap     = assign?.problems.find(ap => ap.probId === probId);
  const idx    = assign?.problems.indexOf(ap);
  const fb     = document.getElementById(`afb-${assignId}-${probId}`);
  const answers = p.answers || [{ id:'ans0', label:'Answer', unit:p.unit }];

  // ── Collect raw inputs (client only reads the DOM — no answer values) ──
  const inputs = [];
  for (let ai = 0; ai < answers.length; ai++) {
    const raw = parseFloat(document.getElementById(`ai-${assignId}-${probId}-${ai}`)?.value);
    if (isNaN(raw)) {
      if (fb) { fb.textContent = 'Fill in all answer boxes.'; fb.className = 'feedback wrong'; fb.style.display = 'block'; }
      return;
    }
    inputs.push(raw);
  }

  // ── Disable submit button while the round-trip is in flight ──
  const submitBtn = document.querySelector(`#assign-row-${assignId}-${probId} .btn-accent`);
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Checking…'; }
  if (fb) { fb.style.display = 'none'; }

  let result;
  try {
    const { getFunctions, httpsCallable } = await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js'
    );
    const fns  = getFunctions(window._firebaseApp, 'us-central1');
    const call = httpsCallable(fns, 'submitAssignment');
    const res  = await call({ assignId, probId, inputs });
    result = res.data;
    console.log('[submitAssignment] server response:', result);
  } catch (err) {
    console.error('[submitAssignment] Cloud Function error:', err);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="ti ti-send"></i> Submit'; }
    const msg = err?.message || 'Server error — please try again.';
    if (fb) { fb.className = 'feedback wrong'; fb.textContent = msg; fb.style.display = 'block'; }
    return;
  }

  // ── Sync authoritative counts back into local state ──
  // The Cloud Function wrote assignAttempts via FieldValue.increment() directly
  // to Firestore. Mirror into local DB so syncAssignAttempts() restores the
  // correct count on the next page refresh.
  const used   = result.attemptsUsed;
  const maxAtt = result.attemptsMax;
  window._assignAttempts[varKey] = used;
  const _u = window.DB.users[window.S.user];
  if (_u) {
    if (!_u.assignAttempts) _u.assignAttempts = {};
    // Always take the higher value — never let a stale local count win.
    _u.assignAttempts[varKey] = Math.max(_u.assignAttempts[varKey] || 0, used);
    console.log('[submitAssignment] mirrored assignAttempts[' + varKey + '] =', _u.assignAttempts[varKey]);
    // Persist to Firestore immediately via dot-notation (non-destructive to CF-managed keys).
    // Belt-and-suspenders: syncAssignAttempts() re-fetches on next login, but this ensures
    // the count survives a same-session refresh even if that fetch hasn't run yet.
    window.saveUserOnly().catch(e => console.warn('[submitAssignment] saveUserOnly failed:', e));
  }

  // ── Log attempt for the admin analytics view ──
  const prob = window.DB.problems.find(p => p.id === probId);
  window.logAttempt?.({
    ts:          Date.now(),
    assignId,
    probId,
    probTitle:   prob?.title || probId,
    assignTitle: assign?.title || assignId,
    attemptNum:  used,
    correct:     result.allOk,
    late:        result.late || false,
    answers: result.details.map((d, i) => ({
      label:     d.label,
      submitted: inputs[i],
      expected:  d.answer ?? null,
      unit:      d.unit,
      ok:        d.ok,
    })),
  });

  window.track?.("assignment_submit", {
    assign_id: assignId, prob_id: probId,
    correct: result.allOk, late: result.late, attempt_num: used,
  });

  // ── Wrong answer with attempts remaining — rebuild row to update badge ──
  if (!result.allOk && !result.locked) {
    const remaining = maxAtt > 0 ? ` (${maxAtt - used} attempt${maxAtt-used!==1?'s':''} left)` : '';
    const detail = result.details.map(d =>
      d.ok
        ? `${answers.length > 1 ? d.label+': ' : ''}✓`
        : `${answers.length > 1 ? d.label+': ' : ''}✗`
    ).join(' · ');
    const u2 = window.DB.users[window.S.user];
    const sub2 = u2?.assignSubmissions?.[assignId] || {};
    const row2 = document.getElementById(`assign-row-${assignId}-${probId}`);
    if (row2 && ap !== undefined && idx !== undefined) {
      buildProbRow(row2, assign, ap, idx, p, sub2, result.late || false);
    }
    const fb2 = document.getElementById(`afb-${assignId}-${probId}`);
    if (fb2) { fb2.className='feedback wrong'; fb2.innerHTML=`${detail}${remaining}`; fb2.style.display='block'; }
    return;
  }

  // ── Locked (correct or out of attempts) — update local cache and rebuild row ──
  const u = window.DB.users[window.S.user];
  if (!u.assignSubmissions)           u.assignSubmissions = {};
  if (!u.assignSubmissions[assignId]) u.assignSubmissions[assignId] = {};
  u.assignSubmissions[assignId][probId] = {
    correct:   result.allOk,
    late:      result.late || false,
    timestamp: Date.now(),
    details:   result.details.map((d, i) => ({
      label:     d.label,
      ok:        d.ok,
      submitted: inputs[i],
      unit:      d.unit,
      answer:    d.answer ?? null,
    })),
  };

  // Update header pill counts
  const sub   = u.assignSubmissions[assignId];
  const total = assign?.problems.length || 0;
  const doneCount = Object.keys(sub).length;
  const head  = document.querySelector(`#ab-${assignId}`)?.previousElementSibling;
  if (head) {
    const pill = head.querySelector('.pill-purple, .pill-green');
    if (pill) {
      pill.className   = doneCount === total ? 'pill pill-green' : 'pill pill-purple';
      pill.textContent = doneCount === total ? 'Submitted' : `${doneCount}/${total} done`;
    }
  }

  // Rebuild only this problem's row — accordion stays open
  const row = document.getElementById(`assign-row-${assignId}-${probId}`);
  if (row && ap !== undefined && idx !== undefined) {
    buildProbRow(row, assign, ap, idx, p, u.assignSubmissions[assignId], result.late || false);
  }
}
