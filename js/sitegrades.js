/* sitegrades.js — Course gradebook built entirely from website data.
   Separate from gradebook.js (which imports an external HuskyCT export).

   Layout:
   - Overview: stats + distribution + a card list of all grade columns
     (assignments + manual). Each card is clickable.
   - Column detail: student roster for one column with section filter,
     inline score/comment/post editing, and back button.

   Admin-only. Assignment scoring via admin.js helpers. */

let _cgUsers    = null;   // cached fresh user list (students only)
let _cgData     = null;   // last computed { assigns, manualCols, rows, sectionName }
let _cgDetailId = null;   // id of the currently-open column, or null for overview

function _letter(pct){
  if(pct>=90) return 'A';
  if(pct>=80) return 'B';
  if(pct>=70) return 'C';
  if(pct>=60) return 'D';
  return 'F';
}
function _pctColor(pct){ return pct>=70?'var(--green)':pct>=50?'var(--warn)':'var(--red)'; }

// ── Entry point ───────────────────────────────
window.renderCourseGrades = async function renderCourseGrades(){
  if(!window.S.isAdmin){ console.warn('[security] renderCourseGrades blocked'); return; }
  const wrap = document.getElementById('cg-content');
  if(!wrap){ console.error('renderCourseGrades: #cg-content missing'); return; }
  wrap.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:1rem 0"><i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Loading grades…</div>';

  try {
    if(!_cgUsers){
      _cgUsers = (await window._fetchAllUsers()).filter(u => !u.isAdmin);
    }
  } catch(e){
    wrap.innerHTML = `<div style="color:var(--red);font-size:12px;padding:1rem 0">Could not load grades: ${escHtml(e.message||String(e))}</div>`;
    return;
  }

  _buildSectionFilter();
  if(_cgDetailId) _drawDetail(_cgDetailId);
  else            _drawOverview();
};

window.refreshCourseGrades = function(){
  _cgUsers = null;
  _cgDetailId = null;
  renderCourseGrades();
};

// ── Section filter (shared by overview + detail) ──
function _buildSectionFilter(){
  const sel = document.getElementById('cg-section-filter');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All students</option>' +
    (window.DB.sections || []).map(s =>
      `<option value="${s.id}" ${s.id===current?'selected':''}>${escHtml(s.name)} (${(s.studentUids||[]).length})</option>`
    ).join('');
}

window.onCourseGradeSection = function(){
  if(_cgDetailId) _drawDetail(_cgDetailId);
  else            _drawOverview();
};

function _sectionUsers(){
  const sectionId = document.getElementById('cg-section-filter')?.value || '';
  if(!sectionId) return { users: _cgUsers, name: 'All students' };
  const sec = (window.DB.sections||[]).find(s=>s.id===sectionId);
  if(!sec)    return { users: _cgUsers, name: 'All students' };
  const uids = new Set(sec.studentUids||[]);
  return { users: _cgUsers.filter(u=>uids.has(u.uid)), name: sec.name };
}

// ── Compute all rows (used for overview stats) ──
function _computeRows(users, assigns, manualCols){
  return users.map(u=>{
    const perAssign = assigns.map(a=>{
      const s = window.assignScoreForUser(a, u);
      return { id:a.id, title:a.title, ...s };
    });
    const assignEarned = perAssign.reduce((s,p)=>s+p.earned, 0);
    const assignMax    = perAssign.reduce((s,p)=>s+p.max,    0);

    const perManual = manualCols.map(col=>{
      const g = (u.manualGrades||{})[col.id];
      return {
        id:      col.id,
        title:   col.name,
        score:   g?.score ?? null,
        max:     col.maxScore,
        comment: g?.comment || '',
        posted:  g?.posted === true,
        pct:     (g?.score != null && col.maxScore>0) ? Math.round(g.score/col.maxScore*100) : null,
      };
    });
    const manualEarned = perManual.reduce((s,m)=>s+(m.score!==null?m.score:0), 0);
    const manualMax    = perManual.reduce((s,m)=>s+(m.score!==null?m.max:0),   0);

    const totalEarned = assignEarned + manualEarned;
    const totalMax    = assignMax    + manualMax;
    const overallPct  = totalMax ? Math.round(totalEarned/totalMax*100) : 0;

    return { name:u.username||u.uid, uid:u.uid, perAssign, perManual, totalEarned, totalMax, overallPct, letter:_letter(overallPct) };
  }).sort((a,b)=>b.overallPct-a.overallPct);
}

