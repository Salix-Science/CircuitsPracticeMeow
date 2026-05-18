/* admin.js — Analytics and grade tables */

function renderAnalytics(){
  const users=Object.entries(window.DB.users);
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
    stb.innerHTML+=`<tr><td>${name}</td><td>${tot}</td>
      <td><div class="acc-bar-outer"><div class="acc-bar-inner" style="width:${pct}%;background:${col}"></div></div>${pct}%</td>
      <td>🔥${u.streak||0}</td><td>${u.isAdmin?'<span class="pill pill-admin">admin</span>':'student'}</td></tr>`;
  });
  const topicMap={};
  users.forEach(([,u])=>Object.entries(u.scores||{}).forEach(([k,sc])=>{
    if(!topicMap[k])topicMap[k]={correct:0,attempted:0};
    topicMap[k].correct+=sc.correct;topicMap[k].attempted+=sc.attempted;
  }));
  const tb=document.getElementById('dt-topics');tb.innerHTML='';
  Object.entries(topicMap).sort((a,b)=>b[1].attempted-a[1].attempted).forEach(([k,sc])=>{
    const pct=sc.attempted?Math.round(sc.correct/sc.attempted*100):0,col=pct>=70?'var(--green)':pct>=50?'var(--warn)':'var(--red)';
    // Use the topic key directly (no BUILTIN lookup — topics are user-defined)
    tb.innerHTML+=`<tr><td>${k}</td><td>${sc.attempted}</td>
      <td><div class="acc-bar-outer"><div class="acc-bar-inner" style="width:${pct}%;background:${col}"></div></div>${pct}%</td></tr>`;
  });
  if(!Object.keys(topicMap).length)tb.innerHTML='<tr><td colspan="3" style="color:var(--text4)">No practice data yet.</td></tr>';
}

// ── Grade buttons ─────────────────────────────
function renderGradeBtns(){
  const wrap=document.getElementById('grade-assign-btns');
  wrap.innerHTML='';
  document.getElementById('grade-table-wrap').innerHTML='';
  if(!window.DB.assignments.length){
    wrap.innerHTML='<div style="color:var(--text4);font-size:12px">No assignments yet.</div>';
    return;
  }
  window.DB.assignments.forEach(a=>{
    const btn=document.createElement('button');
    btn.className='btn btn-sm';
    btn.innerHTML=`<i class="ti ti-table"></i> ${a.title}`;
    btn.onclick=()=>{
      // Mark active
      wrap.querySelectorAll('.btn').forEach(b=>b.classList.remove('btn-accent'));
      btn.classList.add('btn-accent');
      renderGradeTable(a.id);
    };
    wrap.appendChild(btn);
  });
}

// ── Grade table — fetches fresh user data from Firestore ──
async function renderGradeTable(assignId){
  const tableWrap=document.getElementById('grade-table-wrap');
  tableWrap.innerHTML='<div style="color:var(--text3);font-size:12px;padding:1rem 0">Loading grades…</div>';

  const assign=window.DB.assignments.find(a=>a.id===assignId);
  if(!assign){tableWrap.innerHTML='<div style="color:var(--text4)">Assignment not found.</div>';return;}

  // Fetch ALL user docs fresh from Firestore so we get up-to-date submissions
  let freshUsers=[];
  try{
    // firebase.js exposes db via the module scope — access it through a helper
    const snap=await window._fetchAllUsers();
    freshUsers=snap.filter(u=>!u.isAdmin);
  }catch(e){
    tableWrap.innerHTML=`<div style="color:var(--red);font-size:12px">Error loading grades: ${e.message}</div>`;
    return;
  }

  const totalPts=assign.problems.reduce((s,ap)=>s+ap.points,0);
  const due=assign.due?new Date(assign.due):null;

  let html=`<div class="dash-section">
    <div class="dash-head">
      <span>${assign.title} — Grades</span>
      <span style="font-size:10px;font-weight:400;color:var(--text4)">
        Due: ${due?due.toLocaleString():'No deadline'} ·
        Late submissions: ${assign.allowLate===false?'<span style="color:var(--red)">blocked</span>':'<span style="color:var(--green)">allowed</span>'}
      </span>
    </div>
    <table class="dash-table"><thead><tr><th>Student</th>`;

  assign.problems.forEach(ap=>{
    const p=window.DB.problems.find(pr=>pr.id===ap.probId);
    html+=`<th>${p?.title||'Problem'}<br/><span style="font-weight:400;color:var(--text4)">${ap.points}pts</span></th>`;
  });
  html+=`<th>Score</th><th>%</th></tr></thead><tbody>`;

  if(!freshUsers.length){
    html+=`<tr><td colspan="${assign.problems.length+3}" style="color:var(--text4)">No students yet.</td></tr>`;
  }

  freshUsers.forEach(u=>{
    const sub=u.assignSubmissions?.[assignId]||{};
    let earned=0;
    html+=`<tr><td>${u.username||'—'}</td>`;
    assign.problems.forEach(ap=>{
      const s=sub[ap.probId];
      if(s){
        if(s.correct)earned+=ap.points;
        html+=`<td style="text-align:center">
          ${s.correct?'<span style="color:var(--green)">✓</span>':'<span style="color:var(--red)">✗</span>'}
          ${s.late?'<span class="pill pill-warn" style="font-size:9px;margin-left:2px">late</span>':''}
        </td>`;
      }else{
        html+=`<td style="text-align:center;color:var(--text4)">—</td>`;
      }
    });
    const pct=totalPts?Math.round(earned/totalPts*100):0;
    const col=pct>=70?'var(--green)':pct>=50?'var(--warn)':'var(--red)';
    html+=`<td style="font-family:var(--mono)">${earned}/${totalPts}</td>
           <td style="color:${col};font-weight:600">${pct}%</td></tr>`;
  });

  html+=`</tbody></table></div>`;
  tableWrap.innerHTML=html;
}
