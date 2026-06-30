/* calendar.js — Calendar view with events (office hours, exams, etc.)
   Events stored in Firestore 'events' collection.
   Admins can create/edit/delete events. Students see them read-only.
*/

// ── State ─────────────────────────────────────
const CAL = {
  year:  new Date().getFullYear(),
  month: new Date().getMonth(), // 0-indexed
  editingId: null,
};

const EVENT_COLORS = {
  'office-hours': { bg:'rgba(74,222,128,.12)',  border:'rgba(74,222,128,.4)',  text:'var(--green)',  label:'Office Hours' },
  'exam':         { bg:'rgba(248,113,113,.12)', border:'rgba(248,113,113,.4)', text:'var(--red)',    label:'Exam' },
  'deadline':     { bg:'rgba(251,191,36,.12)',  border:'rgba(251,191,36,.4)',  text:'var(--warn)',   label:'Deadline' },
  'lecture':      { bg:'rgba(207,138,69,.12)', border:'rgba(207,138,69,.4)', text:'var(--accent2)',label:'Lecture' },
  'other':        { bg:'rgba(96,165,250,.12)',  border:'rgba(96,165,250,.4)',  text:'var(--blue)',   label:'Other' },
};

// ── MathJax helper ─────────────────────────────
window.typeset = function typeset(el) {
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise(el ? [el] : undefined).catch(e => console.warn('MathJax:', e));
  }
}

// ── Calendar render ────────────────────────────
window.renderCalendar = function renderCalendar() {
  if (window.S.isAdmin) {
    const btn = document.getElementById('cal-add-btn');
    if (btn) btn.style.display = '';
  }
  calDrawGrid();
  calDrawEventList();
}

window.calNav = function calNav(dir) {
  CAL.month += dir;
  if (CAL.month > 11) { CAL.month = 0;  CAL.year++; }
  if (CAL.month < 0)  { CAL.month = 11; CAL.year--; }
  calDrawGrid();
  calDrawEventList();
}

window.calGoToday = function calGoToday() {
  const now  = new Date();
  CAL.year   = now.getFullYear();
  CAL.month  = now.getMonth();
  calDrawGrid();
  calDrawEventList();
}

window.calDrawGrid = function calDrawGrid() {
  const label = document.getElementById('cal-month-label');
  if (label) label.textContent = new Date(CAL.year, CAL.month, 1)
    .toLocaleDateString('en-US', { month:'long', year:'numeric' });

  const grid     = document.getElementById('calendar-grid');
  const today    = new Date();
  const firstDay = new Date(CAL.year, CAL.month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(CAL.year, CAL.month + 1, 0).getDate();

  // Get events for this month
  const monthEvents = (window.DB.events || []).filter(ev => {
    const d = new Date(ev.start);
    return d.getFullYear() === CAL.year && d.getMonth() === CAL.month;
  });

  // Group by day
  const byDay = {};
  monthEvents.forEach(ev => {
    const d = new Date(ev.start).getDate();
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(ev);
  });

  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  let html = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border:0.5px solid var(--border);border-radius:var(--r2);overflow:hidden">`;

  // Day headers
  dayNames.forEach(d => {
    html += `<div style="background:var(--bg3);padding:6px;text-align:center;font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em">${d}</div>`;
  });

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += `<div style="background:var(--bg2);min-height:80px;padding:4px"></div>`;
  }

  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = today.getDate()===day && today.getMonth()===CAL.month && today.getFullYear()===CAL.year;
    const events  = byDay[day] || [];
    const evDots  = events.slice(0,3).map(ev => {
      const c = EVENT_COLORS[ev.type] || EVENT_COLORS.other;
      return `<div style="font-size:10px;background:${c.bg};border:0.5px solid ${c.border};color:${c.text};border-radius:3px;padding:1px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;margin-bottom:2px"
        onclick="calScrollToEvent('${ev.id}')">${ev.title}</div>`;
    }).join('');
    const more = events.length > 3 ? `<div style="font-size:9px;color:var(--text4)">+${events.length-3} more</div>` : '';

    html += `<div style="background:${isToday?'rgba(207,138,69,.08)':'var(--bg2)'};min-height:80px;padding:4px;${isToday?'outline:1.5px solid var(--accent);outline-offset:-1.5px':''}">
      <div style="font-size:11px;font-weight:${isToday?'700':'400'};color:${isToday?'var(--accent2)':'var(--text3)'};margin-bottom:3px;font-family:var(--mono)">${day}</div>
      ${evDots}${more}
    </div>`;
  }

  // Trailing empty cells
  const total = firstDay + daysInMonth;
  const trailing = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 0; i < trailing; i++) {
    html += `<div style="background:var(--bg2);min-height:80px;padding:4px"></div>`;
  }

  html += '</div>';
  grid.innerHTML = html;
}

