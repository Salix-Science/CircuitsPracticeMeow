/* admin.js — Analytics, grade table, and grade charts */

// ── Analytics panel ───────────────────────────
window.renderAnalytics = async function renderAnalytics(){
  // Fetch all users fresh from Firestore — window.DB.users only contains the current user
  let allUsers = [];
  try {
    allUsers = await window._fetchAllUsers();
  } catch(e) {
    console.error('renderAnalytics: failed to fetch users', e);
    return;
  }
  const users = allUsers.map(u => [u.username || u.uid, u]);
  const allAtt=users.reduce((s,[,u])=>s+Object.values(u.scores||{}).reduce((a,v)=>a+v.attempted,0),0);
  const allCor=users.reduce((s,[,u])=>s+Object.values(u.scores||{}).reduce((a,v)=>a+v.correct,0),0);
  const acc=allAtt?Math.round(allCor/allAtt*100):0;
  const enabledProbs=window.DB.problems.filter(p=>p.enabled!==false).length;
  const pubPosts=window.DB.posts.filter(p=>p.status==='published').length;
  document.getElementById('dash-metrics').innerHTML=`
    <div class="metric-card"><div class="metric-label">Students</div><div class="metric-value">${users.filter(([,u])=>!u.isAdmin).length}</div><div class="metric-sub">registered</div></div>
    <div class="metric-card"><div class="metric-label">Total attempts</div><div class="metric-value">${allAtt}</div></div>
    <div class="metric-card"><div class="metric-label">Class accuracy</div><div class="metric-value" style="color:${acc>=70?'var(--green)':acc>=50?'var(--warn)':'var(--red)'}">${acc}%</div></div>
    <div class="metric-card"><div class="metric-label">Problems</div><div class="metric-value">${enabledProbs}<span style="font-size:14px;color:var(--text4)">/${window.DB.problems.length}</span></div><div class="metric-sub">enabled / total</div></div>
    <div class="metric-card"><div class="metric-label">Blog posts</div><div class="metric-value">${pubPosts}<span style="font-size:14px;color:var(--text4)">/${window.DB.posts.length}</span></div><div class="metric-sub">published / total</div></div>`;
  const stb=document.getElementById('dt-students');stb.innerHTML='';
  if(!users.length){stb.innerHTML='<tr><td colspan="5" style="color:var(--text4)">No users yet.</td></tr>';}
  users.sort((a,b)=>Object.values(b[1].scores||{}).reduce((s,v)=>s+v.attempted,0)-Object.values(a[1].scores||{}).reduce((s,v)=>s+v.attempted,0))
  .forEach(([name,u])=>{
    const tot=Object.values(u.scores||{}).reduce((s,v)=>s+v.attempted,0);
    const cor=Object.values(u.scores||{}).reduce((s,v)=>s+v.correct,0);
    const pct=tot?Math.round(cor/tot*100):0,col=pct>=70?'var(--green)':pct>=50?'var(--warn)':'var(--red)';
    stb.innerHTML+=`<tr><td>${escHtml(name)}</td><td>${tot}</td>
      <td><div class="acc-bar-outer"><div class="acc-bar-inner" style="width:${pct}%;background:${col}"></div></div>${pct}%</td>
      <td>🔥${escHtml(String(u.streak||0))}</td><td>${u.isAdmin?'<span class="pill pill-admin">admin</span>':'student'}</td></tr>`;
  });
  const topicMap={};
  users.forEach(([,u])=>Object.entries(u.scores||{}).forEach(([k,sc])=>{
    if(!topicMap[k])topicMap[k]={correct:0,attempted:0};
    topicMap[k].correct+=sc.correct;topicMap[k].attempted+=sc.attempted;
  }));
  const tb=document.getElementById('dt-topics');tb.innerHTML='';
  Object.entries(topicMap).sort((a,b)=>b[1].attempted-a[1].attempted).forEach(([k,sc])=>{
    const pct=sc.attempted?Math.round(sc.correct/sc.attempted*100):0,col=pct>=70?'var(--green)':pct>=50?'var(--warn)':'var(--red)';
    tb.innerHTML+=`<tr><td>${escHtml(k)}</td><td>${sc.attempted}</td>
      <td><div class="acc-bar-outer"><div class="acc-bar-inner" style="width:${pct}%;background:${col}"></div></div>${pct}%</td></tr>`;
  });
  if(!Object.keys(topicMap).length)tb.innerHTML='<tr><td colspan="3" style="color:var(--text4)">No practice data yet.</td></tr>';
}

