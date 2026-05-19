/* ═══════════════════════════════════════════
   blog.js — Blog reader and rich text editor
   ═══════════════════════════════════════════ */

// ── Category pill colors ──────────────────────
const CAT_COLORS = {
  Tutorial:     'background:rgba(74,222,128,.10);color:#4ade80;border:0.5px solid rgba(74,222,128,.25)',
  Update:       'background:rgba(157,125,232,.15);color:#c4a8ff;border:0.5px solid rgba(157,125,232,.30)',
  Announcement: 'background:rgba(232,201,107,.12);color:#e8c96b;border:0.5px solid rgba(232,201,107,.30)',
  Resource:     'background:rgba(20,184,166,.10);color:#2dd4bf;border:0.5px solid rgba(20,184,166,.25)',
};

function catPill(cat) {
  const s = CAT_COLORS[cat] || 'background:rgba(157,125,232,.08);color:var(--text3);border:0.5px solid var(--border)';
  return `<span class="pill" style="${s}">${cat}</span>`;
}

// ── Blog list (reader) ────────────────────────
function renderBlogList() {
  document.getElementById('blog-list-view').classList.remove('hidden');
  document.getElementById('blog-post-view').classList.add('hidden');

  // Visible posts: published always, drafts only for admin
  const posts = window.DB.posts
    .filter(p => p.status === 'published' || (window.S.isAdmin && p.status === 'draft'))
    .sort((a, b) => b.createdAt - a.createdAt);

  // Build filter chips
  const cats = ['All', ...new Set(posts.map(p => p.category))];
  const bar  = document.getElementById('blog-filter-bar');
  bar.innerHTML = '';
  cats.forEach(c => {
    const chip = document.createElement('button');
    chip.className = 'filter-chip' + (window.S.blogFilter === c ? ' active' : '');
    chip.textContent = c;
    chip.onclick = () => { window.S.blogFilter = c; renderBlogList(); };
    bar.appendChild(chip);
  });

  const filtered = window.S.blogFilter === 'All'
    ? posts
    : posts.filter(p => p.category === window.S.blogFilter);

  const grid  = document.getElementById('blog-grid');
  const empty = document.getElementById('blog-empty');
  grid.innerHTML = '';

  if (!filtered.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  filtered.forEach(post => {
    const card = document.createElement('div');
    card.className = 'blog-card';
    const date = new Date(post.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    card.innerHTML = `
      <div class="blog-card-inner">
        <div class="blog-card-meta">
          ${catPill(post.category)}
          ${post.status === 'draft' ? `<span class="pill pill-warn">Draft</span>` : ''}
          <span class="blog-card-date">${date}</span>
        </div>
        <div class="blog-card-title">${post.title}</div>
        ${post.excerpt ? `<div class="blog-card-excerpt">${post.excerpt}</div>` : ''}
        <div class="blog-card-footer">
          <span class="blog-card-author">by ${post.author}</span>
          <span class="blog-read-more">Read more →</span>
        </div>
      </div>`;
    card.onclick = () => openBlogPost(post.id);
    grid.appendChild(card);
  });
}

function openBlogPost(id) {
  const post = window.DB.posts.find(p => p.id === id);
  if (!post) return;
  document.getElementById('blog-list-view').classList.add('hidden');
  document.getElementById('blog-post-view').classList.remove('hidden');
  const date = new Date(post.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('post-title-el').textContent = post.title;
  document.getElementById('post-meta-el').innerHTML =
    `${catPill(post.category)}<span class="post-date">${date}</span><span class="post-date">by ${post.author}</span>
    ${post.status === 'draft' ? '<span class="pill pill-warn">Draft</span>' : ''}`;
  document.getElementById('post-content-el').innerHTML = post.content;
  document.getElementById('view-blog').scrollTop = 0;
}

function showBlogList() {
  document.getElementById('blog-list-view').classList.remove('hidden');
  document.getElementById('blog-post-view').classList.add('hidden');
}

// ── Rich text editor ──────────────────────────
function rteExec(cmd) {
  document.getElementById('rte-body').focus();
  document.execCommand(cmd, false, null);
}

function rteBlock(tag) {
  document.getElementById('rte-body').focus();
  document.execCommand('formatBlock', false, tag);
}

function rteInsertCode() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const code = document.createElement('code');
  code.textContent = sel.toString() || 'code';
  sel.deleteFromDocument();
  sel.getRangeAt(0).insertNode(code);
}

function rteInsertHR() {
  document.getElementById('rte-body').focus();
  document.execCommand('insertHTML', false, '<hr/><p><br></p>');
}

// Category custom tag toggle
function toggleCustomTag(sel) {
  const w = document.getElementById('bp-custom-wrap');
  if (w) w.style.display = sel.value === 'custom' ? 'block' : 'none';
}

// ── Blog editor form ──────────────────────────
function resetBlogForm() {
  window.S.editingPostId = null;
  ['bp-title', 'bp-excerpt', 'bp-custom-tag'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('bp-category').value = 'Tutorial';
  document.getElementById('bp-status').value   = 'published';
  document.getElementById('bp-custom-wrap').style.display = 'none';
  document.getElementById('rte-body').innerHTML = '';
  document.getElementById('blog-form-label').textContent = 'New post';
}

async function saveBlogPost() {
  if(!window.S.isAdmin){console.warn("[security] saveBlogPost blocked");return;}
  const title = document.getElementById('bp-title').value.trim();
  if (!title) { alert('Enter a title.'); return; }

  const catSel   = document.getElementById('bp-category').value;
  const category = catSel === 'custom'
    ? (document.getElementById('bp-custom-tag').value.trim() || 'Custom')
    : catSel;

  const content = document.getElementById('rte-body').innerHTML;
  if (!content.replace(/<[^>]*>/g, '').trim()) { alert('Write some content first.'); return; }

  const existing = window.DB.posts.find(p => p.id === window.S.editingPostId);
  const post = {
    id:           window.S.editingPostId || `post-${Date.now()}`,
    title,
    category,
    excerpt:      document.getElementById('bp-excerpt').value.trim(),
    content,
    status:       document.getElementById('bp-status').value,
    author:       window.S.user,
    createdAt:    existing?.createdAt || Date.now(),
    updatedAt:    Date.now(),
  };

  const idx = window.DB.posts.findIndex(p => p.id === post.id);
  if (idx >= 0) window.DB.posts[idx] = post;
  else          window.DB.posts.unshift(post);

  const _pIsNew = idx < 0;
  window.S.editingPostId = post.id;
  document.getElementById('blog-form-label').textContent = `Editing: ${post.title}`;
  await saveDB();
  logAdminAction(_pIsNew ? 'create_post' : 'edit_post', { id: post.id, title: post.title, category: post.category, status: post.status });
  renderBlogPostList();
  alert(`"${post.title}" ${post.status === 'draft' ? 'saved as draft' : 'published'}!`);
}

function loadPostToEditor(post) {
  window.S.editingPostId = post.id;
  document.getElementById('bp-title').value   = post.title   || '';
  document.getElementById('bp-excerpt').value = post.excerpt || '';

  const known = ['Tutorial', 'Update', 'Announcement', 'Resource'];
  if (known.includes(post.category)) {
    document.getElementById('bp-category').value        = post.category;
    document.getElementById('bp-custom-wrap').style.display = 'none';
  } else {
    document.getElementById('bp-category').value        = 'custom';
    document.getElementById('bp-custom-tag').value      = post.category;
    document.getElementById('bp-custom-wrap').style.display = 'block';
  }

  document.getElementById('bp-status').value   = post.status || 'published';
  document.getElementById('rte-body').innerHTML = post.content || '';
  document.getElementById('blog-form-label').textContent = `Editing: ${post.title}`;

  // Switch to blog editor tab
  showEdTab('blog', document.querySelectorAll('.editor-top-tab')[3]);
}

async function deletePost(id) {
  if(!window.S.isAdmin){console.warn("[security] deletePost blocked");return;}
  if (!confirm('Delete this post?')) return;
  const _dp = window.DB.posts.find(p => p.id === id);
  logAdminAction('delete_post', { id, title: _dp?.title, category: _dp?.category });
  window.DB.posts = window.DB.posts.filter(p => p.id !== id);
  if (window.S.editingPostId === id) resetBlogForm();
  await deleteFromDB('posts', id);
  renderBlogPostList();
}

// ── Blog post list (editor sidebar) ──────────
function renderBlogPostList() {
  const list  = document.getElementById('blog-post-list');
  const empty = document.getElementById('blog-post-list-empty');
  document.getElementById('post-count').textContent = `(${window.DB.posts.length})`;

  list.innerHTML = '';
  empty.style.display = window.DB.posts.length ? 'none' : 'block';

  window.DB.posts.forEach(post => {
    const row = document.createElement('div');
    row.className = 'blog-post-row' + (post.id === window.S.editingPostId ? ' selected' : '');
    const date = new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    row.innerHTML = `
      <div class="blog-post-row-body">
        <div class="blog-post-row-title">${post.title}</div>
        <div class="blog-post-row-meta">${post.category} · ${date}${post.status === 'draft' ? ' · draft' : ''}</div>
      </div>
      <div class="blog-post-row-actions">
        <button class="pm-icon-btn" title="Edit"   onclick="event.stopPropagation(); loadPostToEditor(window.DB.posts.find(p=>p.id==='${post.id}'))"><i class="ti ti-edit"></i></button>
        <button class="pm-icon-btn del" title="Delete" onclick="event.stopPropagation(); deletePost('${post.id}')"><i class="ti ti-trash"></i></button>
      </div>`;
    row.onclick = () => loadPostToEditor(window.DB.posts.find(p => p.id === post.id));
    list.appendChild(row);
  });
}
