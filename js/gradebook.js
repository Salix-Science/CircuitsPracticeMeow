/* gradebook.js — Admin-only final gradebook calculator
   Parses HuskyCT UTF-16 tab-separated .xls exports.
   Works with any number of students or grade columns.
*/

// ── State ─────────────────────────────────────
const GB = {
  headers:     [],      // all column names from file
  maxPts:      [],      // max points per col (null if not a grade col)
  students:    [],      // [{name, username, id, vals:[]}]
  categories:  [],      // [{id, name, weight}]
  assignments: {},      // {catId: [colIndex,...]}
  skipped:     new Set(),
  scale:       [],      // [{letter, min, max}]
  activeCat:   null,
  results:     [],
  sortCol:     'finalPct',
  sortDir:     -1,
};
let _gbCatCtr = 0;

// ── File handling ─────────────────────────────
function gbHandleDrop(e) {
  e.preventDefault();
  document.getElementById('gb-drop-zone').classList.remove('gb-drag-over');
  const f = e.dataTransfer.files[0];
  if (f) gbProcessFile(f);
}
function gbHandleFile(e) {
  const f = e.target.files[0];
  if (f) gbProcessFile(f);
}

function gbProcessFile(file) {
  const tryParse = (encoding) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = e => { try { resolve(gbParseContent(e.target.result)); } catch(err) { reject(err); } };
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsText(file, encoding);
  });

  tryParse('utf-16')
    .catch(() => tryParse('utf-8'))
    .catch(err => gbShowErr(err.message));
}

function gbParseContent(text) {
  const firstLine = text.split('\n')[0];
  const delim = firstLine.includes('\t') ? '\t' : ',';
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (lines.length < 2) throw new Error('File appears empty or unreadable');

  const clean = s => s.replace(/^"+|"+$/g, '').trim();
  const rawHeaders = lines[0].split(delim).map(clean);

  const META = ['last name','first name','username','student id','last access','availability'];
  const isMeta = h => META.some(m => h.toLowerCase().includes(m));

  function parseMaxPts(h) {
    const m = h.match(/Total Pts:\s*([\d,]+)/i);
    if (!m) return null;
    return parseFloat(m[1].replace(/,/g, ''));
  }

  GB.headers = rawHeaders;
  GB.maxPts  = rawHeaders.map(parseMaxPts);

  const lastNameIdx  = rawHeaders.findIndex(h => h.toLowerCase().includes('last name'));
  const firstNameIdx = rawHeaders.findIndex(h => h.toLowerCase().includes('first name'));
  const usernameIdx  = rawHeaders.findIndex(h => h.toLowerCase().includes('username'));
  const idIdx        = rawHeaders.findIndex(h => h.toLowerCase().includes('student id'));

  GB.students = lines.slice(1).map((line, li) => {
    const parts = line.split(delim).map(clean);
    const get = i => (i >= 0 && i < parts.length) ? parts[i] : '';
    const last  = get(lastNameIdx);
    const first = get(firstNameIdx);
    return {
      name:     (first && last) ? `${first} ${last}` : (last || `Student ${li + 1}`),
      username: get(usernameIdx),
      id:       get(idIdx),
      vals:     parts,
    };
  }).filter(s => s.name && s.vals.length > 1);

  if (!GB.students.length) throw new Error('No student rows found');

  // Auto-skip metadata and zero-point columns
  GB.skipped = new Set();
  rawHeaders.forEach((h, i) => {
    if (isMeta(h)) GB.skipped.add(i);
    if (GB.maxPts[i] !== null && GB.maxPts[i] === 0) GB.skipped.add(i);
  });

  // Reset downstream state
  GB.categories  = [];
  GB.assignments = {};
  GB.results     = [];
  GB.activeCat   = null;
  _gbCatCtr      = 0;

  // Seed two default categories
  gbAddCategory('Category 1', 50);
  gbAddCategory('Category 2', 50);
  gbResetScale();

  const gradeCols = rawHeaders.filter((_, i) => !GB.skipped.has(i) && GB.maxPts[i] !== null).length;
  const st = document.getElementById('gb-upload-status');
  st.textContent = `✓  ${GB.students.length} students · ${gradeCols} grade columns`;
  st.style.color = 'var(--green)';

  ['gb-section-cats','gb-section-assign','gb-section-scale','gb-section-calc']
    .forEach(id => document.getElementById(id).classList.remove('hidden'));

  document.getElementById('gb-placeholder').classList.add('hidden');

  gbRenderCategories();
  gbRenderColChips();
  gbRenderScaleRows();
  gbShowColumnPreview();
}

