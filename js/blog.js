/* ═══════════════════════════════════════════
   blog.js — Blog reader and rich text editor
   ═══════════════════════════════════════════ */

// ── Category pills ────────────────────────────
// catPill() and the category colour map now live in firebase.js so the blog
// page and the home page render identical pills from one editable source.
// (window.catPill is defined before this file loads.)

// ── Search / author filter handlers ───────────
window.onBlogSearch = function onBlogSearch(val) {
  window.S.blogSearch = val || '';
  const clearBtn = document.getElementById('blog-search-clear');
  if (clearBtn) clearBtn.classList.toggle('hidden', !window.S.blogSearch);
  renderBlogList();
};
window.clearBlogSearch = function clearBlogSearch() {
  window.S.blogSearch = '';
  const input = document.getElementById('blog-search-input');
  if (input) input.value = '';
  const clearBtn = document.getElementById('blog-search-clear');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderBlogList();
};
window.onBlogAuthor = function onBlogAuthor(val) {
  window.S.blogAuthor = val || 'All';
  renderBlogList();
};
window.resetBlogFilters = function resetBlogFilters() {
  window.S.blogSearch = '';
  window.S.blogAuthor = 'All';
  window.S.blogFilter = 'All';
  const input = document.getElementById('blog-search-input');
  if (input) input.value = '';
  const clearBtn = document.getElementById('blog-search-clear');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderBlogList();
};

// Strip HTML tags so post body text is searchable as plain text
function _blogPlainText(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ');
}

