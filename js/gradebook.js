/* gradebook.js — Admin-only final gradebook calculator
   Features:
   - Parses HuskyCT UTF-16 tab-separated .xls exports
   - Weighted grade categories
   - Curve lab: flat bonus, scale to max, square-root, target average
   - Live before/after curve comparison
   - CSV export + PDF report download
*/

// ── State ─────────────────────────────────────
const GB = {
  headers: [], maxPts: [], students: [],
  categories: [], assignments: {}, skipped: new Set(),
  scale: [], activeCat: null,
  results: [],        // base (uncurved) results
  curved: null,       // { method, param, results } or null
  sortCol: 'finalPct', sortDir: -1,
  showCurved: false,  // toggle between base and curved in table
};
let _gbCatCtr = 0;

// ── File handling ─────────────────────────────
function gbHandleDrop(e) {
  e.preventDefault();
  document.getElementById('gb-drop-zone').classList.remove('gb-drag-over');
  const f = e.dataTransfer.files[0]; if (f) gbProcessFile(f);
}
function gbHandleFile(e) { const f = e.target.files[0]; if (f) gbProcessFile(f); }

function gbProcessFile(file) {
  const tryParse = enc => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => { try { res(gbParseContent(e.target.result)); } catch(err) { rej(err); } };
    r.onerror = () => rej(new Error('Could not read file'));
    r.readAsText(file, enc);
  });
  tryParse('utf-16').catch(() => tryParse('utf-8')).catch(err => gbShowErr(err.message));
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
  const parseMaxPts = h => { const m = h.match(/Total Pts:\s*([\d,]+)/i); return m ? parseFloat(m[1].replace(/,/g,'')) : null; };
  GB.headers = rawHeaders;
  GB.maxPts  = rawHeaders.map(parseMaxPts);
  const find = (...terms) => rawHeaders.findIndex(h => terms.some(t => h.toLowerCase().includes(t)));
  const lastNameIdx = find('last name'), firstNameIdx = find('first name');
  const usernameIdx = find('username'),  idIdx = find('student id');
  GB.students = lines.slice(1).map((line, li) => {
    const parts = line.split(delim).map(clean);
    const get = i => (i >= 0 && i < parts.length) ? parts[i] : '';
    const last = get(lastNameIdx), first = get(firstNameIdx);
    return { name: (first && last) ? `${first} ${last}` : (last || `Student ${li+1}`),
             username: get(usernameIdx), id: get(idIdx), vals: parts };
  }).filter(s => s.name && s.vals.length > 1);
  if (!GB.students.length) throw new Error('No student rows found');
  GB.skipped = new Set();
  rawHeaders.forEach((h, i) => {
    if (isMeta(h)) GB.skipped.add(i);
    if (GB.maxPts[i] !== null && GB.maxPts[i] === 0) GB.skipped.add(i);
  });
  GB.categories = []; GB.assignments = {}; GB.results = []; GB.curved = null; _gbCatCtr = 0;
  gbAddCategory('Category 1', 50);
  gbAddCategory('Category 2', 50);
  gbResetScale();
  const gradeCols = rawHeaders.filter((_, i) => !GB.skipped.has(i) && GB.maxPts[i] !== null).length;
  const st = document.getElementById('gb-upload-status');
  st.textContent = `✓  ${GB.students.length} students · ${gradeCols} grade columns detected`;
  st.style.color = 'var(--green)';
  ['gb-section-cats','gb-section-assign','gb-section-scale','gb-section-calc']
    .forEach(id => document.getElementById(id).classList.remove('hidden'));
  document.getElementById('gb-placeholder').classList.add('hidden');
  gbRenderCategories(); gbRenderColChips(); gbRenderScaleRows(); gbShowColumnPreview();
}

function gbShowErr(msg) {
  const st = document.getElementById('gb-upload-status');
  st.textContent = '⚠ ' + msg; st.style.color = 'var(--red)';
}

