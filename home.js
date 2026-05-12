/* editor.js — Problem editor, folders, assignments (Firebase version)
   Changes:
   - Variables now have an explicit unit field (overrides the type default)
   - maxAttempts field added to problem form (0 = unlimited)
   - No unit selector on answer — unit is shown as plain text
*/

function toggleFormEnable(){window.S.formEnabled=!window.S.formEnabled;const t=document.getElementById('form-toggle-track'),l=document.getElementById('form-toggle-label');t.classList.toggle('on',window.S.formEnabled);l.textContent=window.S.formEnabled?'Enabled':'Disabled';}

function resetForm(){
  window.S.editingId=null;window.S.editorVars=[];window.S.editorImg=null;window.S.formEnabled=true;
  ['e-title','e-topic','e-question','e-formula','e-hint'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('e-unit').value='V';
  document.getElementById('e-tol').value='2';
  document.getElementById('e-pts').value='10';
  document.getElementById('e-max-attempts').value='0';
  document.getElementById('var-rows').innerHTML='';
  document.getElementById('img-preview-wrap').innerHTML='';
  document.getElementById('formula-preview').textContent='Formula preview';
  document.getElementById('editor-preview-card').textContent='Save to preview.';
  document.getElementById('form-mode-label').textContent='New problem';
  document.getElementById('form-toggle-track').classList.add('on');
  document.getElementById('form-toggle-label').textContent='Enabled';
  renderVarInsertChips();
}

// ── Variable rows ─────────────────────────────
// Each variable now has: name, type, min, max, unit (display unit, editable)
const TYPE_DEFAULT_UNITS = { R:'kΩ', V:'V', I:'mA', C:'μF' };
// Common unit options per type
const TYPE_UNIT_OPTIONS = {
  R: ['Ω','kΩ','MΩ'],
  V: ['mV','V','kV'],
  I: ['μA','mA','A'],
  C: ['pF','nF','μF','mH','H'],
};

function addVar(type){
  const names={R:`R${window.S.editorVars.filter(v=>v.type==='R').length+1}`,V:'Vs',I:'Is',C:'C1'};
  const mins={R:'1',V:'5',I:'1',C:'1'};
  const maxs={R:'10',V:'24',I:'10',C:'100'};
  const defaultUnit = TYPE_DEFAULT_UNITS[type]||'';
  window.S.editorVars.push({id:nextVarId(),name:names[type]||'X',type,min:mins[type],max:maxs[type],unit:defaultUnit});
  renderVarRows();renderVarInsertChips();
}

function renderVarRows(){
  const wrap=document.getElementById('var-rows');wrap.innerHTML='';
  window.S.editorVars.forEach((v,i)=>{
    const unitOptions=(TYPE_UNIT_OPTIONS[v.type]||[v.unit||'']).map(u=>`<option value="${u}" ${u===v.unit?'selected':''}>${u}</option>`).join('');
    const row=document.createElement('div');
    // wider grid to fit unit column
    row.style.cssText='display:grid;grid-template-columns:80px 56px 62px 62px 70px 24px;gap:6px;align-items:end;margin-bottom:6px';
    row.innerHTML=`
      <div><label>Name</label><input type="text" value="${v.name}" style="padding:6px 8px;font-size:12px" oninput="window.S.editorVars[${i}].name=this.value;renderVarInsertChips();previewFormula()"/></div>
      <div><label>Type</label><input type="text" value="${v.type}" readonly style="padding:6px 8px;font-size:12px;color:var(--text4)"/></div>
      <div><label>Min</label><input type="number" value="${v.min}" style="padding:6px 8px;font-size:12px" oninput="window.S.editorVars[${i}].min=this.value"/></div>
      <div><label>Max</label><input type="number" value="${v.max}" style="padding:6px 8px;font-size:12px" oninput="window.S.editorVars[${i}].max=this.value"/></div>
      <div><label>Display unit</label>
        <select style="padding:6px 8px;font-size:12px" onchange="window.S.editorVars[${i}].unit=this.value;previewFormula()">
          ${unitOptions}
        </select>
      </div>
      <button class="remove-var" onclick="window.S.editorVars.splice(${i},1);renderVarRows();renderVarInsertChips();previewFormula()"><i class="ti ti-x"></i></button>`;
    wrap.appendChild(row);
  });
}

function renderVarInsertChips(){
  const wrap=document.getElementById('var-insert-chips');if(!wrap)return;wrap.innerHTML='';
  window.S.editorVars.forEach(v=>{
    const btn=document.createElement('button');btn.className='var-chip-btn';
    btn.textContent=`{${v.name}}`;
    btn.title=`Inserts as: ${v.name} value + ${v.unit||''} · e.g. "4.7 kΩ"`;
    btn.onclick=()=>{
      const ta=document.getElementById('e-question');
      const s=ta.selectionStart,e=ta.selectionEnd,ins=`{${v.name}}`;
      ta.value=ta.value.slice(0,s)+ins+ta.value.slice(e);
      ta.focus();ta.selectionStart=ta.selectionEnd=s+ins.length;
    };
    wrap.appendChild(btn);
  });
  if(!window.S.editorVars.length){
    const n=document.createElement('span');n.style.cssText='font-size:11px;color:var(--text4)';
    n.textContent='Add variables to see insert buttons.';wrap.appendChild(n);
  }
}

function previewFormula(){
  const formula=document.getElementById('e-formula').value.trim();
  const prev=document.getElementById('formula-preview');
  if(!formula){prev.textContent='Formula preview';return;}
  const vals={};window.S.editorVars.forEach(v=>{vals[v.name]=(parseFloat(v.min)+parseFloat(v.max))/2;});
  try{
    const fn=new Function(...Object.keys(vals),`return (${formula})`);
    const res=fn(...Object.values(vals));
    const varStr=window.S.editorVars.map(v=>`${v.name}=${vals[v.name]} ${v.unit||''}`).join(', ')||'no vars';
    prev.textContent=`Preview: ${varStr} → ${rnd(res,4)} ${document.getElementById('e-unit').value}`;
  }catch(e){prev.textContent=`⚠ ${e.message}`;}
}

function handleImg(e){const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{window.S.editorImg=ev.target.result;document.getElementById('img-preview-wrap').innerHTML=`<img src="${ev.target.result}" class="img-thumb" alt="Circuit"/>`;};reader.readAsDataURL(file);}
function clearImg(){window.S.editorImg=null;document.getElementById('img-preview-wrap').innerHTML='';}

async function saveProblem(){
  const title=document.getElementById('e-title').value.trim();
  const question=document.getElementById('e-question').value.trim();
  const formula=document.getElementById('e-formula').value.trim();
  if(!title||!question||!formula){alert('Title, Question and Formula are required.');return;}
  const maxAttempts=parseInt(document.getElementById('e-max-attempts').value)||0;
  const prob={
    id:window.S.editingId||`prob-${Date.now()}`,title,
    topic:document.getElementById('e-topic').value.trim(),
    question,formula,
    vars:window.S.editorVars.map(v=>({...v})),
    unit:document.getElementById('e-unit').value,
    tol:document.getElementById('e-tol').value,
    defaultPts:parseInt(document.getElementById('e-pts').value)||10,
    maxAttempts,
    hint:document.getElementById('e-hint').value,
    imgDataUrl:window.S.editorImg||null,
    enabled:window.S.formEnabled,
  };
  const idx=window.DB.problems.findIndex(p=>p.id===prob.id);
  if(idx>=0)window.DB.problems[idx]=prob;else window.DB.problems.push(prob);
  window.S.editingId=prob.id;
  document.getElementById('form-mode-label').textContent='Saving…';
  await saveDB();
  document.getElementById('form-mode-label').textContent=`Editing: ${prob.title}`;
  buildPracticeSidebar();renderPmList();renderFolderList();
  const v=genAuthoredVariant(prob),wrap=document.getElementById('editor-preview-card');
  if(!v){wrap.textContent='Check formula.';return;}
  const attNote=maxAttempts>0?`<div style="font-size:10px;color:var(--warn);font-family:var(--mono);margin-top:4px">Max ${maxAttempts} attempt${maxAttempts!==1?'s':''}</div>`:'';
  wrap.innerHTML=`<div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r2);padding:10px;font-size:12px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <span style="font-family:var(--font-display);font-size:12px;color:var(--accent2)">${prob.title}</span>
      ${!prob.enabled?'<span class="pill pill-disabled">hidden</span>':'<span class="pill pill-green">visible</span>'}
    </div>
    ${prob.imgDataUrl?`<img src="${prob.imgDataUrl}" style="max-width:100%;max-height:80px;border-radius:4px;margin-bottom:6px;display:block"/>`:''}
    <p style="color:var(--text);line-height:1.6;margin-bottom:4px">${v.question}</p>
    <div style="font-family:var(--mono);font-size:10px;color:var(--text4)">Answer (hidden): ${v.answer!==null?v.answer+' '+prob.unit:'⚠ error'}</div>
    ${attNote}
  </div>`;
  alert(`"${prob.title}" saved!`);
}

function loadProbToForm(prob){
  window.S.editingId=prob.id;window.S.editorVars=prob.vars.map(v=>({...v}));window.S.editorImg=prob.imgDataUrl||null;window.S.formEnabled=prob.enabled!==false;
  document.getElementById('e-title').value=prob.title||'';
  document.getElementById('e-topic').value=prob.topic||'';
  document.getElementById('e-question').value=prob.question||'';
  document.getElementById('e-formula').value=prob.formula||'';
  document.getElementById('e-hint').value=prob.hint||'';
  document.getElementById('e-unit').value=prob.unit||'V';
  document.getElementById('e-tol').value=prob.tol||'2';
  document.getElementById('e-pts').value=prob.defaultPts||10;
  document.getElementById('e-max-attempts').value=prob.maxAttempts||0;
  document.getElementById('img-preview-wrap').innerHTML=prob.imgDataUrl?`<img src="${prob.imgDataUrl}" class="img-thumb" alt="Circuit"/>`:'';
  document.getElementById('form-mode-label').textContent=`Editing: ${prob.title}`;
  const track=document.getElementById('form-toggle-track');
  track.classList.toggle('on',window.S.formEnabled);
  document.getElementById('form-toggle-label').textContent=window.S.formEnabled?'Enabled':'Disabled';
  renderVarRows();renderVarInsertChips();previewFormula();
  showEdTab('problems',document.querySelector('.editor-top-tab'));
}

// ── Problem manager ───────────────────────────
let _dragSrcIdx=null;
function renderPmList(){
  const list=document.getElementById('pm-list'),empty=document.getElementById('pm-empty');
  const total=window.DB.problems.length,enabled=window.DB.problems.filter(p=>p.enabled!==false).length;
  document.getElementById('prob-count-badge').textContent=`(${total})`;
  document.getElementById('enabled-count').textContent=`${enabled} on · ${total-enabled} off`;
  list.innerHTML='';empty.style.display=total?'none':'block';
  window.DB.problems.forEach((p,i)=>{
    const isEnabled=p.enabled!==false,row=document.createElement('div');
    row.className=`pm-row${isEnabled?'':' disabled-row'}`;row.draggable=true;
    const maxAtt=p.maxAttempts||0;
    row.innerHTML=`<div class="pm-drag-handle"><i class="ti ti-grip-vertical"></i></div>
      <div class="pm-row-body">
        <div class="pm-row-title">${p.title}</div>
        <div class="pm-row-meta">${p.topic||'—'} · ${p.vars.length} vars · ${maxAtt>0?maxAtt+' attempts':'unlimited'}${!isEnabled?' · hidden':''}</div>
      </div>
      <div class="pm-row-actions">
        <div class="toggle-wrap" onclick="event.stopPropagation();quickToggleEnabled('${p.id}')"><div class="toggle-track ${isEnabled?'on':''}"><div class="toggle-thumb"></div></div></div>
        <button class="pm-icon-btn" onclick="event.stopPropagation();moveProb(${i},-1)" ${i===0?'disabled style="opacity:.3"':''}><i class="ti ti-chevron-up"></i></button>
        <button class="pm-icon-btn" onclick="event.stopPropagation();moveProb(${i},1)" ${i===window.DB.problems.length-1?'disabled style="opacity:.3"':''}><i class="ti ti-chevron-down"></i></button>
        <button class="pm-icon-btn" onclick="event.stopPropagation();duplicateProb(${i})"><i class="ti ti-copy"></i></button>
        <button class="pm-icon-btn del" onclick="event.stopPropagation();deleteProb('${p.id}')"><i class="ti ti-trash"></i></button>
      </div>`;
    row.onclick=()=>loadProbToForm(p);
    row.addEventListener('dragstart',e=>{_dragSrcIdx=i;row.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
    row.addEventListener('dragend',()=>{row.classList.remove('dragging');document.querySelectorAll('.pm-row').forEach(r=>r.classList.remove('drag-over'));});
    row.addEventListener('dragover',e=>{e.preventDefault();row.classList.add('drag-over');});
    row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));
    row.addEventListener('drop',e=>{e.preventDefault();row.classList.remove('drag-over');if(_dragSrcIdx===null||_dragSrcIdx===i)return;const m=window.DB.problems.splice(_dragSrcIdx,1)[0];window.DB.problems.splice(i,0,m);_dragSrcIdx=null;saveDB();renderPmList();});
    list.appendChild(row);
  });
}

async function quickToggleEnabled(id){
  const prob=window.DB.problems.find(p=>p.id===id);if(!prob)return;
  prob.enabled=!(prob.enabled===false);
  await saveDB();renderPmList();buildPracticeSidebar();renderFolderList();
  if(window.S.editingId===id){window.S.formEnabled=prob.enabled;const t=document.getElementById('form-toggle-track');if(t){t.classList.toggle('on',prob.enabled);document.getElementById('form-toggle-label').textContent=prob.enabled?'Enabled':'Disabled';}}
}

async function moveProb(i,d){const n=i+d;if(n<0||n>=window.DB.problems.length)return;[window.DB.problems[i],window.DB.problems[n]]=[window.DB.problems[n],window.DB.problems[i]];await saveDB();renderPmList();}

async function duplicateProb(i){
  const o=window.DB.problems[i];
  const c={...o,vars:o.vars.map(v=>({...v})),id:`prob-${Date.now()}`,title:`${o.title} (copy)`,enabled:o.enabled};
  window.DB.problems.splice(i+1,0,c);await saveDB();renderPmList();buildPracticeSidebar();
}

async function deleteProb(id){
  if(!confirm('Delete this problem?'))return;
  window.DB.problems=window.DB.problems.filter(p=>p.id!==id);
  window.DB.folders.forEach(f=>{f.problemIds=f.problemIds.filter(pid=>pid!==id);});
  await Promise.all([deleteFromDB('problems',id),saveDB()]);
  renderPmList();renderFolderList();buildPracticeSidebar();
}

// ── Folders ───────────────────────────────────
async function createFolder(){
  const name=document.getElementById('new-folder-name').value.trim();if(!name)return;
  window.DB.folders.push({id:`folder-${Date.now()}`,name,problemIds:[]});
  document.getElementById('new-folder-name').value='';
  await saveDB();renderFolderList();buildPracticeSidebar();
}
function renderFolderList(){
  const list=document.getElementById('folder-list'),empty=document.getElementById('folder-empty');
  list.innerHTML='';empty.style.display=window.DB.folders.length?'none':'block';
  window.DB.folders.forEach(f=>{
    const card=document.createElement('div');card.className='folder-card';
    card.innerHTML=`<div class="folder-head"><span class="folder-name"><i class="ti ti-folder" style="font-size:13px;margin-right:6px;color:var(--text3)"></i>${f.name}</span>
      <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${f.problemIds.length} problem${f.problemIds.length!==1?'s':''}</span>
      <button class="btn btn-sm btn-red" style="margin-left:10px" onclick="deleteFolder('${f.id}')"><i class="ti ti-trash"></i></button></div>
    <div style="padding:8px 14px;display:flex;flex-wrap:wrap;gap:6px">
      ${f.problemIds.map(pid=>{const p=window.DB.problems.find(pr=>pr.id===pid);if(!p)return'';const hidden=p.enabled===false;
        return `<span class="folder-prob-chip" style="${hidden?'opacity:.5':''}">${p.title}${hidden?' <span style="font-size:9px;color:var(--text4)">(hidden)</span>':''}
          <button onclick="removeProbFromFolder('${f.id}','${pid}')"><i class="ti ti-x"></i></button></span>`;}).join('')}
      ${!f.problemIds.length?'<span style="font-size:11px;color:var(--text4)">No problems yet.</span>':''}
    </div>
    <div class="add-to-folder-row"><select id="fp-sel-${f.id}"><option value="">— add a problem —</option>
      ${window.DB.problems.filter(p=>!f.problemIds.includes(p.id)).map(p=>`<option value="${p.id}">${p.title}${p.enabled===false?' (hidden)':''}</option>`).join('')}
    </select><button class="btn btn-sm btn-accent" onclick="addProbToFolder('${f.id}')"><i class="ti ti-plus"></i> Add</button></div>`;
    list.appendChild(card);
  });
}
async function addProbToFolder(folderId){const sel=document.getElementById(`fp-sel-${folderId}`);const pid=sel?.value;if(!pid)return;const folder=window.DB.folders.find(f=>f.id===folderId);if(!folder||folder.problemIds.includes(pid))return;folder.problemIds.push(pid);await saveDB();renderFolderList();buildPracticeSidebar();}
async function removeProbFromFolder(folderId,probId){const folder=window.DB.folders.find(f=>f.id===folderId);if(!folder)return;folder.problemIds=folder.problemIds.filter(pid=>pid!==probId);await saveDB();renderFolderList();buildPracticeSidebar();}
async function deleteFolder(id){if(!confirm('Delete this folder?'))return;window.DB.folders=window.DB.folders.filter(f=>f.id!==id);await Promise.all([deleteFromDB('folders',id),saveDB()]);renderFolderList();buildPracticeSidebar();}

// ── Assignments editor ────────────────────────
function renderAssignProbPicker(){
  const wrap=document.getElementById('assign-prob-picker');wrap.innerHTML='';
  if(!window.DB.problems.length){wrap.innerHTML='<div style="color:var(--text4);font-size:12px">No problems yet.</div>';return;}
  window.DB.problems.forEach(p=>{
    const row=document.createElement('div');row.className='assign-prob-picker-row';
    const existing=window.S.editingAssignId?window.DB.assignments.find(a=>a.id===window.S.editingAssignId)?.problems.find(ap=>ap.probId===p.id):null;
    row.innerHTML=`<label><input type="checkbox" id="apc-${p.id}" style="width:auto" ${existing?'checked':''}/>
      ${p.title} ${p.enabled===false?'<span class="pill pill-disabled" style="font-size:9px">hidden</span>':''}</label>
      <input class="assign-pts-input" type="number" id="appts-${p.id}" value="${existing?.points||p.defaultPts||10}" min="1" max="100"/>`;
    wrap.appendChild(row);
  });
}
function newAssignment(){window.S.editingAssignId=null;['as-title','as-instructions','as-open','as-due'].forEach(id=>document.getElementById(id).value='');renderAssignProbPicker();}
async function saveAssignment(){
  const title=document.getElementById('as-title').value.trim();if(!title){alert('Enter a title.');return;}
  const problems=window.DB.problems.filter(p=>document.getElementById(`apc-${p.id}`)?.checked).map(p=>({probId:p.id,points:parseInt(document.getElementById(`appts-${p.id}`)?.value)||10}));
  const assign={id:window.S.editingAssignId||`assign-${Date.now()}`,title,instructions:document.getElementById('as-instructions').value,
    opens:document.getElementById('as-open').value,due:document.getElementById('as-due').value,problems};
  const idx=window.DB.assignments.findIndex(a=>a.id===assign.id);if(idx>=0)window.DB.assignments[idx]=assign;else window.DB.assignments.push(assign);
  window.S.editingAssignId=assign.id;await saveDB();renderAssignAdmin();
  const ok=document.getElementById('as-ok');ok.textContent='Saved!';ok.classList.remove('hidden');setTimeout(()=>ok.classList.add('hidden'),2000);
}
function renderAssignAdmin(){
  const list=document.getElementById('assign-admin-list'),empty=document.getElementById('assign-admin-empty');
  list.innerHTML='';empty.style.display=window.DB.assignments.length?'none':'block';
  window.DB.assignments.forEach(a=>{
    const item=document.createElement('div');item.style.cssText='background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r2);padding:10px;margin-bottom:8px';
    item.innerHTML=`<div style="font-family:var(--font-display);font-size:12px;color:var(--accent2);margin-bottom:4px">${a.title}</div>
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:8px">Due: ${a.due?new Date(a.due).toLocaleString():'—'} · ${a.problems.length} problems</div>
      <div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="loadAssignToEditor('${a.id}')"><i class="ti ti-edit"></i> Edit</button>
      <button class="btn btn-sm btn-red" onclick="deleteAssignment('${a.id}')"><i class="ti ti-trash"></i></button></div>`;
    list.appendChild(item);
  });
}
function loadAssignToEditor(id){
  const a=window.DB.assignments.find(a=>a.id===id);if(!a)return;window.S.editingAssignId=id;
  document.getElementById('as-title').value=a.title||'';document.getElementById('as-instructions').value=a.instructions||'';
  document.getElementById('as-open').value=a.opens||'';document.getElementById('as-due').value=a.due||'';
  renderAssignProbPicker();a.problems.forEach(ap=>{const cb=document.getElementById(`apc-${ap.probId}`);if(cb)cb.checked=true;const pts=document.getElementById(`appts-${ap.probId}`);if(pts)pts.value=ap.points;});
}
async function deleteAssignment(id){
  if(!confirm('Delete this assignment?'))return;
  window.DB.assignments=window.DB.assignments.filter(a=>a.id!==id);
  await Promise.all([deleteFromDB('assignments',id),saveDB()]);
  renderAssignAdmin();
}

// ══════════════════════════════════════════════
// TOPIC LABEL MANAGER
// ══════════════════════════════════════════════

function renderTopicManager() {
  const list  = document.getElementById('topic-label-list');
  const empty = document.getElementById('topic-label-empty');
  if (!list) return;
  list.innerHTML = '';
  const topics = window.DB.topics || [];
  empty.style.display = topics.length ? 'none' : 'block';

  topics.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'topic-label-row';
    row.innerHTML = `
      <span class="topic-label-chip">${t.name}</span>
      <span style="font-size:10px;color:var(--text4);font-family:var(--mono)">${countProblemsWithTopic(t.name)} problem${countProblemsWithTopic(t.name)!==1?'s':''}</span>
      <button class="pm-icon-btn del" onclick="deleteTopic('${t.id}')" title="Remove label"><i class="ti ti-trash"></i></button>`;
    list.appendChild(row);
  });

  // Also rebuild the topic dropdown in the problem form
  rebuildTopicDropdown();
}