// ══════════════════════════════════════════════
//  OVERVIEW VIEW
// ══════════════════════════════════════════════
function _drawOverview(){
  const wrap       = document.getElementById('cg-content');
  if(!wrap) return;
  const assigns    = window.DB.assignments   || [];
  const manualCols = window.DB.manualGradeCols || [];
  const { users, name:sectionName } = _sectionUsers();

  const rows = _computeRows(users, assigns, manualCols);
  _cgData = { assigns, manualCols, rows, sectionName };

  // ── Stats ──
  const overalls = rows.map(r=>r.overallPct);
  const avg      = overalls.length ? Math.round(overalls.reduce((a,b)=>a+b,0)/overalls.length) : 0;
  const sorted   = [...overalls].sort((a,b)=>a-b);
  const median   = sorted.length
    ? (sorted.length%2===0
        ? Math.round((sorted[sorted.length/2-1]+sorted[sorted.length/2])/2)
        : sorted[Math.floor(sorted.length/2)])
    : 0;
  const passing  = overalls.filter(p=>p>=70).length;

  // ── Histogram ──
  const buckets   = Array(11).fill(0);
  overalls.forEach(s=>{ buckets[Math.min(10,Math.floor(s/10))]++; });
  const distLabels = ['0–9','10–19','20–29','30–39','40–49','50–59','60–69','70–79','80–89','90–99','100'];
  const distChart  = window.barChart
    ? window.barChart(buckets, distLabels, Math.max(...buckets,1), i=>i>=7?'var(--green)':i>=5?'var(--warn)':'var(--red)')
    : '';

  // ── Column cards ──
  // Assignments
  const assignCards = assigns.map(a=>{
    const max      = a.problems.reduce((s,ap)=>s+(window.problemMaxPoints?window.problemMaxPoints(ap):(ap.points||0)),0);
    const subCount = rows.filter(r=>r.perAssign.find(p=>p.id===a.id&&p.submitted>0)).length;
    const avgPcts  = rows.map(r=>r.perAssign.find(p=>p.id===a.id)).filter(p=>p&&p.submitted>0).map(p=>p.pct);
    const colAvg   = avgPcts.length ? Math.round(avgPcts.reduce((a,b)=>a+b,0)/avgPcts.length) : null;
    return _columnCard({
      id:       a.id,
      kind:     'assign',
      name:     a.title,
      type:     'Assignment',
      maxScore: max,
      posted:   true,
      subCount,
      total:    rows.length,
      avg:      colAvg,
    });
  });

  // Manual columns
  const manualCards = manualCols.map(col=>{
    const entries  = rows.map(r=>r.perManual.find(m=>m.id===col.id)).filter(m=>m&&m.score!==null);
    const colAvg   = entries.length ? Math.round(entries.reduce((s,m)=>s+m.pct,0)/entries.length) : null;
    return _columnCard({
      id:       col.id,
      kind:     'manual',
      name:     col.name,
      type:     col.type,
      maxScore: col.maxScore,
      posted:   col.posted,
      subCount: entries.length,
      total:    rows.length,
      avg:      colAvg,
    });
  });

  const allCards = [...assignCards, ...manualCards];

  wrap.innerHTML = `
    <div class="dash-grid" style="margin-bottom:14px">
      <div class="metric-card"><div class="metric-label">Students</div><div class="metric-value">${rows.length}</div><div class="metric-sub">${escHtml(sectionName)}</div></div>
      <div class="metric-card"><div class="metric-label">Assignments</div><div class="metric-value">${assigns.length}</div></div>
      <div class="metric-card"><div class="metric-label">Grade columns</div><div class="metric-value">${manualCols.length}</div><div class="metric-sub">manual</div></div>
      <div class="metric-card"><div class="metric-label">Class average</div><div class="metric-value" style="color:${_pctColor(avg)}">${avg}%</div></div>
      <div class="metric-card"><div class="metric-label">Median</div><div class="metric-value" style="color:${_pctColor(median)}">${median}%</div></div>
      <div class="metric-card"><div class="metric-label">Passing ≥70%</div><div class="metric-value">${passing}<span style="font-size:14px;color:var(--text4)">/${rows.length}</span></div></div>
    </div>

    ${distChart ? `<div class="dash-section">
      <div class="dash-head"><span><i class="ti ti-chart-histogram"></i> Overall grade distribution</span></div>
      ${distChart}
    </div>` : ''}

    <div class="dash-section">
      <div class="dash-head" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span><i class="ti ti-layout-grid"></i> Grade columns — click to grade students</span>
        <button class="btn btn-sm btn-accent" onclick="cgOpenColManager()"><i class="ti ti-columns"></i> Manage columns</button>
      </div>
      ${allCards.length
        ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">${allCards.join('')}</div>`
        : `<div style="color:var(--text4);font-size:12px;padding:1rem 0">No assignments or grade columns yet.</div>`}
    </div>

    ${_colManagerModal()}
    ${_gradeEditModal()}`;
}

function _columnCard({ id, kind, name, type, maxScore, posted, subCount, total, avg }){
  const avgBadge = avg !== null
    ? `<span style="font-family:var(--mono);font-size:13px;font-weight:700;color:${_pctColor(avg)}">${avg}%</span>`
    : `<span style="font-size:11px;color:var(--text4)">No data</span>`;
  const postBadge = posted
    ? `<span style="font-size:9px;color:var(--green)"><i class="ti ti-eye" style="font-size:9px"></i> visible</span>`
    : `<span style="font-size:9px;color:var(--warn)"><i class="ti ti-eye-off" style="font-size:9px"></i> hidden</span>`;
  const typeBadge = `<span style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--text4)">${escHtml(type)}</span>`;
  const submittedBar = total>0
    ? `<div style="height:3px;background:var(--bg4);border-radius:2px;margin-top:8px;overflow:hidden">
         <div style="height:100%;width:${Math.round(subCount/total*100)}%;background:var(--accent);border-radius:2px"></div>
       </div>
       <div style="font-size:9px;color:var(--text4);margin-top:3px">${subCount}/${total} graded</div>`
    : '';

  return `<div class="cg-col-card" onclick="cgOpenDetail('${escHtml(id)}','${escHtml(kind)}')" style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);padding:14px;cursor:pointer;transition:border-color .15s,background .15s" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:6px">
      <div style="font-size:13px;font-weight:600;color:var(--text);line-height:1.3;flex:1">${escHtml(name)}</div>
      ${avgBadge}
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      ${typeBadge}
      <span style="font-size:9px;color:var(--text4)">${maxScore} pts</span>
      ${postBadge}
    </div>
    ${submittedBar}
  </div>`;
}