// ── Assignment selector buttons ───────────────
window.renderGradeBtns = function renderGradeBtns(){
  const wrap=document.getElementById('grade-assign-btns');
  wrap.innerHTML='';
  document.getElementById('grade-table-wrap').innerHTML='';
  if (window.rebuildSectionFilter) window.rebuildSectionFilter();
  if(!window.DB.assignments.length){
    wrap.innerHTML='<div style="color:var(--text4);font-size:12px">No assignments yet.</div>';
    return;
  }
  window.DB.assignments.forEach(a=>{
    const btn=document.createElement('button');
    btn.className='btn btn-sm';
    btn.innerHTML=`<i class="ti ti-chart-bar"></i> ${escHtml(a.title)}`;
    btn.onclick=()=>{
      wrap.querySelectorAll('.btn').forEach(b=>b.classList.remove('btn-accent'));
      btn.classList.add('btn-accent');
      loadGradeView(a.id);
    };
    wrap.appendChild(btn);
  });
}

// ── Load grade view (fetch data, then render tabs) ──
let _gradeCache = null; // { assignId, assign, users }

window.loadGradeView = async function loadGradeView(assignId){
  const wrap = document.getElementById('grade-table-wrap');
  wrap.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:1rem 0"><i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Loading…</div>';

  const assign = window.DB.assignments.find(a=>a.id===assignId);
  if(!assign){ wrap.innerHTML='<div style="color:var(--text4)">Assignment not found.</div>'; return; }

  let freshUsers=[];
  try{
    const snap = await window._fetchAllUsers();
    freshUsers = snap.filter(u=>!u.isAdmin);
    freshUsers = window.filterUsersBySection ? window.filterUsersBySection(freshUsers) : freshUsers;
  }catch(e){
    wrap.innerHTML=`<div style="color:var(--red);font-size:12px">Error loading grades: ${e.message}</div>`;
    return;
  }

  _gradeCache = { assignId, assign, users: freshUsers };
  renderGradeShell(wrap, assignId);
  switchGradeTab('table', wrap);
}

// ── Shell with tabs ───────────────────────────
window.renderGradeShell = function renderGradeShell(wrap, assignId){
  const { assign } = _gradeCache;
  const due  = assign.due ? new Date(assign.due) : null;
  const lateLabel = assign.allowLate===false
    ? '<span style="color:var(--red)">blocked</span>'
    : '<span style="color:var(--green)">allowed</span>';

  wrap.innerHTML = `
    <div class="grade-shell">
      <div class="grade-shell-head">
        <div>
          <div style="font-family:var(--font-display);font-size:15px;color:var(--accent2);letter-spacing:.06em">${escHtml(assign.title)}</div>
          <div style="font-size:11px;color:var(--text4);font-family:var(--mono);margin-top:3px">
            Due: ${due?due.toLocaleString():'No deadline'} · Late: ${lateLabel}
          </div>
        </div>
      </div>
      <div class="grade-view-tabs" id="grade-view-tabs">
        <button class="grade-view-tab active" onclick="switchGradeTab('table', document.getElementById('grade-table-wrap'))">
          <i class="ti ti-table"></i> Grade table
        </button>
        <button class="grade-view-tab" onclick="switchGradeTab('distribution', document.getElementById('grade-table-wrap'))">
          <i class="ti ti-chart-histogram"></i> Score distribution
        </button>
        <button class="grade-view-tab" onclick="switchGradeTab('problems', document.getElementById('grade-table-wrap'))">
          <i class="ti ti-chart-bar"></i> Problem accuracy
        </button>
        <button class="grade-view-tab" onclick="switchGradeTab('timeline', document.getElementById('grade-table-wrap'))">
          <i class="ti ti-clock"></i> Submission timeline
        </button>
        <button class="grade-view-tab" onclick="switchGradeTab('log', document.getElementById('grade-table-wrap'))">
          <i class="ti ti-lock"></i> Attempt log
        </button>
      </div>
      <div id="grade-view-content"></div>
    </div>`;
}

window.switchGradeTab = function switchGradeTab(tab, shellWrap){
  // Update tab button states
  const tabs = shellWrap?.querySelectorAll?.('.grade-view-tab') || document.querySelectorAll('.grade-view-tab');
  tabs.forEach(b => {
    const isActive = b.getAttribute('onclick')?.includes(`'${tab}'`);
    b.classList.toggle('active', isActive);
  });
  const content = document.getElementById('grade-view-content');
  if(!content || !_gradeCache) return;
  const { assign, users } = _gradeCache;

  if(tab==='table')        renderGradeTable(content, assign, users);
  if(tab==='distribution') renderScoreDistribution(content, assign, users);
  if(tab==='problems')     renderProblemAccuracy(content, assign, users);
  if(tab==='timeline')     renderSubmissionTimeline(content, assign, users);
  if(tab==='log')          renderAttemptLog(content, assign, users);
}

