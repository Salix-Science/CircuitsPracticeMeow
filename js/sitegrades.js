/* sitegrades.js — Course gradebook built entirely from website data.
   Separate from gradebook.js (which imports an external HuskyCT export).

   Shows every student's grade across all assignments (partial-credit aware)
   PLUS manually-entered grade columns (Lab, Attendance, Participation, etc.),
   with summary graphs, a section filter, and CSV / PDF export.
   Admin-only. All scoring goes through the shared helpers in admin.js
   (problemMaxPoints / problemEarned / assignScoreForUser). */

let _cgUsers = null;   // cached fresh user list (students only)
let _cgData  = null;   // last computed { assigns, rows, sectionName }

function _letter(pct){
  if(pct>=90) return 'A';
  if(pct>=80) return 'B';
  if(pct>=70) return 'C';
  if(pct>=60) return 'D';
  return 'F';
}
function _pctColor(pct){ return pct>=70?'var(--green)':pct>=50?'var(--warn)':'var(--red)'; }

// ── Entry point (called when the tab opens) ───
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
    console.error('renderCourseGrades: failed to fetch users', e);
    wrap.innerHTML = `<div style="color:var(--red);font-size:12px;padding:1rem 0">Could not load grades: ${escHtml(e.message||String(e))}</div>`;
    return;
  }

  _buildSectionFilter();
  _drawCourseGrades();
};

// Refresh button — forces a re-fetch of user data
window.refreshCourseGrades = function refreshCourseGrades(){
  _cgUsers = null;
  renderCourseGrades();
};

function _buildSectionFilter(){
  const sel = document.getElementById('cg-section-filter');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All students</option>' +
    (window.DB.sections || []).map(s =>
      `<option value="${s.id}" ${s.id===current?'selected':''}>${escHtml(s.name)} (${(s.studentUids||[]).length})</option>`
    ).join('');
}

function _filteredUsers(){
  const sectionId = document.getElementById('cg-section-filter')?.value || '';
  if(!sectionId) return { users: _cgUsers, name: 'All students' };
  const section = (window.DB.sections || []).find(s => s.id === sectionId);
  if(!section) return { users: _cgUsers, name: 'All students' };
  const uids = new Set(section.studentUids || []);
  return { users: _cgUsers.filter(u => uids.has(u.uid)), name: section.name };
}

// Re-render table + graphs for the current section selection
window.onCourseGradeSection = function onCourseGradeSection(){ _drawCourseGrades(); };

function _computeRows(users, assigns, manualCols){
  return users.map(u=>{
    const perAssign = assigns.map(a=>{
      const s = window.assignScoreForUser(a, u);
      return { id:a.id, title:a.title, ...s };
    });
    const assignEarned = perAssign.reduce((s,p)=>s+p.earned, 0);
    const assignMax    = perAssign.reduce((s,p)=>s+p.max, 0);

    // Manual grade columns — only count columns where a score has been entered
    const perManual = manualCols.map(col => {
      const g = (u.manualGrades || {})[col.id];
      return {
        id:      col.id,
        title:   col.name,
        score:   g?.score ?? null,
        max:     col.maxScore,
        comment: g?.comment || '',
        posted:  g?.posted === true,
        pct:     (g?.score != null && col.maxScore > 0) ? Math.round(g.score / col.maxScore * 100) : null,
      };
    });
    const manualEarned = perManual.reduce((s,m)=> s + (m.score !== null ? m.score : 0), 0);
    const manualMax    = perManual.reduce((s,m)=> s + (m.score !== null ? m.max  : 0), 0);

    const totalEarned = assignEarned + manualEarned;
    const totalMax    = assignMax    + manualMax;
    const overallPct  = totalMax ? Math.round(totalEarned/totalMax*100) : 0;

    return {
      name:      u.username || u.uid,
      uid:       u.uid,
      perAssign,
      perManual,
      totalEarned,
      totalMax,
      overallPct,
      letter: _letter(overallPct),
    };
  }).sort((a,b)=> b.overallPct - a.overallPct);
}

