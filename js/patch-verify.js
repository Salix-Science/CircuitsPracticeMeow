/* patch-verify.js — Overrides checkMainAnswer (practice.js) and
   submitAssignProb (assignments.js) to verify answers server-side.

   The formula and correct answers never leave the server.
   The client sends: probId, assignId, username, vals (for practice), inputs.
   The server returns: ok, results[{index, ok, unit, label}]

   Load order: after practice.js and assignments.js in main.js.
*/

const VERIFY_ENDPOINT = '/api/verify-answer';

// ── Get Firebase ID token for the current user ────────────────────────────────
async function getIdToken() {
  try {
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const auth = getAuth();
    if (!auth.currentUser) throw new Error('Not signed in');
    return auth.currentUser.getIdToken();
  } catch(e) {
    console.error('[verify] getIdToken failed:', e);
    return null;
  }
}

// ── Core verification call ────────────────────────────────────────────────────
async function verifyAnswerRemote({ probId, assignId, username, inputs, practiceVals }) {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false, error: 'Not authenticated', results: [] };

  const body = { probId, assignId: assignId || null, username, inputs, idToken };
  // For practice problems, send the sessionStorage vals so server can reconstruct
  // the same random variant (server re-evaluates formula against these vals)
  if (practiceVals) body.practiceVals = practiceVals;

  try {
    const res = await fetch(VERIFY_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[verify] server error:', data.error);
      return { ok: false, error: data.error, results: [] };
    }
    return data; // { ok, partial, results: [{index, ok, unit, label}] }
  } catch(e) {
    console.error('[verify] fetch failed:', e);
    return { ok: false, error: e.message, results: [] };
  }
}