// ── Tab 1: Grade table ────────────────────────
window.renderGradeTable = function renderGradeTable(el, assign, users){
  const totalPts = assign.problems.reduce((s,ap)=>s+ap.points, 0);

  let html = `<div style="overflow-x:auto"><table class="dash-table"><thead><tr><th>Student</th>`;
  assign.problems.forEach(ap=>{
    const p = window.DB.problems.find(pr=>pr.id===ap.probId);
    html += `<th>${p?.title||'Problem'}<br/><span style="font-weight:400;color:var(--text4)">${ap.points}pts</span></th>`;
  });
  html += `<th>Score</th><th>%</th></tr></thead><tbody>`;

  if(!users.length){
    html += `<tr><td colspan="${assign.problems.length+3}" style="color:var(--text4);text-align:center;padding:2rem">No students yet.</td></tr>`;
  } else {
    // Sort by score descending
    const withScores = users.map(u=>{
      const sub = u.assignSubmissions?.[assign.id]||{};
      const earned = assign.problems.reduce((s,ap)=> s + (sub[ap.probId]?.correct ? ap.points : 0), 0);
      return { u, sub, earned };
    }).sort((a,b)=>b.earned-a.earned);

    withScores.forEach(({u, sub, earned})=>{
      const pct = totalPts ? Math.round(earned/totalPts*100) : 0;
      const col = pct>=70?'var(--green)':pct>=50?'var(--warn)':'var(--red)';
      html += `<tr><td>${escHtml(u.username||'—')}</td>`;
      assign.problems.forEach(ap=>{
        const s = sub[ap.probId];
        if(s){
          html += `<td style="text-align:center">
            ${s.correct?'<span style="color:var(--green)">✓</span>':'<span style="color:var(--red)">✗</span>'}
            ${s.late?'<span class="pill pill-warn" style="font-size:9px;margin-left:2px">late</span>':''}
          </td>`;
        } else {
          html += `<td style="text-align:center;color:var(--text4)">—</td>`;
        }
      });
      html += `<td style="font-family:var(--mono)">${earned}/${totalPts}</td>
               <td style="color:${col};font-weight:600">${pct}%</td></tr>`;
    });
  }
  html += `</tbody></table></div>`;
  el.innerHTML = html;
}

// ── Tab 2: Score distribution histogram ───────
window.renderScoreDistribution = function renderScoreDistribution(el, assign, users){
  if(!users.length){ el.innerHTML = emptyChart('No submissions yet.'); return; }
  const totalPts = assign.problems.reduce((s,ap)=>s+ap.points, 0);

  // Build scores array
  const scores = users.map(u=>{
    const sub = u.assignSubmissions?.[assign.id]||{};
    const earned = assign.problems.reduce((s,ap)=> s+(sub[ap.probId]?.correct?ap.points:0), 0);
    return totalPts ? Math.round(earned/totalPts*100) : 0;
  });

  // Buckets: 0-9, 10-19, ... 90-100
  const buckets = Array(11).fill(0); // index 0=0-9, ..., 10=100
  scores.forEach(s=>{ const b=Math.min(10, Math.floor(s/10)); buckets[b]++; });
  const labels = ['0–9','10–19','20–29','30–39','40–49','50–59','60–69','70–79','80–89','90–99','100'];
  const maxCount = Math.max(...buckets, 1);

  // Stats
  const avg = Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
  const sorted = [...scores].sort((a,b)=>a-b);
  const median = sorted.length%2===0
    ? Math.round((sorted[sorted.length/2-1]+sorted[sorted.length/2])/2)
    : sorted[Math.floor(sorted.length/2)];
  const passing = scores.filter(s=>s>=70).length;

  el.innerHTML = `
    <div class="chart-wrap">
      <div class="chart-stats-row">
        ${statPill('Average', avg+'%', avg>=70?'green':avg>=50?'warn':'red')}
        ${statPill('Median', median+'%', median>=70?'green':median>=50?'warn':'red')}
        ${statPill('Passing (≥70%)', passing+' / '+scores.length, passing===scores.length?'green':passing>scores.length/2?'warn':'red')}
        ${statPill('Submitted', scores.length+' / '+users.length, 'purple')}
      </div>
      <div class="chart-title">Score distribution</div>
      <div class="chart-subtitle">How many students scored in each range</div>
      ${barChart(buckets, labels, maxCount, (i)=>i>=7?'var(--green)':i>=5?'var(--warn)':'var(--red)')}
    </div>`;
}

