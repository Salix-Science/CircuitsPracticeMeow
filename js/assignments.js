/* assignments.js — Student assignment view */

if (!window._assignVals) window._assignVals = {};

function renderStudentAssignments(){
  const wrap=document.getElementById('assign-student-list');wrap.innerHTML='';
  const now=Date.now();
  const visible=window.DB.assignments.filter(a=>!a.opens||new Date(a.opens).getTime()<=now);
  if(!visible.length){wrap.innerHTML='<div style="color:var(--text4);font-size:13px;padding:2rem;text-align:center">No assignments open right now.</div>';return;}
  visible.forEach(a=>{
    const due=a.due?new Date(a.due):null,isLate=due&&Date.now()>due.getTime();
    const u=window.DB.users[window.S.user],sub=u?.assignSubmissions?.[a.id]||{};
    const answered=Object.keys(sub).length,total=a.problems.length;
    const card=document.createElement('div');card.className='assign-card';
    card.innerHTML=`<div class="assign-head" onclick="toggleAssignBody('ab-${a.id}')">
      <span class="assign-name">${a.title}</span>
      ${isLate?'<span class="pill pill-warn">Late</span>':''}
      ${answered===total&&total>0?'<span class="pill pill-green">Submitted</span>':`<span class="pill pill-purple">${answered}/${total} done</span>`}
      <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${due?'Due: '+due.toLocaleString():''}</span>
      <i class="ti ti-chevron-down" style="font-size:13px;color:var(--text4)"></i></div>
    <div class="assign-body" id="ab-${a.id}">
      ${a.instructions?`<p style="font-size:12px;color:var(--text3);margin-bottom:10px;padding-top:4px">${a.instructions}</p>`:''}
      <div id="assign-probs-${a.id}"></div></div>`;
    wrap.appendChild(card);
    renderAssignProblems(a,card.querySelector(`#assign-probs-${a.id}`));
  });
}

function toggleAssignBody(id){const el=document.getElementById(id);if(el)el.classList.toggle('open');}

function renderAssignProblems(assign,wrap){
  const u=window.DB.users[window.S.user],sub=u?.assignSubmissions?.[assign.id]||{};
  assign.problems.forEach((ap,idx)=>{
    const prob=window.DB.problems.find(p=>p.id===ap.probId);if(!prob)return;
    const done=sub[ap.probId],varKey=`${assign.id}-${ap.probId}`;
    if(!window._assignVals[varKey])window._assignVals[varKey]=genAuthoredVariant(prob);
    const p=window._assignVals[varKey];if(!p)return;
    const row=document.createElement('div');row.style.cssText='border:0.5px solid var(--border);border-radius:var(--r2);padding:12px;margin-bottom:8px;background:var(--bg3)';
    row.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="font-size:12px;font-weight:600;color:var(--accent2)">${idx+1}. ${prob.title}</span>
      <span style="font-size:11px;font-family:var(--mono);color:var(--text3)">${ap.points} pts</span>
      ${done?`<span class="pill ${done.correct?'pill-green':'pill-red'}">${done.correct?'✓ Correct':'✗ Incorrect'}</span>`:''}
      ${!done?`<button class="btn btn-sm shuffle-btn" style="margin-left:auto;padding:3px 8px" onclick="reshuffleAssignProb('${assign.id}','${ap.probId}','${varKey}')"><i class="ti ti-refresh"></i></button>`:''}
    </div>
    ${p.circuit?`<div class="circuit-wrap" style="margin-bottom:8px;min-height:60px">${p.circuit}</div>`:''}
    <p style="font-size:12px;color:var(--text);margin-bottom:8px;line-height:1.7">${p.question}</p>
    ${!done?`<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <input class="mono" type="number" step="any" placeholder="0.000" id="ai-${assign.id}-${ap.probId}" style="width:110px;padding:6px 10px;font-size:12px"/>
      <select id="au-${assign.id}-${ap.probId}" style="width:72px;padding:6px 8px;font-size:12px">
        <option value="1" ${p.unit==='V'?'selected':''}>V</option><option value="0.001" ${p.unit==='mV'?'selected':''}>mV</option>
        <option value="1" ${p.unit==='A'?'selected':''}>A</option><option value="0.001" ${p.unit==='mA'?'selected':''}>mA</option>
        <option value="1000" ${p.unit==='kΩ'?'selected':''}>kΩ</option><option value="1" ${p.unit==='Ω'?'selected':''}>Ω</option>
      </select>
      <button class="btn btn-sm btn-accent" onclick="submitAssignProb('${assign.id}','${ap.probId}','${varKey}')"><i class="ti ti-send"></i> Submit</button>
      ${p.hint?`<button class="btn btn-sm" onclick="toggleEl('ahint-${assign.id}-${ap.probId}')"><i class="ti ti-bulb"></i></button>`:''}
    </div>
    ${p.hint?`<div class="hint-box" id="ahint-${assign.id}-${ap.probId}">${p.hint}</div>`:''}
    <div class="feedback" id="afb-${assign.id}-${ap.probId}"></div>`
    :`<div class="feedback ${done.correct?'correct':'wrong'}" style="display:block">
      ${done.correct?`✓ Correct · ${done.submitted} ${p.unit}`:`✗ Your answer: ${done.submitted} ${p.unit} · Expected: ${p.answer} ${p.unit}`}
    </div>`}`;
    wrap.appendChild(row);
  });
}

function reshuffleAssignProb(assignId,probId,varKey){const prob=window.DB.problems.find(p=>p.id===probId);if(!prob)return;window._assignVals[varKey]=genAuthoredVariant(prob);renderStudentAssignments();}

function submitAssignProb(assignId,probId,varKey){
  const p=window._assignVals[varKey];if(!p)return;
  const raw=parseFloat(document.getElementById(`ai-${assignId}-${probId}`)?.value);
  const mult=parseFloat(document.getElementById(`au-${assignId}-${probId}`)?.value)||1;
  const fb=document.getElementById(`afb-${assignId}-${probId}`);
  if(isNaN(raw)){if(fb){fb.textContent='Enter a number.';fb.className='feedback wrong';fb.style.display='block';}return;}
  const submitted=raw*mult,tol=Math.abs(p.answer)*p.tol+0.001,correct=Math.abs(submitted-p.answer)<=tol;
  const u=window.DB.users[window.S.user];if(!u.assignSubmissions)u.assignSubmissions={};if(!u.assignSubmissions[assignId])u.assignSubmissions[assignId]={};
  const assign=window.DB.assignments.find(a=>a.id===assignId);const due=assign?.due?new Date(assign.due):null;const isLate=due&&Date.now()>due.getTime();
  u.assignSubmissions[assignId][probId]={correct,submitted:rnd(submitted,4),answer:p.answer,timestamp:Date.now(),late:isLate};
  saveDB();renderStudentAssignments();
}
