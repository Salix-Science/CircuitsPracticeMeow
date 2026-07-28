/* calendar.js — Calendar view with events (office hours, exams, etc.)
   Events stored in Firestore 'events' collection.
   Admins can create/edit/delete events. Students see them read-only.

   2026-07-28: per-event custom colours (ev.color, 6-digit hex) overriding the
   type palette. Falls back to EVENT_COLORS when unset/invalid.
*/

console.log('[build] calendar.js 2026-07-28-color');

// ── Debug ─────────────────────────────────────
// Flip to false (or run window.CAL_DEBUG=false in console) to silence.
window.CAL_DEBUG = true;
function cdbg(...a) {
  if (window.CAL_DEBUG) console.log('%c[cal]', 'color:#cf8a45;font-weight:700', ...a);
}

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

const CAL_DEFAULT_HEX = '#cf8a45';
const HEX6 = /^#[0-9a-fA-F]{6}$/;

// Resolve the palette for one event: custom hex wins, else the type palette.
// Always returns safe, pre-validated CSS — never interpolate ev.color directly.
window.calEventStyle = function calEventStyle(ev) {
  const base = EVENT_COLORS[ev?.type] || EVENT_COLORS.other;
  const hex  = (ev?.color || '').trim();
  if (!HEX6.test(hex)) return base;
  const rgb = window.hexToRgb(hex);
  return {
    bg:     `rgba(${rgb},.12)`,
    border: `rgba(${rgb},.40)`,
    text:   hex,
    label:  base.label,
  };
};

const esc = s => (window.escHtml ? window.escHtml(s ?? '') : String(s ?? ''));

// ── Timezone (everything below is Eastern, wherever the browser is) ──
// Firestore always stores full UTC ISO strings. These helpers are the ONLY
// place naive "YYYY-MM-DDTHH:mm" input strings get interpreted, and they
// always interpret them as Eastern wall-clock time.
const CAL_TZ       = 'America/New_York';
const CAL_TZ_LABEL = 'ET';
const _pad = n => String(n).padStart(2, '0');

const _calTzFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: CAL_TZ, year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
});

// Wall-clock calendar parts for a Date, as seen in Eastern.
window.calParts = function calParts(d) {
  const p = {};
  for (const { type, value } of _calTzFmt.formatToParts(d)) p[type] = value;
  if (p.hour === '24') p.hour = '00';   // some engines emit 24 for midnight
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour, minute: +p.minute, second: +p.second,
  };
};

// Eastern's UTC offset in ms at a given instant (-5h EST, -4h EDT).
function _calTzOffsetMs(d) {
  const p = window.calParts(d);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - Math.floor(d.getTime() / 1000) * 1000;
}

// "YYYY-MM-DDTHH:mm" (Eastern wall time) → full UTC ISO string.
window.calInputToIso = function calInputToIso(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  if (!m) { cdbg('calInputToIso: unparseable', JSON.stringify(s)); return null; }
  const [, Y, Mo, D, H, Mi] = m.map(Number);
  const wall = Date.UTC(Y, Mo - 1, D, H, Mi);
  // Two passes: the offset itself depends on the instant (DST boundaries).
  let utc = wall;
  for (let i = 0; i < 2; i++) utc = wall - _calTzOffsetMs(new Date(utc));
  return new Date(utc).toISOString();
};

// Full UTC ISO string → "YYYY-MM-DDTHH:mm" for a datetime-local input, in Eastern.
window.calIsoToInput = function calIsoToInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) { cdbg('calIsoToInput: bad date', JSON.stringify(iso)); return ''; }
  const p = window.calParts(d);
  return `${p.year}-${_pad(p.month)}-${_pad(p.day)}T${_pad(p.hour)}:${_pad(p.minute)}`;
};

// Shorthand for the Intl options every display call needs.
const _tzOpt = o => ({ ...o, timeZone: CAL_TZ });

// ── MathJax helper ─────────────────────────────
window.typeset = function typeset(el) {
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise(el ? [el] : undefined).catch(e => console.warn('MathJax:', e));
  }
}

