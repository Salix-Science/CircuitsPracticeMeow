/* adminlog.js — Admin audit log viewer
   Reads from the `auditLog` Firestore collection (admin-only).
   Relies on window._getFirestoreDb() and window._firestoreQuery
   exposed by firebase.js.
*/

const AUDITLOG_PAGE = 60;

const AL = {
  entries:   [],
  filtered:  [],
  allLoaded: false,
  loading:   false,
  filter:    '',
  search:    '',
  _lastDoc:  null,
};

// ── Action → display config ───────────────────
const ACTION_META = {
  save_problem:         { icon:'ti-pencil',          color:'var(--blue)',     label:'Save problem' },
  delete_problem:       { icon:'ti-trash',            color:'var(--red)',      label:'Delete problem' },
  save_folder:          { icon:'ti-folder',           color:'var(--blue)',     label:'Save folder' },
  delete_folder:        { icon:'ti-folder-x',         color:'var(--red)',      label:'Delete folder' },
  save_assignment:      { icon:'ti-clipboard',        color:'var(--blue)',     label:'Save assignment' },
  delete_assignment:    { icon:'ti-clipboard-x',      color:'var(--red)',      label:'Delete assignment' },
  publish_post:         { icon:'ti-send',             color:'var(--green)',    label:'Publish post' },
  unpublish_post:       { icon:'ti-eye-off',          color:'var(--warn)',     label:'Unpublish post' },
  delete_post:          { icon:'ti-file-x',           color:'var(--red)',      label:'Delete post' },
  save_post:            { icon:'ti-file-pencil',      color:'var(--blue)',     label:'Save post' },
  batch_create_account: { icon:'ti-users-plus',       color:'var(--accent2)',  label:'Batch create accounts' },
  create_account:       { icon:'ti-user-plus',        color:'var(--accent2)',  label:'Create account' },
  delete_account:       { icon:'ti-user-minus',       color:'var(--red)',      label:'Delete account' },
  reset_password:       { icon:'ti-key',              color:'var(--warn)',     label:'Reset password' },
  send_notification:    { icon:'ti-bell',             color:'var(--accent3)',  label:'Send notification' },
  save_event:           { icon:'ti-calendar-plus',    color:'var(--blue)',     label:'Save event' },
  delete_event:         { icon:'ti-calendar-x',       color:'var(--red)',      label:'Delete event' },
  save_homepage:        { icon:'ti-home-edit',        color:'var(--blue)',     label:'Save homepage' },
  create_section:       { icon:'ti-users-group',      color:'var(--accent2)',  label:'Create section' },
  delete_section:       { icon:'ti-users-minus',      color:'var(--red)',      label:'Delete section' },
  toggle_admin:         { icon:'ti-shield',           color:'var(--warn)',     label:'Toggle admin' },
  add_grade_col:        { icon:'ti-column-insert-right', color:'var(--blue)',  label:'Add grade column' },
  remove_grade_col:     { icon:'ti-column-remove',    color:'var(--red)',      label:'Remove grade column' },
  save_grade_cols:      { icon:'ti-columns',          color:'var(--blue)',     label:'Save grade columns' },
  enter_grade:          { icon:'ti-pencil-check',     color:'var(--green)',    label:'Enter grade' },
  bulk_post_grades:     { icon:'ti-eye-check',        color:'var(--green)',    label:'Bulk post grades' },
};

function _meta(action) {
  return ACTION_META[action] || { icon:'ti-activity', color:'var(--text3)', label: action };
}

// ── Load entries from Firestore ───────────────
window.auditLogLoadMore = async function() {
  if (AL.loading || AL.allLoaded) return;
  AL.loading = true;
  _alSpinner(true);

  try {
    const db  = window._getFirestoreDb?.();
    const fq  = window._firestoreQuery;
    if (!db || !fq) throw new Error('Firestore helpers not available — firebase.js may not have exposed _getFirestoreDb / _firestoreQuery');

    const { query, collection, orderBy, limit, startAfter, getDocs } = fq;

    let q = AL._lastDoc
      ? query(collection(db, 'adminLog'), orderBy('ts','desc'), startAfter(AL._lastDoc), limit(AUDITLOG_PAGE))
      : query(collection(db, 'adminLog'), orderBy('ts','desc'), limit(AUDITLOG_PAGE));

    const snap = await getDocs(q);
    if (snap.empty || snap.docs.length < AUDITLOG_PAGE) AL.allLoaded = true;

    snap.docs.forEach(d => AL.entries.push({ _id: d.id, ...d.data() }));
    if (snap.docs.length) AL._lastDoc = snap.docs[snap.docs.length - 1];

    _alApplyFilter();
    _alRender();
    _alBuildPills(); // rebuild now that we have new action types
  } catch(e) {
    console.error('[adminlog] load failed:', e);
    const wrap = document.getElementById('auditlog-list');
    if (wrap) wrap.insertAdjacentHTML('beforeend',
      `<div style="color:var(--red);font-size:12px;padding:8px 0"><i class="ti ti-alert-circle"></i> ${window.escHtml(e.message)}</div>`);
  } finally {
    AL.loading = false;
    _alSpinner(false);
  }
};