// ── Blog list (reader) ────────────────────────
window.renderBlogList = function renderBlogList() {
  document.getElementById('blog-list-view').classList.remove('hidden');
  document.getElementById('blog-post-view').classList.add('hidden');

  // Default state (in case S wasn't initialised with these keys)
  if (window.S.blogSearch == null) window.S.blogSearch = '';
  if (window.S.blogAuthor == null) window.S.blogAuthor = 'All';

  // Visible posts: published always, drafts only for admin
  const posts = window.DB.posts
    .filter(p => p.status === 'published' || (window.S.isAdmin && p.status === 'draft'))
    .sort((a, b) => b.createdAt - a.createdAt);

  // Build category filter chips
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

  // Build author (poster) dropdown from the visible posts
  const authorSel = document.getElementById('blog-author-filter');
  if (authorSel) {
    const authors = ['All', ...[...new Set(posts.map(p => p.author).filter(Boolean))].sort()];
    // If the currently selected author no longer exists, fall back to All
    if (!authors.includes(window.S.blogAuthor)) window.S.blogAuthor = 'All';
    authorSel.innerHTML = authors.map(a =>
      `<option value="${escHtml(a)}">${a === 'All' ? 'All authors' : escHtml(a)}</option>`
    ).join('');
    authorSel.value = window.S.blogAuthor;
  }

  // Apply filters: category → author → text search
  let filtered = window.S.blogFilter === 'All'
    ? posts
    : posts.filter(p => p.category === window.S.blogFilter);

  if (window.S.blogAuthor !== 'All') {
    filtered = filtered.filter(p => p.author === window.S.blogAuthor);
  }

  const q = window.S.blogSearch.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(p => {
      const haystack = [
        p.title, p.excerpt, p.author, p.category, _blogPlainText(p.content)
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }

  const grid  = document.getElementById('blog-grid');
  const empty = document.getElementById('blog-empty');
  grid.innerHTML = '';

  if (!filtered.length) {
    // Distinguish "no posts at all" from "no matches for this search/filter"
    const filtering = q || window.S.blogAuthor !== 'All' || window.S.blogFilter !== 'All';
    if (filtering) {
      empty.classList.add('hidden');
      grid.innerHTML = `<div class="blog-no-results">
        <i class="ti ti-search-off" style="font-size:28px;display:block;margin-bottom:8px;color:var(--text4)"></i>
        No posts match your search or filters.
        <div style="margin-top:10px"><button class="btn btn-sm" onclick="resetBlogFilters()"><i class="ti ti-rotate"></i> Clear filters</button></div>
      </div>`;
    } else {
      empty.classList.remove('hidden');
    }
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
          ${window.categoryPill(post.category)}
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

window.openBlogPost = function openBlogPost(id) {
  const post = window.DB.posts.find(p => p.id === id);
  if (!post) return;
  window.S._openPostId = id;
  document.getElementById('blog-list-view').classList.add('hidden');
  document.getElementById('blog-post-view').classList.remove('hidden');
  const date = new Date(post.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('post-title-el').textContent = post.title;
  document.getElementById('post-meta-el').innerHTML =
    `${window.categoryPill(post.category)}<span class="post-date">${date}</span><span class="post-date">by ${post.author}</span>
    ${post.status === 'draft' ? '<span class="pill pill-warn">Draft</span>' : ''}`;
  document.getElementById('post-content-el').innerHTML = post.content;
  document.getElementById('view-blog').scrollTop = 0;
  loadPostComments(id);
}

window.showBlogList = function showBlogList() {
  document.getElementById('blog-list-view').classList.remove('hidden');
  document.getElementById('blog-post-view').classList.add('hidden');
}

// ── Comments ──────────────────────────────────

async function loadPostComments(postId) {
  const container = document.getElementById('post-comments');
  if (!container) return;
  container.style.display = 'block';
  container.innerHTML = '<div style="color:var(--text4);font-size:12px;padding:1rem 0">Loading comments…</div>';

  let comments = [];
  try {
    const { query, collection, orderBy, getDocs } = window._firestoreQuery;
    const db = window._getFirestoreDb();
    const snap = await getDocs(
      query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'))
    );
    snap.forEach(d => comments.push({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('[comments] load failed:', e);
    container.innerHTML = '<div style="color:var(--red);font-size:12px;padding:1rem 0">Could not load comments.</div>';
    return;
  }

  _renderComments(postId, comments);
}

function _renderComments(postId, comments) {
  const container = document.getElementById('post-comments');
  if (!container) return;
  const uid = window.S.uid;

  // Non-admins only see approved comments
  const visible = window.S.isAdmin ? comments : comments.filter(c => c.approved);

  let html = `<div class="comment-section-label"><i class="ti ti-message-circle"></i> Comments${visible.length ? ' ' + visible.length : ''}</div>`;

  if (!visible.length) {
    html += `<div style="color:var(--text4);font-size:12px;padding:.5rem 0 1rem">No comments yet — be the first!</div>`;
  } else {
    visible.forEach(c => {
      const isMe = c.uid === uid;
      const dateStr = new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const pendingBadge = !c.approved
        ? `<span class="pill" style="background:rgba(255,180,0,.15);color:#e0a800;font-size:9px;margin-left:4px">Pending</span>`
        : '';
      html += `<div class="comment-row">
        <div class="comment-header">
          <span class="comment-author">${escHtml(c.username || 'Anonymous')}${isMe ? ' <span style="color:var(--text4);font-weight:400">(you)</span>' : ''}${pendingBadge}</span>
          <span class="comment-date">${dateStr}</span>
          <div class="comment-actions">
            ${(isMe || window.S.isAdmin) ? `<button class="pm-icon-btn del" title="Delete" onclick="deleteComment('${escHtml(postId)}','${escHtml(c.id)}')"><i class="ti ti-trash"></i></button>` : ''}
            ${(window.S.isAdmin && !c.approved) ? `<button class="pm-icon-btn" title="Approve" onclick="approveComment('${escHtml(postId)}','${escHtml(c.id)}')"><i class="ti ti-check"></i></button>` : ''}
            ${!isMe ? `<button class="pm-icon-btn" title="Report" onclick="reportComment('${escHtml(postId)}','${escHtml(c.id)}')"><i class="ti ti-flag"></i></button>` : ''}
          </div>
        </div>
        <div class="comment-body">${escHtml(c.body)}</div>
      </div>`;
    });
  }

  html += `<div class="comment-form-label"><i class="ti ti-message-plus"></i> Leave a comment</div>
    <textarea id="comment-input" class="comment-textarea" placeholder="Write your comment…" maxlength="2000"></textarea>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
      <span style="font-size:11px;color:var(--text4)">Max 2000 characters</span>
      <button class="btn btn-accent btn-sm" onclick="submitComment('${escHtml(postId)}')"><i class="ti ti-send"></i> Post comment</button>
    </div>
    <div id="comment-err" class="err-msg hidden" style="margin-top:8px"><i class="ti ti-alert-circle"></i><span></span></div>`;

  container.innerHTML = html;
}

window.submitComment = async function submitComment(postId) {
  const input = document.getElementById('comment-input');
  const body  = (input?.value || '').trim();
  if (!body) { _showCommentErr('Write something first.'); return; }

  const btn = document.querySelector('#post-comments .btn-accent');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i> Posting…'; }
  const errEl = document.getElementById('comment-err');
  if (errEl) errEl.classList.add('hidden');

  try {
    const { getFunctions, httpsCallable } = await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js'
    );
    const fns  = getFunctions(window._firebaseApp, 'us-central1');
    const call = httpsCallable(fns, 'postComment');
    await call({ postId, body });
    await loadPostComments(postId);
  } catch (e) {
    _showCommentErr(e?.message || 'Failed to post comment.');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-send"></i> Post comment'; }
  }
};

window.deleteComment = async function deleteComment(postId, commentId) {
  if (!confirm('Delete this comment?')) return;
  try {
    const { doc, deleteDoc } = window._firestoreQuery;
    await deleteDoc(doc(window._getFirestoreDb(), 'posts', postId, 'comments', commentId));
    await loadPostComments(postId);
  } catch (e) {
    alert('Failed to delete: ' + e.message);
  }
};

window.approveComment = async function approveComment(postId, commentId) {
  try {
    const { doc, updateDoc } = window._firestoreQuery;
    await updateDoc(doc(window._getFirestoreDb(), 'posts', postId, 'comments', commentId), { approved: true });
    // Refresh wherever we are — post view or admin panel
    const container = document.getElementById('post-comments');
    if (container && container.style.display !== 'none') {
      await loadPostComments(postId);
    }
    if (document.getElementById('reported-comments-list')) {
      renderReportedComments();
    }
  } catch (e) {
    alert('Failed to approve: ' + e.message);
  }
};

window.reportComment = async function reportComment(postId, commentId) {
  if (!confirm('Report this comment for review?')) return;
  try {
    const { doc, updateDoc } = window._firestoreQuery;
    await updateDoc(doc(window._getFirestoreDb(), 'posts', postId, 'comments', commentId), { reported: true });
    alert('Comment reported — thank you.');
  } catch (e) {
    alert('Failed to report: ' + e.message);
  }
};

// Admin: all reported comments across all posts (requires collectionGroup index in Firestore)
window.renderReportedComments = async function renderReportedComments() {
  const el = document.getElementById('reported-comments-list');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text4);font-size:12px">Loading…</div>';
  try {
    const { collectionGroup, query, where, orderBy, getDocs } = window._firestoreQuery;
    const db   = window._getFirestoreDb();
    const snap = await getDocs(
      query(collectionGroup(db, 'comments'), where('reported', '==', true), orderBy('createdAt', 'desc'))
    );
    if (snap.empty) {
      el.innerHTML = '<div style="color:var(--text4);font-size:12px">No reported comments.</div>';
      return;
    }
    el.innerHTML = '';
    snap.forEach(d => {
      const c      = d.data();
      const postId = d.ref.parent.parent.id;
      const row    = document.createElement('div');
      row.className = 'comment-row';
      row.innerHTML = `
        <div class="comment-header">
          <span class="comment-author">${escHtml(c.username || 'Anonymous')}</span>
          <span class="comment-date">${new Date(c.createdAt).toLocaleDateString()}</span>
          <span style="font-size:10px;color:var(--text4);margin-left:4px">post: ${escHtml(postId)}</span>
          <div class="comment-actions">
            <button class="btn btn-sm btn-accent" onclick="approveComment('${escHtml(postId)}','${escHtml(d.id)}')"><i class="ti ti-check"></i> Approve</button>
            <button class="btn btn-sm" onclick="deleteComment('${escHtml(postId)}','${escHtml(d.id)}')"><i class="ti ti-trash"></i> Delete</button>
          </div>
        </div>
        <div class="comment-body">${escHtml(c.body)}</div>`;
      el.appendChild(row);
    });
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red);font-size:12px">Error: ${escHtml(e.message)}</div>`;
  }
};

function _showCommentErr(msg) {
  const el = document.getElementById('comment-err');
  if (!el) return;
  el.querySelector('span').textContent = msg;
  el.classList.remove('hidden');
}

// ── Rich text editor ──────────────────────────
window.rteExec = function rteExec(cmd) {
  document.getElementById('rte-body').focus();
  document.execCommand(cmd, false, null);
}

window.rteBlock = function rteBlock(tag) {
  document.getElementById('rte-body').focus();
  document.execCommand('formatBlock', false, tag);
}

window.rteInsertCode = function rteInsertCode() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const code = document.createElement('code');
  code.textContent = sel.toString() || 'code';
  sel.deleteFromDocument();
  sel.getRangeAt(0).insertNode(code);
}

window.rteInsertHR = function rteInsertHR() {
  document.getElementById('rte-body').focus();
  document.execCommand('insertHTML', false, '<hr/><p><br></p>');
}

// Category custom tag toggle
window.toggleCustomTag = function toggleCustomTag(sel) {
  const w = document.getElementById('bp-custom-wrap');
  if (w) w.style.display = sel.value === 'custom' ? 'block' : 'none';
}

// ── Blog editor form ──────────────────────────
// Fill the category <select> from the editable category list (+ a custom option)
window.populateBpCategory = function populateBpCategory(selected) {
  const sel = document.getElementById('bp-category');
  if (!sel) return;
  const cats = (window.DB.categories && window.DB.categories.length)
    ? window.DB.categories : (window.DEFAULT_CATEGORIES || []);
  sel.innerHTML = cats.map(c =>
    `<option value="${escHtml(c.name)}">${escHtml(c.name)}</option>`
  ).join('') + `<option value="custom">Custom…</option>`;
  if (selected != null) sel.value = selected;
};

window.resetBlogForm = function resetBlogForm() {
  window.S.editingPostId = null;
  ['bp-title', 'bp-excerpt', 'bp-custom-tag'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  populateBpCategory();
  const firstCat = (window.DB.categories && window.DB.categories[0]?.name) || 'Tutorial';
  document.getElementById('bp-category').value = firstCat;
  document.getElementById('bp-status').value   = 'published';
  document.getElementById('bp-custom-wrap').style.display = 'none';
  document.getElementById('rte-body').innerHTML = '';
  document.getElementById('blog-form-label').textContent = 'New post';
}

window.saveBlogPost = async function saveBlogPost() {
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
  // Send email notification when a new post is published (not drafts, not edits).
  // Announcements go to announcement subscribers; everything else to post subscribers.
  if (_pIsNew && post.status === 'published' && typeof sendEmailNotification === 'function') {
    const _type = post.category === 'Announcement' ? 'announcements' : 'posts';
    sendEmailNotification(
      `New ${post.category}: ${post.title}`,
      `A new ${post.category} post has been published on Circuits Practice.\n\n"${post.title}"\n\n${post.excerpt || 'Log in to read the full post.'}\n\n— ${post.author}`,
      _type
    ).then(r => { if (r && r.sent > 0) console.log(`Notified ${r.sent} student(s).`); })
     .catch(e => console.error('[notifications] post auto-send failed:', e));
  }
  alert(`"${post.title}" ${post.status === 'draft' ? 'saved as draft' : 'published'}!`);
}

window.loadPostToEditor = function loadPostToEditor(post) {
  window.S.editingPostId = post.id;
  document.getElementById('bp-title').value   = post.title   || '';
  document.getElementById('bp-excerpt').value = post.excerpt || '';

  const known = (window.DB.categories && window.DB.categories.length)
    ? window.DB.categories.map(c => c.name)
    : ['Tutorial', 'Update', 'Announcement', 'Resource'];
  populateBpCategory();
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

window.deletePost = async function deletePost(id) {
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
window.renderBlogPostList = function renderBlogPostList() {
  // Keep the category dropdown in sync with the current category list
  populateBpCategory(document.getElementById('bp-category')?.value);
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
