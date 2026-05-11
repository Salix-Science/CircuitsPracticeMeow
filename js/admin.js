/* ═══════════════════════════════════════════
   admin.js — Analytics, grade tables
   ═══════════════════════════════════════════ */

function renderAnalytics() {
  const users  = Object.entries(window.DB.users);
  const allAtt = users.reduce((s,[,u]) => s + Object.values(u.scores||{}).reduce((a,v) => a + v.attempted, 0), 0);
  const allCor = users.reduce((s,[,u]) => s + Object.values(u.scores||{}).reduce((a,v) => a + v.correct,   0), 0);
  const acc    = allAtt ? Math.round(allCor / allAtt * 100) : 0;
  const enabledProbs = window.DB.problems.filter(p => p.enabled !== false).length;
  const pubPosts     = window.DB.posts.filter(p => p.status === 'published').length;

  document.getElementById('dash-metrics').innerHTML = `
    <div class="metric-card">
      <div class="metric-label">Students</div>
      <div class="metric-value">${users.filter(([,u]) => !u.isAdmin).length}</div>
      <div class="metric-sub">registered</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total attempts</div>
      <div class="metric-value">${allAtt}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Class accuracy</div>
      <div class="metric-value" style="color:${acc>=70?'var(--green)':acc>=50?'var(--warn)':'var(--red)'}">${acc}%</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Problems</div>
      <div class="metric-value">${enabledProbs}<span style="font-size:14px;color:var(--text4)">/${window.DB.problems.length}</span></div>
      <div class="metric-sub">enabled / total</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Blog posts</div>
      <div class="metric-value">${pubPosts}<span style="font-size:14px;color:var(--text4)">/${window.DB.posts.length}</span></div>
      <div class="metric-sub">published / total</div>
    </div>`;

  // Students table
  const stb = document.getElementById('dt-students');
  stb.innerHTML = '';
  if (!users.length) { stb.innerHTML = '<tr><td colspan="5" style="color:var(--text4)">No users yet.</td></tr>'; }

  users
    .sort((a,b) =>
      Object.values(b[1].scores||{}).reduce((s,v) => s+v.attempted, 0) -
      Object.values(a[1].scores||{}).reduce((s,v) => s+v.attempted, 0)
    )
    .forEach(([name, u]) => {
      const tot = Object.values(u.scores||{}).reduce((s,v) => s+v.attempted, 0);
      const cor = Object.values(u.scores||{}).reduce((s,v) => s+v.correct,   0);
      const pct = tot ? Math.round(cor/tot*100) : 0;
      const col = pct>=70?'var(--green)':pct>=50?'var(--warn)':'var(--red)';
      stb.innerHTML += `
        <tr>
          <td>${name}</td>
          <td>${tot}</td>
          <td>
            <div class="acc-bar-outer"><div class="acc-bar-inner" style="width:${pct}%;background:${col}"></div></div>
            ${pct}%
          </td>
          <td>🔥${u.streak||0}</td>
          <td>${u.isAdmin ? '<span class="pill pill-admin">admin</span>' : 'student'}</td>
        </tr>`;
    });

  // Topic accuracy table
  const topicMap = {};
  users.forEach(([,u]) =>
    Object.entries(u.scores||{}).forEach(([k,sc]) => {
      if (!topicMap[k]) topicMap[k] = { correct:0, attempted:0 };
      topicMap[k].correct   += sc.correct;
      topicMap[k].attempted += sc.attempted;
    })
  );
  const tb = document.getElementById('dt-topics');
  tb.innerHTML = '';
  Object.entries(topicMap)
    .sort((a,b) => b[1].attempted - a[1].attempted)
    .forEach(([k, sc]) => {
      const pct = sc.attempted ? Math.round(sc.correct/sc.attempted*100) : 0;
      const col = pct>=70?'var(--green)':pct>=50?'var(--warn)':'var(--red)';
      const label = BUILTIN[k]?.label || k;
      tb.innerHTML += `
        <tr>
          <td>${label}</td>
          <td>${sc.attempted}</td>
          <td>
            <div class="acc-bar-outer"><div class="acc-bar-inner" style="width:${pct}%;background:${col}"></div></div>
            ${pct}%
          </td>
        </tr>`;
    });
  if (!Object.keys(topicMap).length)
    tb.innerHTML = '<tr><td colspan="3" style="color:var(--text4)">No practice data yet.</td></tr>';
}

// ── Grade buttons ─────────────────────────────
function renderGradeBtns() {
  const wrap = document.getElementById('grade-assign-btns');
  wrap.innerHTML = '';
  document.getElementById('grade-table-wrap').innerHTML = '';
  window.DB.assignments.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.innerHTML = `<i class="ti ti-table"></i> ${a.title}`;
    btn.onclick = () => renderGradeTable(a.id);
    wrap.appendChild(btn);
  });
}

function renderGradeTable(assignId) {
  const assign   = window.DB.assignments.find(a => a.id === assignId);
  if (!assign) return;
  const users    = Object.entries(window.DB.users).filter(([,u]) => !u.isAdmin);
  const totalPts = assign.problems.reduce((s, ap) => s + ap.points, 0);

  let html = `
    <div class="dash-section">
      <div class="dash-head">${assign.title} — Grade Summary</div>
      <table class="dash-table">
        <thead><tr>
          <th>Student</th>`;

  assign.problems.forEach(ap => {
    const p = window.DB.problems.find(pr => pr.id === ap.probId);
    html += `<th>${p?.title || ap.probId}<br/><span style="font-weight:400;color:var(--text4)">${ap.points}pts</span></th>`;
  });
  html += `<th>Score</th><th>%</th></tr></thead><tbody>`;

  users.forEach(([name, u]) => {
    const sub = u.assignSubmissions?.[assignId] || {};
    let earned = 0;
    html += `<tr><td>${name}</td>`;
    assign.problems.forEach(ap => {
      const s = sub[ap.probId];
      if (s) {
        if (s.correct) earned += ap.points;
        html += `<td>
          ${s.correct ? `<span style="color:var(--green)">✓</span>` : `<span style="color:var(--red)">✗</span>`}
          ${s.late ? `<span class="pill pill-warn" style="font-size:9px">late</span>` : ''}
        </td>`;
      } else {
        html += `<td style="color:var(--text4)">—</td>`;
      }
    });
    const pct = totalPts ? Math.round(earned / totalPts * 100) : 0;
    const col = pct>=70?'var(--green)':pct>=50?'var(--warn)':'var(--red)';
    html += `<td style="font-family:var(--mono)">${earned}/${totalPts}</td><td style="color:${col}">${pct}%</td></tr>`;
  });

  html += `</tbody></table></div>`;
  document.getElementById('grade-table-wrap').innerHTML = html;
}