// ── Filter / search ───────────────────────────
function _alApplyFilter() {
  const f = AL.filter;
  const s = AL.search.toLowerCase();
  AL.filtered = AL.entries.filter(e => {
    if (f && e.action !== f) return false;
    if (s) {
      const hay = [e.action, e.admin, ...Object.values(e).map(v => String(v))].join(' ').toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
}

window.auditLogSetFilter = function(action, el) {
  AL.filter = action;
  _alApplyFilter();
  _alRender();
  document.querySelectorAll('.al-pill').forEach(p => p.classList.toggle('al-pill-active', p === el));
};

window.auditLogSearch = function(val) {
  AL.search = val;
  _alApplyFilter();
  _alRender();
};

// ── Render rows ───────────────────────────────
function _alRender() {
  const wrap  = document.getElementById('auditlog-list');
  const count = document.getElementById('auditlog-count');
  if (!wrap) return;

  if (count) {
    count.textContent = AL.filtered.length
      ? `${AL.filtered.length.toLocaleString()} entr${AL.filtered.length === 1 ? 'y' : 'ies'}`
      : '';
  }

  if (!AL.filtered.length && !AL.loading) {
    wrap.innerHTML = `<div style="color:var(--text4);font-size:12px;padding:2rem 0;text-align:center">
      <i class="ti ti-ghost" style="font-size:20px;display:block;margin-bottom:6px;opacity:.35"></i>
      No log entries${AL.filter || AL.search ? ' match the current filters' : ''}.
    </div>`;
    return;
  }

  let html = AL.filtered.map(_alRow).join('');

  if (!AL.allLoaded) {
    html += `<div style="text-align:center;padding:12px 0">
      <button class="btn btn-sm" onclick="auditLogLoadMore()">
        <i class="ti ti-chevron-down"></i> Load more
      </button>
    </div>`;
  } else if (AL.filtered.length) {
    html += `<div style="text-align:center;font-size:11px;color:var(--text4);padding:10px 0">
      — end of log —
    </div>`;
  }

  wrap.innerHTML = html;
}

function _alRow(e) {
  const meta    = _meta(e.action);
  const ts      = e.ts ? new Date(e.ts) : null;
  const timeStr = ts
    ? ts.toLocaleString(undefined, { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '—';
  const details = _alDetailLine(e);

  return `<div class="al-row">
    <div class="al-row-icon" style="color:${meta.color}"><i class="ti ${meta.icon}"></i></div>
    <div class="al-row-body">
      <div class="al-row-top">
        <span class="al-row-action" style="color:${meta.color}">${window.escHtml(meta.label)}</span>
        <span class="al-row-admin"><i class="ti ti-user-circle" style="font-size:10px;opacity:.5"></i> ${window.escHtml(e.admin || '—')}</span>
        <span class="al-row-time"><i class="ti ti-clock" style="font-size:10px;opacity:.4"></i> ${timeStr}</span>
      </div>
      ${details ? `<div class="al-row-details">${details}</div>` : ''}
    </div>
  </div>`;
}

function _alDetailLine(e) {
  const SKIP = new Set(['ts','admin','action','_id']);
  const parts = [];
  for (const [k, v] of Object.entries(e)) {
    if (SKIP.has(k)) continue;
    const label = k.replace(/_/g, ' ');
    const val   = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    parts.push(
      `<span class="al-detail-key">${window.escHtml(label)}</span>` +
      `<span class="al-detail-sep">:</span>` +
      `<span class="al-detail-val">${window.escHtml(val)}</span>`
    );
  }
  return parts.join('<span class="al-detail-dot">·</span>');
}

function _alSpinner(on) {
  const el = document.getElementById('auditlog-spinner');
  if (el) el.style.display = on ? 'inline-flex' : 'none';
}

// ── Filter pills ──────────────────────────────
function _alBuildPills() {
  const wrap = document.getElementById('auditlog-pills');
  if (!wrap) return;

  const actions = [...new Set(AL.entries.map(e => e.action))].sort();

  const allBtn = document.createElement('button');
  allBtn.className = 'al-pill al-pill-active';
  allBtn.textContent = 'All';
  allBtn.onclick = () => window.auditLogSetFilter('', allBtn);

  wrap.innerHTML = '';
  wrap.appendChild(allBtn);

  actions.forEach(a => {
    const meta = _meta(a);
    const btn  = document.createElement('button');
    btn.className = 'al-pill';
    btn.style.setProperty('--al-pill-color', meta.color);
    btn.innerHTML = `<i class="ti ${meta.icon}" style="font-size:10px"></i> ${window.escHtml(meta.label)}`;
    btn.onclick = () => window.auditLogSetFilter(a, btn);
    wrap.appendChild(btn);
  });
}

// ── Public init (called by app.js tab switch) ─
window.renderAuditLog = async function() {
  if (!window.S.isAdmin) return;

  // Reset state
  Object.assign(AL, {
    entries: [], filtered: [], allLoaded: false,
    loading: false, filter: '', search: '', _lastDoc: null,
  });

  const wrap = document.getElementById('auditlog-list');
  if (wrap) wrap.innerHTML = `<div style="color:var(--text3);font-size:12px;padding:1rem 0">
    <i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Loading…</div>`;

  const pills = document.getElementById('auditlog-pills');
  if (pills) pills.innerHTML = '';
  const search = document.getElementById('auditlog-search');
  if (search) search.value = '';
  const count = document.getElementById('auditlog-count');
  if (count) count.textContent = '';

  await window.auditLogLoadMore();
};