// ── Tab 3: Problem accuracy ───────────────────
window.renderProblemAccuracy = function renderProblemAccuracy(el, assign, users){
  if(!users.length){ el.innerHTML = emptyChart('No submissions yet.'); return; }

  const probData = assign.problems.map(ap=>{
    const p = window.DB.problems.find(pr=>pr.id===ap.probId);
    const subs = users.map(u=>u.assignSubmissions?.[assign.id]?.[ap.probId]).filter(Boolean);
    const correct = subs.filter(s=>s.correct).length;
    const attempted = subs.length;
    const pct = attempted ? Math.round(correct/attempted*100) : null;
    return { title: p?.title||'Problem', correct, attempted, pct };
  });

  const labels = probData.map(d=>d.title);
  const values = probData.map(d=>d.pct??0);
  const maxVal = 100;
  const colors = values.map(v=>v>=70?'var(--green)':v>=50?'var(--warn)':'var(--red)');

  // Find hardest and easiest
  const withData = probData.filter(d=>d.attempted>0).sort((a,b)=>a.pct-b.pct);
  const hardest = withData[0];
  const easiest = withData[withData.length-1];

  el.innerHTML = `
    <div class="chart-wrap">
      <div class="chart-stats-row">
        ${hardest?statPill('Hardest', hardest.title+' ('+hardest.pct+'%)', 'red'):''}
        ${easiest&&easiest!==hardest?statPill('Easiest', easiest.title+' ('+easiest.pct+'%)', 'green'):''}
        ${statPill('Problems', assign.problems.length+'', 'purple')}
      </div>
      <div class="chart-title">Problem accuracy</div>
      <div class="chart-subtitle">% of students who answered each problem correctly</div>
      ${horizontalBarChart(values, labels, maxVal, colors, probData.map(d=>d.attempted?`${d.correct}/${d.attempted}`:'no data'))}
    </div>`;
}

