/* sections.js — Admin section management and section-filtered grade view */

let _activeSectionId = null;
let _sectionAllUsers = [];
let _savingSection   = false; // prevent double-clicks

// ── Render section list only (no side effects) ─
window.renderSections = async function() {
  if (!window.S.isAdmin) return;

  // Fetch fresh user list once
  _sectionAllUsers = (await window._fetchAllUsers()).filter(u => !u.isAdmin);

  _drawSectionList();
  window.rebuildSectionFilter?.();

  // If a section was already selected, refresh its detail panels
  if (_activeSectionId) {
    renderSectionMembers();
    renderSectionAvailable();
  }
};

// Draw just the left-side section list — no async, no selectSection call
function _drawSectionList() {
  const list     = document.getElementById('section-list');
  const empty    = document.getElementById('section-list-empty');
  const sections = window.DB.sections || [];

  list.innerHTML = '';
  empty.style.display = sections.length ? 'none' : 'block';

  sections.forEach(s => {
    const item = document.createElement('div');
    item.style.cssText = [
      'display:flex;align-items:center;gap:8px;padding:9px 12px',
      'border-radius:var(--r);cursor:pointer;border:0.5px solid;margin-bottom:4px;transition:all .15s',
      _activeSectionId === s.id
        ? 'background:rgba(207,138,69,.1);border-color:var(--accent)'
        : 'background:var(--bg3);border-color:var(--border)'
    ].join(';');

    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'font-size:13px;font-weight:500;color:var(--text);flex:1';
    nameEl.textContent = s.name;

    const countEl = document.createElement('span');
    countEl.style.cssText = 'font-size:11px;color:var(--text4);font-family:var(--mono)';
    countEl.textContent = `${(s.studentUids||[]).length} students`;

    item.appendChild(nameEl);
    item.appendChild(countEl);
    item.addEventListener('click', () => selectSection(s.id));
    list.appendChild(item);
  });
}

// ── Select a section ───────────────────────────
window.selectSection = function(id) {
  _activeSectionId = id;
  const s = window.DB.sections.find(s => s.id === id);
  if (!s) { console.error('selectSection: section not found', id); return; }

  console.log('selectSection:', s.name, 'users cached:', _sectionAllUsers.length);

  // Update active highlight in list without re-fetching
  _drawSectionList();

  // Show detail panel
  const detail = document.getElementById('section-detail');
  if (!detail) { console.error('selectSection: #section-detail not found'); return; }
  detail.style.display = 'block';
  document.getElementById('section-detail-name').textContent = s.name;
  document.getElementById('section-member-count').textContent = `(${(s.studentUids||[]).length})`;
  document.getElementById('section-student-search').value = '';

  renderSectionMembers();
  renderSectionAvailable();
};

// ── Create section ─────────────────────────────
window.createSection = async function() {
  if (!window.S.isAdmin) return;
  const input = document.getElementById('new-section-name');
  const name  = input?.value.trim();
  if (!name) return;

  const section = { id: `sec-${Date.now()}`, name, studentUids: [] };
  window.DB.sections.push(section);
  await _saveSection(section);
  logAdminAction('create_section', { id: section.id, name });
  if (input) input.value = '';
  _drawSectionList();
  window.rebuildSectionFilter?.();
};

// ── Delete section ─────────────────────────────
window.deleteSection = async function() {
  if (!window.S.isAdmin || !_activeSectionId) return;
  const s = window.DB.sections.find(s => s.id === _activeSectionId);
  if (!s) return;
  if (!confirm(`Delete section "${s.name}"? Students won't be deleted.`)) return;

  await window.deleteFromDB('sections', _activeSectionId);
  logAdminAction('delete_section', { id: _activeSectionId, name: s.name });
  window.DB.sections = window.DB.sections.filter(s => s.id !== _activeSectionId);
  _activeSectionId = null;
  document.getElementById('section-detail').style.display = 'none';
  _drawSectionList();
  window.rebuildSectionFilter?.();
};