// ══════════════════════════════════════════════
//  DETAIL VIEW (one column → student roster)
// ══════════════════════════════════════════════
window.cgOpenDetail = function cgOpenDetail(id, kind){
  _cgDetailId = id;
  _drawDetail(id, kind);
};

window.cgBackToOverview = function cgBackToOverview(){
  _cgDetailId = null;
  _drawOverview();
};

function _drawDetail(id){
  const wrap       = document.getElementById('cg-content');
  if(!wrap) return;
  const assigns    = window.DB.assignments    || [];
  const manualCols = window.DB.manualGradeCols || [];
  const { users, name:sectionName } = _sectionUsers();

  // Determine if this is an assignment or manual column
  const assign  = assigns.find(a=>a.id===id);
  const manCol  = manualCols.find(c=>c.id===id);
  if(!assign && !manCol){ _drawOverview(); return; }

  const colName = assign ? assign.title : manCol.name;
  const colType = assign ? 'Assignment' : manCol.type;
  const maxScore = assign
    ? assign.problems.reduce((s,ap)=>s+(window.problemMaxPoints?window.problemMaxPoints(ap):(ap.points||0)),0)
    : manCol.maxScore;
  const isManual = !!manCol;

  // Build student rows
  const studentRows = users.map(u=>{
    if(assign){
      const s = window.assignScoreForUser(assign, u);
      return { uid:u.uid, name:u.username||u.uid, earned:s.earned, max:s.max, pct:s.pct, submitted:s.submitted>0, isLate:false, comment:'', posted:true };
    } else {
      const g = (u.manualGrades||{})[id];
      const pct = (g?.score!=null&&manCol.maxScore>0) ? Math.round(g.score/manCol.maxScore*100) : null;
      return { uid:u.uid, name:u.username||u.uid, earned:g?.score??null, max:manCol.maxScore, pct, submitted:g?.score!=null, comment:g?.comment||'', posted:g?.posted===true };
    }
  }).sort((a,b)=>a.name.localeCompare(b.name));

  const graded    = studentRows.filter(r=>r.submitted).length;
  const avgPct    = graded ? Math.round(studentRows.filter(r=>r.submitted).reduce((s,r)=>s+r.pct,0)/graded) : null;

  // Build table rows
  const tableRows = studentRows.map(r=>{
    const scoreCell = r.submitted
      ? `<span style="font-family:var(--mono);font-size:13px;font-weight:600;color:${_pctColor(r.pct)}">${r.pct}%</span>
         <span style="font-size:10px;color:var(--text4);margin-left:4px">${r.earned}/${r.max}</span>`
      : `<span style="font-size:11px;color:var(--text4)">—</span>`;

    const commentCell = r.comment
      ? `<span style="font-size:11px;color:var(--text3);font-style:italic" title="${escHtml(r.comment)}">${escHtml(r.comment.length>40?r.comment.slice(0,39)+'…':r.comment)}</span>`
      : `<span style="font-size:11px;color:var(--border2)">—</span>`;

    const postedCell = isManual
      ? (r.submitted
          ? (r.posted
              ? `<span style="font-size:10px;color:var(--green)"><i class="ti ti-eye"></i> Posted</span>`
              : `<span style="font-size:10px;color:var(--warn)"><i class="ti ti-eye-off"></i> Hidden</span>`)
          : `<span style="font-size:10px;color:var(--text4)">—</span>`)
      : `<span style="font-size:10px;color:var(--green)"><i class="ti ti-eye"></i> Posted</span>`;

    const editBtn = isManual
      ? `<button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="cgOpenGradeEdit('${escHtml(r.uid)}','${escHtml(r.name)}','${escHtml(id)}')">
           <i class="ti ti-pencil"></i> ${r.submitted ? 'Edit' : 'Grade'}
         </button>`
      : '';

    return `<tr>
      <td style="font-weight:500;white-space:nowrap">${escHtml(r.name)}</td>
      <td style="text-align:center">${scoreCell}</td>
      <td>${commentCell}</td>
      <td style="text-align:center">${postedCell}</td>
      ${isManual ? `<td style="text-align:center">${editBtn}</td>` : ''}
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <!-- Back nav -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <button class="btn btn-sm" onclick="cgBackToOverview()"><i class="ti ti-arrow-left"></i> All columns</button>
      <div style="flex:1">
        <div style="font-family:var(--font-display);font-size:15px;color:var(--accent2);letter-spacing:.06em">${escHtml(colName)}</div>
        <div style="font-size:10px;color:var(--text4);text-transform:uppercase;letter-spacing:.07em">${escHtml(colType)} · ${maxScore} pts</div>
      </div>
      ${isManual ? `<button class="btn btn-sm btn-accent" onclick="cgBulkPost('${escHtml(id)}')"><i class="ti ti-eye"></i> Post all to students</button>` : ''}
    </div>

    <!-- Stats strip -->
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      <div class="metric-card" style="flex:1;min-width:100px"><div class="metric-label">Students</div><div class="metric-value">${users.length}</div><div class="metric-sub">${escHtml(sectionName)}</div></div>
      <div class="metric-card" style="flex:1;min-width:100px"><div class="metric-label">Graded</div><div class="metric-value">${graded}<span style="font-size:14px;color:var(--text4)">/${users.length}</span></div></div>
      <div class="metric-card" style="flex:1;min-width:100px"><div class="metric-label">Average</div><div class="metric-value" style="color:${avgPct!==null?_pctColor(avgPct):'var(--text4)'}">${avgPct!==null?avgPct+'%':'—'}</div></div>
    </div>

    <!-- Student table -->
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);overflow:hidden">
      <div style="overflow-x:auto">
        <table class="dash-table" style="font-size:12px">
          <thead><tr>
            <th>Student</th>
            <th>Score</th>
            <th>Comment</th>
            <th>Visibility</th>
            ${isManual ? '<th></th>' : ''}
          </tr></thead>
          <tbody>${tableRows || `<tr><td colspan="${isManual?5:4}" style="color:var(--text4);text-align:center;padding:2rem">No students in this section.</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    ${_gradeEditModal()}`;
}

// ── Bulk-post all entered grades for a manual column ──
window.cgBulkPost = async function cgBulkPost(colId){
  const col = (window.DB.manualGradeCols||[]).find(c=>c.id===colId);
  if(!col) return;
  if(!confirm(`Post all entered grades for "${col.name}" to students? Each student with a score will be able to see it.`)) return;
  const targets = (_cgUsers||[]).filter(u=>{
    const g = (u.manualGrades||{})[colId];
    return g && g.score != null && !g.posted;
  });
  if(!targets.length){ alert('No unposted grades to publish.'); return; }
  try {
    await Promise.all(targets.map(u=>{
      const g = (u.manualGrades||{})[colId];
      const updated = { ...g, posted: true };
      if(!u.manualGrades) u.manualGrades = {};
      u.manualGrades[colId] = updated;
      return window.saveManualGradeForUser(u.uid, colId, updated);
    }));
    _drawDetail(colId);
  } catch(e){
    alert('Error posting grades: ' + (e.message||String(e)));
  }
};

// ══════════════════════════════════════════════
//  COLUMN MANAGER MODAL
// ══════════════════════════════════════════════
function _colManagerModal(){
  return `<div id="cg-col-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9998;align-items:center;justify-content:center">
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);width:520px;max-width:97vw;max-height:85vh;overflow-y:auto;padding:20px;box-shadow:0 8px 40px rgba(0,0,0,.4)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-family:var(--font-display);font-size:14px;color:var(--accent2);letter-spacing:.06em"><i class="ti ti-columns"></i> Grade Columns</div>
        <button class="btn btn-sm" onclick="cgCloseColManager()"><i class="ti ti-x"></i></button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:12px">Manual columns for labs, attendance, participation, exams, etc. Columns with <b>Post to students</b> checked appear in each student's My Grades view.</div>
      <div id="cg-col-list" style="margin-bottom:12px"></div>
      <button class="btn btn-sm btn-accent" onclick="cgAddCol()"><i class="ti ti-plus"></i> Add column</button>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;padding-top:12px;border-top:0.5px solid var(--border)">
        <button class="btn btn-sm" onclick="cgCloseColManager()">Cancel</button>
        <button class="btn btn-sm btn-accent" onclick="cgSaveCols()"><i class="ti ti-device-floppy"></i> Save columns</button>
      </div>
      <div id="cg-col-status" style="font-size:11px;color:var(--green);margin-top:8px;text-align:right"></div>
    </div>
  </div>`;
}

window.cgOpenColManager = function(){
  // Re-inject modal into page if it was replaced by _drawDetail
  if(!document.getElementById('cg-col-modal')){
    const div = document.createElement('div');
    div.innerHTML = _colManagerModal();
    document.getElementById('cg-content').appendChild(div.firstElementChild);
  }
  _renderColList();
  document.getElementById('cg-col-modal').style.display = 'flex';
};

window.cgCloseColManager = function(){
  const m = document.getElementById('cg-col-modal');
  if(m) m.style.display = 'none';
};

const COL_TYPES = ['Lab','Assignment','Exam','Quiz','Attendance','Participation','Project','Other'];

function _renderColList(){
  const list = document.getElementById('cg-col-list');
  if(!list) return;
  const cols = window.DB.manualGradeCols || [];
  if(!cols.length){
    list.innerHTML = '<div style="color:var(--text4);font-size:12px;padding:8px 0">No columns yet — click Add column.</div>';
    return;
  }
  list.innerHTML = cols.map((col,i)=>`
    <div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r2);padding:12px;margin-bottom:8px">
      <div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:start;margin-bottom:8px">
        <div>
          <label style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3)">Column name</label>
          <input type="text" value="${escHtml(col.name)}" id="cgcol-name-${i}" style="width:100%;margin-top:2px" placeholder="e.g. Lab 1, Midterm…"/>
        </div>
        <div>
          <label style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3)">Max score</label>
          <input type="number" value="${col.maxScore}" id="cgcol-max-${i}" style="width:80px;margin-top:2px" min="0.1" step="0.5"/>
        </div>
        <button class="btn btn-sm" onclick="cgRemoveCol(${i})" title="Remove column" style="align-self:flex-end"><i class="ti ti-trash" style="color:var(--red)"></i></button>
      </div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div>
          <label style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3)">Type</label>
          <select id="cgcol-type-${i}" style="font-size:11px;padding:3px 6px;margin-top:2px">
            ${COL_TYPES.map(t=>`<option ${t===col.type?'selected':''}>${escHtml(t)}</option>`).join('')}
          </select>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2);cursor:pointer;margin-top:14px">
          <input type="checkbox" id="cgcol-posted-${i}" ${col.posted?'checked':''} style="width:auto"/>
          Post to students
        </label>
      </div>
    </div>`).join('');
}

window.cgAddCol = function(){
  const cols = window.DB.manualGradeCols || [];
  cols.push({ id:'col_'+Date.now().toString(36), name:'', maxScore:100, type:'Other', posted:false });
  window.DB.manualGradeCols = cols;
  _renderColList();
};

window.cgRemoveCol = function(i){
  const cols = window.DB.manualGradeCols || [];
  if(!confirm(`Remove column "${cols[i]?.name||'this column'}"? Existing student grades for it are not deleted.`)) return;
  cols.splice(i,1);
  window.DB.manualGradeCols = cols;
  _renderColList();
};

window.cgSaveCols = async function(){
  const cols = window.DB.manualGradeCols || [];
  cols.forEach((col,i)=>{
    col.name     = (document.getElementById(`cgcol-name-${i}`)?.value||'').trim();
    col.maxScore = parseFloat(document.getElementById(`cgcol-max-${i}`)?.value)||100;
    col.type     = document.getElementById(`cgcol-type-${i}`)?.value||'Other';
    col.posted   = !!document.getElementById(`cgcol-posted-${i}`)?.checked;
  });
  const status = document.getElementById('cg-col-status');
  try {
    await window.saveManualGradeCols();
    if(status){ status.textContent='Saved!'; setTimeout(()=>{ if(status) status.textContent=''; },2000); }
    cgCloseColManager();
    _cgUsers = null;
    _cgDetailId = null;
    renderCourseGrades();
  } catch(e){
    console.error('cgSaveCols failed:',e);
    if(status){ status.textContent='Error: '+(e.message||String(e)); status.style.color='var(--red)'; }
  }
};

// ══════════════════════════════════════════════
//  GRADE ENTRY MODAL
// ══════════════════════════════════════════════
function _gradeEditModal(){
  return `<div id="cg-grade-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;align-items:center;justify-content:center">
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);width:380px;max-width:95vw;padding:20px;box-shadow:0 8px 40px rgba(0,0,0,.4)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-family:var(--font-display);font-size:14px;color:var(--accent2);letter-spacing:.06em" id="cg-modal-title">Enter grade</div>
        <button class="btn btn-sm" onclick="cgCloseGradeEdit()"><i class="ti ti-x"></i></button>
      </div>
      <div class="field"><label>Score</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input type="number" id="cg-modal-score" step="0.5" min="0" style="width:100px"/>
          <span id="cg-modal-maxlabel" style="font-size:11px;color:var(--text3)"></span>
        </div>
      </div>
      <div class="field"><label>Comment <span style="font-weight:400;color:var(--text4)">(visible to student when posted)</span></label>
        <textarea id="cg-modal-comment" rows="3" placeholder="Optional feedback…" style="resize:vertical"></textarea>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);cursor:pointer;margin-bottom:14px">
        <input type="checkbox" id="cg-modal-posted" style="width:auto"/>
        Post to student (visible in their My Grades view)
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-sm" onclick="cgCloseGradeEdit()">Cancel</button>
        <button class="btn btn-sm btn-accent" onclick="cgSaveGradeEdit()"><i class="ti ti-device-floppy"></i> Save</button>
      </div>
      <div id="cg-modal-status" style="font-size:11px;margin-top:8px;text-align:right"></div>
    </div>
  </div>`;
}

let _cgEditCtx = null;

window.cgOpenGradeEdit = function(uid, name, colId){
  const col      = (window.DB.manualGradeCols||[]).find(c=>c.id===colId);
  if(!col) return;
  const userObj  = (_cgUsers||[]).find(u=>u.uid===uid);
  const existing = userObj ? (userObj.manualGrades||{})[colId] : null;
  _cgEditCtx     = { uid, name, colId, col };

  // Inject modal if missing (detail view renders it fresh each time)
  if(!document.getElementById('cg-grade-modal')){
    const div = document.createElement('div');
    div.innerHTML = _gradeEditModal();
    document.getElementById('cg-content').appendChild(div.firstElementChild);
  }

  document.getElementById('cg-modal-title').textContent   = `${col.name} — ${name}`;
  document.getElementById('cg-modal-score').value         = existing?.score ?? '';
  document.getElementById('cg-modal-score').max           = col.maxScore;
  document.getElementById('cg-modal-maxlabel').textContent= `/ ${col.maxScore} pts`;
  document.getElementById('cg-modal-comment').value       = existing?.comment || '';
  document.getElementById('cg-modal-posted').checked      = existing?.posted === true;
  document.getElementById('cg-modal-status').textContent  = '';
  document.getElementById('cg-grade-modal').style.display = 'flex';
};

window.cgCloseGradeEdit = function(){
  const m = document.getElementById('cg-grade-modal');
  if(m) m.style.display = 'none';
  _cgEditCtx = null;
};

window.cgSaveGradeEdit = async function(){
  if(!_cgEditCtx) return;
  const { uid, name, colId } = _cgEditCtx;
  const scoreRaw = document.getElementById('cg-modal-score')?.value;
  const comment  = document.getElementById('cg-modal-comment')?.value?.trim() || '';
  const posted   = !!document.getElementById('cg-modal-posted')?.checked;
  const status   = document.getElementById('cg-modal-status');
  const score    = (scoreRaw !== '' && scoreRaw != null) ? parseFloat(scoreRaw) : null;
  const entry    = { score, comment, posted };

  try {
    await window.saveManualGradeForUser(uid, colId, entry);
    // Mirror into cache
    const userObj = (_cgUsers||[]).find(u=>u.uid===uid);
    if(userObj){ if(!userObj.manualGrades) userObj.manualGrades={}; userObj.manualGrades[colId]=entry; }
    if(status){ status.style.color='var(--green)'; status.textContent='Saved!'; }
    setTimeout(()=>{ cgCloseGradeEdit(); _drawDetail(colId); }, 600);
  } catch(e){
    console.error('cgSaveGradeEdit failed:',e);
    if(status){ status.style.color='var(--red)'; status.textContent='Error: '+(e.message||String(e)); }
  }
};

// ══════════════════════════════════════════════
//  CSV / PDF EXPORTS  (operate on full data)
// ══════════════════════════════════════════════
function _csvCell(v){
  const s = String(v??'');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

window.exportCourseGradesCSV = function(){
  if(!_cgData){ console.warn('exportCourseGradesCSV: nothing to export'); return; }
  const { assigns, manualCols, rows, sectionName } = _cgData;
  const header = [
    'Student',
    ...assigns.map(a=>`${a.title} (%)`),
    ...assigns.map(a=>`${a.title} (pts)`),
    ...manualCols.map(c=>`${c.name} (score)`),
    ...manualCols.map(c=>`${c.name} (comment)`),
    'Overall %','Overall pts','Letter',
  ];
  const lines = [header.map(_csvCell).join(',')];
  rows.forEach(r=>{
    lines.push([
      r.name,
      ...r.perAssign.map(p=>p.submitted>0?p.pct:''),
      ...r.perAssign.map(p=>p.submitted>0?`${p.earned}/${p.max}`:''),
      ...r.perManual.map(m=>m.score!==null?m.score:''),
      ...r.perManual.map(m=>m.comment||''),
      r.overallPct,
      `${r.totalEarned}/${r.totalMax}`,
      r.letter,
    ].map(_csvCell).join(','));
  });
  const stamp    = new Date().toISOString().slice(0,10);
  const safeName = sectionName.replace(/[^a-z0-9]+/gi,'_');
  _downloadBlob(lines.join('\r\n'), `grades_${safeName}_${stamp}.csv`, 'text/csv;charset=utf-8;');
};

function _downloadBlob(content, filename, mime){
  try {
    const blob = new Blob([content],{type:mime});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href=url; a.download=filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(e){ console.error('_downloadBlob failed:',e); alert('Download failed — see console.'); }
}

window.exportCourseGradesPDF = function(){
  if(!_cgData){ console.warn('exportCourseGradesPDF: nothing to export'); return; }
  const { assigns, manualCols, rows, sectionName } = _cgData;
  const esc  = window.escHtml;
  const when = new Date().toLocaleString();
  const avg  = rows.length ? Math.round(rows.reduce((s,r)=>s+r.overallPct,0)/rows.length) : 0;

  let thead = '<th style="text-align:left">Student</th>';
  assigns.forEach(a=>{ thead+=`<th>${esc(a.title)}</th>`; });
  manualCols.forEach(c=>{ thead+=`<th>${esc(c.name)}<br/><span style="font-weight:400;font-size:9px">${esc(c.type)}</span></th>`; });
  thead+='<th>Overall</th><th>Grade</th>';

  let tbody='';
  rows.forEach(r=>{
    let tds=`<td style="text-align:left">${esc(r.name)}</td>`;
    r.perAssign.forEach(p=>{ tds+=`<td>${p.submitted>0?`${p.pct}% (${p.earned}/${p.max})`:'—'}</td>`; });
    r.perManual.forEach(m=>{ tds+=`<td>${m.score!==null?`${m.score}/${m.max}`:'—'}</td>`; });
    tds+=`<td><b>${r.overallPct}%</b></td><td><b>${r.letter}</b></td>`;
    tbody+=`<tr>${tds}</tr>`;
  });

  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <title>Course grades — ${esc(sectionName)}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px}
      h1{font-size:18px;margin:0 0 2px}.sub{color:#555;font-size:12px;margin-bottom:16px}
      table{border-collapse:collapse;width:100%;font-size:11px}
      th,td{border:1px solid #ccc;padding:5px 7px;text-align:center}
      th{background:#f2f2f2}tr:nth-child(even) td{background:#fafafa}
      @media print{@page{size:landscape;margin:12mm}}
    </style></head><body>
    <h1>Circuits Practice — Course Grades</h1>
    <div class="sub">Section: ${esc(sectionName)} · Students: ${rows.length} · Class avg: ${avg}% · ${esc(when)}</div>
    <table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
    </body></html>`;

  const w = window.open('','_blank');
  if(!w){ alert('Pop-up blocked — allow pop-ups to export PDF, or use CSV export.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
};