function _drawCourseGrades(){
  const wrap = document.getElementById('cg-content');
  if(!wrap) return;
  const assigns    = window.DB.assignments || [];
  const manualCols = window.DB.manualGradeCols || [];
  const { users, name:sectionName } = _filteredUsers();

  const rows = _computeRows(users, assigns, manualCols);
  _cgData = { assigns, manualCols, rows, sectionName };

  // ── Summary stats ──
  const overalls = rows.map(r=>r.overallPct);
  const avg = overalls.length ? Math.round(overalls.reduce((a,b)=>a+b,0)/overalls.length) : 0;
  const sorted = [...overalls].sort((a,b)=>a-b);
  const median = sorted.length
    ? (sorted.length%2===0 ? Math.round((sorted[sorted.length/2-1]+sorted[sorted.length/2])/2) : sorted[Math.floor(sorted.length/2)])
    : 0;
  const passing = overalls.filter(p=>p>=70).length;

  // ── Distribution histogram ──
  const buckets = Array(11).fill(0);
  overalls.forEach(s=>{ buckets[Math.min(10, Math.floor(s/10))]++; });
  const distLabels = ['0–9','10–19','20–29','30–39','40–49','50–59','60–69','70–79','80–89','90–99','100'];
  const distChart = window.barChart
    ? window.barChart(buckets, distLabels, Math.max(...buckets,1), i=>i>=7?'var(--green)':i>=5?'var(--warn)':'var(--red)')
    : '';

  // ── Per-assignment averages ──
  const assignAvgs = assigns.map(a=>{
    const ps = rows.map(r=>r.perAssign.find(p=>p.id===a.id)).filter(p=>p && p.submitted>0);
    const avgP = ps.length ? Math.round(ps.reduce((s,p)=>s+p.pct,0)/ps.length) : 0;
    return { title:a.title, avg:avgP, n:ps.length };
  });
  const aLabels = assignAvgs.map(a=>a.title);
  const aValues = assignAvgs.map(a=>a.avg);
  const aColors = aValues.map(v=>v>=70?'var(--green)':v>=50?'var(--warn)':'var(--red)');
  const assignChart = window.horizontalBarChart
    ? window.horizontalBarChart(aValues, aLabels, 100, aColors, assignAvgs.map(a=>a.n?`${a.n} subm.`:'no data'))
    : '';

  // ── Grade table ──
  let table = `<div style="overflow-x:auto"><table class="dash-table" style="font-size:12px"><thead><tr>
      <th>Student</th>`;
  assigns.forEach(a=>{
    const max = a.problems.reduce((s,ap)=> s + (window.problemMaxPoints?window.problemMaxPoints(ap):(ap.points||0)), 0);
    table += `<th title="${escHtml(a.title)}">${escHtml(a.title.length>16?a.title.slice(0,15)+'…':a.title)}<br/><span style="font-weight:400;color:var(--text4)">${max}pts</span></th>`;
  });
  manualCols.forEach(col=>{
    const postedBadge = col.posted ? '' : ' <span style="font-size:9px;color:var(--warn)">(hidden)</span>';
    table += `<th title="${escHtml(col.name)}">${escHtml(col.name.length>14?col.name.slice(0,13)+'…':col.name)}${postedBadge}<br/><span style="font-weight:400;color:var(--text4)">${col.maxScore}pts · ${escHtml(col.type)}</span></th>`;
  });
  table += `<th>Overall</th><th>Grade</th></tr></thead><tbody>`;

  if(!rows.length){
    table += `<tr><td colspan="${assigns.length+manualCols.length+3}" style="color:var(--text4);text-align:center;padding:2rem">No students${sectionName!=='All students'?' in this section':''} yet.</td></tr>`;
  } else {
    rows.forEach(r=>{
      table += `<tr><td style="font-weight:500">${escHtml(r.name)}</td>`;
      r.perAssign.forEach(p=>{
        if(p.submitted>0){
          table += `<td style="text-align:center;font-family:var(--mono)"><span style="color:${_pctColor(p.pct)}">${p.pct}%</span><br/><span style="font-size:9px;color:var(--text4)">${p.earned}/${p.max}</span></td>`;
        } else {
          table += `<td style="text-align:center;color:var(--text4)">—</td>`;
        }
      });
      r.perManual.forEach(m=>{
        if(m.score !== null){
          table += `<td style="text-align:center;font-family:var(--mono);cursor:pointer" onclick="cgOpenGradeEdit('${escHtml(r.uid)}','${escHtml(r.name)}','${escHtml(m.id)}')" title="Click to edit">
            <span style="color:${_pctColor(m.pct)}">${m.score}/${m.max}</span>
            ${m.comment ? `<br/><span style="font-size:9px;color:var(--text4)" title="${escHtml(m.comment)}"><i class="ti ti-message-circle" style="font-size:10px"></i></span>` : ''}
            ${!m.posted ? '<br/><span style="font-size:8px;color:var(--warn)">hidden</span>' : ''}
          </td>`;
        } else {
          table += `<td style="text-align:center;color:var(--accent2);cursor:pointer;font-size:10px" onclick="cgOpenGradeEdit('${escHtml(r.uid)}','${escHtml(r.name)}','${escHtml(m.id)}')" title="Click to enter grade">
            <i class="ti ti-plus"></i></td>`;
        }
      });
      table += `<td style="font-weight:600;color:${_pctColor(r.overallPct)}">${r.overallPct}%<br/><span style="font-size:9px;color:var(--text4);font-weight:400">${r.totalEarned}/${r.totalMax}</span></td>
                <td style="font-family:var(--font-display);font-weight:600;color:${_pctColor(r.overallPct)}">${r.letter}</td></tr>`;
    });
  }
  table += `</tbody></table></div>`;

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
    ${assignChart ? `<div class="dash-section">
      <div class="dash-head"><span><i class="ti ti-chart-bar"></i> Average score by assignment</span></div>
      ${assignChart}
    </div>` : ''}

    <div class="dash-section">
      <div class="dash-head" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span><i class="ti ti-table"></i> Grade table</span>
        <button class="btn btn-sm btn-accent" onclick="cgOpenColManager()"><i class="ti ti-columns"></i> Manage grade columns</button>
      </div>
      ${table}
    </div>

    <!-- Grade entry modal -->
    <div id="cg-grade-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;align-items:center;justify-content:center">
      <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);width:380px;max-width:95vw;padding:20px;box-shadow:0 8px 40px rgba(0,0,0,.4)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="font-family:var(--font-display);font-size:14px;color:var(--accent2);letter-spacing:.06em" id="cg-modal-title">Enter grade</div>
          <button class="btn btn-sm" onclick="cgCloseGradeEdit()"><i class="ti ti-x"></i></button>
        </div>
        <div class="field"><label>Score</label>
          <input type="number" id="cg-modal-score" step="0.5" min="0" style="width:120px"/>
          <span id="cg-modal-maxlabel" style="font-size:11px;color:var(--text3);margin-left:8px"></span>
        </div>
        <div class="field"><label>Comment (visible to student when posted)</label>
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
        <div id="cg-modal-status" style="font-size:11px;color:var(--green);margin-top:8px;text-align:right"></div>
      </div>
    </div>

    <!-- Column manager modal -->
    <div id="cg-col-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9998;align-items:center;justify-content:center">
      <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);width:520px;max-width:97vw;max-height:85vh;overflow-y:auto;padding:20px;box-shadow:0 8px 40px rgba(0,0,0,.4)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="font-family:var(--font-display);font-size:14px;color:var(--accent2);letter-spacing:.06em"><i class="ti ti-columns"></i> Grade Columns</div>
          <button class="btn btn-sm" onclick="cgCloseColManager()"><i class="ti ti-x"></i></button>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:12px">Add manual columns for labs, attendance, participation, exams, etc. Columns with <b>Post to students</b> checked appear in each student's My Grades view.</div>
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