function gbShowErr(msg) {
  const st = document.getElementById('gb-upload-status');
  st.textContent = '⚠ ' + msg;
  st.style.color = 'var(--red)';
}

// ── Categories ────────────────────────────────
function gbAddCategory(name, weight) {
  const id = `gcat-${++_gbCatCtr}`;
  GB.categories.push({ id, name: name || `Category ${GB.categories.length + 1}`, weight: weight ?? 0 });
  GB.assignments[id] = [];
  gbRenderCategories();
  gbRenderCatBtns();
}

function gbRemoveCategory(id) {
  GB.categories = GB.categories.filter(c => c.id !== id);
  delete GB.assignments[id];
  if (GB.activeCat === id) GB.activeCat = null;
  gbRenderCategories();
  gbRenderCatBtns();
  gbRenderColChips();
}

function gbRenderCategories() {
  const el = document.getElementById('gb-cat-list');
  el.innerHTML = GB.categories.map(c => `
    <div class="gb-cat-row">
      <input type="text" value="${gbEsc(c.name)}" placeholder="Name"
        oninput="GB.categories.find(x=>x.id==='${c.id}').name=this.value;gbRenderCatBtns();gbRenderColChips()"/>
      <div style="display:flex;align-items:center;gap:2px">
        <input type="number" value="${c.weight}" min="0" max="100" step="1" style="text-align:center"
          oninput="GB.categories.find(x=>x.id==='${c.id}').weight=parseFloat(this.value)||0;gbRenderWeightSum()"/>
        <span style="font-size:10px;color:var(--text3);flex-shrink:0">%</span>
      </div>
      <button class="remove-var" onclick="gbRemoveCategory('${c.id}')"><i class="ti ti-x" style="font-size:12px"></i></button>
    </div>`).join('');
  gbRenderWeightSum();
}

function gbRenderWeightSum() {
  const total = GB.categories.reduce((s, c) => s + (c.weight || 0), 0);
  const ok    = Math.abs(total - 100) < 0.01;
  const el    = document.getElementById('gb-weight-sum');
  el.textContent   = `Total: ${total}% ${ok ? '✓' : '— must equal 100%'}`;
  el.style.background  = ok ? 'rgba(74,222,128,.08)'  : 'rgba(251,191,36,.08)';
  el.style.color        = ok ? 'var(--green)'           : 'var(--warn)';
  el.style.borderColor  = ok ? 'rgba(74,222,128,.25)'  : 'rgba(251,191,36,.25)';
}

// ── Column assignment ─────────────────────────
function gbRenderCatBtns() {
  const el = document.getElementById('gb-cat-btns');
  el.innerHTML = GB.categories.map(c => `
    <button class="btn btn-sm ${GB.activeCat === c.id ? 'btn-accent' : ''}"
      onclick="gbSelectCat('${c.id}')" style="font-size:11px;padding:4px 9px">
      ${gbEsc(c.name)} (${(GB.assignments[c.id] || []).length})
    </button>`).join('');
}

function gbSelectCat(id) {
  GB.activeCat = GB.activeCat === id ? null : id;
  gbRenderCatBtns();
  gbRenderColChips();
}

function gbRenderColChips() {
  const el = document.getElementById('gb-col-chips');
  const colToCat = {};
  Object.entries(GB.assignments).forEach(([catId, cols]) => cols.forEach(ci => colToCat[ci] = catId));

  const META = ['last name','first name','username','student id','last access','availability'];

  el.innerHTML = GB.headers.map((h, i) => {
    if (META.some(m => h.toLowerCase().includes(m))) return '';
    const catId  = colToCat[i];
    const isSkip = GB.skipped.has(i) && !catId;
    const max    = GB.maxPts[i];
    const label  = h.replace(/\s*\[.*?\]\s*\|?\d*/, '').trim() || h;
    const pts    = max !== null ? ` ${max}pt` : '';
    return `<span class="gb-chip ${catId ? 'gb-assigned' : ''} ${isSkip ? 'gb-skipped' : ''}"
      onclick="gbAssignCol(${i})"
      oncontextmenu="gbToggleSkip(${i});event.preventDefault()"
      title="${gbEsc(h)}${pts ? ' · ' + max + ' pts' : ''}\n${catId ? 'In: ' + GB.categories.find(c=>c.id===catId)?.name : 'Unassigned'} — right-click to skip">
      ${gbEsc(label)}<span style="color:var(--text4);margin-left:2px">${pts}</span>
    </span>`;
  }).join('');
}

