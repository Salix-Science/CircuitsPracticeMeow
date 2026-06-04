/* editor.js — Problem editor, folders, assignments
   - Multiple solution boxes per problem (each has label, formula, unit, tolerance)
   - Topic dropdown populated on form load, not just on tab switch
   - "New problem" button clears and focuses the form
*/

// ── Enable toggle ─────────────────────────────
window.toggleFormEnable = function toggleFormEnable(){
  window.S.formEnabled=!window.S.formEnabled;
  const t=document.getElementById('form-toggle-track'),l=document.getElementById('form-toggle-label');
  t.classList.toggle('on',window.S.formEnabled);
  l.textContent=window.S.formEnabled?'Enabled':'Disabled';
}

// ── Reset / New problem ───────────────────────
window.resetForm = function resetForm(){
  window.S.editingId=null;
  window.S.editorVars=[];
  window.S.editorImg=null;
  window.S.formEnabled=true;
  window.S.editorAnswers=[{id:`ans-${Date.now()}`,label:'Answer',formula:'',unit:'V',tol:'2'}];
  window.S.editorAnswerMode='boxes';
  window.S.editorTable=defaultTable();
  ['e-title','e-topic','e-question','e-hint'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const topicSel=document.getElementById('e-topic-select');
  if(topicSel) topicSel.value='';
  document.getElementById('e-pts').value='10';
  document.getElementById('e-max-attempts').value='0';
  document.getElementById('var-rows').innerHTML='';
  document.getElementById('img-preview-wrap').innerHTML='';
  document.getElementById('editor-preview-card').textContent='Save to preview.';
  document.getElementById('form-mode-label').textContent='New problem';
  document.getElementById('form-toggle-track').classList.add('on');
  document.getElementById('form-toggle-label').textContent='Enabled';
  renderVarInsertChips();
  renderAnswerBoxes();
  applyAnswerMode();
  rebuildTopicDropdown(); // ← always rebuild on form reset so dropdown is current
  document.getElementById('e-title')?.focus();
}

// ── Variable rows ─────────────────────────────
const TYPE_DEFAULT_UNITS={R:'kΩ',V:'V',I:'mA',C:'μF'};
const TYPE_UNIT_OPTIONS={
  R:['Ω','kΩ','MΩ'],
  V:['mV','V','kV'],
  I:['μA','mA','A'],
  C:['pF','nF','μF','mH','H'],
};

window.addVar = function addVar(type){
  const names={R:`R${window.S.editorVars.filter(v=>v.type==='R').length+1}`,V:'Vs',I:'Is',C:'C1'};
  const mins={R:'1',V:'5',I:'1',C:'1'};
  const maxs={R:'10',V:'24',I:'10',C:'100'};
  window.S.editorVars.push({
    id:nextVarId(),name:names[type]||'X',type,
    min:mins[type],max:maxs[type],unit:TYPE_DEFAULT_UNITS[type]||''
  });
  renderVarRows();renderVarInsertChips();
}

window.renderVarRows = function renderVarRows(){
  const wrap=document.getElementById('var-rows');wrap.innerHTML='';
  window.S.editorVars.forEach((v,i)=>{
    const unitOptions=(TYPE_UNIT_OPTIONS[v.type]||[v.unit||'']).map(u=>
      `<option value="${u}" ${u===v.unit?'selected':''}>${u}</option>`).join('');
    const row=document.createElement('div');
    row.style.cssText='display:grid;grid-template-columns:80px 56px 62px 62px 70px 24px;gap:6px;align-items:end;margin-bottom:6px';
    row.innerHTML=`
      <div><label>Name</label>
        <input type="text" value="${v.name}" style="padding:6px 8px;font-size:12px"
          oninput="window.S.editorVars[${i}].name=this.value;renderVarInsertChips();previewAllFormulas()"/></div>
      <div><label>Type</label>
        <input type="text" value="${v.type}" readonly style="padding:6px 8px;font-size:12px;color:var(--text4)"/></div>
      <div><label>Min</label>
        <input type="number" value="${v.min}" style="padding:6px 8px;font-size:12px"
          oninput="window.S.editorVars[${i}].min=this.value"/></div>
      <div><label>Max</label>
        <input type="number" value="${v.max}" style="padding:6px 8px;font-size:12px"
          oninput="window.S.editorVars[${i}].max=this.value"/></div>
      <div><label>Display unit</label>
        <select style="padding:6px 8px;font-size:12px"
          onchange="window.S.editorVars[${i}].unit=this.value;previewAllFormulas()">
          ${unitOptions}
        </select></div>
      <button class="remove-var"
        onclick="window.S.editorVars.splice(${i},1);renderVarRows();renderVarInsertChips();previewAllFormulas()">
        <i class="ti ti-x"></i></button>`;
    wrap.appendChild(row);
  });
}

window.renderVarInsertChips = function renderVarInsertChips(){
  const wrap=document.getElementById('var-insert-chips');if(!wrap)return;
  wrap.innerHTML='';
  window.S.editorVars.forEach(v=>{
    const btn=document.createElement('button');btn.className='var-chip-btn';
    btn.textContent=`{${v.name}}`;
    btn.title=`Inserts as value + ${v.unit||''} · e.g. "4.7 ${v.unit||''}"`;
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

// ── Answer boxes ──────────────────────────────
// S.editorAnswers = [{ id, label, formula, unit, tol }, ...]
if(!window.S.editorAnswers) window.S.editorAnswers=[
  {id:`ans-${Date.now()}`,label:'Answer',formula:'',unit:'V',tol:'2'}
];
if(!window.S.editorAnswerMode) window.S.editorAnswerMode='boxes';
if(!window.S.editorTable) window.S.editorTable=(typeof defaultTable==='function'?defaultTable():null);

const ANSWER_UNITS=['V','mV','kV','A','mA','μA','Ω','kΩ','MΩ','W','kW','F','μF','nF','H','mH'];

// Build the shared <datalist> of unit suggestions: presets + any custom
// units already used across saved problems (so your own units come back).
window.rebuildUnitDatalist = function rebuildUnitDatalist(){
  const dl=document.getElementById('answer-units-datalist'); if(!dl) return;
  const used=new Set(ANSWER_UNITS);
  (window.DB?.problems||[]).forEach(p=>{
    (p.answers||[]).forEach(a=>{ if(a.unit) used.add(a.unit); });
    (p.table?.rows||[]).forEach(r=>{ if(r.unit) used.add(r.unit); });
  });
  dl.innerHTML=[...used].map(u=>`<option value="${u}"></option>`).join('');
}

window.renderAnswerBoxes = function renderAnswerBoxes(){
  const wrap=document.getElementById('answer-boxes-wrap');if(!wrap)return;
  rebuildUnitDatalist();
  wrap.innerHTML='';
  window.S.editorAnswers.forEach((ans,i)=>{
    const box=document.createElement('div');
    box.className='answer-box';
    box.innerHTML=`
      <div class="answer-box-head">
        <input type="text" class="answer-box-label-input" value="${ans.label}"
          placeholder="e.g. Find Vout"
          oninput="window.S.editorAnswers[${i}].label=this.value"
          style="flex:1;padding:5px 8px;font-size:12px;font-weight:600"/>
        ${window.S.editorAnswers.length>1
          ? `<button class="pm-icon-btn del" onclick="removeAnswerBox(${i})" title="Remove"><i class="ti ti-trash"></i></button>`
          : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 80px 80px;gap:8px;margin-top:8px">
        <div>
          <label>Formula (JS · bare var names)</label>
          <input type="text" value="${ans.formula}" placeholder="e.g. Vs*R2/(R1+R2)"
            style="padding:6px 8px;font-size:12px"
            oninput="window.S.editorAnswers[${i}].formula=this.value;previewAllFormulas()"/>
        </div>
        <div>
          <label>Unit</label>
          <input type="text" list="answer-units-datalist" value="${ans.unit}"
            placeholder="e.g. V" style="padding:6px 8px;font-size:12px"
            oninput="window.S.editorAnswers[${i}].unit=this.value"/>
        </div>
        <div>
          <label>Tolerance %</label>
          <input type="number" value="${ans.tol}" min="0.1" max="20" step="0.1"
            style="padding:6px 8px;font-size:12px"
            oninput="window.S.editorAnswers[${i}].tol=this.value"/>
        </div>
      </div>
      <div class="formula-preview" id="formula-preview-${i}" style="margin-top:6px">Formula preview</div>`;
    wrap.appendChild(box);
  });
  previewAllFormulas();
}

window.addAnswerBox = function addAnswerBox(){
  window.S.editorAnswers.push({
    id:`ans-${Date.now()}`,label:`Part ${String.fromCharCode(64+window.S.editorAnswers.length+1)}`,
    formula:'',unit:'V',tol:'2'
  });
  renderAnswerBoxes();
}

window.removeAnswerBox = function removeAnswerBox(i){
  if(window.S.editorAnswers.length<=1)return;
  window.S.editorAnswers.splice(i,1);
  renderAnswerBoxes();
}

window.previewAllFormulas = function previewAllFormulas(){
  const vals={};
  window.S.editorVars.forEach(v=>{vals[v.name]=(parseFloat(v.min)+parseFloat(v.max))/2;});
  window.S.editorAnswers.forEach((ans,i)=>{
    const prev=document.getElementById(`formula-preview-${i}`);if(!prev)return;
    if(!ans.formula.trim()){prev.textContent='Formula preview';return;}
    try{
      const fn=new Function(...Object.keys(vals),`return (${ans.formula})`);
      const res=fn(...Object.values(vals));
      const varStr=window.S.editorVars.map(v=>`${v.name}=${vals[v.name]} ${v.unit||''}`).join(', ')||'no vars';
      prev.textContent=`Preview: ${varStr} → ${rnd(res,4)} ${ans.unit}`;
    }catch(e){prev.textContent=`⚠ ${e.message}`;}
  });
}

// Keep old previewFormula name so nothing breaks
window.previewFormula = function previewFormula(){ previewAllFormulas(); }

// ── Answer mode (boxes vs table) ──────────────
window.defaultTable = function defaultTable(){
  return {
    corner:'',
    tol:'2',
    cols:[{label:'t = 0⁻'},{label:'t = 0⁺'},{label:'t = ∞'}],
    rows:[
      {label:'I',     unit:'A', cells:['','','']},
      {label:'V_C1',  unit:'V', cells:['','','']},
      {label:'V_C2',  unit:'V', cells:['','','']},
    ],
  };
}

// Show/hide the right builder + sync the segmented control
window.applyAnswerMode = function applyAnswerMode(){
  const mode=window.S.editorAnswerMode||'boxes';
  const boxesWrap=document.getElementById('answer-mode-boxes');
  const tableWrap=document.getElementById('answer-mode-table');
  if(boxesWrap) boxesWrap.style.display = mode==='boxes' ? '' : 'none';
  if(tableWrap) tableWrap.style.display = mode==='table' ? '' : 'none';
  document.querySelectorAll('.answer-mode-tab').forEach(b=>
    b.classList.toggle('active', b.dataset.mode===mode));
  // Always (re)render the active panel so it never shows empty
  if(mode==='table') renderAnswerTable(); else renderAnswerBoxes();
}

window.setAnswerMode = function setAnswerMode(mode){
  window.S.editorAnswerMode=mode;
  if(mode==='table' && !window.S.editorTable) window.S.editorTable=defaultTable();
  applyAnswerMode();
}

// Render the table builder grid into #answer-table-builder
window.renderAnswerTable = function renderAnswerTable(){
  const wrap=document.getElementById('answer-table-builder'); if(!wrap)return;
  rebuildUnitDatalist();
  const t=window.S.editorTable; if(!t){wrap.innerHTML='';return;}

  // Header: corner + column-label inputs + remove-col buttons + Unit
  const colHead=t.cols.map((c,ci)=>`
    <th style="padding:4px">
      <input type="text" value="${escAttr(c.label)}" placeholder="Column ${ci+1}"
        style="width:100%;min-width:90px;padding:5px 7px;font-size:11px;font-weight:600;text-align:center"
        oninput="window.S.editorTable.cols[${ci}].label=this.value"/>
      ${t.cols.length>1?`<button class="pm-icon-btn del" style="margin-top:3px" title="Remove column"
        onclick="removeTableCol(${ci})"><i class="ti ti-x"></i></button>`:''}
    </th>`).join('');

  const bodyRows=t.rows.map((row,ri)=>{
    const cells=t.cols.map((c,ci)=>`
      <td style="padding:4px">
        <input type="text" value="${escAttr((row.cells&&row.cells[ci])||'')}" placeholder="formula"
          class="mono" style="width:100%;min-width:90px;padding:5px 7px;font-size:11px"
          oninput="setTableCell(${ri},${ci},this.value)"/>
      </td>`).join('');
    return `<tr>
      <th style="padding:4px">
        <input type="text" value="${escAttr(row.label)}" placeholder="Row ${ri+1}"
          style="width:74px;padding:5px 7px;font-size:11px;font-weight:600"
          oninput="window.S.editorTable.rows[${ri}].label=this.value"/>
      </th>
      ${cells}
      <td style="padding:4px">
        <input type="text" list="answer-units-datalist" value="${escAttr(row.unit)}" placeholder="unit"
          style="width:60px;padding:5px 7px;font-size:11px"
          oninput="window.S.editorTable.rows[${ri}].unit=this.value;previewTable()"/>
      </td>
      <td style="padding:4px;width:24px">
        ${t.rows.length>1?`<button class="pm-icon-btn del" title="Remove row"
          onclick="removeTableRow(${ri})"><i class="ti ti-trash"></i></button>`:''}
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML=`
    <div class="field" style="display:flex;gap:8px;align-items:end;margin-bottom:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px;margin:0">
        <label>Corner label (top-left, optional)</label>
        <input type="text" value="${escAttr(t.corner)}" placeholder="(blank)"
          style="padding:6px 8px;font-size:12px"
          oninput="window.S.editorTable.corner=this.value"/>
      </div>
      <div style="width:130px;margin:0">
        <label>Tolerance % (all cells)</label>
        <input type="number" value="${escAttr(t.tol)}" min="0.1" max="20" step="0.1"
          style="padding:6px 8px;font-size:12px"
          oninput="window.S.editorTable.tol=this.value;previewTable()"/>
      </div>
    </div>
    <div style="overflow-x:auto">
      <table class="answer-table-builder">
        <thead><tr><th style="padding:4px"></th>${colHead}<th style="padding:4px">Unit</th><th></th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="add-var-btn" onclick="addTableRow()"><i class="ti ti-plus" style="font-size:11px"></i> Add row</button>
      <button class="add-var-btn" onclick="addTableCol()"><i class="ti ti-plus" style="font-size:11px"></i> Add column</button>
    </div>
    <p style="font-size:11px;color:var(--text3);margin-top:8px;line-height:1.6">
      Each cell is a formula using bare variable names. The Unit column applies to every cell in its row.
    </p>
    <div class="formula-preview" id="table-preview" style="margin-top:8px">Table preview</div>`;
  previewTable();
}

window.setTableCell = function setTableCell(ri,ci,val){
  const row=window.S.editorTable.rows[ri]; if(!row)return;
  if(!row.cells) row.cells=[];
  row.cells[ci]=val;
  previewTable();
}
window.addTableRow = function addTableRow(){
  const t=window.S.editorTable;
  t.rows.push({label:`Row ${t.rows.length+1}`,unit:'',cells:t.cols.map(()=> '')});
  renderAnswerTable();
}
window.removeTableRow = function removeTableRow(ri){
  const t=window.S.editorTable; if(t.rows.length<=1)return;
  t.rows.splice(ri,1); renderAnswerTable();
}
window.addTableCol = function addTableCol(){
  const t=window.S.editorTable;
  t.cols.push({label:`Column ${t.cols.length+1}`});
  t.rows.forEach(r=>{ if(!r.cells)r.cells=[]; r.cells.push(''); });
  renderAnswerTable();
}
window.removeTableCol = function removeTableCol(ci){
  const t=window.S.editorTable; if(t.cols.length<=1)return;
  t.cols.splice(ci,1);
  t.rows.forEach(r=>{ if(r.cells) r.cells.splice(ci,1); });
  renderAnswerTable();
}

// Live preview: evaluate every cell at the midpoint of each variable
window.previewTable = function previewTable(){
  const prev=document.getElementById('table-preview'); if(!prev)return;
  const t=window.S.editorTable; if(!t){prev.textContent='Table preview';return;}
  const vals={};
  window.S.editorVars.forEach(v=>{vals[v.name]=(parseFloat(v.min)+parseFloat(v.max))/2;});
  let ok=0,err=0,empty=0;
  t.rows.forEach(row=>{
    t.cols.forEach((c,ci)=>{
      const f=(row.cells&&row.cells[ci])||'';
      if(!f.trim()){empty++;return;}
      try{ new Function(...Object.keys(vals),`return (${f})`)(...Object.values(vals)); ok++; }
      catch(e){ err++; }
    });
  });
  const total=t.rows.length*t.cols.length;
  prev.textContent=`Preview: ${t.rows.length}×${t.cols.length} grid · ${ok}/${total} formulas OK`
    +(empty?` · ${empty} empty`:'')+(err?` · ⚠ ${err} error${err!==1?'s':''}`:'');
}

// Small attribute-escaper for values rendered into HTML attributes
window.escAttr = function escAttr(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Image ─────────────────────────────────────
window.handleImg = function handleImg(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    window.S.editorImg=ev.target.result;
    document.getElementById('img-preview-wrap').innerHTML=
      `<img src="${ev.target.result}" class="img-thumb" alt="Circuit"/>`;
  };
  reader.readAsDataURL(file);
}
window.clearImg = function clearImg(){window.S.editorImg=null;document.getElementById('img-preview-wrap').innerHTML='';}

// ── Save problem ──────────────────────────────
window.saveProblem = async function saveProblem(){
  if(!window.S.isAdmin){console.warn("[security] saveProblem blocked");return;}
  const title=document.getElementById('e-title').value.trim();
  const question=document.getElementById('e-question').value.trim();
  if(!title||!question){alert('Title and Question are required.');return;}

  const mode=window.S.editorAnswerMode||'boxes';
  const answers=window.S.editorAnswers;
  const table=window.S.editorTable;

  if(mode==='table'){
    if(!table||!table.rows.length||!table.cols.length){alert('Add at least one row and column to the table.');return;}
    const hasAny=table.rows.some(r=>(r.cells||[]).some(f=>f&&f.trim()));
    if(!hasAny){alert('Fill in at least one cell formula in the table.');return;}
    // Validate every non-empty cell parses
    const vals={}; window.S.editorVars.forEach(v=>{vals[v.name]=(parseFloat(v.min)+parseFloat(v.max))/2;});
    for(const row of table.rows){
      for(let ci=0;ci<table.cols.length;ci++){
        const f=(row.cells&&row.cells[ci])||'';
        if(!f.trim()) continue;
        try{ new Function(...Object.keys(vals),`return (${f})`)(...Object.values(vals)); }
        catch(e){ alert(`Cell "${row.label||''} · ${table.cols[ci].label||''}" has an invalid formula:\n${e.message}`); return; }
      }
    }
  } else {
    if(!answers.length||!answers[0].formula.trim()){alert('At least one answer formula is required.');return;}
    const badFormulas=answers.filter(a=>!a.formula.trim());
    if(badFormulas.length){alert(`Answer box "${badFormulas[0].label}" has no formula.`);return;}
  }

  const maxAttempts=parseInt(document.getElementById('e-max-attempts').value)||0;
  // First gradable answer (for legacy single-answer compatibility)
  const firstDef=(window.expandProblemAnswers
    ? window.expandProblemAnswers({answerMode:mode,table,answers}).answerDefs[0]
    : answers[0]) || {formula:'',unit:'',tol:'2'};
  const prob={
    id:window.S.editingId||`prob-${Date.now()}`,
    title,
    topic:document.getElementById('e-topic').value.trim(),
    question,
    answerMode:mode,
    answers:answers.map(a=>({...a})),   // array of answer boxes (boxes mode)
    table: mode==='table'
      ? {corner:table.corner||'',tol:table.tol||'2',
         cols:table.cols.map(c=>({label:c.label||''})),
         rows:table.rows.map(r=>({label:r.label||'',unit:r.unit||'',cells:(r.cells||[]).slice()}))}
      : null,
    // Legacy single-answer fields kept for compatibility with old problems
    formula:firstDef.formula,
    unit:firstDef.unit,
    tol:firstDef.tol,
    vars:window.S.editorVars.map(v=>({...v})),
    defaultPts:parseInt(document.getElementById('e-pts').value)||10,
    maxAttempts,
    hint:document.getElementById('e-hint').value,
    imgDataUrl:window.S.editorImg||null,
    enabled:window.S.formEnabled,
  };
  const idx=window.DB.problems.findIndex(p=>p.id===prob.id);
  const isNew=idx<0;
  if(idx>=0)window.DB.problems[idx]=prob;else window.DB.problems.push(prob);
  window.S.editingId=prob.id;
  document.getElementById('form-mode-label').textContent='Saving…';
  await saveDB();
  document.getElementById('form-mode-label').textContent=`Editing: ${prob.title}`;
  logAdminAction(isNew ? 'create_problem' : 'edit_problem', { id: prob.id, title: prob.title, topic: prob.topic, enabled: prob.enabled, answerMode: prob.answerMode, answerCount: (window.expandProblemAnswers(prob).answerDefs||[]).length });
  buildPracticeSidebar();renderPmList();renderFolderList();

  // Preview
  const v=genAuthoredVariant(prob);
  const wrap=document.getElementById('editor-preview-card');
  if(!v){wrap.textContent='Check formula.';return;}
  const attNote=maxAttempts>0
    ?`<div style="font-size:10px;color:var(--warn);font-family:var(--mono);margin-top:4px">Max ${maxAttempts} attempt${maxAttempts!==1?'s':''}</div>`:'';
  let answerRows;
  if(v.table){
    // Show the computed solution grid (read-only, values filled in)
    const t=v.table;
    const head=`<tr><th class="at-corner"></th>${
      t.cols.map(c=>`<th>${escHtml(c.label||'')}</th>`).join('')
    }<th class="at-unit-h">Unit</th></tr>`;
    const body=t.rows.map((row,r)=>{
      const cells=t.cols.map((col,c)=>{
        const ai=t.cellIndex[r][c];
        const val=v.answers[ai]?.answer;
        return `<td style="font-family:var(--mono);font-size:11px;color:${val!=null?'var(--text)':'var(--red)'}">${val!=null?val:'⚠'}</td>`;
      }).join('');
      return `<tr><th class="at-rowlabel">${escHtml(row.label||'')}</th>${cells}<td class="at-unit">${escHtml(row.unit||'')}</td></tr>`;
    }).join('');
    answerRows=`<div class="answer-table-wrap" style="margin-top:4px"><table class="answer-table">
      <thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  } else {
    answerRows=v.answers.map(a=>
      `<div style="font-family:var(--mono);font-size:10px;color:var(--text4)">${a.label}: ${a.answer!==null?a.answer+' '+a.unit:'⚠ error'}</div>`
    ).join('');
  }
  wrap.innerHTML=`<div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r2);padding:10px;font-size:12px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <span style="font-family:var(--font-display);font-size:12px;color:var(--accent2)">${prob.title}</span>
      ${!prob.enabled?'<span class="pill pill-disabled">hidden</span>':'<span class="pill pill-green">visible</span>'}
    </div>
    ${prob.imgDataUrl?`<img src="${prob.imgDataUrl}" style="max-width:100%;max-height:80px;border-radius:4px;margin-bottom:6px;display:block"/>`:''}
    <p style="color:var(--text);line-height:1.6;margin-bottom:6px">${v.question}</p>
    ${answerRows}
    ${attNote}
  </div>`;
  alert(`"${prob.title}" saved!`);
}

// ── Load problem into form ────────────────────
window.loadProbToForm = function loadProbToForm(prob){
  window.S.editingId=prob.id;
  window.S.editorVars=prob.vars.map(v=>({...v}));
  window.S.editorImg=prob.imgDataUrl||null;
  window.S.formEnabled=prob.enabled!==false;

  // Load answers — support old single-formula problems
  if(prob.answers&&prob.answers.length){
    window.S.editorAnswers=prob.answers.map(a=>({...a}));
  } else {
    window.S.editorAnswers=[{
      id:`ans-${Date.now()}`,label:'Answer',
      formula:prob.formula||'',unit:prob.unit||'V',tol:prob.tol||'2'
    }];
  }

  // Load answer mode + table
  window.S.editorAnswerMode = prob.answerMode==='table' ? 'table' : 'boxes';
  window.S.editorTable = (prob.table && prob.table.rows && prob.table.cols)
    ? {corner:prob.table.corner||'',tol:prob.table.tol||'2',
       cols:prob.table.cols.map(c=>({label:c.label||''})),
       rows:prob.table.rows.map(r=>({label:r.label||'',unit:r.unit||'',cells:(r.cells||[]).slice()}))}
    : defaultTable();

  document.getElementById('e-title').value=prob.title||'';
  document.getElementById('e-question').value=prob.question||'';
  document.getElementById('e-hint').value=prob.hint||'';
  document.getElementById('e-pts').value=prob.defaultPts||10;
  document.getElementById('e-max-attempts').value=prob.maxAttempts||0;
  document.getElementById('img-preview-wrap').innerHTML=prob.imgDataUrl
    ?`<img src="${prob.imgDataUrl}" class="img-thumb" alt="Circuit"/>` :'';
  document.getElementById('form-mode-label').textContent=`Editing: ${prob.title}`;

  const track=document.getElementById('form-toggle-track');
  track.classList.toggle('on',window.S.formEnabled);
  document.getElementById('form-toggle-label').textContent=window.S.formEnabled?'Enabled':'Disabled';

  // Rebuild topic dropdown first, then set value
  rebuildTopicDropdown();
  const topicSel=document.getElementById('e-topic-select');
  if(topicSel) topicSel.value=prob.topic||'';
  const topicInp=document.getElementById('e-topic');
  if(topicInp) topicInp.value=prob.topic||'';

  renderVarRows();renderVarInsertChips();renderAnswerBoxes();
  applyAnswerMode();
  showEdTab('problems',document.querySelector('.editor-top-tab'));
}

// ── Problem manager (right panel) ─────────────
let _dragSrcIdx=null;
window.renderPmList = function renderPmList(){
  try {
  const list    = document.getElementById('pm-list');
  const empty   = document.getElementById('pm-empty');
  const noMatch = document.getElementById('pm-no-match');
  const total   = window.DB.problems.length;
  const enabled = window.DB.problems.filter(p=>p.enabled!==false).length;

  document.getElementById('prob-count-badge').textContent = `(${total})`;
  document.getElementById('enabled-count').textContent    = `${enabled} on · ${total-enabled} off`;

  // Populate tag filter dropdown (keep current selection)
  const tagSel     = document.getElementById('pm-tag-filter');
  const currentTag = tagSel?.value || '';
  if (tagSel) {
    const tags = [...new Set(window.DB.problems.map(p=>p.topic).filter(Boolean))].sort();
    tagSel.innerHTML = '<option value="">All topics</option>' +
      tags.map(t=>`<option value="${t}" ${t===currentTag?'selected':''}>${t}</option>`).join('');
  }

  // Read filter values
  const search = (document.getElementById('pm-search')?.value || '').toLowerCase().trim();
  const tag    = tagSel?.value || '';

  // Filter
  const filtered = window.DB.problems
    .map((p,i) => ({p,i}))
    .filter(({p}) => {
      const matchSearch = !search || p.title.toLowerCase().includes(search);
      const matchTag    = !tag    || p.topic === tag;
      return matchSearch && matchTag;
    });

  list.innerHTML  = '';
  empty.style.display    = total   ? 'none' : 'block';
  noMatch.classList.toggle('hidden', !(total && !filtered.length));
  list.style.display     = filtered.length ? '' : 'none';

  filtered.forEach(({p, i}) => {
    const isEnabled = p.enabled !== false;
    const row       = document.createElement('div');
    row.className   = `pm-row${isEnabled ? '' : ' disabled-row'}`;
    row.draggable   = true;
    const maxAtt    = p.maxAttempts || 0;
    const ansCount  = (p.answers || [p]).length;

    // Compute average difficulty from all users
    const avgDiff = typeof computeAvgDifficulty === 'function' ? computeAvgDifficulty(p.id) : null;
    const diffStr = avgDiff ? ' · ' + '★'.repeat(Math.round(avgDiff)) + '☆'.repeat(5-Math.round(avgDiff)) + ' ' + avgDiff.toFixed(1) : '';
    row.innerHTML = `
      <div class="pm-drag-handle"><i class="ti ti-grip-vertical"></i></div>
      <div class="pm-row-body">
        <div class="pm-row-title">${escHtml(p.title)}</div>
        <div class="pm-row-meta">${p.topic||'—'} · ${p.vars.length} vars · ${ansCount} answer${ansCount!==1?'s':''} · ${maxAtt>0?maxAtt+' att.':'unlimited'}${!isEnabled?' · hidden':''}${diffStr}</div>
      </div>
      <div class="pm-row-actions">
        <div class="toggle-wrap" onclick="event.stopPropagation();quickToggleEnabled('${p.id}')">
          <div class="toggle-track ${isEnabled?'on':''}"><div class="toggle-thumb"></div></div>
        </div>
        <button class="pm-icon-btn" onclick="event.stopPropagation();moveProb(${i},-1)" ${i===0?'disabled style="opacity:.3"':''}><i class="ti ti-chevron-up"></i></button>
        <button class="pm-icon-btn" onclick="event.stopPropagation();moveProb(${i},1)"  ${i===window.DB.problems.length-1?'disabled style="opacity:.3"':''}><i class="ti ti-chevron-down"></i></button>
        <button class="pm-icon-btn" onclick="event.stopPropagation();duplicateProb(${i})"><i class="ti ti-copy"></i></button>
        <button class="pm-icon-btn del" onclick="event.stopPropagation();deleteProb('${p.id}')"><i class="ti ti-trash"></i></button>
      </div>`;

    row.onclick = () => loadProbToForm(p);
    row.addEventListener('dragstart', e => { _dragSrcIdx=i; row.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
    row.addEventListener('dragend',   () => { row.classList.remove('dragging'); document.querySelectorAll('.pm-row').forEach(r=>r.classList.remove('drag-over')); });
    row.addEventListener('dragover',  e => { e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', async e => {
      e.preventDefault(); row.classList.remove('drag-over');
      if (_dragSrcIdx===null || _dragSrcIdx===i) return;
      const m = window.DB.problems.splice(_dragSrcIdx,1)[0];
      window.DB.problems.splice(i,0,m);
      _dragSrcIdx = null;
      await saveDB(); renderPmList();
    });
    list.appendChild(row);
  });
  } catch(e) {
    console.error('renderPmList crashed:', e);
    const list = document.getElementById('pm-list');
    if (list) list.innerHTML = `<div style="color:var(--red);font-size:12px;padding:1rem;font-family:monospace">Error loading problems: ${e.message}</div>`;
  }
}

// ── Expand / collapse problem bank panel ──────
let _pmExpanded = false;
window.togglePmExpand = function togglePmExpand() {
  _pmExpanded = !_pmExpanded;
  const panel  = document.getElementById('editor-side-panel');
  const grid   = panel?.closest('.editor-two');
  const btn    = document.getElementById('pm-expand-btn');
  if (grid) {
    grid.style.gridTemplateColumns = _pmExpanded ? '1fr 520px' : '1fr 290px';
  }
  if (btn) {
    btn.innerHTML = _pmExpanded
      ? '<i class="ti ti-arrows-minimize"></i>'
      : '<i class="ti ti-arrows-horizontal"></i>';
    btn.title = _pmExpanded ? 'Collapse bank' : 'Expand bank';
  }
}

window.quickToggleEnabled = async function quickToggleEnabled(id){
  if(!window.S.isAdmin){console.warn("[security] quickToggleEnabled blocked");return;}
  const prob=window.DB.problems.find(p=>p.id===id);if(!prob)return;
  prob.enabled=!(prob.enabled===false);
  logAdminAction('toggle_problem_enabled', { id: prob.id, title: prob.title, enabled: prob.enabled });
  await saveDB();renderPmList();buildPracticeSidebar();renderFolderList();
  if(window.S.editingId===id){
    window.S.formEnabled=prob.enabled;
    const t=document.getElementById('form-toggle-track');
    if(t){t.classList.toggle('on',prob.enabled);document.getElementById('form-toggle-label').textContent=prob.enabled?'Enabled':'Disabled';}
  }
}
window.moveProb = async function moveProb(i,d){const n=i+d;if(n<0||n>=window.DB.problems.length)return;[window.DB.problems[i],window.DB.problems[n]]=[window.DB.problems[n],window.DB.problems[i]];await saveDB();renderPmList();}
window.duplicateProb = async function duplicateProb(i){
  const o=window.DB.problems[i];
  const c={...o,vars:o.vars.map(v=>({...v})),answers:(o.answers||[]).map(a=>({...a})),id:`prob-${Date.now()}`,title:`${o.title} (copy)`,enabled:o.enabled};
  logAdminAction('duplicate_problem', { sourceTitle: o.title, newId: c.id });
  window.DB.problems.splice(i+1,0,c);await saveDB();renderPmList();buildPracticeSidebar();
}
window.deleteProb = async function deleteProb(id){
  if(!window.S.isAdmin){console.warn("[security] deleteProb blocked");return;}
  if(!confirm('Delete this problem?'))return;
  const _dp=window.DB.problems.find(p=>p.id===id);
  logAdminAction('delete_problem', { id, title: _dp?.title });
  window.DB.problems=window.DB.problems.filter(p=>p.id!==id);
  window.DB.folders.forEach(f=>{f.problemIds=f.problemIds.filter(pid=>pid!==id);});
  await Promise.all([deleteFromDB('problems',id),saveDB()]);
  renderPmList();renderFolderList();buildPracticeSidebar();
}

// ── Folders ───────────────────────────────────
window.createFolder = async function createFolder(){
  if(!window.S.isAdmin){console.warn("[security] createFolder blocked");return;}
  const name=document.getElementById('new-folder-name').value.trim();if(!name)return;
  const _newFolder={id:`folder-${Date.now()}`,name,problemIds:[]};
  window.DB.folders.push(_newFolder);
  logAdminAction('create_folder', { id: _newFolder.id, name });
  document.getElementById('new-folder-name').value='';
  await saveDB();renderFolderList();buildPracticeSidebar();
}
// Track which problem is being dragged within a folder
let _folderDragSrc = null; // { folderId, idx }

window.renderFolderList = function renderFolderList(){
  const list=document.getElementById('folder-list'),empty=document.getElementById('folder-empty');
  list.innerHTML='';empty.style.display=window.DB.folders.length?'none':'block';
  window.DB.folders.forEach(f=>{
    const card=document.createElement('div');card.className='folder-card';

    // Build the draggable problem rows
    const probRows=document.createElement('div');
    probRows.style.cssText='padding:8px 14px 4px;display:flex;flex-direction:column;gap:4px';

    if(!f.problemIds.length){
      probRows.innerHTML='<span style="font-size:11px;color:var(--text4)">No problems yet.</span>';
    } else {
      f.problemIds.forEach((pid,pi)=>{
        const p=window.DB.problems.find(pr=>pr.id===pid);if(!p)return;
        const hidden=p.enabled===false;
        const row=document.createElement('div');
        row.className='folder-prob-row';
        row.draggable=true;
        row.dataset.idx=pi;
        row.innerHTML=`
          <i class="ti ti-grip-vertical" style="font-size:13px;color:var(--text4);cursor:grab;flex-shrink:0"></i>
          <span style="flex:1;font-size:12px;color:${hidden?'var(--text4)':'var(--text2)'}">${p.title}
            ${hidden?'<span style="font-size:9px;color:var(--text4);margin-left:4px">(hidden)</span>':''}
          </span>
          <button class="pm-icon-btn del" style="flex-shrink:0"
            onclick="removeProbFromFolder('${f.id}','${pid}')">
            <i class="ti ti-x"></i>
          </button>`;

        // Drag events
        row.addEventListener('dragstart', e=>{
          _folderDragSrc={folderId:f.id,idx:pi};
          row.style.opacity='0.4';
          e.dataTransfer.effectAllowed='move';
        });
        row.addEventListener('dragend', ()=>{
          row.style.opacity='';
          probRows.querySelectorAll('.folder-prob-row').forEach(r=>r.classList.remove('folder-prob-drag-over'));
        });
        row.addEventListener('dragover', e=>{
          e.preventDefault();
          row.classList.add('folder-prob-drag-over');
        });
        row.addEventListener('dragleave', ()=>row.classList.remove('folder-prob-drag-over'));
        row.addEventListener('drop', async e=>{
          e.preventDefault();
          row.classList.remove('folder-prob-drag-over');
          if(!_folderDragSrc||_folderDragSrc.folderId!==f.id||_folderDragSrc.idx===pi) return;
          // Reorder problemIds in this folder
          const ids=[...f.problemIds];
          const [moved]=ids.splice(_folderDragSrc.idx,1);
          ids.splice(pi,0,moved);
          f.problemIds=ids;
          _folderDragSrc=null;
          await saveDB();
          renderFolderList();
          buildPracticeSidebar();
        });

        probRows.appendChild(row);
      });
    }

    // Header
    const head=document.createElement('div');
    head.className='folder-head';
    head.innerHTML=`
      <span class="folder-name"><i class="ti ti-folder" style="font-size:13px;margin-right:6px;color:var(--text3)"></i>${escHtml(f.name)}</span>
      <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${f.problemIds.length} problem${f.problemIds.length!==1?'s':''}</span>
      <button class="btn btn-sm btn-red" style="margin-left:10px" onclick="deleteFolder('${f.id}')"><i class="ti ti-trash"></i></button>`;

    // Add-to-folder row
    const addRow=document.createElement('div');
    addRow.className='add-to-folder-row';
    addRow.innerHTML=`
      <select id="fp-sel-${f.id}">
        <option value="">— add a problem —</option>
        ${window.DB.problems.filter(p=>!f.problemIds.includes(p.id)).map(p=>
          `<option value="${p.id}">${p.title}${p.enabled===false?' (hidden)':''}</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-accent" onclick="addProbToFolder('${f.id}')"><i class="ti ti-plus"></i> Add</button>`;

    card.appendChild(head);
    card.appendChild(probRows);
    card.appendChild(addRow);
    list.appendChild(card);
  });
}
window.addProbToFolder = async function addProbToFolder(folderId){const sel=document.getElementById(`fp-sel-${folderId}`);const pid=sel?.value;if(!pid)return;const folder=window.DB.folders.find(f=>f.id===folderId);if(!folder||folder.problemIds.includes(pid))return;const _addP=window.DB.problems.find(p=>p.id===pid);logAdminAction('add_problem_to_folder',{folderId,folderName:folder.name,probId:pid,probTitle:_addP?.title});folder.problemIds.push(pid);await saveDB();renderFolderList();buildPracticeSidebar();}
window.removeProbFromFolder = async function removeProbFromFolder(folderId,probId){const folder=window.DB.folders.find(f=>f.id===folderId);if(!folder)return;const _remP=window.DB.problems.find(p=>p.id===probId);logAdminAction('remove_problem_from_folder',{folderId,folderName:folder.name,probId,probTitle:_remP?.title});folder.problemIds=folder.problemIds.filter(pid=>pid!==probId);await saveDB();renderFolderList();buildPracticeSidebar();}
window.deleteFolder = async function deleteFolder(id){
  if(!window.S.isAdmin){console.warn("[security] deleteFolder blocked");return;}if(!confirm('Delete this folder?'))return;const _df=window.DB.folders.find(f=>f.id===id);logAdminAction('delete_folder',{id,name:_df?.name});window.DB.folders=window.DB.folders.filter(f=>f.id!==id);await Promise.all([deleteFromDB('folders',id),saveDB()]);renderFolderList();buildPracticeSidebar();}

// ── Assignments editor ─────────────────────────
window.renderAssignProbPicker = function renderAssignProbPicker(){
  const wrap=document.getElementById('assign-prob-picker');wrap.innerHTML='';
  if(!window.DB.problems.length){wrap.innerHTML='<div style="color:var(--text4);font-size:12px">No problems yet.</div>';return;}
  window.DB.problems.forEach(p=>{
    const row=document.createElement('div');row.className='assign-prob-picker-row';
    const existing=window.S.editingAssignId?window.DB.assignments.find(a=>a.id===window.S.editingAssignId)?.problems.find(ap=>ap.probId===p.id):null;
    row.innerHTML=`<label><input type="checkbox" id="apc-${p.id}" style="width:auto" ${existing?'checked':''}/> ${p.title}
      ${p.enabled===false?'<span class="pill pill-disabled" style="font-size:9px">hidden</span>':''}</label>
      <input class="assign-pts-input" type="number" id="appts-${p.id}" value="${existing?.points||p.defaultPts||10}" min="1" max="100"/>`;
    wrap.appendChild(row);
  });
}
window.newAssignment = function newAssignment(){
  window.S.editingAssignId=null;
  ['as-title','as-instructions','as-open','as-due'].forEach(id=>document.getElementById(id).value='');
  const lateToggle=document.getElementById('as-allow-late');
  if(lateToggle) lateToggle.checked=true; // default: allow late
  renderAssignProbPicker();
}
window.saveAssignment = async function saveAssignment(){
  if(!window.S.isAdmin){console.warn("[security] saveAssignment blocked");return;}
  const title=document.getElementById('as-title').value.trim();if(!title){alert('Enter a title.');return;}
  const allowLate=document.getElementById('as-allow-late')?.checked!==false;
  const problems=window.DB.problems.filter(p=>document.getElementById(`apc-${p.id}`)?.checked).map(p=>({probId:p.id,points:parseInt(document.getElementById(`appts-${p.id}`)?.value)||10}));
  const assign={id:window.S.editingAssignId||`assign-${Date.now()}`,title,
    instructions:document.getElementById('as-instructions').value,
    opens:document.getElementById('as-open').value,due:document.getElementById('as-due').value,
    allowLate, problems};
  const _aIdx=window.DB.assignments.findIndex(a=>a.id===assign.id);
  const _aIsNew=_aIdx<0;
  if(_aIdx>=0)window.DB.assignments[_aIdx]=assign;else window.DB.assignments.push(assign);
  logAdminAction(_aIsNew?'create_assignment':'edit_assignment', { id: assign.id, title: assign.title, due: assign.due, allowLate: assign.allowLate, problemCount: assign.problems.length });
  window.S.editingAssignId=assign.id;await saveDB();renderAssignAdmin();
  const ok=document.getElementById('as-ok');ok.textContent='Saved!';ok.classList.remove('hidden');setTimeout(()=>ok.classList.add('hidden'),2000);
}
window.renderAssignAdmin = function renderAssignAdmin(){
  const list=document.getElementById('assign-admin-list'),empty=document.getElementById('assign-admin-empty');
  list.innerHTML='';empty.style.display=window.DB.assignments.length?'none':'block';
  window.DB.assignments.forEach(a=>{
    const item=document.createElement('div');item.style.cssText='background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r2);padding:10px;margin-bottom:8px';
    const lateLabel=a.allowLate===false
      ?'<span class="pill pill-red" style="font-size:9px">Late blocked</span>'
      :'<span class="pill pill-green" style="font-size:9px">Late allowed</span>';
    item.innerHTML=`<div style="font-family:var(--font-display);font-size:12px;color:var(--accent2);margin-bottom:4px">${escHtml(a.title)}</div>
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:6px;display:flex;align-items:center;gap:6px">
        Due: ${a.due?new Date(a.due).toLocaleString():'—'} · ${a.problems.length} problems ${lateLabel}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm" onclick="loadAssignToEditor('${a.id}')"><i class="ti ti-edit"></i> Edit</button>
        <button class="btn btn-sm btn-red" onclick="deleteAssignment('${a.id}')"><i class="ti ti-trash"></i></button>
      </div>`;
    list.appendChild(item);
  });
}
window.loadAssignToEditor = function loadAssignToEditor(id){
  const a=window.DB.assignments.find(a=>a.id===id);if(!a)return;window.S.editingAssignId=id;
  document.getElementById('as-title').value=a.title||'';document.getElementById('as-instructions').value=a.instructions||'';
  document.getElementById('as-open').value=a.opens||'';document.getElementById('as-due').value=a.due||'';
  const lateToggle=document.getElementById('as-allow-late');
  if(lateToggle) lateToggle.checked=a.allowLate!==false;
  renderAssignProbPicker();
  a.problems.forEach(ap=>{
    const cb=document.getElementById(`apc-${ap.probId}`);if(cb)cb.checked=true;
    const pts=document.getElementById(`appts-${ap.probId}`);if(pts)pts.value=ap.points;
  });
}
window.deleteAssignment = async function deleteAssignment(id){
  if(!window.S.isAdmin){console.warn("[security] deleteAssignment blocked");return;}
  if(!confirm('Delete this assignment?'))return;
  const _da=window.DB.assignments.find(a=>a.id===id);
  logAdminAction('delete_assignment', { id, title: _da?.title });
  window.DB.assignments=window.DB.assignments.filter(a=>a.id!==id);
  await Promise.all([deleteFromDB('assignments',id),saveDB()]);renderAssignAdmin();
}

// ── Topic label manager ───────────────────────
window.renderTopicManager = function renderTopicManager(){
  const list=document.getElementById('topic-label-list'),empty=document.getElementById('topic-label-empty');
  if(!list)return;list.innerHTML='';
  const topics=window.DB.topics||[];
  empty.style.display=topics.length?'none':'block';
  topics.forEach(t=>{
    const row=document.createElement('div');row.className='topic-label-row';
    const count=window.DB.problems.filter(p=>p.topic===t.name).length;
    row.innerHTML=`<span class="topic-label-chip">${t.name}</span>
      <span style="font-size:10px;color:var(--text4);font-family:var(--mono)">${count} problem${count!==1?'s':''}</span>
      <button class="pm-icon-btn del" onclick="deleteTopic('${t.id}')"><i class="ti ti-trash"></i></button>`;
    list.appendChild(row);
  });
  rebuildTopicDropdown();
}

// ── Rebuild topic dropdown ────────────────────
// Called on form reset/load AND whenever topics change — no more tab-switch dependency
window.rebuildTopicDropdown = function rebuildTopicDropdown(){
  const sel=document.getElementById('e-topic-select');if(!sel)return;
  const current=document.getElementById('e-topic')?.value||'';
  sel.innerHTML='<option value="">— select a topic —</option>'+
    (window.DB.topics||[]).map(t=>
      `<option value="${t.name}" ${t.name===current?'selected':''}>${t.name}</option>`
    ).join('');
}
window.onTopicSelectChange = function onTopicSelectChange(val){
  const inp=document.getElementById('e-topic');if(inp)inp.value=val;
}

window.addTopic = async function addTopic(){
  if(!window.S.isAdmin){console.warn("[security] addTopic blocked");return;}
  const input=document.getElementById('new-topic-input');const name=input?.value.trim();if(!name)return;
  if((window.DB.topics||[]).find(t=>t.name.toLowerCase()===name.toLowerCase())){alert(`"${name}" already exists.`);return;}
  if(!window.DB.topics)window.DB.topics=[];
  const _newTopic={id:`topic-${Date.now()}`,name};
  window.DB.topics.push(_newTopic);
  logAdminAction('create_topic_label', { id: _newTopic.id, name });
  if(input)input.value='';
  await saveDB();renderTopicManager();
  // Also update dropdown in problem form immediately
  rebuildTopicDropdown();
}
window.deleteTopic = async function deleteTopic(id){
  if(!window.S.isAdmin){console.warn("[security] deleteTopic blocked");return;}
  const t=(window.DB.topics||[]).find(t=>t.id===id);if(!t)return;
  const count=window.DB.problems.filter(p=>p.topic===t.name).length;
  const msg=count>0
    ?`Delete label "${t.name}"? It's used by ${count} problem${count!==1?'s':''}.`
    :`Delete label "${t.name}"?`;
  if(!confirm(msg))return;
  logAdminAction('delete_topic_label', { id, name: t?.name });
  await deleteFromDB('topics',id);
  window.DB.topics=window.DB.topics.filter(t=>t.id!==id);
  renderTopicManager();rebuildTopicDropdown();
}