// ── Categories ────────────────────────────────
function gbAddCategory(name, weight) {
  const id = `gcat-${++_gbCatCtr}`;
  GB.categories.push({ id, name: name || `Category ${GB.categories.length + 1}`, weight: weight ?? 0 });
  GB.assignments[id] = [];
  gbRenderCategories(); gbRenderCatBtns();
}
function gbRemoveCategory(id) {
  GB.categories = GB.categories.filter(c => c.id !== id);
  delete GB.assignments[id];
  if (GB.activeCat === id) GB.activeCat = null;
  gbRenderCategories(); gbRenderCatBtns(); gbRenderColChips();
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
  const ok = Math.abs(total - 100) < 0.01;
  const el = document.getElementById('gb-weight-sum');
  el.textContent = `Total: ${total}% ${ok ? '✓' : '— must equal 100%'}`;
  el.style.background  = ok ? 'rgba(74,222,128,.08)' : 'rgba(251,191,36,.08)';
  el.style.color       = ok ? 'var(--green)' : 'var(--warn)';
  el.style.borderColor = ok ? 'rgba(74,222,128,.25)' : 'rgba(251,191,36,.25)';
}

// ── Column assignment ─────────────────────────
function gbRenderCatBtns() {
  const el = document.getElementById('gb-cat-btns');
  el.innerHTML = GB.categories.map(c => `
    <button class="btn btn-sm ${GB.activeCat === c.id ? 'btn-accent' : ''}"
      onclick="gbSelectCat('${c.id}')" style="font-size:11px;padding:4px 9px">
      ${gbEsc(c.name)} (${(GB.assignments[c.id]||[]).length})
    </button>`).join('');
}
function gbSelectCat(id) {
  GB.activeCat = GB.activeCat === id ? null : id;
  gbRenderCatBtns(); gbRenderColChips();
}
function gbRenderColChips() {
  const el = document.getElementById('gb-col-chips');
  const colToCat = {};
  Object.entries(GB.assignments).forEach(([catId, cols]) => cols.forEach(ci => colToCat[ci] = catId));
  const META = ['last name','first name','username','student id','last access','availability'];
  el.innerHTML = GB.headers.map((h, i) => {
    if (META.some(m => h.toLowerCase().includes(m))) return '';
    const catId = colToCat[i], isSkip = GB.skipped.has(i) && !catId;
    const label = h.replace(/\s*\[.*?\]\s*\|?\d*/, '').trim() || h;
    const pts   = GB.maxPts[i] !== null ? ` ${GB.maxPts[i]}pt` : '';
    return `<span class="gb-chip ${catId?'gb-assigned':''} ${isSkip?'gb-skipped':''}"
      onclick="gbAssignCol(${i})" oncontextmenu="gbToggleSkip(${i});event.preventDefault()"
      title="${gbEsc(h)}${pts}\n${catId?'In: '+GB.categories.find(c=>c.id===catId)?.name:'Unassigned'} — right-click to skip">
      ${gbEsc(label)}<span style="color:var(--text4);margin-left:2px">${pts}</span>
    </span>`;
  }).join('');
}
function gbAssignCol(i) {
  if (!GB.activeCat) return;
  Object.values(GB.assignments).forEach(arr => { const idx=arr.indexOf(i); if(idx>=0) arr.splice(idx,1); });
  const already = Object.entries(GB.assignments).find(([,arr]) => arr.includes(i));
  if (!already) { GB.assignments[GB.activeCat].push(i); GB.skipped.delete(i); }
  gbRenderCatBtns(); gbRenderColChips();
}
function gbToggleSkip(i) {
  Object.values(GB.assignments).forEach(arr => { const idx=arr.indexOf(i); if(idx>=0) arr.splice(idx,1); });
  if (GB.skipped.has(i)) GB.skipped.delete(i); else GB.skipped.add(i);
  gbRenderCatBtns(); gbRenderColChips();
}

// ── Grading scale ─────────────────────────────
function gbResetScale() {
  GB.scale = [
    {letter:'A+',min:97,max:100},{letter:'A',min:93,max:96.99},{letter:'A-',min:90,max:92.99},
    {letter:'B+',min:87,max:89.99},{letter:'B',min:83,max:86.99},{letter:'B-',min:80,max:82.99},
    {letter:'C+',min:77,max:79.99},{letter:'C',min:73,max:76.99},{letter:'C-',min:70,max:72.99},
    {letter:'D+',min:67,max:69.99},{letter:'D',min:60,max:66.99},{letter:'F',min:0,max:59.99},
  ];
  gbRenderScaleRows();
}
function gbAddScaleRow() { GB.scale.push({letter:'',min:0,max:0}); gbRenderScaleRows(); }
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
  const sorted = [...GB.scale].sort((a,b) => b.min - a.min);
  for (const row of sorted) { if (pct >= row.min) return row.letter || '?'; }
  return GB.scale.length ? GB.scale[GB.scale.length-1].letter : 'F';
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

