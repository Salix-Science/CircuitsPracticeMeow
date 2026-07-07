/* progress.js — Student progress tracking view
   Includes:
   - Practice accuracy stats + streak
   - Per-topic breakdown
   - Assignment history (with per-problem score breakdown)
   - My Grades panel: posted manual grade columns (labs, attendance, etc.)
     plus all assignment scores — mirrors what the instructor sees */

window.renderProgress = function renderProgress() {
  const el  = document.getElementById('progress-content');
  const u   = window.DB.users[window.S.user];
  if (!u) { el.innerHTML = '<div style="color:var(--text4)">No data yet.</div>'; return; }

  const scores       = u.scores || {};
  const assignSubs   = u.assignSubmissions || {};
  const manualGrades = u.manualGrades || {};
  const streak       = parseInt(u.streak) || 0;

  // ── Overall stats ─────────────────────────
  const allAtt = Object.values(scores).reduce((s,v) => s + v.attempted, 0);
  const allCor = Object.values(scores).reduce((s,v) => s + v.correct,   0);
  const pct    = allAtt ? Math.round(allCor / allAtt * 100) : null;

  // ── Assignment completion (use box-point-aware helpers if available) ──
  let assignPts = 0, earnedPts = 0;
  window.DB.assignments.forEach(a => {
    const sub = assignSubs[a.id] || {};
    a.problems.forEach(ap => {
      const max = window.problemMaxPoints ? window.problemMaxPoints(ap) : (ap.points || 0);
      assignPts  += max;
      earnedPts  += window.problemEarned ? window.problemEarned(ap, sub[ap.probId]) : (sub[ap.probId]?.correct ? max : 0);
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
        <div style="font-size:13px;font-weight:500;color:var(--text);margin-bottom:4px">${escHtml(topic)}</div>
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

  // ── Assignment list (compact summary) ────────────────────
  const assignRows = window.DB.assignments.length ? window.DB.assignments.map(a => {
    const sub     = assignSubs[a.id] || {};
    const done    = a.problems.filter(ap => sub[ap.probId]).length;
    const total   = a.problems.length;
    const pts     = a.problems.reduce((s, ap) => s + (window.problemMaxPoints ? window.problemMaxPoints(ap) : (ap.points||0)), 0);
    const earned  = a.problems.reduce((s, ap) => s + (window.problemEarned ? window.problemEarned(ap, sub[ap.probId]) : (sub[ap.probId]?.correct ? (ap.points||0) : 0)), 0);
    const p       = pts ? Math.round(earned / pts * 100) : 0;
    const pColor  = p >= 90 ? 'var(--green)' : p >= 70 ? 'var(--accent2)' : p >= 60 ? 'var(--warn)' : 'var(--red)';
    const due     = a.due ? new Date(a.due) : null;
    const late    = Object.values(sub).some(s => s.late);
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:0.5px solid var(--border);flex-wrap:wrap">
      <div style="flex:1;min-width:160px">
        <div style="font-size:13px;font-weight:500;color:var(--text);margin-bottom:2px">
          ${escHtml(a.title)}
          ${late ? '<span class="pill pill-warn" style="font-size:9px;margin-left:6px">late submission</span>' : ''}
        </div>
        <div style="font-size:11px;color:var(--text3);font-family:var(--mono)">${due ? due.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'No deadline'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
        <div style="text-align:center">
          <div style="font-family:var(--mono);font-size:12px;color:var(--text3)">${done}/${total} submitted</div>
          <div style="font-family:var(--mono);font-size:12px;color:${p===100&&total>0?'var(--green)':'var(--accent2)'}">${earned}/${pts} pts</div>
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

  // ── My Grades detailed panel ──────────────────────────────
  const myGradesHTML = _buildMyGrades(u, assignSubs, manualGrades);

  el.innerHTML = `
    <!-- Summary cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:24px">
      ${card('🔥', streak, 'Day streak')}
      ${card('✓', allCor, 'Correct')}
      ${card('📝', allAtt, 'Attempted')}
      ${card('%', pct !== null ? pct + '%' : '—', 'Accuracy', pct !== null ? (pct>=70?'var(--green)':pct>=50?'var(--warn)':'var(--red)') : '')}
      ${card('📋', assignPct !== null ? assignPct + '%' : '—', 'Assignment score', assignPct !== null ? (assignPct>=70?'var(--green)':assignPct>=50?'var(--warn)':'var(--red)') : '')}
    </div>

    <!-- My Grades (instructor-posted grades) -->
    ${myGradesHTML}

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
};

// ── My Grades panel builder ────────────────────────────────────────────────
function _buildMyGrades(u, assignSubs, manualGrades) {
  const assigns    = window.DB.assignments || [];
  const manualCols = (window.DB.manualGradeCols || []).filter(c => c.posted);

  // Build rows: one per assignment + one per posted manual column
  const assignGradeRows = assigns.map(a => {
    const sub    = assignSubs[a.id] || {};
    const due    = a.due ? new Date(a.due) : null;
    const pts    = a.problems.reduce((s, ap) => s + (window.problemMaxPoints ? window.problemMaxPoints(ap) : (ap.points||0)), 0);
    const earned = a.problems.reduce((s, ap) => s + (window.problemEarned ? window.problemEarned(ap, sub[ap.probId]) : (sub[ap.probId]?.correct ? (ap.points||0) : 0)), 0);
    const pct    = pts ? Math.round(earned / pts * 100) : 0;
    const col    = pct >= 90 ? 'var(--green)' : pct >= 70 ? 'var(--accent2)' : pct >= 60 ? 'var(--warn)' : 'var(--red)';
    const anySubmitted = a.problems.some(ap => sub[ap.probId]);

    // Per-problem breakdown
    const probRows = a.problems.map(ap => {
      const prob = window.DB.problems.find(pr => pr.id === ap.probId);
      const s    = sub[ap.probId];
      const max  = window.problemMaxPoints ? window.problemMaxPoints(ap) : (ap.points||0);
      const got  = window.problemEarned ? window.problemEarned(ap, s) : (s?.correct ? max : 0);
      const partial = Array.isArray(ap.boxPoints) && ap.boxPoints.length > 1;
      const lateTag = s?.late ? '<span class="pill pill-warn" style="font-size:8px;margin-left:4px">late</span>' : '';

      let statusCell;
      if(!s){
        statusCell = `<span style="color:var(--text4);font-size:11px">—</span>`;
      } else if(partial){
        const c = got===max?'var(--green)':got>0?'var(--warn)':'var(--red)';
        statusCell = `<span style="font-family:var(--mono);font-size:12px;color:${c}">${got}/${max}</span>`;
      } else {
        statusCell = s.correct
          ? `<span style="color:var(--green);font-size:13px">✓</span>`
          : `<span style="color:var(--red);font-size:13px">✗</span>`;
      }

      // Comment from instructor (stored on the submission object's comment field)
      const commentHTML = s?.comment
        ? `<div style="font-size:10px;color:var(--text3);font-style:italic;margin-top:2px;padding-left:4px;border-left:2px solid var(--border)"><i class="ti ti-message-circle" style="font-size:10px"></i> ${escHtml(s.comment)}</div>`
        : '';

      return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:0.5px solid var(--border)">
        <div style="flex:1;min-width:0">
          <span style="font-size:11px;color:var(--text2)">${escHtml(prob?.title || ap.probId)}</span>${lateTag}
          ${commentHTML}
        </div>
        <div style="flex-shrink:0;text-align:right">${statusCell}<span style="font-size:9px;color:var(--text4);font-family:var(--mono);margin-left:4px">${max}pts</span></div>
      </div>`;
    }).join('');

    return `<div style="border-bottom:0.5px solid var(--border);padding:10px 0">
      <div style="display:flex;align-items:center;gap:10px;cursor:pointer" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:var(--text)">${escHtml(a.title)}</div>
          <div style="font-size:10px;color:var(--text4);font-family:var(--mono)">${due?due.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'No deadline'} · ${a.problems.length} problems</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${anySubmitted
            ? `<div style="font-family:var(--mono);font-size:15px;font-weight:700;color:${col}">${earned}/${pts}</div>
               <div style="font-size:10px;color:${col}">${pct}%</div>`
            : `<div style="font-size:11px;color:var(--text4)">Not submitted</div>`}
        </div>
        <i class="ti ti-chevron-down" style="color:var(--text4);font-size:13px;flex-shrink:0"></i>
      </div>
      <div style="display:none;margin-top:6px;padding:0 4px">${probRows}</div>
    </div>`;
  });

  const manualRows = manualCols.map(col => {
    const g   = manualGrades[col.id];
    const has = g && g.score != null;
    const pct = has && col.maxScore > 0 ? Math.round(g.score / col.maxScore * 100) : null;
    const color = pct === null ? 'var(--text4)' : pct >= 90 ? 'var(--green)' : pct >= 70 ? 'var(--accent2)' : pct >= 60 ? 'var(--warn)' : 'var(--red)';

    const commentHTML = g?.comment
      ? `<div style="font-size:10px;color:var(--text3);font-style:italic;margin-top:4px;padding-left:4px;border-left:2px solid var(--border)"><i class="ti ti-message-circle" style="font-size:10px"></i> ${escHtml(g.comment)}</div>`
      : '';

    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:0.5px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--text)">${escHtml(col.name)}</div>
        <div style="font-size:10px;color:var(--text4);text-transform:uppercase;letter-spacing:.06em">${escHtml(col.type)}</div>
        ${commentHTML}
      </div>
      <div style="text-align:right;flex-shrink:0">
        ${has
          ? `<div style="font-family:var(--mono);font-size:15px;font-weight:700;color:${color}">${g.score}/${col.maxScore}</div>
             <div style="font-size:10px;color:${color}">${pct}%</div>`
          : `<div style="font-size:11px;color:var(--text4)">Pending</div>`}
      </div>
    </div>`;
  });

  const allRows = [...assignGradeRows, ...manualRows];

  if(!allRows.length){
    return `<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-bottom:16px">
      <div style="padding:10px 16px;border-bottom:0.5px solid var(--border);background:var(--bg3);font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;display:flex;align-items:center;gap:6px">
        <i class="ti ti-receipt" style="font-size:13px"></i> My grades
      </div>
      <div style="padding:14px 16px;color:var(--text4);font-size:12px">No grades posted yet.</div>
    </div>`;
  }

  return `<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-bottom:16px">
    <div style="padding:10px 16px;border-bottom:0.5px solid var(--border);background:var(--bg3);font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;display:flex;align-items:center;gap:6px">
      <i class="ti ti-receipt" style="font-size:13px"></i> My grades
      <span style="font-weight:400;font-size:10px;color:var(--text4);text-transform:none;letter-spacing:0;margin-left:4px">Click any assignment to see per-problem breakdown</span>
    </div>
    <div style="padding:0 16px">${allRows.join('')}</div>
  </div>`;
}

window.card = function card(icon, value, label, color = '') {
  return `<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center">
    <div style="font-size:20px;margin-bottom:4px">${icon}</div>
    <div style="font-size:22px;font-family:var(--mono);font-weight:500;color:${color||'var(--accent2)'};line-height:1">${value}</div>
    <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:.1em;margin-top:3px">${label}</div>
  </div>`;
};