// ── Members in section ─────────────────────────
window.renderSectionMembers = function() {
  const s    = window.DB.sections.find(s => s.id === _activeSectionId);
  const wrap = document.getElementById('section-members');
  if (!s || !wrap) return;

  wrap.innerHTML = '';
  const members = _sectionAllUsers.filter(u => (s.studentUids||[]).includes(u.uid));

  if (!members.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:12px;color:var(--text4)';
    msg.textContent = 'No students yet — add from the right.';
    wrap.appendChild(msg);
    return;
  }

  members.forEach(u => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r);font-size:12px;margin-bottom:4px';

    const name = document.createElement('span');
    name.style.cssText = 'flex:1;color:var(--text)';
    name.textContent = u.username;

    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-red';
    btn.style.cssText = 'padding:3px 8px;font-size:11px;flex-shrink:0';
    btn.innerHTML = '<i class="ti ti-x"></i>';
    btn.addEventListener('click', () => removeFromSection(u.uid));

    row.appendChild(name);
    row.appendChild(btn);
    wrap.appendChild(row);
  });
};

// ── Available students ─────────────────────────
window.renderSectionAvailable = function() {
  const s     = window.DB.sections.find(s => s.id === _activeSectionId);
  const wrap  = document.getElementById('section-available');
  const query = (document.getElementById('section-student-search')?.value || '').toLowerCase().trim();
  if (!s || !wrap) return;

  wrap.innerHTML = '';
  const available = _sectionAllUsers
    .filter(u => !(s.studentUids||[]).includes(u.uid))
    .filter(u => !query || u.username.toLowerCase().includes(query));

  if (!available.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:12px;color:var(--text4)';
    msg.textContent = query ? 'No students match.' : 'All students are already in this section.';
    wrap.appendChild(msg);
    return;
  }

  available.forEach(u => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r);font-size:12px;margin-bottom:4px';

    const name = document.createElement('span');
    name.style.cssText = 'flex:1;color:var(--text)';
    name.textContent = u.username;

    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-accent';
    btn.style.cssText = 'padding:3px 8px;font-size:11px;flex-shrink:0';
    btn.innerHTML = '<i class="ti ti-plus"></i>';
    btn.addEventListener('click', () => addToSection(u.uid));

    row.appendChild(name);
    row.appendChild(btn);
    wrap.appendChild(row);
  });
};

// ── Add student ────────────────────────────────
window.addToSection = async function(uid) {
  console.log('addToSection called, uid:', uid, 'saving:', _savingSection, 'activeSection:', _activeSectionId);
  if (_savingSection) { console.warn('addToSection: blocked by _savingSection'); return; }
  const s = window.DB.sections.find(s => s.id === _activeSectionId);
  if (!s) { console.error('addToSection: no active section'); return; }
  if (!s.studentUids) s.studentUids = [];
  if (s.studentUids.includes(uid)) return;

  _savingSection = true;
  s.studentUids.push(uid);
  document.getElementById('section-member-count').textContent = `(${s.studentUids.length})`;

  // Re-render panels immediately (optimistic) before the save
  renderSectionMembers();
  renderSectionAvailable();
  window.rebuildSectionFilter?.();
  _drawSectionList();

  await _saveSection(s);
  _savingSection = false;
};

// ── Remove student ─────────────────────────────
window.removeFromSection = async function(uid) {
  if (_savingSection) return;
  const s = window.DB.sections.find(s => s.id === _activeSectionId);
  if (!s) return;

  _savingSection = true;
  s.studentUids = (s.studentUids || []).filter(id => id !== uid);
  document.getElementById('section-member-count').textContent = `(${s.studentUids.length})`;

  renderSectionMembers();
  renderSectionAvailable();
  window.rebuildSectionFilter?.();
  _drawSectionList();

  await _saveSection(s);
  _savingSection = false;
};

// ── Save section to Firestore ──────────────────
async function _saveSection(s) {
  const { id, ...data } = s;
  // Firestore rejects undefined values — strip them out
  const clean = {
    name:        data.name || '',
    studentUids: Array.isArray(data.studentUids) ? data.studentUids : [],
  };
  await window._setDoc('sections', id, clean);
}

// ── Grade view section filter ──────────────────
window.rebuildSectionFilter = function() {
  const sel = document.getElementById('grade-section-filter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All students</option>' +
    (window.DB.sections || []).map(s =>
      `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${escHtml(s.name)} (${(s.studentUids||[]).length})</option>`
    ).join('');
};

window.refreshGradeView = function() {
  const active = document.querySelector('#grade-assign-btns .btn-accent');
  if (active) active.click();
};

window.filterUsersBySection = function(users) {
  const sectionId = document.getElementById('grade-section-filter')?.value;
  if (!sectionId) return users;
  const section = (window.DB.sections || []).find(s => s.id === sectionId);
  if (!section) return users;
  const uids = new Set(section.studentUids || []);
  return users.filter(u => uids.has(u.uid));
};
