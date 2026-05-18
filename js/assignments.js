/* assignments.js — Student assignment view
   Changes: no unit selector, attempt limits enforced */

if (!window._assignVals)    window._assignVals    = {};
if (!window._assignAttempts) window._assignAttempts = {}; // keyed by `${assignId}-${probId}`

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
    const done=sub[ap.probId];
    const varKey=`${assign.id}-${ap.probId}`;
    const attKey=varKey;
    if(!window._assignVals[varKey])window._assignVals[varKey]=genAuthoredVariant(prob);
    const p=window._assignVals[varKey];if(!p)return;

    const maxAtt=p.maxAttempts||0;
    const used=window._assignAttempts[attKey]||0;
    const locked=done||(maxAtt>0&&used>=maxAtt);

    const attBadge=maxAtt>0&&!done
      ? `<span class="pill ${used>=maxAtt?'pill-red':used>0?'pill-warn':'pill-purple'}" style="font-size:10px">${used>=maxAtt?'No attempts left':`${used}/${maxAtt} attempts`}</span>`
      : '';

    const row=document.createElement('div');
    row.style.cssText='border:0.5px solid var(--border);border-radius:var(--r2);padding:12px;margin-bottom:8px;background:var(--bg3)';
    row.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:600;color:var(--accent2)">${idx+1}. ${prob.title}</span>
      <span style="font-size:11px;font-family:var(--mono);color:var(--text3)">${ap.points} pts</span>
      ${done?`<span class="pill ${done.correct?'pill-green':'pill-red'}">${done.correct?'✓ Correct':'✗ Incorrect'}</span>`:''}
      ${attBadge}
      ${!locked?`<button class="btn btn-sm shuffle-btn" style="margin-left:auto;padding:3px 8px" onclick="reshuffleAssignProb('${assign.id}','${ap.probId}','${varKey}')"><i class="ti ti-refresh"></i></button>`:''}
    </div>
    ${p.circuit?`<div class="circuit-wrap" style="margin-bottom:8px;min-height:60px">${p.circuit}</div>`:''}
    <p style="font-size:12px;color:var(--text);margin-bottom:8px;line-height:1.7">${p.question}</p>
    ${!locked?`
      ${(p.answers||[{id:'ans0',label:'Answer',answer:p.answer,unit:p.unit}]).map((a,ai)=>`
        <div class="multi-ans-row">
          ${p.answers&&p.answers.length>1?`<div class="multi-ans-label">${a.label}</div>`:''}
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
            <input class="mono" type="number" step="any" placeholder="0.000"
              id="ai-${assign.id}-${ap.probId}-${ai}"
              style="width:120px;padding:6px 10px;font-size:12px"/>
            <span style="font-size:13px;font-weight:500;color:var(--text2)">${a.unit}</span>
          </div>
        </div>`).join('')}
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
        <button class="btn btn-sm btn-accent" onclick="submitAssignProb('${assign.id}','${ap.probId}','${varKey}')">
          <i class="ti ti-send"></i> Submit
        </button>
        ${p.hint?`<button class="btn btn-sm" onclick="toggleEl('ahint-${assign.id}-${ap.probId}')"><i class="ti ti-bulb"></i></button>`:''}
      </div>
      ${p.hint?`<div class="hint-box" id="ahint-${assign.id}-${ap.probId}">${p.hint}</div>`:''}
      <div class="feedback" id="afb-${assign.id}-${ap.probId}"></div>`
    :done
      ?`<div class="feedback ${done.correct?'correct':'wrong'}" style="display:block">
          ${done.correct
            ?'✓ Correct!'
            :'✗ Incorrect — ' + (done.details||[]).map(d=>`${d.label}: expected ${d.answer} ${d.unit}`).join(' · ')}
        </div>`
      :`<div class="feedback wrong" style="display:block">No attempts remaining.</div>`
    }`;
    wrap.appendChild(row);
  });
}

function reshuffleAssignProb(assignId,probId,varKey){
  const prob=window.DB.problems.find(p=>p.id===probId);if(!prob)return;
  try { sessionStorage.removeItem(`prob_vals_${probId}`); } catch(e) {}
  window._assignVals[varKey]=genAuthoredVariant(prob, true);
  window._assignAttempts[varKey]=0;
  renderStudentAssignments();
}

async function submitAssignProb(assignId,probId,varKey){
  const p=window._assignVals[varKey];if(!p)return;
  const fb=document.getElementById(`afb-${assignId}-${probId}`);
  const answers=p.answers||[{id:'ans0',label:'Answer',answer:p.answer,unit:p.unit,tol:p.tol||0.02}];

  // Collect all inputs
  const results=answers.map((a,ai)=>{
    const raw=parseFloat(document.getElementById(`ai-${assignId}-${probId}-${ai}`)?.value);
    if(isNaN(raw))return{missing:true,label:a.label};
    const tol=Math.abs(a.answer)*(a.tol||0.02)+0.001;
    return{ok:Math.abs(raw-a.answer)<=tol,raw,label:a.label,answer:a.answer,unit:a.unit,tol:a.tol||0.02,missing:false};
  });

  if(results.some(r=>r.missing)){
    if(fb){fb.textContent='Fill in all answer boxes.';fb.className='feedback wrong';fb.style.display='block';}
    return;
  }

  const allOk=results.every(r=>r.ok);
  const attKey=varKey;
  window._assignAttempts[attKey]=(window._assignAttempts[attKey]||0)+1;
  const used=window._assignAttempts[attKey];
  const maxAtt=p.maxAttempts||0;
  const noMore=maxAtt>0&&used>=maxAtt;

  if(allOk||noMore){
    const u=window.DB.users[window.S.user];
    if(!u.assignSubmissions)u.assignSubmissions={};
    if(!u.assignSubmissions[assignId])u.assignSubmissions[assignId]={};
    const assign=window.DB.assignments.find(a=>a.id===assignId);
    const due=assign?.due?new Date(assign.due):null;
    const isLate=due&&Date.now()>due.getTime();
    u.assignSubmissions[assignId][probId]={
      correct:allOk,
      details:results.map(r=>({label:r.label,answer:r.answer,unit:r.unit,submitted:rnd(r.raw,4),ok:r.ok})),
      timestamp:Date.now(),late:isLate
    };
    await saveUserOnly();
    renderStudentAssignments();
  } else {
    const remaining=maxAtt>0?` (${maxAtt-used} attempt${maxAtt-used!==1?'s':''} left)`:'';
    const detail=results.map(r=>{
      if(r.ok)return`${answers.length>1?r.label+': ':''}✓`;
      return`${answers.length>1?r.label+': ':''}✗ expected ≈${r.answer} ${r.unit}`;
    }).join(' · ');
    if(fb){fb.className='feedback wrong';fb.innerHTML=`${detail}${remaining}`;fb.style.display='block';}
    renderStudentAssignments();
  }
}
