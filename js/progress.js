/* progress.js — Student progress tracking view */

window.renderProgress = function renderProgress() {
  const el  = document.getElementById('progress-content');
  const u   = window.DB.users[window.S.user];
  if (!u) { el.innerHTML = '<div style="color:var(--text4)">No data yet.</div>'; return; }

  const scores       = u.scores || {};
  const assignSubs   = u.assignSubmissions || {};
  const streak       = parseInt(u.streak) || 0;

  // ── Overall stats ─────────────────────────
  const allAtt = Object.values(scores).reduce((s,v) => s + v.attempted, 0);
  const allCor = Object.values(scores).reduce((s,v) => s + v.correct,   0);
  const pct    = allAtt ? Math.round(allCor / allAtt * 100) : null;

  // ── Assignment completion ─────────────────
  const totalAssign  = window.DB.assignments.length;
  let   assignPts    = 0, earnedPts = 0;
  window.DB.assignments.forEach(a => {
    const sub = assignSubs[a.id] || {};
    a.problems.forEach(ap => {
      assignPts  += ap.points;
      if (sub[ap.probId]?.correct) earnedPts += ap.points;
    });
  });
  const assignPct = assignPts ? Math.round(earnedPts / assignPts * 100) : null;

  // ── Per-topic breakdown ───────────────────
  const topics = Object.entries(scores).sort((a,b) => b[1].attempted - a[1].attempted);

  const topicRows = topics.length ? topics.map(([topic, sc]) => {
    const p   = sc.attempted ? Math.round(sc.correct / sc.attempted * 100) : 0;
    const col = p >= 80 ? 'var(--green)' : p >= 60 ? 'var(--warn)' : 'var(--red)';
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:0.5px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:var(--text);margin-bottom:4px">${topic}</div>
        <div style="height:6px;background:var(--bg3);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${p}%;background:${col};border-radius:99px;transition:width .5s"></div>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-family:var(--mono);font-size:14px;font-weight:600;color:${col}">${p}%</div>
        <div style="font-size:10px;color:var(--text4);font-family:var(--mono)">${sc.correct}/${sc.attempted}</div>
      </div>
    </div>`;
  }).join('') : '<div style="color:var(--text4);font-size:12px;padding:1rem 0">No practice data yet — try some problems!</div>';

  // ── Assignment list ───────────────────────
  const assignRows = window.DB.assignments.length ? window.DB.assignments.map(a => {
    const sub     = assignSubs[a.id] || {};
    const done    = a.problems.filter(ap => sub[ap.probId]).length;
    const correct = a.problems.filter(ap => sub[ap.probId]?.correct).length;
    const total   = a.problems.length;
    const pts     = a.problems.reduce((s, ap) => s + ap.points, 0);
    const earned  = a.problems.reduce((s, ap) => s + (sub[ap.probId]?.correct ? ap.points : 0), 0);
    const p       = pts ? Math.round(earned / pts * 100) : 0;
    const pColor  = p >= 90 ? 'var(--green)' : p >= 70 ? 'var(--accent2)' : p >= 60 ? 'var(--warn)' : 'var(--red)';
    const due     = a.due ? new Date(a.due) : null;
    const late    = Object.values(sub).some(s => s.late);
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:0.5px solid var(--border);flex-wrap:wrap">
      <div style="flex:1;min-width:160px">
        <div style="font-size:13px;font-weight:500;color:var(--text);margin-bottom:2px">
          ${a.title}
          ${late ? '<span class="pill pill-warn" style="font-size:9px;margin-left:6px">late submission</span>' : ''}
        </div>
        <div style="font-size:11px;color:var(--text3);font-family:var(--mono)">${due ? due.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'No deadline'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
        <div style="text-align:center">
          <div style="font-family:var(--mono);font-size:12px;color:var(--text3)">${done}/${total} submitted</div>
          <div style="font-family:var(--mono);font-size:12px;color:${correct===total&&total>0?'var(--green)':'var(--accent2)'}">${earned}/${pts} pts</div>
        </div>
        <div style="width:56px;height:56px;position:relative">
          <svg viewBox="0 0 36 36" style="width:100%;transform:rotate(-90deg)">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bg3)" stroke-width="3"/>
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="${pColor}" stroke-width="3"
              stroke-dasharray="${p} ${100-p}" stroke-linecap="round"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:11px;font-weight:600;color:${pColor}">${p}%</div>
        </div>
      </div>
    </div>`;
  }).join('') : '<div style="color:var(--text4);font-size:12px;padding:1rem 0">No assignments yet.</div>';

  el.innerHTML = `
    <!-- Summary cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:24px">
      ${card('🔥', streak, 'Day streak')}
      ${card('✓', allCor, 'Correct')}
      ${card('📝', allAtt, 'Attempted')}
      ${card('%', pct !== null ? pct + '%' : '—', 'Accuracy', pct !== null ? (pct>=70?'var(--green)':pct>=50?'var(--warn)':'var(--red)') : '')}
      ${card('📋', assignPct !== null ? assignPct + '%' : '—', 'Assignment score', assignPct !== null ? (assignPct>=70?'var(--green)':assignPct>=50?'var(--warn)':'var(--red)') : '')}
    </div>

    <!-- Topic breakdown -->
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-bottom:16px">
      <div style="padding:10px 16px;border-bottom:0.5px solid var(--border);background:var(--bg3);font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;display:flex;align-items:center;gap:6px">
        <i class="ti ti-chart-bar" style="font-size:13px"></i> Practice accuracy by topic
      </div>
      <div style="padding:0 16px">${topicRows}</div>
    </div>

    <!-- Assignments -->
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);overflow:hidden">
      <div style="padding:10px 16px;border-bottom:0.5px solid var(--border);background:var(--bg3);font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;display:flex;align-items:center;gap:6px">
        <i class="ti ti-clipboard-check" style="font-size:13px"></i> Assignment history
      </div>
      <div style="padding:0 16px">${assignRows}</div>
    </div>`;

  typeset();
}

window.card = function card(icon, value, label, color = '') {
  return `<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center">
    <div style="font-size:20px;margin-bottom:4px">${icon}</div>
    <div style="font-size:22px;font-family:var(--mono);font-weight:500;color:${color||'var(--accent2)'};line-height:1">${value}</div>
    <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:.1em;margin-top:3px">${label}</div>
  </div>`;
}