window.calDrawEventList = function calDrawEventList() {
  const el = document.getElementById('cal-event-list');
  const now = new Date();

  // Show upcoming events (next 60 days) + this month's past events
  const monthStart = new Date(CAL.year, CAL.month, 1);
  const monthEnd   = new Date(CAL.year, CAL.month + 1, 0, 23, 59, 59);

  const visible = (window.DB.events || [])
    .filter(ev => {
      const d = new Date(ev.start);
      return d >= monthStart && d <= monthEnd;
    })
    .sort((a,b) => new Date(a.start) - new Date(b.start));

  if (!visible.length) {
    el.innerHTML = '<div style="color:var(--text4);font-size:12px;text-align:center;padding:1rem">No events this month.</div>';
    return;
  }

  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Events this month</div>
    ${visible.map(ev => {
      const c       = EVENT_COLORS[ev.type] || EVENT_COLORS.other;
      const start   = new Date(ev.start);
      const end     = ev.end ? new Date(ev.end) : null;
      const isPast  = start < now;
      const dateStr = start.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
      const timeStr = start.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
      const endStr  = end ? ' – ' + end.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '';
      return `<div id="ev-${ev.id}" style="display:flex;gap:12px;align-items:flex-start;padding:12px;background:${c.bg};border:0.5px solid ${c.border};border-radius:var(--r2);margin-bottom:8px;opacity:${isPast?'0.6':'1'}">
        <div style="flex-shrink:0;text-align:center;min-width:44px">
          <div style="font-size:10px;font-weight:700;color:${c.text};text-transform:uppercase">${start.toLocaleDateString('en-US',{month:'short'})}</div>
          <div style="font-size:22px;font-family:var(--mono);font-weight:700;color:${c.text};line-height:1">${start.getDate()}</div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
            <span style="font-size:12px;font-weight:600;color:var(--text)">${ev.title}</span>
            <span style="font-size:10px;padding:1px 7px;border-radius:99px;background:${c.bg};border:0.5px solid ${c.border};color:${c.text}">${c.label}</span>
            ${isPast ? '<span style="font-size:9px;color:var(--text4)">past</span>' : ''}
          </div>
          <div style="font-size:11px;color:var(--text3);font-family:var(--mono)">${dateStr} · ${timeStr}${endStr}</div>
          ${ev.notes ? `<div style="font-size:11px;color:var(--text3);margin-top:3px">${ev.notes}</div>` : ''}
          ${ev.recurring ? `<div style="font-size:10px;color:var(--text4);margin-top:2px"><i class="ti ti-refresh" style="font-size:10px"></i> Repeats ${ev.repeat||'weekly'}</div>` : ''}
        </div>
        ${window.S.isAdmin ? `<button class="btn btn-sm" onclick="calEditEvent('${ev.id}')" style="flex-shrink:0;padding:4px 8px;font-size:11px"><i class="ti ti-edit"></i></button>` : ''}
      </div>`;
    }).join('')}`;
}

window.calScrollToEvent = function calScrollToEvent(id) {
  const el = document.getElementById(`ev-${id}`);
  if (el) el.scrollIntoView({ behavior:'smooth', block:'center' });
}

// ── Event form ─────────────────────────────────
window.calOpenEventForm = function calOpenEventForm(dateStr) {
  CAL.editingId = null;
  document.getElementById('cal-modal-title').textContent = 'Add event';
  document.getElementById('cal-ev-title').value  = '';
  document.getElementById('cal-ev-type').value   = 'office-hours';
  document.getElementById('cal-ev-notes').value  = '';
  document.getElementById('cal-ev-start').value  = dateStr || '';
  document.getElementById('cal-ev-end').value    = '';
  document.getElementById('cal-ev-recurring').checked = false;
  document.getElementById('cal-recurring-opts').style.display = 'none';
  document.getElementById('cal-delete-btn').style.display = 'none';
  document.getElementById('cal-err').classList.add('hidden');
  const m = document.getElementById('cal-modal');
  m.style.display = 'flex';
}

window.calEditEvent = function calEditEvent(id) {
  const ev = (window.DB.events||[]).find(e => e.id===id);
  if (!ev) return;
  CAL.editingId = id;
  document.getElementById('cal-modal-title').textContent = 'Edit event';
  document.getElementById('cal-ev-title').value  = ev.title || '';
  document.getElementById('cal-ev-type').value   = ev.type  || 'other';
  document.getElementById('cal-ev-notes').value  = ev.notes || '';
  document.getElementById('cal-ev-start').value  = ev.start ? ev.start.slice(0,16) : '';
  document.getElementById('cal-ev-end').value    = ev.end   ? ev.end.slice(0,16)   : '';
  const rec = !!ev.recurring;
  document.getElementById('cal-ev-recurring').checked = rec;
  document.getElementById('cal-recurring-opts').style.display = rec ? '' : 'none';
  if (rec) {
    document.getElementById('cal-ev-repeat').value = ev.repeat || 'weekly';
    document.getElementById('cal-ev-until').value  = ev.until  || '';
  }
  document.getElementById('cal-delete-btn').style.display = '';
  document.getElementById('cal-err').classList.add('hidden');
  document.getElementById('cal-modal').style.display = 'flex';
}

window.calCloseModal = function calCloseModal() {
  document.getElementById('cal-modal').style.display = 'none';
}

window.calToggleRecurring = function calToggleRecurring() {
  const on = document.getElementById('cal-ev-recurring').checked;
  document.getElementById('cal-recurring-opts').style.display = on ? '' : 'none';
}

window.calSaveEvent = async function calSaveEvent() {
  if (!window.S.isAdmin) return;
  const title = document.getElementById('cal-ev-title').value.trim();
  const start = document.getElementById('cal-ev-start').value;
  const errEl = document.getElementById('cal-err');

  if (!title || !start) {
    errEl.querySelector('span').textContent = 'Title and start time are required.';
    errEl.classList.remove('hidden');
    return;
  }
  errEl.classList.add('hidden');

  const recurring = document.getElementById('cal-ev-recurring').checked;
  const ev = {
    id:        CAL.editingId || `ev-${Date.now()}`,
    title,
    type:      document.getElementById('cal-ev-type').value,
    start:     new Date(start).toISOString(),
    end:       document.getElementById('cal-ev-end').value
                 ? new Date(document.getElementById('cal-ev-end').value).toISOString() : null,
    notes:     document.getElementById('cal-ev-notes').value.trim(),
    recurring,
    repeat:    recurring ? document.getElementById('cal-ev-repeat').value : null,
    until:     recurring && document.getElementById('cal-ev-until').value
                 ? document.getElementById('cal-ev-until').value : null,
  };

  // Expand recurring events into individual DB entries
  const toSave = recurring ? expandRecurring(ev) : [ev];

  if (!window.DB.events) window.DB.events = [];

  // Remove old entries for this event group (same base id or same title+type if editing)
  if (CAL.editingId) {
    window.DB.events = window.DB.events.filter(e => e.id !== CAL.editingId && !e.id.startsWith(CAL.editingId + '_'));
    await deleteFromDB('events', CAL.editingId);
  }

  for (const e of toSave) {
    window.DB.events.push(e);
    await setEventInDB(e);
  }

  logAdminAction('save_event', { title, type: ev.type, recurring });
  calCloseModal();
  calDrawGrid();
  calDrawEventList();
}

window.expandRecurring = function expandRecurring(ev) {
  const events = [];
  const repeatMs = { weekly: 7, biweekly: 14, daily: 1 };
  const days     = repeatMs[ev.repeat] || 7;
  let   cur      = new Date(ev.start);
  const until    = ev.until ? new Date(ev.until) : new Date(cur.getTime() + 90 * 86400000);
  const dur      = ev.end ? new Date(ev.end) - new Date(ev.start) : 0;
  let   idx      = 0;

  while (cur <= until) {
    const endTime = dur ? new Date(cur.getTime() + dur) : null;
    events.push({
      ...ev,
      id:    idx === 0 ? ev.id : `${ev.id}_${idx}`,
      start: cur.toISOString(),
      end:   endTime ? endTime.toISOString() : null,
    });
    cur = new Date(cur.getTime() + days * 86400000);
    idx++;
  }
  return events;
}

window.setEventInDB = async function setEventInDB(ev) {
  const { id, ...data } = ev;
  await window._setDoc('events', id, data);
}

window.calDeleteEvent = async function calDeleteEvent() {
  if (!window.S.isAdmin || !CAL.editingId) return;
  // Delete this event and any recurrences
  const toDelete = (window.DB.events||[]).filter(e => e.id===CAL.editingId || e.id.startsWith(CAL.editingId+'_'));
  window.DB.events = (window.DB.events||[]).filter(e => e.id!==CAL.editingId && !e.id.startsWith(CAL.editingId+'_'));
  for (const e of toDelete) await deleteFromDB('events', e.id);
  logAdminAction('delete_event', { id: CAL.editingId });
  calCloseModal();
  calDrawGrid();
  calDrawEventList();
}

// Close modal on backdrop click
document.getElementById('cal-modal')?.addEventListener('click', function(e) {
  if (e.target === this) calCloseModal();
});
