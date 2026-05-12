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
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input class="mono" type="number" step="any" placeholder="0.000" id="ai-${assign.id}-${ap.probId}" style="width:130px;padding:6px 10px;font-size:12px"/>
        <span style="font-size:13px;font-weight:500;color:var(--text2)">${p.unit}</span>
        <button class="btn btn-sm btn-accent" onclick="submitAssignProb('${assign.id}','${ap.probId}','${varKey}')">
          <i class="ti ti-send"></i> Submit
        </button>
        ${p.hint?`<button class="btn btn-sm" onclick="toggleEl('ahint-${assign.id}-${ap.probId}')"><i class="ti ti-bulb"></i></button>`:''}
      </div>
      ${p.hint?`<div class="hint-box" id="ahint-${assign.id}-${ap.probId}">${p.hint}</div>`:''}
      <div class="feedback" id="afb-${assign.id}-${ap.probId}"></div>`
    :done
      ?`<div class="feedback ${done.correct?'correct':'wrong'}" style="display:block">
          ${done.correct?`✓ Correct · ${done.submitted} ${p.unit}`:`✗ Your answer: ${done.submitted} ${p.unit} · Expected: ${p.answer} ${p.unit}`}
        </div>`
      :`<div class="feedback wrong" style="display:block">No attempts remaining. The answer was <strong>${p.answer} ${p.unit}</strong>.</div>`
    }`;
    wrap.appendChild(row);
  });
}

function reshuffleAssignProb(assignId,probId,varKey){
  const prob=window.DB.problems.find(p=>p.id===probId);if(!prob)return;
  window._assignVals[varKey]=genAuthoredVariant(prob);
  // Reset attempt count for new numbers
  window._assignAttempts[varKey]=0;
  renderStudentAssignments();
}

async function submitAssignProb(assignId,probId,varKey){
  const p=window._assignVals[varKey];if(!p)return;
  const raw=parseFloat(document.getElementById(`ai-${assignId}-${probId}`)?.value);
  const fb=document.getElementById(`afb-${assignId}-${probId}`);
  if(isNaN(raw)){if(fb){fb.textContent='Enter a number.';fb.className='feedback wrong';fb.style.display='block';}return;}

  // Track attempt
  const attKey=varKey;
  window._assignAttempts[attKey]=(window._assignAttempts[attKey]||0)+1;
  const used=window._assignAttempts[attKey];
  const maxAtt=p.maxAttempts||0;
  const tol=Math.abs(p.answer)*p.tol+0.001;
  const correct=Math.abs(raw-p.answer)<=tol;
  const noMore=maxAtt>0&&used>=maxAtt;

  if(correct||noMore){
    // Lock in the submission
    const u=window.DB.users[window.S.user];
    if(!u.assignSubmissions)u.assignSubmissions={};
    if(!u.assignSubmissions[assignId])u.assignSubmissions[assignId]={};
    const assign=window.DB.assignments.find(a=>a.id===assignId);
    const due=assign?.due?new Date(assign.due):null;
    const isLate=due&&Date.now()>due.getTime();
    u.assignSubmissions[assignId][probId]={correct,submitted:rnd(raw,4),answer:p.answer,timestamp:Date.now(),late:isLate};
    await saveUserOnly();
    renderStudentAssignments();
  } else {
    const remaining=maxAtt>0?` (${maxAtt-used} attempt${maxAtt-used!==1?'s':''} left)`:'';
    if(fb){
      fb.className='feedback wrong';
      fb.innerHTML=`✗ Not quite — expected ≈ ${p.answer} ${p.unit} (±${((p.tol||0.02)*100).toFixed(0)}%).${remaining}`;
      fb.style.display='block';
    }
    // Refresh the attempt badge
    renderStudentAssignments();
  }
}