// ── Column manager ────────────────────────────
window.cgOpenColManager = function cgOpenColManager(){
  const modal = document.getElementById('cg-col-modal');
  if(!modal) return;
  _renderColList();
  modal.style.display = 'flex';
};

window.cgCloseColManager = function cgCloseColManager(){
  const modal = document.getElementById('cg-col-modal');
  if(modal) modal.style.display = 'none';
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
  list.innerHTML = cols.map((col, i)=>`
    <div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r2);padding:12px;margin-bottom:8px">
      <div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:start;margin-bottom:8px">
        <div>
          <label style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3)">Column name</label>
          <input type="text" value="${escHtml(col.name)}" id="cgcol-name-${i}" style="width:100%;margin-top:2px" placeholder="e.g. Lab 1, Midterm, Attendance…"/>
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

window.cgAddCol = function cgAddCol(){
  const cols = window.DB.manualGradeCols || [];
  const id   = 'col_' + Date.now().toString(36);
  cols.push({ id, name: '', maxScore: 100, type: 'Other', posted: false });
  window.DB.manualGradeCols = cols;
  _renderColList();
};

window.cgRemoveCol = function cgRemoveCol(i){
  const cols = window.DB.manualGradeCols || [];
  if(!confirm(`Remove column "${escHtml(cols[i]?.name||'this column')}"? This will NOT delete existing student grades for it.`)) return;
  cols.splice(i, 1);
  window.DB.manualGradeCols = cols;
  _renderColList();
};

window.cgSaveCols = async function cgSaveCols(){
  const cols = window.DB.manualGradeCols || [];
  // Read back edits from the form
  cols.forEach((col, i)=>{
    col.name     = (document.getElementById(`cgcol-name-${i}`)?.value || '').trim();
    col.maxScore = parseFloat(document.getElementById(`cgcol-max-${i}`)?.value) || 100;
    col.type     = document.getElementById(`cgcol-type-${i}`)?.value || 'Other';
    col.posted   = !!document.getElementById(`cgcol-posted-${i}`)?.checked;
  });
  const status = document.getElementById('cg-col-status');
  try {
    await window.saveManualGradeCols();
    if(status){ status.textContent = 'Saved!'; setTimeout(()=>{ if(status) status.textContent=''; }, 2000); }
    cgCloseColManager();
    _cgUsers = null; // force re-fetch so updated cols reflect immediately
    renderCourseGrades();
  } catch(e){
    console.error('cgSaveCols failed:', e);
    if(status){ status.textContent = 'Error: ' + (e.message||String(e)); status.style.color = 'var(--red)'; }
  }
};

// ── Grade entry modal ─────────────────────────
let _cgEditCtx = null;

window.cgOpenGradeEdit = function cgOpenGradeEdit(uid, name, colId){
  const cols     = window.DB.manualGradeCols || [];
  const col      = cols.find(c=>c.id===colId);
  if(!col) return;
  const userObj  = (_cgUsers||[]).find(u=>u.uid===uid);
  const existing = userObj ? (userObj.manualGrades||{})[colId] : null;

  _cgEditCtx = { uid, name, colId, col };

  const modal    = document.getElementById('cg-grade-modal');
  const titleEl  = document.getElementById('cg-modal-title');
  const scoreEl  = document.getElementById('cg-modal-score');
  const maxEl    = document.getElementById('cg-modal-maxlabel');
  const commentEl= document.getElementById('cg-modal-comment');
  const postedEl = document.getElementById('cg-modal-posted');
  const status   = document.getElementById('cg-modal-status');

  if(titleEl)   titleEl.textContent  = `${col.name} — ${name}`;
  if(scoreEl)   scoreEl.value        = existing?.score ?? '';
  if(scoreEl)   scoreEl.max          = col.maxScore;
  if(maxEl)     maxEl.textContent    = `/ ${col.maxScore} pts`;
  if(commentEl) commentEl.value      = existing?.comment || '';
  if(postedEl)  postedEl.checked     = existing?.posted === true;
  if(status)    status.textContent   = '';

  if(modal) modal.style.display = 'flex';
};

window.cgCloseGradeEdit = function cgCloseGradeEdit(){
  const modal = document.getElementById('cg-grade-modal');
  if(modal) modal.style.display = 'none';
  _cgEditCtx = null;
};

window.cgSaveGradeEdit = async function cgSaveGradeEdit(){
  if(!_cgEditCtx) return;
  const { uid, name, colId } = _cgEditCtx;
  const scoreRaw  = document.getElementById('cg-modal-score')?.value;
  const comment   = document.getElementById('cg-modal-comment')?.value?.trim() || '';
  const posted    = !!document.getElementById('cg-modal-posted')?.checked;
  const status    = document.getElementById('cg-modal-status');
  const score     = scoreRaw !== '' && scoreRaw != null ? parseFloat(scoreRaw) : null;
  const entry     = { score, comment, posted };

  try {
    await window.saveManualGradeForUser(uid, colId, entry);
    // Mirror into in-memory cache so table updates without re-fetch
    const userObj = (_cgUsers||[]).find(u=>u.uid===uid);
    if(userObj){
      if(!userObj.manualGrades) userObj.manualGrades = {};
      userObj.manualGrades[colId] = entry;
    }
    if(status){ status.style.color='var(--green)'; status.textContent = 'Saved!'; }
    setTimeout(()=>{ cgCloseGradeEdit(); _drawCourseGrades(); }, 700);
  } catch(e){
    console.error('cgSaveGradeEdit failed:', e);
    if(status){ status.style.color='var(--red)'; status.textContent = 'Error: '+(e.message||String(e)); }
  }
};

// ── CSV export ────────────────────────────────
function _csvCell(v){
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

window.exportCourseGradesCSV = function exportCourseGradesCSV(){
  if(!_cgData){ console.warn('exportCourseGradesCSV: nothing to export'); return; }
  const { assigns, manualCols, rows, sectionName } = _cgData;
  const header = [
    'Student',
    ...assigns.map(a=>`${a.title} (%)`),
    ...assigns.map(a=>`${a.title} (pts)`),
    ...manualCols.map(c=>`${c.name} (score)`),
    ...manualCols.map(c=>`${c.name} (comment)`),
    'Overall %', 'Overall pts', 'Letter',
  ];
  const lines = [header.map(_csvCell).join(',')];
  rows.forEach(r=>{
    const cells = [
      r.name,
      ...r.perAssign.map(p=> p.submitted>0 ? p.pct : ''),
      ...r.perAssign.map(p=> p.submitted>0 ? `${p.earned}/${p.max}` : ''),
      ...r.perManual.map(m=> m.score !== null ? m.score : ''),
      ...r.perManual.map(m=> m.comment || ''),
      r.overallPct,
      `${r.totalEarned}/${r.totalMax}`,
      r.letter,
    ];
    lines.push(cells.map(_csvCell).join(','));
  });
  const csv = lines.join('\r\n');
  const stamp = new Date().toISOString().slice(0,10);
  const safeName = sectionName.replace(/[^a-z0-9]+/gi,'_');
  _downloadBlob(csv, `grades_${safeName}_${stamp}.csv`, 'text/csv;charset=utf-8;');
};

function _downloadBlob(content, filename, mime){
  try {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  } catch(e){
    console.error('_downloadBlob failed:', e);
    alert('Download failed — see console.');
  }
}

// ── PDF export ────────────────────────────────
window.exportCourseGradesPDF = function exportCourseGradesPDF(){
  if(!_cgData){ console.warn('exportCourseGradesPDF: nothing to export'); return; }
  const { assigns, manualCols, rows, sectionName } = _cgData;
  const esc = window.escHtml;
  const when = new Date().toLocaleString();

  const overalls = rows.map(r=>r.overallPct);
  const avg = overalls.length ? Math.round(overalls.reduce((a,b)=>a+b,0)/overalls.length) : 0;

  let thead = '<th style="text-align:left">Student</th>';
  assigns.forEach(a=>{ thead += `<th>${esc(a.title)}</th>`; });
  manualCols.forEach(c=>{ thead += `<th>${esc(c.name)}<br/><span style="font-weight:400;font-size:9px">${esc(c.type)}</span></th>`; });
  thead += '<th>Overall</th><th>Grade</th>';

  let tbody = '';
  rows.forEach(r=>{
    let tds = `<td style="text-align:left">${esc(r.name)}</td>`;
    r.perAssign.forEach(p=>{ tds += `<td>${p.submitted>0?`${p.pct}% (${p.earned}/${p.max})`:'—'}</td>`; });
    r.perManual.forEach(m=>{ tds += `<td>${m.score !== null ? `${m.score}/${m.max}` : '—'}</td>`; });
    tds += `<td><b>${r.overallPct}%</b></td><td><b>${r.letter}</b></td>`;
    tbody += `<tr>${tds}</tr>`;
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <title>Course grades — ${esc(sectionName)}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px}
      h1{font-size:18px;margin:0 0 2px}
      .sub{color:#555;font-size:12px;margin-bottom:16px}
      table{border-collapse:collapse;width:100%;font-size:11px}
      th,td{border:1px solid #ccc;padding:5px 7px;text-align:center}
      th{background:#f2f2f2}
      tr:nth-child(even) td{background:#fafafa}
      @media print{ @page{ size:landscape; margin:12mm } }
    </style></head><body>
    <h1>Circuits Practice — Course Grades</h1>
    <div class="sub">Section: ${esc(sectionName)} · Students: ${rows.length} · Class average: ${avg}% · Generated ${esc(when)}</div>
    <table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
    </body></html>`;

  const w = window.open('', '_blank');
  if(!w){ alert('Pop-up blocked — allow pop-ups to export PDF, or use CSV export.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
};