// ── Calculate base grades ─────────────────────
function gbCalculate() {
  const totalWeight = GB.categories.reduce((s,c) => s+(c.weight||0), 0);
  if (Math.abs(totalWeight - 100) > 0.5) { alert(`Weights sum to ${totalWeight}%, not 100%.`); return; }
  if (!GB.categories.some(c => (GB.assignments[c.id]||[]).length > 0)) {
    alert('No columns assigned yet. Use Step 3.'); return;
  }
  GB.results = GB.students.map(s => {
    const catScores = {};
    GB.categories.forEach(cat => {
      const cols = GB.assignments[cat.id] || [];
      if (!cols.length) { catScores[cat.id] = {pct:0,earned:0,possible:0,missing:0}; return; }
      let earned=0, possible=0, missing=0;
      cols.forEach(ci => {
        const raw = s.vals[ci];
        const val = (raw===''||raw==null) ? null : parseFloat(raw.replace(/,/g,''));
        const max = GB.maxPts[ci] || 0;
        if (val===null||isNaN(val)) missing++;
        else { earned+=val; possible+=max; }
      });
      catScores[cat.id] = { pct: possible>0?(earned/possible)*100:0, earned, possible, missing };
    });
    let finalPct = 0;
    GB.categories.forEach(cat => { finalPct += (catScores[cat.id].pct/100)*cat.weight; });
    finalPct = Math.round(finalPct*100)/100;
    return { name:s.name, username:s.username, id:s.id, catScores, finalPct, letter:gbLetterGrade(finalPct) };
  });
  GB.curved = null;
  GB.showCurved = false;
  gbRenderResults();
}

// ── Curve lab ─────────────────────────────────
// Apply a curve method to GB.results and return new result array
function gbApplyCurve(method, param) {
  const base = GB.results;
  if (!base.length) return [];
  const scores = base.map(r => r.finalPct);
  const hi  = Math.max(...scores);
  const avg = scores.reduce((a,b)=>a+b,0) / scores.length;

  return base.map(r => {
    let curved;
    switch (method) {
      case 'flat':
        curved = Math.min(100, r.finalPct + param);
        break;
      case 'scale':
        curved = hi > 0 ? Math.min(100, (r.finalPct / hi) * 100) : r.finalPct;
        break;
      case 'sqrt':
        curved = Math.min(100, Math.sqrt(r.finalPct / 100) * 100);
        break;
      case 'target': {
        const shift = param - avg;
        curved = Math.min(100, Math.max(0, r.finalPct + shift));
        break;
      }
      default:
        curved = r.finalPct;
    }
    curved = Math.round(curved * 100) / 100;
    return { ...r, finalPct: curved, letter: gbLetterGrade(curved), _base: r.finalPct };
  });
}

function gbPreviewCurve() {
  const method = document.getElementById('gb-curve-method')?.value;
  const param  = parseFloat(document.getElementById('gb-curve-param')?.value) || 0;
  if (!GB.results.length) { alert('Calculate grades first.'); return; }

  const curvedResults = gbApplyCurve(method, param);
  GB.curved = { method, param, results: curvedResults };

  // Show comparison panel
  gbRenderCurveComparison(curvedResults);
}

function gbApplyCurveToResults() {
  if (!GB.curved) return;
  GB.results  = GB.curved.results.map(r => ({ ...r, _base: undefined }));
  GB.curved   = null;
  GB.showCurved = false;
  document.getElementById('gb-curve-comparison').innerHTML =
    '<div style="color:var(--green);font-size:12px;padding:8px 0">✓ Curve applied. Grades updated.</div>';
  gbRenderResults();
}