// ── Tab 4: Submission timeline ────────────────
window.renderSubmissionTimeline = function renderSubmissionTimeline(el, assign, users){
  // Collect all submission timestamps
  const events = [];
  users.forEach(u=>{
    const sub = u.assignSubmissions?.[assign.id]||{};
    Object.values(sub).forEach(s=>{
      if(s.timestamp) events.push({ ts:s.timestamp, late:s.late, user:u.username });
    });
  });

  if(!events.length){ el.innerHTML = emptyChart('No submissions yet.'); return; }

  events.sort((a,b)=>a.ts-b.ts);
  const due = assign.due ? new Date(assign.due).getTime() : null;
  const tMin = events[0].ts;
  const tMax = Math.max(events[events.length-1].ts, due||0);
  const span = tMax - tMin || 1;

  // Stats
  const onTime = events.filter(e=>!e.late).length;
  const late   = events.filter(e=>e.late).length;
  const firstSub = new Date(tMin).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const lastSub  = new Date(events[events.length-1].ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});

  // Build SVG timeline
  const W=560, H=120, PAD=16, DOT=7;
  const toX = ts => PAD + ((ts-tMin)/span)*(W-PAD*2);

  let dots='';
  events.forEach(e=>{
    const x = toX(e.ts);
    const col = e.late ? 'var(--warn)' : 'var(--green)';
    dots += `<circle cx="${x}" cy="${H/2}" r="${DOT}" fill="${col}" opacity="0.85">
      <title>${e.user} — ${new Date(e.ts).toLocaleString()}</title>
    </circle>`;
  });

  // Due date line
  let dueLine='';
  if(due && due>=tMin && due<=tMax){
    const dx = toX(due);
    dueLine = `<line x1="${dx}" y1="${PAD}" x2="${dx}" y2="${H-PAD}" stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="4,3"/>
      <text x="${dx}" y="${PAD-3}" text-anchor="middle" font-size="9" fill="var(--warn)" font-family="IBM Plex Mono">Due</text>`;
  }

  // Time axis labels
  const startLabel = new Date(tMin).toLocaleString('en-US',{month:'short',day:'numeric'});
  const endLabel   = new Date(tMax).toLocaleString('en-US',{month:'short',day:'numeric'});

  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${W}px;display:block;margin:0 auto">
    <line x1="${PAD}" y1="${H/2}" x2="${W-PAD}" y2="${H/2}" stroke="var(--border)" stroke-width="1.5"/>
    ${dueLine}
    ${dots}
    <text x="${PAD}" y="${H-4}" font-size="9" fill="var(--text4)" font-family="IBM Plex Mono">${startLabel}</text>
    <text x="${W-PAD}" y="${H-4}" font-size="9" fill="var(--text4)" font-family="IBM Plex Mono" text-anchor="end">${endLabel}</text>
  </svg>`;

  el.innerHTML = `
    <div class="chart-wrap">
      <div class="chart-stats-row">
        ${statPill('On time', onTime+'', 'green')}
        ${statPill('Late', late+'', late>0?'warn':'purple')}
        ${statPill('First submission', firstSub, 'purple')}
        ${statPill('Last submission', lastSub, 'purple')}
      </div>
      <div class="chart-title">Submission timeline</div>
      <div class="chart-subtitle">Each dot is one problem submission · <span style="color:var(--green)">●</span> on time &nbsp; <span style="color:var(--warn)">●</span> late · hover for student name</div>
      <div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r2);padding:12px 8px;margin-top:12px">${svg}</div>
    </div>`;
}

// ── Chart helpers ─────────────────────────────
window.emptyChart = function emptyChart(msg){
  return `<div style="text-align:center;padding:3rem;color:var(--text4);font-size:13px"><i class="ti ti-chart-off" style="font-size:32px;display:block;margin-bottom:8px"></i>${msg}</div>`;
}

window.statPill = function statPill(label, value, color){
  const colors={green:'var(--green)',warn:'var(--warn)',red:'var(--red)',purple:'var(--accent2)'};
  const bgs={green:'rgba(74,222,128,.08)',warn:'rgba(251,191,36,.08)',red:'rgba(248,113,113,.08)',purple:'rgba(157,125,232,.1)'};
  const borders={green:'rgba(74,222,128,.2)',warn:'rgba(251,191,36,.2)',red:'rgba(248,113,113,.2)',purple:'rgba(157,125,232,.25)'};
  return `<div style="background:${bgs[color]||bgs.purple};border:0.5px solid ${borders[color]||borders.purple};border-radius:var(--r2);padding:10px 14px;min-width:100px">
    <div style="font-size:9px;font-weight:700;color:var(--text4);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">${label}</div>
    <div style="font-size:15px;font-family:var(--mono);font-weight:500;color:${colors[color]||colors.purple}">${value}</div>
  </div>`;
}

// Vertical bar chart
window.barChart = function barChart(values, labels, maxVal, colorFn){
  const W=560, H=160, PAD=8, BAR_PAD=4;
  const n=values.length;
  const barW=Math.max(8, (W-PAD*2)/n - BAR_PAD);
  const step=barW+BAR_PAD;
  const offsetX=PAD+(step*n<W-PAD*2?(W-PAD*2-step*n)/2:0);

  let bars='',labelsEl='';
  values.forEach((v,i)=>{
    const bh=Math.max(0,(v/maxVal)*(H-30));
    const x=offsetX+i*step;
    const y=H-20-bh;
    const col=typeof colorFn==='function'?colorFn(i):'var(--accent)';
    bars+=`<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="3" fill="${col}" opacity="0.85"/>`;
    if(v>0) bars+=`<text x="${x+barW/2}" y="${y-4}" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="IBM Plex Mono">${v}</text>`;
    labelsEl+=`<text x="${x+barW/2}" y="${H-4}" text-anchor="middle" font-size="8.5" fill="var(--text4)" font-family="IBM Plex Mono">${labels[i]||''}</text>`;
  });

  return `<div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r2);padding:12px 8px;margin-top:12px">
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${W}px;display:block;margin:0 auto">
      <line x1="${PAD}" y1="${H-20}" x2="${W-PAD}" y2="${H-20}" stroke="var(--border)" stroke-width="1"/>
      ${bars}${labelsEl}
    </svg>
    <div style="display:flex;gap:12px;justify-content:center;margin-top:6px;font-size:10px;font-family:var(--mono);flex-wrap:wrap">
      <span style="color:var(--red)">■ 0–49%</span>
      <span style="color:var(--warn)">■ 50–69%</span>
      <span style="color:var(--green)">■ 70–100%</span>
    </div>
  </div>`;
}

// Horizontal bar chart (for problem accuracy)
window.horizontalBarChart = function horizontalBarChart(values, labels, maxVal, colors, annotations){
  const rowH=28, PAD=8, LABEL_W=130, BAR_AREA=380, H=rowH*values.length+PAD*2;

  let bars='';
  values.forEach((v,i)=>{
    const bw=Math.max(0,(v/maxVal)*BAR_AREA);
    const y=PAD+i*rowH;
    const col=colors[i]||'var(--accent)';
    const labelTrim=labels[i]?.length>18?labels[i].slice(0,17)+'…':labels[i]||'';
    bars+=`
      <text x="${LABEL_W-6}" y="${y+rowH/2+4}" text-anchor="end" font-size="10" fill="var(--text2)" font-family="IBM Plex Mono">${labelTrim}</text>
      <rect x="${LABEL_W}" y="${y+4}" width="${bw}" height="${rowH-8}" rx="3" fill="${col}" opacity="0.85"/>
      <text x="${LABEL_W+bw+6}" y="${y+rowH/2+4}" font-size="10" fill="var(--text3)" font-family="IBM Plex Mono">${v}%${annotations[i]?' ('+annotations[i]+')':''}</text>`;
  });

  return `<div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r2);padding:12px 8px;margin-top:12px;overflow-x:auto">
    <svg viewBox="0 0 ${LABEL_W+BAR_AREA+100} ${H}" xmlns="http://www.w3.org/2000/svg"
         style="width:100%;min-width:${LABEL_W+BAR_AREA+80}px;max-width:600px;display:block;margin:0 auto">
      <line x1="${LABEL_W}" y1="${PAD}" x2="${LABEL_W}" y2="${H-PAD}" stroke="var(--border)" stroke-width="1"/>
      ${bars}
    </svg>
  </div>`;
}

// ── Tab 5: Attempt log ────────────────────────
// Shows every submission attempt for this assignment across all students,
// chronologically. Each row includes: time, student, problem, what they
// submitted, what the correct answer was, and whether it was right.
// Students never see this tab — it's admin-only.
window.renderAttemptLog = function renderAttemptLog(el, assign, users){
  // Gather all attemptLog entries for this assignment from all users
  const entries = [];
  users.forEach(u => {
    (u.attemptLog || []).forEach(e => {
      if (e.assignId === assign.id) {
        entries.push({ ...e, username: u.username || '—' });
      }
    });
  });

  if (!entries.length) {
    el.innerHTML = `
      <div style="text-align:center;padding:2.5rem;color:var(--text4)">
        <i class="ti ti-lock" style="font-size:32px;display:block;margin-bottom:10px"></i>
        No attempt records yet for this assignment.<br/>
        <span style="font-size:11px;margin-top:6px;display:block">Logs appear here as students submit answers.</span>
      </div>`;
    return;
  }

  // Sort newest first
  entries.sort((a,b) => b.ts - a.ts);

  // Summary stats
  const totalAttempts = entries.length;
  const uniqueStudents = new Set(entries.map(e=>e.username)).size;
  const wrongFirst = entries.filter(e=>!e.correct&&e.attemptNum===1).length;
  const multiAttempt = entries.filter(e=>e.attemptNum>1).length;

  // Filter controls (by student)
  const students = [...new Set(entries.map(e=>e.username))].sort();
  const filterId = 'log-filter-student';

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${statPill('Total attempts', totalAttempts+'', 'purple')}
        ${statPill('Students', uniqueStudents+'', 'purple')}
        ${statPill('Wrong on 1st try', wrongFirst+'', wrongFirst>0?'warn':'green')}
        ${statPill('Re-attempts', multiAttempt+'', multiAttempt>0?'warn':'green')}
      </div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
        <label style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin:0">Filter student:</label>
        <select id="${filterId}" style="padding:5px 8px;font-size:12px;width:auto"
          onchange="filterAttemptLog()">
          <option value="">All students</option>
          ${students.map(s=>`<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div style="overflow-x:auto">
      <table class="dash-table" id="attempt-log-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Student</th>
            <th>Problem</th>
            <th>Attempt #</th>
            <th>Submitted</th>
            <th>Expected</th>
            <th>Result</th>
            <th>Late</th>
          </tr>
        </thead>
        <tbody id="attempt-log-body">
          ${renderAttemptRows(entries)}
        </tbody>
      </table>
    </div>
    <div style="font-size:10px;color:var(--text4);margin-top:10px;font-family:var(--mono)">
      <i class="ti ti-info-circle"></i>
      Logged automatically on every submission. Students cannot see this data.
    </div>`;

  // Store entries for filtering
  window._currentLogEntries = entries;
}

window.renderAttemptRows = function renderAttemptRows(entries){
  if(!entries.length) return `<tr><td colspan="8" style="color:var(--text4);text-align:center">No entries match this filter.</td></tr>`;
  return entries.map(e=>{
    const time = new Date(e.ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const answerCells = (e.answers||[{submitted:e.submitted,expected:e.expected,unit:e.unit,label:''}]).map(a=>
      `${e.answers?.length>1?`<span style="font-size:10px;color:var(--text4)">${a.label}: </span>`:''}${a.submitted} ${a.unit}`
    ).join('<br/>');
    const expectedCells = (e.answers||[{answer:e.answer,unit:e.unit,label:''}]).map(a=>
      `${e.answers?.length>1?`<span style="font-size:10px;color:var(--text4)">${a.label}: </span>`:''}${a.expected??a.answer} ${a.unit}`
    ).join('<br/>');
    const resultIcon = e.correct
      ? '<span style="color:var(--green);font-weight:600">✓ Correct</span>'
      : `<span style="color:var(--red)">✗ Wrong</span>`;
    const lateIcon = e.late
      ? '<span class="pill pill-warn" style="font-size:9px">Late</span>'
      : '<span style="color:var(--text4)">—</span>';
    const rowBg = e.correct ? '' : (e.attemptNum>1?'style="background:rgba(251,191,36,.04)"':'style="background:rgba(248,113,113,.04)"');
    return `<tr ${rowBg}>
      <td style="font-family:var(--mono);white-space:nowrap;font-size:11px">${time}</td>
      <td style="font-weight:500">${escHtml(e.username)}</td>
      <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(e.probTitle||e.probId)}</td>
      <td style="text-align:center;font-family:var(--mono)">${e.attemptNum||1}</td>
      <td style="font-family:var(--mono)">${answerCells}</td>
      <td style="font-family:var(--mono);color:var(--text3)">${expectedCells}</td>
      <td>${resultIcon}</td>
      <td>${lateIcon}</td>
    </tr>`;
  }).join('');
}

window.filterAttemptLog = function filterAttemptLog(){
  const filter = document.getElementById('log-filter-student')?.value || '';
  const entries = window._currentLogEntries || [];
  const filtered = filter ? entries.filter(e=>e.username===filter) : entries;
  const body = document.getElementById('attempt-log-body');
  if(body) body.innerHTML = renderAttemptRows(filtered);
}

/* ═══════════════════════════════════════════════
   Problem analysis tab (admin)
   Per-problem view: attempts, accuracy, and the
   difficulty rating students gave it ("what people
   rate it"). Accuracy/attempts are aggregated from
   every student's attemptLog; difficulty comes from
   the rating aggregate merged onto each problem.
   Read-only — no writes happen here.
   ═══════════════════════════════════════════════ */

window.renderProblemAnalysis = async function renderProblemAnalysis(){
  if(!window.S.isAdmin){ console.warn('[security] renderProblemAnalysis blocked'); return; }
  const wrap = document.getElementById('pa-wrap');
  const metrics = document.getElementById('pa-metrics');
  if(!wrap){ console.error('renderProblemAnalysis: #pa-wrap missing'); return; }
  wrap.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:1rem 0"><i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Loading attempt data…</div>';

  // Fetch all users (needed for attempt aggregation — DB.users only holds the current admin)
  let users = [];
  try {
    users = await window._fetchAllUsers();
  } catch(e){
    console.error('renderProblemAnalysis: failed to fetch users', e);
    wrap.innerHTML = `<div style="color:var(--red);font-size:12px;padding:1rem 0">Could not load attempt data: ${escHtml(e.message||String(e))}</div>`;
    return;
  }

  // Aggregate per-problem attempts/correct/unique-students from attemptLog
  const agg = {}; // probId -> { attempts, correct, students:Set }
  users.forEach(u => {
    (u.attemptLog || []).forEach(e => {
      if(!e || !e.probId) return;
      if(!agg[e.probId]) agg[e.probId] = { attempts:0, correct:0, students:new Set() };
      agg[e.probId].attempts++;
      if(e.correct) agg[e.probId].correct++;
      agg[e.probId].students.add(u.username || u.uid);
    });
  });

  // Build a row per problem in the bank
  const rows = (window.DB.problems || []).map(p => {
    const a   = agg[p.id] || { attempts:0, correct:0, students:new Set() };
    const acc = a.attempts ? Math.round((a.correct / a.attempts) * 100) : null;
    return {
      id:         p.id,
      title:      p.title || p.id,
      topic:      p.topic || '—',
      enabled:    p.enabled !== false,
      attempts:   a.attempts,
      correct:    a.correct,
      students:   a.students.size,
      acc:        acc,                         // null = never attempted
      ratingAvg:  p.ratingAvg || 0,
      ratingCount:p.ratingCount || 0,
    };
  });

  window._paRows = rows;
  window._paSort = window._paSort || { key:'attempts', dir:-1 };

  // ── Summary metric cards ──
  if(metrics){
    const attempted   = rows.filter(r => r.attempts > 0);
    const totalAtt    = rows.reduce((s,r)=>s+r.attempts,0);
    const totalCor    = rows.reduce((s,r)=>s+r.correct,0);
    const overallAcc  = totalAtt ? Math.round(totalCor/totalAtt*100) : 0;
    const rated       = rows.filter(r => r.ratingCount > 0);
    const avgDiff     = rated.length
      ? Math.round((rated.reduce((s,r)=>s+r.ratingAvg,0)/rated.length)*10)/10
      : 0;
    const accCol = overallAcc>=70?'var(--green)':overallAcc>=50?'var(--warn)':'var(--red)';
    metrics.innerHTML = `
      <div class="metric-card"><div class="metric-label">Problems</div><div class="metric-value">${rows.length}</div><div class="metric-sub">${attempted.length} attempted</div></div>
      <div class="metric-card"><div class="metric-label">Total attempts</div><div class="metric-value">${totalAtt}</div></div>
      <div class="metric-card"><div class="metric-label">Overall accuracy</div><div class="metric-value" style="color:${accCol}">${overallAcc}%</div><div class="metric-sub">across attempted</div></div>
      <div class="metric-card"><div class="metric-label">Avg difficulty</div><div class="metric-value" style="color:var(--warn)">${avgDiff||'—'}${avgDiff?'★':''}</div><div class="metric-sub">${rated.length} rated</div></div>`;
  }

  renderProblemAnalysisTable();
};

window.paSort = function paSort(key){
  const s = window._paSort || (window._paSort = { key:'attempts', dir:-1 });
  if(s.key === key){ s.dir = -s.dir; } else { s.key = key; s.dir = (key==='title'||key==='topic') ? 1 : -1; }
  renderProblemAnalysisTable();
};

window.renderProblemAnalysisTable = function renderProblemAnalysisTable(){
  const wrap = document.getElementById('pa-wrap');
  if(!wrap) return;
  const rows = (window._paRows || []).slice();
  const { key, dir } = window._paSort || { key:'attempts', dir:-1 };

  if(!rows.length){
    wrap.innerHTML = '<div style="color:var(--text4);font-size:12px;padding:1rem 0">No problems in the bank yet.</div>';
    return;
  }

  // Sort — strings alphabetically, numbers numerically; null accuracy always last
  rows.sort((a,b)=>{
    let av=a[key], bv=b[key];
    if(key==='acc'){
      if(av==null && bv==null) return 0;
      if(av==null) return 1;          // never-attempted sink to the bottom
      if(bv==null) return -1;
    }
    if(typeof av==='string'){ return av.localeCompare(bv)*dir; }
    return ((av||0)-(bv||0))*dir;
  });

  const arrow = k => key===k ? `<span class="pa-arrow">${dir>0?'▲':'▼'}</span>` : '';
  const stars = avg => {
    if(!avg) return '<span style="color:var(--text4)">—</span>';
    const filled = Math.round(avg);
    return `<span class="pa-stars">${'★'.repeat(filled)}${'☆'.repeat(5-filled)}</span> <span style="color:var(--text3)">${avg}</span>`;
  };
  const accCell = r => {
    if(r.acc==null) return '<span style="color:var(--text4)">—</span>';
    const col = r.acc>=70?'var(--green)':r.acc>=50?'var(--warn)':'var(--red)';
    return `<div class="acc-bar-outer" style="display:inline-block;vertical-align:middle"><div class="acc-bar-inner" style="width:${r.acc}%;background:${col}"></div></div> ${r.acc}%`;
  };

  wrap.innerHTML = `
    <table class="pa-table">
      <thead>
        <tr>
          <th onclick="paSort('title')">Problem${arrow('title')}</th>
          <th onclick="paSort('topic')">Topic${arrow('topic')}</th>
          <th onclick="paSort('attempts')" style="text-align:right">Attempts${arrow('attempts')}</th>
          <th onclick="paSort('students')" style="text-align:right">Students${arrow('students')}</th>
          <th onclick="paSort('acc')">Accuracy${arrow('acc')}</th>
          <th onclick="paSort('ratingAvg')">Difficulty${arrow('ratingAvg')}</th>
          <th onclick="paSort('ratingCount')" style="text-align:right">Ratings${arrow('ratingCount')}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td class="pa-title">${escHtml(r.title)}${r.enabled?'':' <span style="font-size:9px;color:var(--text4)">(hidden)</span>'}</td>
            <td style="color:var(--text3)">${escHtml(r.topic)}</td>
            <td style="text-align:right;font-family:var(--mono)">${r.attempts}</td>
            <td style="text-align:right;font-family:var(--mono)">${r.students}</td>
            <td>${accCell(r)}</td>
            <td>${stars(r.ratingAvg)}</td>
            <td style="text-align:right;font-family:var(--mono)">${r.ratingCount}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div style="font-size:10px;color:var(--text4);margin-top:10px;font-family:var(--mono)">
      <i class="ti ti-info-circle"></i>
      Attempts &amp; accuracy come from assignment submissions; difficulty is the average student rating. Click a column to sort.
    </div>`;
};