function gbAssignCol(i) {
  if (!GB.activeCat) return;
  // Remove from any category
  Object.values(GB.assignments).forEach(arr => {
    const idx = arr.indexOf(i); if (idx >= 0) arr.splice(idx, 1);
  });
  // Toggle: if already in active cat it's now unassigned, else assign
  const alreadyHere = Object.entries(GB.assignments).find(([, arr]) => arr.includes(i));
  if (!alreadyHere) {
    GB.assignments[GB.activeCat].push(i);
    GB.skipped.delete(i);
  }
  gbRenderCatBtns();
  gbRenderColChips();
}

function gbToggleSkip(i) {
  Object.values(GB.assignments).forEach(arr => {
    const idx = arr.indexOf(i); if (idx >= 0) arr.splice(idx, 1);
  });
  if (GB.skipped.has(i)) GB.skipped.delete(i);
  else GB.skipped.add(i);
  gbRenderCatBtns();
  gbRenderColChips();
}

// ── Grading scale ─────────────────────────────
function gbResetScale() {
  GB.scale = [
    {letter:'A+',min:97,  max:100},   {letter:'A', min:93,  max:96.99},
    {letter:'A-',min:90,  max:92.99}, {letter:'B+',min:87,  max:89.99},
    {letter:'B', min:83,  max:86.99}, {letter:'B-',min:80,  max:82.99},
    {letter:'C+',min:77,  max:79.99}, {letter:'C', min:73,  max:76.99},
    {letter:'C-',min:70,  max:72.99}, {letter:'D+',min:67,  max:69.99},
    {letter:'D', min:60,  max:66.99}, {letter:'F', min:0,   max:59.99},
  ];
  gbRenderScaleRows();
}

function gbAddScaleRow() {
  GB.scale.push({letter:'', min:0, max:0});
  gbRenderScaleRows();
}

function gbRenderScaleRows() {
  const el = document.getElementById('gb-scale-rows');
  el.innerHTML = GB.scale.map((row, i) => `
    <div class="gb-scale-row">
      <input type="text"   value="${row.letter}" placeholder="A+" style="text-align:center"
        oninput="GB.scale[${i}].letter=this.value"/>
      <input type="number" value="${row.min}" min="0" max="100" step="0.01"
        oninput="GB.scale[${i}].min=parseFloat(this.value)||0"/>
      <input type="number" value="${row.max}" min="0" max="100" step="0.01"
        oninput="GB.scale[${i}].max=parseFloat(this.value)||0"/>
      <button class="remove-var" onclick="GB.scale.splice(${i},1);gbRenderScaleRows()">
        <i class="ti ti-x" style="font-size:11px"></i>
      </button>
    </div>`).join('');
}

function gbLetterGrade(pct) {
  const sorted = [...GB.scale].sort((a, b) => b.min - a.min);
  for (const row of sorted) {
    if (pct >= row.min) return row.letter || '?';
  }
  return GB.scale.length ? GB.scale[GB.scale.length - 1].letter : 'F';
}

function gbGradeClass(letter) {
  if (!letter) return '';
  const l = letter.toUpperCase();
  if (l.startsWith('A')) return 'gb-gA';
  if (l.startsWith('B')) return 'gb-gB';
  if (l.startsWith('C')) return 'gb-gC';
  if (l.startsWith('D')) return 'gb-gD';
  return 'gb-gF';
}