function countProblemsWithTopic(name) {
  return window.DB.problems.filter(p => p.topic === name).length;
}

async function addTopic() {
  const input = document.getElementById('new-topic-input');
  const name  = input?.value.trim();
  if (!name) return;
  if (window.DB.topics.find(t => t.name.toLowerCase() === name.toLowerCase())) {
    alert(`"${name}" already exists.`);
    return;
  }
  window.DB.topics.push({ id: `topic-${Date.now()}`, name });
  if (input) input.value = '';
  await saveDB();
  renderTopicManager();
}

async function deleteTopic(id) {
  const t = window.DB.topics.find(t => t.id === id);
  if (!t) return;
  const count = countProblemsWithTopic(t.name);
  const msg   = count > 0
    ? `Delete label "${t.name}"? It's used by ${count} problem${count!==1?'s':''} (those problems will keep the tag as plain text).`
    : `Delete label "${t.name}"?`;
  if (!confirm(msg)) return;
  await deleteFromDB('topics', id);
  window.DB.topics = window.DB.topics.filter(t => t.id !== id);
  renderTopicManager();
}

// Rebuild the topic <select> in the problem form using the master list
function rebuildTopicDropdown() {
  const sel = document.getElementById('e-topic-select');
  if (!sel) return;
  const current = document.getElementById('e-topic')?.value || '';
  sel.innerHTML = '<option value="">— select a topic —</option>' +
    window.DB.topics.map(t => `<option value="${t.name}" ${t.name===current?'selected':''}>${t.name}</option>`).join('');
}

// Sync the hidden text input when dropdown changes
function onTopicSelectChange(val) {
  const inp = document.getElementById('e-topic');
  if (inp) inp.value = val;
}