function gbRenderCurveComparison(curvedResults) {
  const el = document.getElementById('gb-curve-comparison');
  const base = GB.results;

  const baseAvg   = base.reduce((s,r)=>s+r.finalPct,0)/base.length;
  const curvedAvg = curvedResults.reduce((s,r)=>s+r.finalPct,0)/curvedResults.length;

  // Grade distribution comparison
  const baseDist = {}, curvedDist = {};
  const letters  = [...GB.scale].sort((a,b)=>b.min-a.min).map(s=>s.letter).filter(Boolean);
  base.forEach(r => { baseDist[r.letter] = (baseDist[r.letter]||0)+1; });
  curvedResults.forEach(r => { curvedDist[r.letter] = (curvedDist[r.letter]||0)+1; });

  const maxN = Math.max(...Object.values({...baseDist,...curvedDist}), 1);
  const n    = base.length;

  const methodLabels = {
    flat:   `+${document.getElementById('gb-curve-param')?.value||0}% flat bonus`,
    scale:  'Scale to max (highest = 100%)',
    sqrt:   'Square root curve',
    target: `Target average of ${document.getElementById('gb-curve-param')?.value||0}%`,
  };
  const methodKey = document.getElementById('gb-curve-method')?.value;

  el.innerHTML = `
    <div style="margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:var(--accent2);margin-bottom:4px">
        Preview: ${methodLabels[methodKey]||''}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        ${gbStatChip('Before avg', baseAvg.toFixed(1)+'%')}
        ${gbStatChip('After avg', curvedAvg.toFixed(1)+'%', curvedAvg>baseAvg?'green':curvedAvg<baseAvg?'red':'')}
        ${gbStatChip('Δ avg', (curvedAvg-baseAvg>0?'+':'')+((curvedAvg-baseAvg).toFixed(1))+'%', curvedAvg>baseAvg?'green':'')}
      </div>
    </div>
    <div style="font-size:10px;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em;font-weight:700">Grade distribution comparison</div>
    ${letters.map(l => {
      const b = baseDist[l]||0, c = curvedDist[l]||0;
      const bw = (b/maxN)*100, cw = (c/maxN)*100;
      const col = l.startsWith('A')?'var(--green)':l.startsWith('B')?'var(--blue)':
                  l.startsWith('C')?'var(--warn)':l.startsWith('D')?'#f97316':'var(--red)';
      const delta = c-b;
      return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11px">
        <span class="gb-grade-pill ${gbGradeClass(l)}" style="width:26px;text-align:center;flex-shrink:0">${l}</span>
        <div style="flex:1">
          <div style="height:7px;background:var(--bg4);border-radius:2px;overflow:hidden;margin-bottom:2px">
            <div style="height:100%;width:${bw}%;background:${col};opacity:0.4;border-radius:2px"></div>
          </div>
          <div style="height:7px;background:var(--bg4);border-radius:2px;overflow:hidden">
            <div style="height:100%;width:${cw}%;background:${col};border-radius:2px"></div>
          </div>
        </div>
        <span style="font-family:var(--mono);width:28px;text-align:right;color:var(--text3)">${b}→${c}</span>
        <span style="font-family:var(--mono);width:28px;text-align:right;color:${delta>0?'var(--green)':delta<0?'var(--red)':'var(--text4)'}">
          ${delta>0?'+':''}${delta||''}
        </span>
      </div>`;
    }).join('')}
    <div style="margin-top:10px;font-size:10px;color:var(--text4)">
      Light bars = before · Solid bars = after
    </div>
    <div style="display:flex;gap:6px;margin-top:12px">
      <button class="btn btn-sm btn-accent" onclick="gbApplyCurveToResults()" style="flex:1;justify-content:center">
        <i class="ti ti-check"></i> Apply this curve
      </button>
      <button class="btn btn-sm" onclick="document.getElementById('gb-curve-comparison').innerHTML=''" style="font-size:11px">
        Cancel
      </button>
    </div>
    <div style="margin-top:10px;overflow-x:auto">
      <table class="dash-table" style="font-size:11px">
        <thead><tr><th>Student</th><th>Before</th><th>After</th><th>Δ</th><th>Grade</th></tr></thead>
        <tbody>
          ${[...curvedResults].sort((a,b)=>b.finalPct-a.finalPct).map(r=>{
            const delta = r.finalPct-(r._base||0);
            return `<tr>
              <td style="color:var(--text)">${gbEsc(r.name)}</td>
              <td style="font-family:var(--mono)">${(r._base||0).toFixed(2)}%</td>
              <td style="font-family:var(--mono);font-weight:600;color:${r.finalPct>=70?'var(--green)':r.finalPct>=60?'var(--warn)':'var(--red)'}">${r.finalPct.toFixed(2)}%</td>
              <td style="font-family:var(--mono);color:${delta>0?'var(--green)':delta<0?'var(--red)':'var(--text4)'}">${delta>0?'+':''}${delta.toFixed(2)}</td>
              <td><span class="gb-grade-pill ${gbGradeClass(r.letter)}">${r.letter}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function gbStatChip(label, value, color) {
  const col = color==='green'?'var(--green)':color==='red'?'var(--red)':'var(--accent2)';
  return `<div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r);padding:6px 10px;min-width:70px;text-align:center">
    <div style="font-family:var(--mono);font-size:14px;font-weight:500;color:${col}">${value}</div>
    <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:.08em;margin-top:1px">${label}</div>
  </div>`;
}

// ── Render results ────────────────────────────
function gbRenderResults() {
  const results = GB.results;
  const total   = results.length;
  if (!total) return;

  const avg     = (results.reduce((s,r) => s+r.finalPct, 0)/total).toFixed(1);
  const hi      = Math.max(...results.map(r=>r.finalPct)).toFixed(1);
  const lo      = Math.min(...results.map(r=>r.finalPct)).toFixed(1);
  const passing = results.filter(r=>r.finalPct>=60).length;

  const dist = {};
  results.forEach(r => { dist[r.letter]=(dist[r.letter]||0)+1; });
  const letters = [...GB.scale].sort((a,b)=>b.min-a.min).map(s=>s.letter).filter(Boolean);
  const maxDist = Math.max(...Object.values(dist), 1);

  const sortFn = (a,b) => {
    if (GB.sortCol==='name')     return a.name.localeCompare(b.name)*GB.sortDir;
    if (GB.sortCol==='finalPct') return (a.finalPct-b.finalPct)*GB.sortDir;
    if (GB.sortCol.startsWith('cat_')) {
      const id=GB.sortCol.replace('cat_','');
      return ((a.catScores[id]?.pct||0)-(b.catScores[id]?.pct||0))*GB.sortDir;
    }
    return 0;
  };
  const sorted = [...results].sort(sortFn);
  const sArrow = col => GB.sortCol===col?(GB.sortDir>0?' ↑':' ↓'):'';
  const sortTh = (col,label) =>
    `<th style="cursor:pointer;user-select:none;white-space:nowrap" onclick="gbSortBy('${col}')">${label}${sArrow(col)}</th>`;

  const el = document.getElementById('gb-results');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div style="font-family:var(--font-display);font-size:15px;letter-spacing:.08em;color:var(--accent2);margin-bottom:14px">Final Grades</div>

    <!-- Stats -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px;margin-bottom:16px">
      ${[['Students',total],['Average',avg+'%'],['Highest',hi+'%'],['Lowest',lo+'%'],['Passing',passing]].map(([l,v])=>`
        <div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r2);padding:10px;text-align:center">
          <div style="font-size:18px;font-family:var(--mono);font-weight:500;color:var(--accent2)">${v}</div>
          <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:.1em;margin-top:2px">${l}</div>
        </div>`).join('')}
    </div>

    <!-- Distribution -->
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-bottom:14px">
      <div style="padding:8px 12px;border-bottom:0.5px solid var(--border);font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;background:var(--bg3)">Grade distribution</div>
      <div style="padding:10px 14px">
        ${letters.map(l=>`
          <div class="gb-dist-bar">
            <span class="gb-grade-pill ${gbGradeClass(l)}" style="width:28px;text-align:center">${l}</span>
            <div class="gb-dist-outer"><div class="gb-dist-inner" style="width:${((dist[l]||0)/maxDist)*100}%;background:${
              l.startsWith('A')?'var(--green)':l.startsWith('B')?'var(--blue)':
              l.startsWith('C')?'var(--warn)':l.startsWith('D')?'#f97316':'var(--red)'}"></div></div>
            <span style="width:24px;text-align:right;font-family:var(--mono);font-size:11px;color:var(--text3)">${dist[l]||0}</span>
          </div>`).join('')}
      </div>
    </div>

    <!-- Curve lab -->
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-bottom:14px">
      <div style="padding:8px 12px;border-bottom:0.5px solid var(--border);font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;background:var(--bg3);display:flex;align-items:center;gap:6px">
        <i class="ti ti-chart-line" style="font-size:12px"></i> Curve lab
        <span style="font-size:9px;font-weight:400;color:var(--text4);margin-left:4px">preview any curve without committing — click Apply to make it permanent</span>
      </div>
      <div style="padding:12px 14px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
          <div style="flex:1;min-width:160px">
            <label>Curve method</label>
            <select id="gb-curve-method" onchange="gbUpdateCurveParam()">
              <option value="flat">Flat bonus — add points to everyone</option>
              <option value="scale">Scale to max — highest score becomes 100%</option>
              <option value="sqrt">Square root — √(score/100) × 100</option>
              <option value="target">Target average — shift everyone to hit a target avg</option>
            </select>
          </div>
          <div id="gb-curve-param-wrap" style="width:130px">
            <label id="gb-curve-param-label">Bonus points (%)</label>
            <input type="number" id="gb-curve-param" value="5" min="0" max="50" step="0.5"/>
          </div>
          <button class="btn btn-accent btn-sm" onclick="gbPreviewCurve()" style="align-self:flex-end">
            <i class="ti ti-eye"></i> Preview
          </button>
        </div>
        <div id="gb-curve-comparison"></div>
      </div>
    </div>

    <!-- Grade table -->
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);overflow:hidden">
      <div style="padding:8px 12px;border-bottom:0.5px solid var(--border);font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;background:var(--bg3);display:flex;align-items:center;gap:8px">
        <i class="ti ti-list" style="font-size:12px"></i> Student grades
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="btn btn-sm" onclick="gbExportCSV()" style="font-size:11px"><i class="ti ti-file-text"></i> CSV</button>
          <button class="btn btn-sm btn-accent" onclick="gbExportPDF()" style="font-size:11px"><i class="ti ti-file-type-pdf"></i> PDF report</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="dash-table" style="min-width:100%">
          <thead><tr>
            ${sortTh('name','Student')}
            <th>Username</th>
            ${GB.categories.map(c=>sortTh('cat_'+c.id,gbEsc(c.name)+' %')).join('')}
            ${sortTh('finalPct','Final %')}
            <th>Grade</th>
          </tr></thead>
          <tbody>
            ${sorted.map(r=>`
              <tr>
                <td style="font-weight:500;color:var(--text)">${gbEsc(r.name)}</td>
                <td style="font-family:var(--mono);font-size:11px;color:var(--text3)">${gbEsc(r.username)}</td>
                ${GB.categories.map(c=>{
                  const cs=r.catScores[c.id], pct=cs.pct.toFixed(1);
                  const col=cs.pct>=90?'var(--green)':cs.pct>=70?'var(--accent2)':cs.pct>=60?'var(--warn)':'var(--red)';
                  return `<td style="font-family:var(--mono)" title="${cs.earned.toFixed(1)}/${cs.possible} pts${cs.missing?' · '+cs.missing+' missing':''}">
                    <span style="color:${col}">${pct}%</span>
                    ${cs.missing?`<span style="font-size:9px;color:var(--text4)"> (${cs.missing}⚠)</span>`:''}
                  </td>`;
                }).join('')}
                <td style="font-family:var(--mono);font-weight:600;color:${
                  r.finalPct>=90?'var(--green)':r.finalPct>=70?'var(--accent2)':r.finalPct>=60?'var(--warn)':'var(--red)'}">${r.finalPct.toFixed(2)}%</td>
                <td><span class="gb-grade-pill ${gbGradeClass(r.letter)}">${r.letter}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function gbUpdateCurveParam() {
  const method = document.getElementById('gb-curve-method')?.value;
  const label  = document.getElementById('gb-curve-param-label');
  const wrap   = document.getElementById('gb-curve-param-wrap');
  const input  = document.getElementById('gb-curve-param');
  document.getElementById('gb-curve-comparison').innerHTML = '';
  if (method==='scale'||method==='sqrt') {
    wrap.style.display='none';
  } else {
    wrap.style.display='';
    if (label) label.textContent = method==='flat'?'Bonus points (%)':'Target average (%)';
    if (input) input.value = method==='target'?'75':'5';
  }
}