// ── Calculate ─────────────────────────────────
function gbCalculate() {
  const totalWeight = GB.categories.reduce((s, c) => s + (c.weight || 0), 0);
  if (Math.abs(totalWeight - 100) > 0.5) {
    alert(`Category weights sum to ${totalWeight}%, not 100%. Please fix before calculating.`);
    return;
  }
  if (!GB.categories.some(c => (GB.assignments[c.id] || []).length > 0)) {
    alert('No columns are assigned to any category yet. Use Step 3 to assign columns.');
    return;
  }

  GB.results = GB.students.map(s => {
    const catScores = {};
    GB.categories.forEach(cat => {
      const cols = GB.assignments[cat.id] || [];
      if (!cols.length) { catScores[cat.id] = {pct:0, earned:0, possible:0, missing:0}; return; }
      let earned = 0, possible = 0, missing = 0;
      cols.forEach(ci => {
        const raw = s.vals[ci];
        const val = (raw === '' || raw == null) ? null : parseFloat(raw.replace(/,/g, ''));
        const max = GB.maxPts[ci] || 0;
        if (val === null || isNaN(val)) missing++;
        else { earned += val; possible += max; }
      });
      catScores[cat.id] = {
        pct:      possible > 0 ? (earned / possible) * 100 : 0,
        earned, possible, missing,
      };
    });

    let finalPct = 0;
    GB.categories.forEach(cat => {
      finalPct += (catScores[cat.id].pct / 100) * cat.weight;
    });

    return {
      name:     s.name,
      username: s.username,
      id:       s.id,
      catScores,
      finalPct: Math.round(finalPct * 100) / 100,
      letter:   gbLetterGrade(finalPct),
    };
  });

  gbRenderResults();
}

