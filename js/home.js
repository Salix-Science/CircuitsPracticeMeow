/* home.js — Homepage render (student view) + homepage editor (admin) */

// Category pills are rendered by window.catPill (defined in firebase.js, which
// loads before this file). Using it here keeps home-page pill colours identical
// to the blog page and respects the admin's Category editor settings.
function _homeCatPill(cat) {
  return (typeof window.catPill === 'function')
    ? window.catPill(cat)
    : `<span class="pill" style="background:rgba(157,125,232,.08);color:var(--text3);border:0.5px solid var(--border)">${escHtml(cat)}</span>`;
}

// ── Student homepage ──────────────────────────
window.renderHomepage = function renderHomepage() {
  try {
  const wrap = document.getElementById('view-home');
  if (!wrap) return;
  wrap.innerHTML = '';

  const hp  = window.DB.homepage || {};
  const now = Date.now();
  const u   = window.DB.users[window.S.user] || {};

  // ── Stats bar
  const allScores = Object.values(u.scores || {});
  const totalAtt  = allScores.reduce((s,v) => s + v.attempted, 0);
  const totalCor  = allScores.reduce((s,v) => s + v.correct,   0);
  const pct       = totalAtt ? Math.round(totalCor / totalAtt * 100) : null;
  const streak    = parseInt(u.streak) || 0;

  const statsHTML = `
    <div class="home-stats-bar">
      <div class="home-stat">
        <i class="ti ti-check" style="color:var(--green)"></i>
        <span class="home-stat-val">${totalCor}</span>
        <span class="home-stat-lbl">solved</span>
      </div>
      <div class="home-stat">
        <i class="ti ti-send" style="color:var(--accent)"></i>
        <span class="home-stat-val">${totalAtt}</span>
        <span class="home-stat-lbl">attempted</span>
      </div>
      <div class="home-stat">
        <i class="ti ti-percentage" style="color:var(--accent2)"></i>
        <span class="home-stat-val">${pct !== null ? pct + '%' : '—'}</span>
        <span class="home-stat-lbl">accuracy</span>
      </div>
      <div class="home-stat">
        <i class="ti ti-flame" style="color:var(--warn)"></i>
        <span class="home-stat-val">${streak}</span>
        <span class="home-stat-lbl">streak</span>
      </div>
    </div>`;

  // ── Announcement banner
  let bannerHTML = '';
  if (hp.bannerEnabled && hp.banner && hp.banner.trim()) {
    bannerHTML = `
      <div class="home-banner">
        <i class="ti ti-speakerphone" style="font-size:16px;flex-shrink:0"></i>
        <div class="home-banner-text">${hp.banner}</div>
      </div>`;
  }

  // ── Recent blog posts (up to 3)
  const recentPosts = window.DB.posts
    .filter(p => p.status === 'published')
    .sort((a,b) => b.createdAt - a.createdAt)
    .slice(0, 3);

  const postsHTML = recentPosts.length ? `
    <div class="home-section">
      <div class="home-section-head">
        <i class="ti ti-notebook"></i> Recent posts
        <button class="btn btn-sm" style="margin-left:auto" onclick="showView('blog')">View all →</button>
      </div>
      <div class="home-posts-grid">
        ${recentPosts.map(p => {
          const date = new Date(p.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric'});
          return `<div class="home-post-card" onclick="showView('blog');setTimeout(()=>openBlogPost('${p.id}'),50)">
            <div class="home-post-meta">${_homeCatPill(p.category)}<span class="blog-card-date">${date}</span></div>
            <div class="home-post-title">${escHtml(p.title)}</div>
            ${p.excerpt ? `<div class="home-post-excerpt">${escHtml(p.excerpt)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  // ── Upcoming / open assignments
  const openAssignments = window.DB.assignments
    .filter(a => !a.opens || new Date(a.opens).getTime() <= now)
    .sort((a,b) => {
      // Sort by due date ascending; no-due-date at end
      const da = a.due ? new Date(a.due).getTime() : Infinity;
      const db_ = b.due ? new Date(b.due).getTime() : Infinity;
      return da - db_;
    })
    .slice(0, 5);

  const sub = u.assignSubmissions || {};

  const assignHTML = openAssignments.length ? `
    <div class="home-section">
      <div class="home-section-head">
        <i class="ti ti-calendar-due"></i> Assignments
        <button class="btn btn-sm" style="margin-left:auto" onclick="showView('assignments')">View all →</button>
      </div>
      ${openAssignments.map(a => {
        const due    = a.due ? new Date(a.due) : null;
        const isLate = due && Date.now() > due.getTime();
        const mySub  = sub[a.id] || {};
        const done   = Object.keys(mySub).length;
        const total  = a.problems.length;
        const pctDone = total ? Math.round(done/total*100) : 0;
        const dueStr  = due ? due.toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : 'No due date';
        return `<div class="home-assign-row" onclick="showView('assignments')">
          <div class="home-assign-info">
            <div class="home-assign-name">${escHtml(a.title)}</div>
            <div class="home-assign-due">${isLate?'<span class="pill pill-warn" style="font-size:9px">Late</span> ':''} Due ${dueStr}</div>
          </div>
          <div class="home-assign-prog">
            <div class="home-assign-bar-outer"><div class="home-assign-bar-inner" style="width:${pctDone}%"></div></div>
            <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${done}/${total}</span>
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  wrap.innerHTML = `
    <div class="home-outer">
      <div class="home-hero">
        <div class="home-hero-title">Welcome back, ${escHtml(window.S.user)}</div>
        <div class="home-hero-sub">Circuits Practice</div>
      </div>
      ${statsHTML}
      ${bannerHTML}
      ${postsHTML}
      ${assignHTML}
      ${!postsHTML && !assignHTML && !bannerHTML ? '<div style="color:var(--text4);text-align:center;padding:3rem;font-size:13px">Nothing to show yet — check back soon.</div>' : ''}
    </div>`;
  } catch(e) {
    console.error('renderHomepage crashed:', e);
    document.getElementById('view-home').innerHTML =
      `<div style="color:var(--red);padding:2rem;font-family:monospace">Homepage error: ${e.message}</div>`;
  }
}

// ── Admin homepage editor ─────────────────────
window.renderHomepageEditor = function renderHomepageEditor() {
  const hp  = window.DB.homepage || {};
  const ban = document.getElementById('hp-banner');
  const ben = document.getElementById('hp-banner-enabled');
  if (ban) ban.value = hp.banner || '';
  if (ben) ben.checked = hp.bannerEnabled !== false;
  updateBannerPreview();
}

window.updateBannerPreview = function updateBannerPreview() {
  const prev = document.getElementById('hp-banner-preview');
  if (!prev) return;
  const text    = document.getElementById('hp-banner')?.value.trim();
  const enabled = document.getElementById('hp-banner-enabled')?.checked;
  if (enabled && text) {
    prev.innerHTML = `<div class="home-banner"><i class="ti ti-speakerphone" style="font-size:16px;flex-shrink:0"></i><div class="home-banner-text">${text}</div></div>`;
    prev.style.display = 'block';
  } else {
    prev.style.display = 'none';
  }
}

window.saveHomepageEditor = async function saveHomepageEditor() {
  if(!window.S.isAdmin){console.warn("[security] saveHomepageEditor blocked");return;}
  const banner        = document.getElementById('hp-banner')?.value || '';
  const bannerEnabled = document.getElementById('hp-banner-enabled')?.checked !== false;
  window.DB.homepage  = { banner, bannerEnabled };
  await saveHomepage();
  logAdminAction('edit_homepage', { bannerEnabled, bannerLength: banner.length });
  const ok = document.getElementById('hp-ok');
  if (ok) { ok.classList.remove('hidden'); setTimeout(()=>ok.classList.add('hidden'), 2000); }
}