function gbSortBy(col) {
  if (GB.sortCol===col) GB.sortDir*=-1; else { GB.sortCol=col; GB.sortDir=-1; }
  gbRenderResults();
}

// ── Column preview ────────────────────────────
function gbShowColumnPreview() {
  const el   = document.getElementById('gb-results');
  el.classList.remove('hidden');
  const cols = GB.headers.map((h,i)=>({h,i,max:GB.maxPts[i]})).filter(({i})=>!GB.skipped.has(i)&&GB.maxPts[i]!==null);
  el.innerHTML = `
    <div style="font-family:var(--font-display);font-size:14px;letter-spacing:.06em;color:var(--accent2);margin-bottom:10px">${cols.length} grade columns detected</div>
    <p style="font-size:11px;color:var(--text3);margin-bottom:12px;line-height:1.6">
      Set up categories (Step 2), assign columns (Step 3), then calculate. Right-click a chip to skip it.
    </p>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      ${cols.map(({h,max})=>{
        const label=h.replace(/\s*\[.*?\]\s*\|?\d*/,'').trim();
        return `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;font-size:10px;background:var(--bg3);border:0.5px solid var(--border);color:var(--text2)">
          ${gbEsc(label)} <span style="color:var(--text4)">${max}pt</span>
        </span>`;
      }).join('')}
    </div>`;
}