// ── Calendar render ────────────────────────────
window.renderCalendar = function renderCalendar() {
  cdbg('renderCalendar', { isAdmin: window.S?.isAdmin, events: (window.DB?.events || []).length });
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
  if (!grid) { cdbg('calDrawGrid: #calendar-grid missing, bailing'); return; }
  // CAL.year/CAL.month are plain grid coordinates, so these stay local-Date math.
  const firstDay = new Date(CAL.year, CAL.month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(CAL.year, CAL.month + 1, 0).getDate();
  // "Today" must be today in Eastern, not in the browser's zone.
  const today    = window.calParts(new Date());

  // Get events for this month — bucketed by their Eastern calendar date.
  const monthEvents = (window.DB.events || []).filter(ev => {
    const p = window.calParts(new Date(ev.start));
    return p.year === CAL.year && p.month - 1 === CAL.month;
  });

  cdbg('calDrawGrid', `${CAL.year}-${String(CAL.month+1).padStart(2,'0')}`,
       `${monthEvents.length} event(s)`,
       'custom-coloured:', monthEvents.filter(e => HEX6.test((e.color||'').trim())).length);

  // Group by day
  const byDay = {};
  monthEvents.forEach(ev => {
    const d = window.calParts(new Date(ev.start)).day;
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
    const isToday = today.day===day && today.month-1===CAL.month && today.year===CAL.year;
    const events  = byDay[day] || [];
    const evDots  = events.slice(0,3).map(ev => {
      const c = window.calEventStyle(ev);
      return `<div style="font-size:10px;background:${c.bg};border:0.5px solid ${c.border};color:${c.text};border-radius:3px;padding:1px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;margin-bottom:2px"
        onclick="calScrollToEvent('${esc(ev.id)}')">${esc(ev.title)}</div>`;
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
  if (!el) { cdbg('calDrawEventList: #cal-event-list missing, bailing'); return; }
  const now = new Date();

  // Month bounds as Eastern wall time, so the list matches the grid exactly.
  const lastDay    = new Date(CAL.year, CAL.month + 1, 0).getDate();
  const monthStart = new Date(window.calInputToIso(`${CAL.year}-${_pad(CAL.month+1)}-01T00:00`));
  const monthEnd   = new Date(window.calInputToIso(`${CAL.year}-${_pad(CAL.month+1)}-${_pad(lastDay)}T23:59`));

  const visible = (window.DB.events || [])
    .filter(ev => {
      const d = new Date(ev.start);
      return d >= monthStart && d <= monthEnd;
    })
    .sort((a,b) => new Date(a.start) - new Date(b.start));

  cdbg('calDrawEventList', `${visible.length} visible`);

  if (!visible.length) {
    el.innerHTML = '<div style="color:var(--text4);font-size:12px;text-align:center;padding:1rem">No events this month.</div>';
    return;
  }

  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Events this month</div>
    ${visible.map(ev => {
      const c       = window.calEventStyle(ev);
      const start   = new Date(ev.start);
      const end     = ev.end ? new Date(ev.end) : null;
      const isPast  = start < now;
      const dateStr = start.toLocaleDateString('en-US',_tzOpt({weekday:'short',month:'short',day:'numeric'}));
      const timeStr = start.toLocaleTimeString('en-US',_tzOpt({hour:'2-digit',minute:'2-digit'}));
      const endStr  = end ? ' – ' + end.toLocaleTimeString('en-US',_tzOpt({hour:'2-digit',minute:'2-digit'})) : '';
      return `<div id="ev-${esc(ev.id)}" style="display:flex;gap:12px;align-items:flex-start;padding:12px;background:${c.bg};border:0.5px solid ${c.border};border-radius:var(--r2);margin-bottom:8px;opacity:${isPast?'0.6':'1'}">
        <div style="flex-shrink:0;text-align:center;min-width:44px">
          <div style="font-size:10px;font-weight:700;color:${c.text};text-transform:uppercase">${start.toLocaleDateString('en-US',_tzOpt({month:'short'}))}</div>
          <div style="font-size:22px;font-family:var(--mono);font-weight:700;color:${c.text};line-height:1">${window.calParts(start).day}</div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
            <span style="font-size:12px;font-weight:600;color:var(--text)">${esc(ev.title)}</span>
            <span style="font-size:10px;padding:1px 7px;border-radius:99px;background:${c.bg};border:0.5px solid ${c.border};color:${c.text}">${c.label}</span>
            ${isPast ? '<span style="font-size:9px;color:var(--text4)">past</span>' : ''}
          </div>
          <div style="font-size:11px;color:var(--text3);font-family:var(--mono)">${dateStr} · ${timeStr}${endStr} ${CAL_TZ_LABEL}</div>
          ${ev.notes ? `<div style="font-size:11px;color:var(--text3);margin-top:3px">${esc(ev.notes)}</div>` : ''}
          ${ev.recurring ? `<div style="font-size:10px;color:var(--text4);margin-top:2px"><i class="ti ti-refresh" style="font-size:10px"></i> Repeats ${esc(ev.repeat||'weekly')}</div>` : ''}
        </div>
        ${window.S.isAdmin ? `<button class="btn btn-sm" onclick="calEditEvent('${esc(ev.id)}')" style="flex-shrink:0;padding:4px 8px;font-size:11px"><i class="ti ti-edit"></i></button>` : ''}
      </div>`;
    }).join('')}`;
}

window.calScrollToEvent = function calScrollToEvent(id) {
  const el = document.getElementById(`ev-${id}`);
  if (el) el.scrollIntoView({ behavior:'smooth', block:'center' });
}

// ── Colour controls ────────────────────────────
window.calToggleColor = function calToggleColor() {
  const on   = document.getElementById('cal-ev-custom-color')?.checked;
  const opts = document.getElementById('cal-color-opts');
  if (opts) opts.style.display = on ? 'flex' : 'none';
  cdbg('calToggleColor', on ? 'custom' : 'type default');
  calPreviewColor();
}

window.calPreviewColor = function calPreviewColor() {
  const prev = document.getElementById('cal-color-preview');
  if (!prev) return;
  const c = window.calEventStyle({
    type:  document.getElementById('cal-ev-type')?.value,
    color: calReadFormColor(),
  });
  prev.style.cssText = `font-size:10px;padding:2px 9px;border-radius:99px;background:${c.bg};border:0.5px solid ${c.border};color:${c.text}`;
  prev.textContent = document.getElementById('cal-ev-title')?.value.trim() || c.label;
}

// Returns a validated hex string, or null when "custom colour" is off.
window.calReadFormColor = function calReadFormColor() {
  if (!document.getElementById('cal-ev-custom-color')?.checked) return null;
  const raw = document.getElementById('cal-ev-color')?.value || '';
  const hex = raw.trim().toLowerCase();
  if (!HEX6.test(hex)) {
    cdbg('calReadFormColor: rejected', JSON.stringify(raw), '→ falling back to', CAL_DEFAULT_HEX);
    return CAL_DEFAULT_HEX;
  }
  return hex;
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
  const cc = document.getElementById('cal-ev-custom-color');
  if (cc) cc.checked = false;
  const ci = document.getElementById('cal-ev-color');
  if (ci) ci.value = CAL_DEFAULT_HEX;
  calToggleColor();
  document.getElementById('cal-delete-btn').style.display = 'none';
  document.getElementById('cal-err').classList.add('hidden');
  const m = document.getElementById('cal-modal');
  m.style.display = 'flex';
  cdbg('calOpenEventForm', dateStr || '(no date)');
}

window.calEditEvent = function calEditEvent(id) {
  const ev = (window.DB.events||[]).find(e => e.id===id);
  if (!ev) { cdbg('calEditEvent: no event with id', id); return; }
  cdbg('calEditEvent', id, { type: ev.type, color: ev.color ?? null, recurring: !!ev.recurring });
  CAL.editingId = id;
  document.getElementById('cal-modal-title').textContent = 'Edit event';
  document.getElementById('cal-ev-title').value  = ev.title || '';
  document.getElementById('cal-ev-type').value   = ev.type  || 'other';
  document.getElementById('cal-ev-notes').value  = ev.notes || '';
  // Was `ev.start.slice(0,16)` — that fed a raw UTC string into a local-time
  // input, shifting the event forward by the offset on every edit+save cycle.
  document.getElementById('cal-ev-start').value  = window.calIsoToInput(ev.start);
  document.getElementById('cal-ev-end').value    = window.calIsoToInput(ev.end);
  const rec = !!ev.recurring;
  document.getElementById('cal-ev-recurring').checked = rec;
  document.getElementById('cal-recurring-opts').style.display = rec ? '' : 'none';
  if (rec) {
    document.getElementById('cal-ev-repeat').value = ev.repeat || 'weekly';
    document.getElementById('cal-ev-until').value  = ev.until  || '';
  }
  const hasColor = HEX6.test((ev.color || '').trim());
  const cc = document.getElementById('cal-ev-custom-color');
  if (cc) cc.checked = hasColor;
  const ci = document.getElementById('cal-ev-color');
  if (ci) ci.value = hasColor ? ev.color.trim().toLowerCase() : CAL_DEFAULT_HEX;
  calToggleColor();
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
    color:     window.calReadFormColor(),   // null = inherit the type palette
    start:     window.calInputToIso(start),
    end:       window.calInputToIso(document.getElementById('cal-ev-end').value) || null,
    notes:     document.getElementById('cal-ev-notes').value.trim(),
    recurring,
    repeat:    recurring ? document.getElementById('cal-ev-repeat').value : null,
    until:     recurring && document.getElementById('cal-ev-until').value
                 ? document.getElementById('cal-ev-until').value : null,
  };

  cdbg('calSaveEvent payload', JSON.parse(JSON.stringify(ev)));
  cdbg('calSaveEvent time check',
       'you typed:', start,
       '| stored UTC:', ev.start,
       '| reads back as ET:', window.calIsoToInput(ev.start),
       '| browser tz:', Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Expand recurring events into individual DB entries
  const toSave = recurring ? expandRecurring(ev) : [ev];
  cdbg('calSaveEvent writing', toSave.length, 'doc(s)');

  if (!window.DB.events) window.DB.events = [];

  // Remove old entries for this event group (same base id or same title+type if editing)
  if (CAL.editingId) {
    window.DB.events = window.DB.events.filter(e => e.id !== CAL.editingId && !e.id.startsWith(CAL.editingId + '_'));
    await deleteFromDB('events', CAL.editingId);
  }

  try {
    for (const e of toSave) {
      window.DB.events.push(e);
      await setEventInDB(e);
    }
  } catch (err) {
    console.error('[cal] calSaveEvent write failed:', err);
    errEl.querySelector('span').textContent = 'Save failed — see console for details.';
    errEl.classList.remove('hidden');
    return;
  }

  logAdminAction('save_event', { title, type: ev.type, recurring, color: ev.color });
  calCloseModal();
  calDrawGrid();
  calDrawEventList();
}

window.expandRecurring = function expandRecurring(ev) {
  const events   = [];
  const repeatMs = { weekly: 7, biweekly: 14, daily: 1 };
  const days     = repeatMs[ev.repeat] || 7;
  const dur      = ev.end ? new Date(ev.end) - new Date(ev.start) : 0;

  // Anchor on the Eastern wall-clock time of the first occurrence. Stepping by
  // calendar days (not by 86400000 ms) keeps a 3pm office hour at 3pm across
  // the March/November DST transitions instead of drifting an hour.
  const p0 = window.calParts(new Date(ev.start));
  // `until` is a date-only input; treat it as end-of-day Eastern.
  const untilMs = ev.until
    ? new Date(window.calInputToIso(`${ev.until}T23:59`)).getTime()
    : new Date(ev.start).getTime() + 90 * 86400000;

  for (let idx = 0; idx < 400; idx++) {
    const step  = new Date(Date.UTC(p0.year, p0.month - 1, p0.day + idx * days));
    const iso   = window.calInputToIso(
      `${step.getUTCFullYear()}-${_pad(step.getUTCMonth()+1)}-${_pad(step.getUTCDate())}`
      + `T${_pad(p0.hour)}:${_pad(p0.minute)}`
    );
    const startMs = new Date(iso).getTime();
    if (startMs > untilMs) break;
    events.push({
      ...ev,                          // carries `color` onto every occurrence
      id:    idx === 0 ? ev.id : `${ev.id}_${idx}`,
      start: iso,
      end:   dur ? new Date(startMs + dur).toISOString() : null,
    });
  }

  cdbg('expandRecurring', ev.repeat || 'weekly', `→ ${events.length} occurrence(s)`,
       events.length ? `first ${window.calIsoToInput(events[0].start)} ET, last ${window.calIsoToInput(events[events.length-1].start)} ET` : '');
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
  cdbg('calDeleteEvent', CAL.editingId, `removing ${toDelete.length} doc(s)`);
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