// ── Render results ────────────────────────────
function gbRenderResults() {
  const results = GB.results;
  const total   = results.length;
  if (!total) return;

  const avg     = (results.reduce((s, r) => s + r.finalPct, 0) / total).toFixed(1);
  const hi      = Math.max(...results.map(r => r.finalPct)).toFixed(1);
  const lo      = Math.min(...results.map(r => r.finalPct)).toFixed(1);
  const passing = results.filter(r => r.finalPct >= 60).length;

  // Distribution
  const dist = {};
  results.forEach(r => { dist[r.letter] = (dist[r.letter] || 0) + 1; });
  const letters  = [...GB.scale].sort((a, b) => b.min - a.min).map(s => s.letter).filter(Boolean);
  const maxDist  = Math.max(...Object.values(dist), 1);

  // Sort
  const sortFn = (a, b) => {
    if (GB.sortCol === 'name')     return a.name.localeCompare(b.name) * GB.sortDir;
    if (GB.sortCol === 'finalPct') return (a.finalPct - b.finalPct) * GB.sortDir;
    if (GB.sortCol.startsWith('cat_')) {
      const id = GB.sortCol.replace('cat_', '');
      return ((a.catScores[id]?.pct || 0) - (b.catScores[id]?.pct || 0)) * GB.sortDir;
    }
    return 0;
  };
  const sorted = [...results].sort(sortFn);

  const sArrow = col => GB.sortCol === col ? (GB.sortDir > 0 ? ' ↑' : ' ↓') : '';
  const sortTh = (col, label) =>
    `<th style="cursor:pointer;user-select:none;white-space:nowrap" onclick="gbSortBy('${col}')">${label}${sArrow(col)}</th>`;

  const el = document.getElementById('gb-results');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div style="font-family:var(--font-display);font-size:15px;letter-spacing:.08em;color:var(--accent2);margin-bottom:14px">Final Grades</div>

    <!-- Stats -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:16px">
      ${[['Students',total,''],['Avg',avg+'%',''],['High',hi+'%',''],['Low',lo+'%',''],['Passing',passing,'']].map(([l,v])=>`
        <div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r2);padding:10px;text-align:center">
          <div style="font-size:18px;font-family:var(--mono);font-weight:500;color:var(--accent2)">${v}</div>
          <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:.1em;margin-top:2px">${l}</div>
        </div>`).join('')}
    </div>

    <!-- Distribution -->
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-bottom:14px">
      <div style="padding:8px 12px;border-bottom:0.5px solid var(--border);font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;background:var(--bg3)">
        Grade distribution
      </div>
      <div style="padding:10px 14px">
        ${letters.filter(l => (dist[l] || 0) >= 0).map(l => `
          <div class="gb-dist-bar">
            <span class="gb-grade-pill ${gbGradeClass(l)}" style="width:28px;text-align:center">${l}</span>
            <div class="gb-dist-outer">
              <div class="gb-dist-inner" style="width:${((dist[l]||0)/maxDist)*100}%;background:${
                l.startsWith('A')?'var(--green)':l.startsWith('B')?'var(--blue)':
                l.startsWith('C')?'var(--warn)':l.startsWith('D')?'#f97316':'var(--red)'}"></div>
            </div>
            <span style="width:24px;text-align:right;font-family:var(--mono);font-size:11px;color:var(--text3)">${dist[l]||0}</span>
          </div>`).join('')}
      </div>
    </div>

    <!-- Table -->
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);overflow:hidden">
      <div style="padding:8px 12px;border-bottom:0.5px solid var(--border);font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;background:var(--bg3);display:flex;align-items:center;gap:8px">
        Student grades
        <button class="btn btn-sm" onclick="gbExportCSV()" style="margin-left:auto;font-size:11px"><i class="ti ti-download"></i> Export CSV</button>
      </div>
      <div style="overflow-x:auto">
        <table class="dash-table" style="min-width:100%">
          <thead><tr>
            ${sortTh('name','Student')}
            <th>Username</th>
            ${GB.categories.map(c => sortTh('cat_'+c.id, gbEsc(c.name)+' %')).join('')}
            ${sortTh('finalPct','Final %')}
            <th>Grade</th>
          </tr></thead>
          <tbody>
            ${sorted.map(r => `
              <tr>
                <td style="font-weight:500;color:var(--text)">${gbEsc(r.name)}</td>
                <td style="font-family:var(--mono);font-size:11px;color:var(--text3)">${gbEsc(r.username)}</td>
                ${GB.categories.map(c => {
                  const cs  = r.catScores[c.id];
                  const pct = cs.pct.toFixed(1);
                  const col = cs.pct>=90?'var(--green)':cs.pct>=70?'var(--accent2)':cs.pct>=60?'var(--warn)':'var(--red)';
                  return `<td style="font-family:var(--mono)" title="${cs.earned.toFixed(1)}/${cs.possible} pts${cs.missing?' · '+cs.missing+' missing':''}">
                    <span style="color:${col}">${pct}%</span>
                    ${cs.missing?`<span style="font-size:9px;color:var(--text4)"> (${cs.missing}⚠)</span>`:''}
                  </td>`;
                }).join('')}
                <td style="font-family:var(--mono);font-weight:600;color:${
                  r.finalPct>=90?'var(--green)':r.finalPct>=70?'var(--accent2)':
                  r.finalPct>=60?'var(--warn)':'var(--red)'}">${r.finalPct.toFixed(2)}%</td>
                <td><span class="gb-grade-pill ${gbGradeClass(r.letter)}">${r.letter}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function gbSortBy(col) {
  if (GB.sortCol === col) GB.sortDir *= -1;
  else { GB.sortCol = col; GB.sortDir = -1; }
  gbRenderResults();
}

// ── Column preview ────────────────────────────
function gbShowColumnPreview() {
  const el = document.getElementById('gb-results');
  el.classList.remove('hidden');
  const cols = GB.headers
    .map((h, i) => ({h, i, max: GB.maxPts[i]}))
    .filter(({i}) => !GB.skipped.has(i) && GB.maxPts[i] !== null);

  el.innerHTML = `
    <div style="font-family:var(--font-display);font-size:14px;letter-spacing:.06em;color:var(--accent2);margin-bottom:10px">
      ${cols.length} grade columns detected
    </div>
    <p style="font-size:11px;color:var(--text3);margin-bottom:12px;line-height:1.6">
      Set up categories in Step 2, then assign these columns in Step 3.
      Right-click any column chip to skip it.
    </p>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      ${cols.map(({h, max}) => {
        const label = h.replace(/\s*\[.*?\]\s*\|?\d*/,'').trim();
        return `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;font-size:10px;background:var(--bg3);border:0.5px solid var(--border);color:var(--text2)">
          ${gbEsc(label)} <span style="color:var(--text4)">${max}pt</span>
        </span>`;
      }).join('')}
    </div>`;
}

// ── Export CSV ────────────────────────────────
function gbExportCSV() {
  if (!GB.results.length) { alert('Calculate grades first.'); return; }
  const rows = [
    ['Name','Username','Student ID',...GB.categories.map(c=>c.name+' %'),'Final %','Letter Grade']
  ];
  GB.results.forEach(r => {
    rows.push([
      r.name, r.username, r.id,
      ...GB.categories.map(c => r.catScores[c.id].pct.toFixed(2)),
      r.finalPct.toFixed(2),
      r.letter,
    ]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = 'final_grades.csv';
  a.click();
}

// ── Utility ───────────────────────────────────
function gbEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