// ── CSV export ────────────────────────────────
function gbExportCSV() {
  if (!GB.results.length) { alert('Calculate grades first.'); return; }
  const rows = [['Name','Username','Student ID',...GB.categories.map(c=>c.name+' %'),'Final %','Letter Grade']];
  [...GB.results].sort((a,b)=>a.name.localeCompare(b.name)).forEach(r => {
    rows.push([r.name,r.username,r.id,...GB.categories.map(c=>r.catScores[c.id].pct.toFixed(2)),r.finalPct.toFixed(2),r.letter]);
  });
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = 'final_grades.csv'; a.click();
}

// ── PDF report ────────────────────────────────
function gbExportPDF() {
  if (!GB.results.length) { alert('Calculate grades first.'); return; }

  const results = [...GB.results].sort((a,b)=>a.name.localeCompare(b.name));
  const total   = results.length;
  const avg     = (results.reduce((s,r)=>s+r.finalPct,0)/total).toFixed(1);
  const hi      = Math.max(...results.map(r=>r.finalPct)).toFixed(1);
  const lo      = Math.min(...results.map(r=>r.finalPct)).toFixed(1);
  const passing = results.filter(r=>r.finalPct>=60).length;
  const now     = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});

  const dist = {};
  results.forEach(r => { dist[r.letter]=(dist[r.letter]||0)+1; });
  const letters = [...GB.scale].sort((a,b)=>b.min-a.min).map(s=>s.letter).filter(Boolean);

  const gradeColor = pct =>
    pct>=90?'#4ade80':pct>=80?'#60a5fa':pct>=70?'#a78bfa':pct>=60?'#fbbf24':'#f87171';

  const letterColor = l =>
    l.startsWith('A')?'#4ade80':l.startsWith('B')?'#60a5fa':
    l.startsWith('C')?'#fbbf24':l.startsWith('D')?'#f97316':'#f87171';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>Grade Report</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size:12px; color:#1e1b2e; background:#fff; }
  .page { max-width:860px; margin:0 auto; padding:32px 36px; }
  h1 { font-size:22px; font-weight:700; color:#8a5326; letter-spacing:.04em; }
  h2 { font-size:13px; font-weight:700; color:#a5631f; text-transform:uppercase; letter-spacing:.1em; margin-bottom:10px; padding-bottom:4px; border-bottom:1.5px solid #f0ddc0; }
  .meta { font-size:11px; color:#b9772f; margin-top:4px; }
  .stats { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; margin:20px 0; }
  .stat { background:#fdf3e6; border:1px solid #f0ddc0; border-radius:8px; padding:12px; text-align:center; }
  .stat-val { font-size:20px; font-weight:700; color:#8a5326; }
  .stat-lbl { font-size:9px; color:#b9772f; text-transform:uppercase; letter-spacing:.08em; margin-top:3px; }
  .dist-row { display:flex; align-items:center; gap:10px; margin-bottom:5px; }
  .dist-letter { width:32px; text-align:center; font-size:11px; font-weight:700; padding:2px 6px; border-radius:4px; }
  .dist-bar-outer { flex:1; height:14px; background:#f3f4f6; border-radius:3px; overflow:hidden; }
  .dist-bar-inner { height:100%; border-radius:3px; }
  .dist-n { width:30px; text-align:right; font-size:11px; color:#6b7280; font-variant-numeric:tabular-nums; }
  table { width:100%; border-collapse:collapse; margin-top:0; font-size:11px; }
  th { background:#8a5326; color:#fff; padding:7px 10px; text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.07em; }
  td { padding:6px 10px; border-bottom:1px solid #f0ddc0; }
  tr:nth-child(even) td { background:#fdf8f1; }
  .grade-pill { font-size:11px; font-weight:700; padding:2px 7px; border-radius:4px; display:inline-block; }
  .scale-table td, .scale-table th { padding:5px 10px; }
  .section { margin-bottom:28px; }
  .page-break { page-break-before:always; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding:20px 24px; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="section">
    <h1>Grade Report</h1>
    <div class="meta">Generated: ${now} &nbsp;·&nbsp; ${total} students &nbsp;·&nbsp; ${GB.categories.length} categories</div>
  </div>

  <!-- Stats -->
  <div class="section">
    <h2>Class summary</h2>
    <div class="stats">
      <div class="stat"><div class="stat-val">${total}</div><div class="stat-lbl">Students</div></div>
      <div class="stat"><div class="stat-val">${avg}%</div><div class="stat-lbl">Average</div></div>
      <div class="stat"><div class="stat-val">${hi}%</div><div class="stat-lbl">Highest</div></div>
      <div class="stat"><div class="stat-val">${lo}%</div><div class="stat-lbl">Lowest</div></div>
      <div class="stat"><div class="stat-val">${passing}</div><div class="stat-lbl">Passing</div></div>
    </div>
  </div>

  <!-- Distribution -->
  <div class="section">
    <h2>Grade distribution</h2>
    ${letters.map(l=>{
      const n=dist[l]||0, pct=Math.round(n/total*100);
      const col=letterColor(l);
      return `<div class="dist-row">
        <span class="dist-letter" style="background:${col}22;color:${col}">${l}</span>
        <div class="dist-bar-outer"><div class="dist-bar-inner" style="width:${(n/Math.max(...Object.values(dist),1))*100}%;background:${col}"></div></div>
        <span class="dist-n">${n} (${pct}%)</span>
      </div>`;
    }).join('')}
  </div>

  <!-- Categories -->
  <div class="section">
    <h2>Grade categories</h2>
    <table>
      <thead><tr><th>Category</th><th>Weight</th><th>Columns assigned</th></tr></thead>
      <tbody>
        ${GB.categories.map(c=>`
          <tr>
            <td style="font-weight:600">${gbEsc(c.name)}</td>
            <td>${c.weight}%</td>
            <td style="color:#6b7280">${(GB.assignments[c.id]||[]).length} column${(GB.assignments[c.id]||[]).length!==1?'s':''}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- Grading scale -->
  <div class="section">
    <h2>Grading scale</h2>
    <table class="scale-table" style="width:auto">
      <thead><tr><th>Grade</th><th>Min %</th><th>Max %</th></tr></thead>
      <tbody>
        ${[...GB.scale].sort((a,b)=>b.min-a.min).map(r=>`
          <tr>
            <td><span class="grade-pill" style="background:${letterColor(r.letter)}22;color:${letterColor(r.letter)}">${r.letter}</span></td>
            <td>${r.min}%</td>
            <td>${r.max}%</td>
          </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- Grade table -->
  <div class="page-break"></div>
  <div class="section">
    <h2>Student grades</h2>
    <table>
      <thead><tr>
        <th>Student</th>
        <th>Username</th>
        ${GB.categories.map(c=>`<th>${gbEsc(c.name)}</th>`).join('')}
        <th>Final %</th>
        <th>Grade</th>
      </tr></thead>
      <tbody>
        ${results.map(r=>`
          <tr>
            <td style="font-weight:600">${gbEsc(r.name)}</td>
            <td style="color:#6b7280;font-size:10px">${gbEsc(r.username)}</td>
            ${GB.categories.map(c=>{
              const cs=r.catScores[c.id], pct=cs.pct.toFixed(1);
              return `<td style="color:${gradeColor(cs.pct)};font-weight:500">${pct}%${cs.missing?` ⚠${cs.missing}`:''}</td>`;
            }).join('')}
            <td style="font-weight:700;color:${gradeColor(r.finalPct)}">${r.finalPct.toFixed(2)}%</td>
            <td><span class="grade-pill" style="background:${letterColor(r.letter)}22;color:${letterColor(r.letter)}">${r.letter}</span></td>
          </tr>`).join('')}
      </tbody>
    </table>
  </div>

</div>
</body>
</html>`;

  // Open in new tab and trigger print dialog
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.onload = () => win.print();
}

// ── Utility ───────────────────────────────────
function gbEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
