/* sitegrades.js — Course gradebook built entirely from website data.
   Separate from gradebook.js (which imports an external HuskyCT export).

   Shows every student's grade across all assignments (partial-credit aware),
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

  // Fetch all students once, then cache (the section dropdown re-renders without re-fetching)
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

function _computeRows(users, assigns){
  return users.map(u=>{
    const perAssign = assigns.map(a=>{
      const s = window.assignScoreForUser(a, u);   // { earned, max, pct, submitted }
      return { id:a.id, title:a.title, ...s };
    });
    const totalEarned = perAssign.reduce((s,p)=>s+p.earned, 0);
    const totalMax    = perAssign.reduce((s,p)=>s+p.max, 0);
    const overallPct  = totalMax ? Math.round(totalEarned/totalMax*100) : 0;
    return { name: u.username || u.uid, perAssign, totalEarned, totalMax, overallPct, letter:_letter(overallPct) };
  }).sort((a,b)=> b.overallPct - a.overallPct);
}

function _drawCourseGrades(){
  const wrap = document.getElementById('cg-content');
  if(!wrap) return;
  const assigns = window.DB.assignments || [];
  const { users, name:sectionName } = _filteredUsers();

  if(!assigns.length){
    wrap.innerHTML = '<div style="color:var(--text4);font-size:13px;padding:2rem;text-align:center">No assignments yet — create one in the editor.</div>';
    _cgData = null;
    return;
  }

  const rows = _computeRows(users, assigns);
  _cgData = { assigns, rows, sectionName };

  // ── Summary stats ──
  const overalls = rows.map(r=>r.overallPct);
  const avg = overalls.length ? Math.round(overalls.reduce((a,b)=>a+b,0)/overalls.length) : 0;
  const sorted = [...overalls].sort((a,b)=>a-b);
  const median = sorted.length
    ? (sorted.length%2===0 ? Math.round((sorted[sorted.length/2-1]+sorted[sorted.length/2])/2) : sorted[Math.floor(sorted.length/2)])
    : 0;
  const passing = overalls.filter(p=>p>=70).length;

  // ── Overall distribution histogram (reuse admin.js barChart) ──
  const buckets = Array(11).fill(0);
  overalls.forEach(s=>{ buckets[Math.min(10, Math.floor(s/10))]++; });
  const distLabels = ['0–9','10–19','20–29','30–39','40–49','50–59','60–69','70–79','80–89','90–99','100'];
  const distChart = window.barChart
    ? window.barChart(buckets, distLabels, Math.max(...buckets,1), i=>i>=7?'var(--green)':i>=5?'var(--warn)':'var(--red)')
    : '';

  // ── Per-assignment averages (reuse admin.js horizontalBarChart) ──
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

  // ── Build the grade table ──
  let table = `<div style="overflow-x:auto"><table class="dash-table" style="font-size:12px"><thead><tr>
      <th>Student</th>`;
  assigns.forEach(a=>{
    const max = a.problems.reduce((s,ap)=> s + (window.problemMaxPoints?window.problemMaxPoints(ap):(ap.points||0)), 0);
    table += `<th title="${escHtml(a.title)}">${escHtml(a.title.length>16?a.title.slice(0,15)+'…':a.title)}<br/><span style="font-weight:400;color:var(--text4)">${max}pts</span></th>`;
  });
  table += `<th>Overall</th><th>Grade</th></tr></thead><tbody>`;

  if(!rows.length){
    table += `<tr><td colspan="${assigns.length+3}" style="color:var(--text4);text-align:center;padding:2rem">No students${sectionName!=='All students'?' in this section':''} yet.</td></tr>`;
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
      table += `<td style="font-weight:600;color:${_pctColor(r.overallPct)}">${r.overallPct}%<br/><span style="font-size:9px;color:var(--text4);font-weight:400">${r.totalEarned}/${r.totalMax}</span></td>
                <td style="font-family:var(--font-display);font-weight:600;color:${_pctColor(r.overallPct)}">${r.letter}</td></tr>`;
    });
  }
  table += `</tbody></table></div>`;

  wrap.innerHTML = `
    <div class="dash-grid" style="margin-bottom:14px">
      <div class="metric-card"><div class="metric-label">Students</div><div class="metric-value">${rows.length}</div><div class="metric-sub">${escHtml(sectionName)}</div></div>
      <div class="metric-card"><div class="metric-label">Assignments</div><div class="metric-value">${assigns.length}</div></div>
      <div class="metric-card"><div class="metric-label">Class average</div><div class="metric-value" style="color:${_pctColor(avg)}">${avg}%</div></div>
      <div class="metric-card"><div class="metric-label">Median</div><div class="metric-value" style="color:${_pctColor(median)}">${median}%</div></div>
      <div class="metric-card"><div class="metric-label">Passing ≥70%</div><div class="metric-value">${passing}<span style="font-size:14px;color:var(--text4)">/${rows.length}</span></div></div>
    </div>

    <div class="dash-section">
      <div class="dash-head"><span><i class="ti ti-chart-histogram"></i> Overall grade distribution</span></div>
      ${distChart}
    </div>
    <div class="dash-section">
      <div class="dash-head"><span><i class="ti ti-chart-bar"></i> Average score by assignment</span></div>
      ${assignChart}
    </div>

    <div class="dash-section">
      <div class="dash-head"><span><i class="ti ti-table"></i> Grade table</span></div>
      ${table}
    </div>`;
}

// ── CSV export ────────────────────────────────
function _csvCell(v){
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

window.exportCourseGradesCSV = function exportCourseGradesCSV(){
  if(!_cgData){ console.warn('exportCourseGradesCSV: nothing to export'); return; }
  const { assigns, rows, sectionName } = _cgData;
  const header = ['Student', ...assigns.map(a=>`${a.title} (%)`), ...assigns.map(a=>`${a.title} (pts)`), 'Overall %', 'Overall pts', 'Letter'];
  const lines = [header.map(_csvCell).join(',')];
  rows.forEach(r=>{
    const cells = [
      r.name,
      ...r.perAssign.map(p=> p.submitted>0 ? p.pct : ''),
      ...r.perAssign.map(p=> p.submitted>0 ? `${p.earned}/${p.max}` : ''),
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

// ── PDF export (print-to-PDF) ─────────────────
// Opens a clean, printable report in a new window and triggers the browser's
// print dialog, where "Save as PDF" produces the file. No external library.
window.exportCourseGradesPDF = function exportCourseGradesPDF(){
  if(!_cgData){ console.warn('exportCourseGradesPDF: nothing to export'); return; }
  const { assigns, rows, sectionName } = _cgData;
  const esc = window.escHtml;
  const when = new Date().toLocaleString();

  const overalls = rows.map(r=>r.overallPct);
  const avg = overalls.length ? Math.round(overalls.reduce((a,b)=>a+b,0)/overalls.length) : 0;

  let thead = '<th style="text-align:left">Student</th>';
  assigns.forEach(a=>{ thead += `<th>${esc(a.title)}</th>`; });
  thead += '<th>Overall</th><th>Grade</th>';

  let tbody = '';
  rows.forEach(r=>{
    let tds = `<td style="text-align:left">${esc(r.name)}</td>`;
    r.perAssign.forEach(p=>{ tds += `<td>${p.submitted>0?`${p.pct}% (${p.earned}/${p.max})`:'—'}</td>`; });
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