// ── Helper: style an input box ────────────────────────────────────────────────
function markPracticeInput(ai, state) {
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

// ── Override: checkMainAnswer (practice problems) ─────────────────────────────
window.checkMainAnswer = async function checkMainAnswer() {
  const p = window._currentMainProb; if (!p) return;
  const fb      = document.getElementById('main-fb');
  const btn     = document.getElementById('main-check');
  const answers = p.answers || [{ id:'ans0', label:'Answer', unit: p.unit }];

  // Collect raw inputs
  const inputs = answers.map((_, ai) => parseFloat(document.getElementById(`main-ans-${ai}`)?.value));
  const missing = inputs.some(v => isNaN(v));
  if (missing) {
    inputs.forEach((v, ai) => { if (isNaN(v)) markPracticeInput(ai, 'wrong'); });
    fb.textContent  = 'Fill in all answer boxes first.';
    fb.className    = 'feedback wrong';
    fb.style.display = 'block';
    return;
  }

  // Disable button while verifying
  if (btn) btn.setAttribute('disabled', '');
  fb.textContent  = 'Checking…';
  fb.className    = 'feedback';
  fb.style.display = 'block';

  // Send to server — include sessionStorage vals so server can evaluate formula
  const practiceVals = p.vals || null;
  const { ok, partial, results, error } = await verifyAnswerRemote({
    probId:       p.probId || p.id,
    assignId:     null,
    username:     window.S.user,
    inputs,
    practiceVals,
  });

  if (error && !results.length) {
    // Network/auth failure — fall back to client-side check so students aren't blocked
    console.warn('[verify] falling back to client-side check:', error);
    if (btn) btn.removeAttribute('disabled');
    _checkMainAnswerClientSide(p, fb, btn, answers, inputs);
    return;
  }

  // Apply per-box styling
  results.forEach(r => markPracticeInput(r.index, r.ok ? 'correct' : 'wrong'));

  const maxAtt = p.maxAttempts || 0;
  window._attemptCounts[p.id] = (window._attemptCounts[p.id] || 0) + 1;
  const used   = window._attemptCounts[p.id];
  const noMore = maxAtt > 0 && used >= maxAtt;

  window.track?.('practice_attempt', { topic: p.topicKey || 'custom', correct: ok, attempt_num: used });

  // Update Firestore scores via atomic increments
  const u = window.DB.users[window.S.user];
  if (u) {
    const key = p.topicKey || 'custom';
    if (!u.scores[key]) u.scores[key] = { correct: 0, attempted: 0 };
    if (!p._attemptScored) {
      p._attemptScored = true;
      u.scores[key].attempted++;
      window.recordAttempt?.(key);
    }
    if (ok && !p._correctScored) {
      p._correctScored = true;
      u.scores[key].correct++;
      window.recordCorrect?.(key);
    }
    if ((ok || noMore) && !p._streakScored) {
      p._streakScored = true;
      if (ok) u.streak = (parseInt(u.streak) || 0) + 1; else u.streak = 0;
      const sv = document.getElementById('streak-val');
      if (sv) sv.textContent = u.streak;
      window.recordStreak?.(ok);
    }
  }

  if (ok) {
    fb.className    = 'feedback correct';
    fb.innerHTML    = answers.length > 1 ? '✓ All correct!' : '✓ Correct!';
    fb.style.display = 'block';
    btn?.setAttribute('disabled', '');
    if (!window.S.isAdmin && p.probId) window.showDifficultyRating?.(p.probId);

  } else if (noMore) {
    fb.className    = 'feedback wrong';
    fb.innerHTML    = '✗ No attempts remaining.';
    fb.style.display = 'block';
    btn?.setAttribute('disabled', '');

  } else {
    if (btn) btn.removeAttribute('disabled');
    const rem    = maxAtt > 0 ? ` · ${maxAtt - used} attempt${maxAtt - used !== 1 ? 's' : ''} left` : '';
    const detail = results.map(r =>
      answers.length > 1 ? `${r.label}: ${r.ok ? '✓' : '✗'}` : null
    ).filter(Boolean).join(' · ');
    fb.className    = 'feedback wrong';
    fb.innerHTML    = detail ? `${detail}${rem}` : `✗ Not quite.${rem}`;
    fb.style.display = 'block';
  }
};

// Graceful fallback if the function is unreachable
function _checkMainAnswerClientSide(p, fb, btn, answers, inputs) {
  const results = answers.map((a, ai) => {
    const tol = Math.abs(a.answer) * (a.tol || 0.02) + 0.001;
    const ok  = Math.abs(inputs[ai] - a.answer) <= tol;
    return { ok, label: a.label, unit: a.unit, answer: a.answer, ai };
  });
  const allOk = results.every(r => r.ok);
  results.forEach(r => markPracticeInput(r.ai, r.ok ? 'correct' : 'wrong'));
  if (allOk) {
    fb.className = 'feedback correct'; fb.innerHTML = '✓ Correct!'; fb.style.display = 'block';
    btn?.setAttribute('disabled', '');
  } else {
    fb.className = 'feedback wrong'; fb.innerHTML = '✗ Not quite.'; fb.style.display = 'block';
  }
}

// ── Override: submitAssignProb (assignments) ──────────────────────────────────
window.submitAssignProb = async function submitAssignProb(assignId, probId) {
  const varKey = `${assignId}-${probId}-${window.S.user}`;
  const p      = window._assignVals[varKey]; if (!p) return;
  const assign = window.DB.assignments.find(a => a.id === assignId);
  const ap     = assign?.problems.find(ap => ap.probId === probId);
  const idx    = assign?.problems.indexOf(ap);
  const fb     = document.getElementById(`afb-${assignId}-${probId}`);
  const answers = p.answers || [{ id:'ans0', label:'Answer', unit: p.unit }];

  // Collect inputs
  const inputs = answers.map((_, ai) =>
    parseFloat(document.getElementById(`ai-${assignId}-${probId}-${ai}`)?.value)
  );

  if (inputs.some(isNaN)) {
    if (fb) { fb.textContent = 'Fill in all answer boxes.'; fb.className = 'feedback wrong'; fb.style.display = 'block'; }
    return;
  }

  // Late deadline hard check
  const due    = assign?.due ? new Date(assign.due) : null;
  const isLate = due && Date.now() > due.getTime();
  if (isLate && assign.allowLate === false) {
    if (fb) { fb.className = 'feedback wrong'; fb.textContent = 'This assignment is closed — the deadline has passed.'; fb.style.display = 'block'; }
    const row = document.getElementById(`assign-row-${assignId}-${probId}`);
    const u   = window.DB.users[window.S.user];
    const sub = u?.assignSubmissions?.[assignId] || {};
    if (row && ap !== undefined && idx !== undefined) window.buildProbRow(row, assign, ap, idx, p, sub, isLate);
    return;
  }

  // Show loading state
  if (fb) { fb.textContent = 'Checking…'; fb.className = 'feedback'; fb.style.display = 'block'; }
  const submitBtn = document.querySelector(`#assign-row-${assignId}-${probId} .btn-accent`);
  if (submitBtn) submitBtn.setAttribute('disabled', '');

  // Server-side verification — assignments use seeded vals (no practiceVals needed)
  const { ok, partial, results, error } = await verifyAnswerRemote({
    probId,
    assignId,
    username: window.S.user,
    inputs,
  });

  if (submitBtn) submitBtn.removeAttribute('disabled');

  // Attempt counting (always, regardless of server result)
  window._assignAttempts[varKey] = (window._assignAttempts[varKey] || 0) + 1;
  const used   = window._assignAttempts[varKey];
  const _u     = window.DB.users[window.S.user];
  if (_u) { if (!_u.assignAttempts) _u.assignAttempts = {}; _u.assignAttempts[varKey] = used; }
  const maxAtt = p.maxAttempts || 0;
  const noMore = maxAtt > 0 && used >= maxAtt;

  if (error && !results.length) {
    // Server unreachable — warn but don't silently pass
    console.error('[verify] assignment verification failed:', error);
    if (fb) { fb.className = 'feedback wrong'; fb.textContent = '⚠ Could not verify — check your connection and try again.'; fb.style.display = 'block'; }
    return;
  }

  // Log the attempt
  const prob = window.DB.problems.find(pr => pr.id === probId);
  window.logAttempt?.({
    ts:          Date.now(),
    assignId,
    probId,
    probTitle:   prob?.title || probId,
    assignTitle: assign?.title || assignId,
    attemptNum:  used,
    correct:     ok,
    late:        isLate,
    answers:     results.map((r, i) => ({
      label:     r.label,
      submitted: inputs[i],
      unit:      r.unit,
      ok:        r.ok,
    })),
  });

  if (!ok && !noMore) {
    // Wrong but has attempts remaining — inline feedback only, don't lock
    const remaining = maxAtt > 0 ? ` (${maxAtt - used} attempt${maxAtt - used !== 1 ? 's' : ''} left)` : '';
    const detail    = results.map(r =>
      answers.length > 1 ? `${r.label}: ${r.ok ? '✓' : '✗'}` : null
    ).filter(Boolean).join(' · ');
    if (fb) { fb.className = 'feedback wrong'; fb.innerHTML = `${detail || '✗ Not quite.'}${remaining}`; fb.style.display = 'block'; }

    // Update attempt badge
    document.querySelectorAll(`#assign-row-${assignId}-${probId} .pill`).forEach(b => {
      if (b.textContent.includes('attempt')) {
        b.textContent = maxAtt > 0 && used >= maxAtt ? 'No attempts left' : `${used}/${maxAtt} attempts`;
        b.className   = `pill ${used >= maxAtt ? 'pill-red' : 'pill-warn'}`;
      }
    });
    return;
  }

  // Lock in submission (correct OR out of attempts)
  const u = window.DB.users[window.S.user];
  if (!u.assignSubmissions)           u.assignSubmissions = {};
  if (!u.assignSubmissions[assignId]) u.assignSubmissions[assignId] = {};

  u.assignSubmissions[assignId][probId] = {
    correct:   ok,
    details:   results.map((r, i) => ({
      label:     r.label,
      unit:      r.unit,
      submitted: inputs[i],
      ok:        r.ok,
    })),
    timestamp: Date.now(),
    late:      isLate,
  };

  window.track?.('assignment_submit', { assign_id: assignId, prob_id: probId, correct: ok, late: isLate, attempt_num: used });
  await window.saveUserOnly?.();

  // Update header pill
  const sub   = u.assignSubmissions[assignId];
  const total = assign?.problems.length || 0;
  const done  = Object.keys(sub).length;
  const head  = document.querySelector(`#ab-${assignId}`)?.previousElementSibling;
  if (head) {
    const pill = head.querySelector('.pill-purple, .pill-green');
    if (pill) {
      pill.className   = done === total ? 'pill pill-green' : 'pill pill-purple';
      pill.textContent = done === total ? 'Submitted' : `${done}/${total} done`;
    }
  }

  // Rebuild this row in place
  const row = document.getElementById(`assign-row-${assignId}-${probId}`);
  if (row && ap !== undefined && idx !== undefined) {
    window.buildProbRow(row, assign, ap, idx, p, u.assignSubmissions[assignId], isLate);
  }
};
