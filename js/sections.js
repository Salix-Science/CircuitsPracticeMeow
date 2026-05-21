/* sections.js — Admin section management and section-filtered grade view */

let _activeSectionId = null;
let _sectionAllUsers = []; // cached from last fetch

// ── Render section list (left panel) ──────────
window.renderSections = async function() {
  if (!window.S.isAdmin) return;

  // Fetch fresh user list for the member panels
  _sectionAllUsers = await window._fetchAllUsers();
  _sectionAllUsers = _sectionAllUsers.filter(u => !u.isAdmin);

  const list  = document.getElementById('section-list');
  const empty = document.getElementById('section-list-empty');
  const sections = window.DB.sections || [];

  list.innerHTML = '';
  empty.style.display = sections.length ? 'none' : 'block';

  sections.forEach(s => {
    const btn = document.createElement('div');
    btn.style.cssText = `display:flex;align-items:center;gap:8px;padding:9px 12px;
      border-radius:var(--r);cursor:pointer;border:0.5px solid;margin-bottom:4px;transition:all .15s;
      background:${_activeSectionId===s.id?'rgba(157,125,232,.1)':'var(--bg3)'};
      border-color:${_activeSectionId===s.id?'var(--accent)':'var(--border)'}`;

    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'font-size:13px;font-weight:500;color:var(--text);flex:1';
    nameEl.textContent = s.name;

    const count = document.createElement('span');
    count.style.cssText = 'font-size:11px;color:var(--text4);font-family:var(--mono)';
    count.textContent = `${(s.studentUids||[]).length} students`;

    btn.appendChild(nameEl);
    btn.appendChild(count);
    btn.addEventListener('click', () => selectSection(s.id));
    list.appendChild(btn);
  });

  // Update section filter dropdown in grades tab
  window.rebuildSectionFilter?.();

  if (_activeSectionId) selectSection(_activeSectionId);
};

// ── Create section ─────────────────────────────
window.createSection = async function() {
  if (!window.S.isAdmin) return;
  const input = document.getElementById('new-section-name');
  const name  = input?.value.trim();
  if (!name) return;

  const section = { id: `sec-${Date.now()}`, name, studentUids: [] };
  window.DB.sections.push(section);
  await setSection(section);
  logAdminAction('create_section', { id: section.id, name });
  if (input) input.value = '';
  renderSections();
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
  renderSections();
};

// ── Select a section to edit ───────────────────
window.selectSection = function(id) {
  _activeSectionId = id;
  const s = window.DB.sections.find(s => s.id === id);
  if (!s) return;

  document.getElementById('section-detail').style.display = '';
  document.getElementById('section-detail-name').textContent = s.name;
  document.getElementById('section-member-count').textContent = `(${(s.studentUids||[]).length})`;
  document.getElementById('section-student-search').value = '';

  renderSectionMembers();
  renderSectionAvailable();

  // Highlight active in list
  renderSections();
};

// ── Members list (students in section) ────────
window.renderSectionMembers = function() {
  const s    = window.DB.sections.find(s => s.id === _activeSectionId);
  const wrap = document.getElementById('section-members');
  if (!s || !wrap) return;

  wrap.innerHTML = '';
  const members = _sectionAllUsers.filter(u => (s.studentUids||[]).includes(u.uid));

  if (!members.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:12px;color:var(--text4)';
    empty.textContent = 'No students yet — add from the right.';
    wrap.appendChild(empty);
    return;
  }

  members.forEach(u => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r);font-size:12px';

    const name = document.createElement('span');
    name.style.cssText = 'flex:1;color:var(--text)';
    name.textContent = u.username;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-sm btn-red';
    removeBtn.style.cssText = 'padding:3px 8px;font-size:11px';
    removeBtn.innerHTML = '<i class="ti ti-x"></i>';
    removeBtn.addEventListener('click', () => removeFromSection(u.uid));

    row.appendChild(name);
    row.appendChild(removeBtn);
    wrap.appendChild(row);
  });
};

// ── Available students (not in section) ───────
window.renderSectionAvailable = function() {
  const s     = window.DB.sections.find(s => s.id === _activeSectionId);
  const wrap  = document.getElementById('section-available');
  const query = (document.getElementById('section-student-search')?.value || '').toLowerCase();
  if (!s || !wrap) return;

  wrap.innerHTML = '';
  const available = _sectionAllUsers
    .filter(u => !(s.studentUids||[]).includes(u.uid))
    .filter(u => !query || u.username.toLowerCase().includes(query));

  if (!available.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:12px;color:var(--text4)';
    empty.textContent = query ? 'No students match.' : 'All students are in this section.';
    wrap.appendChild(empty);
    return;
  }

  available.forEach(u => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r);font-size:12px';

    const name = document.createElement('span');
    name.style.cssText = 'flex:1;color:var(--text)';
    name.textContent = u.username;

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-sm btn-accent';
    addBtn.style.cssText = 'padding:3px 8px;font-size:11px';
    addBtn.innerHTML = '<i class="ti ti-plus"></i>';
    addBtn.addEventListener('click', () => addToSection(u.uid));

    row.appendChild(name);
    row.appendChild(addBtn);
    wrap.appendChild(row);
  });
};

// ── Add/remove student from section ───────────
window.addToSection = async function(uid) {
  const s = window.DB.sections.find(s => s.id === _activeSectionId);
  if (!s) return;
  if (!s.studentUids) s.studentUids = [];
  if (s.studentUids.includes(uid)) return;
  s.studentUids.push(uid);
  document.getElementById('section-member-count').textContent = `(${s.studentUids.length})`;
  await setSection(s);
  // Update just the member panels — no need to re-fetch everything
  renderSectionMembers();
  renderSectionAvailable();
  window.rebuildSectionFilter?.();
};

window.removeFromSection = async function(uid) {
  const s = window.DB.sections.find(s => s.id === _activeSectionId);
  if (!s) return;
  s.studentUids = (s.studentUids || []).filter(id => id !== uid);
  document.getElementById('section-member-count').textContent = `(${s.studentUids.length})`;
  await setSection(s);
  renderSectionMembers();
  renderSectionAvailable();
  window.rebuildSectionFilter?.();
};

// ── Persist section to Firestore ───────────────
async function setSection(s) {
  const { id, ...data } = s;
  await window._setDoc('sections', id, data);
}

// ── Section filter in grade view ───────────────
window.rebuildSectionFilter = function() {
  const sel = document.getElementById('grade-section-filter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All students</option>' +
    (window.DB.sections || []).map(s =>
      `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${escHtml(s.name)} (${(s.studentUids||[]).length})</option>`
    ).join('');
};

// Called when section filter changes in grades tab
window.refreshGradeView = function() {
  // Re-run whatever assignment is currently selected
  const active = document.querySelector('#grade-assign-btns .btn-accent');
  if (active) active.click();
};

// ── Filter users by selected section ──────────
// Called from admin.js loadGradeView to filter the user list
window.filterUsersBySection = function(users) {
  const sectionId = document.getElementById('grade-section-filter')?.value;
  if (!sectionId) return users;
  const section = (window.DB.sections || []).find(s => s.id === sectionId);
  if (!section) return users;
  const uids = new Set(section.studentUids || []);
  return users.filter(u => uids.has(u.uid));
};
