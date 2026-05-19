/* ratings.js — Problem difficulty rating (1–5 stars)
   - Students rate after solving (or any time in practice)
   - Rating stored in user profile: { probRatings: { [probId]: 1-5 } }
   - Aggregate (average + count) stored on the problem doc in Firestore
   - Admin sees avg rating in the problem bank list
*/

// ── Build star rating widget HTML ──────────────
// Returns an HTML string. Pass onRate callback name for interactive mode.
function starWidget(probId, currentRating, interactive, size = 16) {
  if (!interactive) {
    // Read-only display
    const filled = Math.round(currentRating || 0);
    return Array.from({length:5}, (_,i) =>
      `<i class="ti ${i < filled ? 'ti-star-filled' : 'ti-star'}"
          style="font-size:${size}px;color:${i < filled ? 'var(--warn)' : 'var(--border2)'};"></i>`
    ).join('');
  }
  // Interactive — each star calls submitRating on click
  return `<div class="star-rating" id="stars-${probId}" style="display:inline-flex;gap:2px;cursor:pointer">
    ${Array.from({length:5}, (_,i) => `
      <i class="ti ${currentRating && i < currentRating ? 'ti-star-filled' : 'ti-star'}"
         data-val="${i+1}"
         style="font-size:${size}px;color:${currentRating && i < currentRating ? 'var(--warn)' : 'var(--border2)'};transition:color .15s"
         onclick="submitRating('${probId}', ${i+1})"
         onmouseenter="previewStars('${probId}', ${i+1})"
         onmouseleave="resetStars('${probId}')">
      </i>`).join('')}
  </div>
  <span id="rating-label-${probId}" style="font-size:11px;color:var(--text4);margin-left:6px;font-family:var(--mono)">
    ${currentRating ? ratingLabel(currentRating) : 'Rate difficulty'}
  </span>`;
}

function ratingLabel(r) {
  return ['','Very easy','Easy','Medium','Hard','Very hard'][Math.round(r)] || '';
}

function previewStars(probId, val) {
  const wrap = document.getElementById(`stars-${probId}`);
  if (!wrap) return;
  wrap.querySelectorAll('i').forEach((star, i) => {
    star.className = `ti ${i < val ? 'ti-star-filled' : 'ti-star'}`;
    star.style.color = i < val ? 'var(--warn)' : 'var(--border2)';
  });
  const lbl = document.getElementById(`rating-label-${probId}`);
  if (lbl) lbl.textContent = ratingLabel(val);
}

function resetStars(probId) {
  const u = window.DB.users[window.S.user];
  const myRating = u?.probRatings?.[probId] || 0;
  previewStars(probId, myRating);
  const lbl = document.getElementById(`rating-label-${probId}`);
  if (lbl) lbl.textContent = myRating ? ratingLabel(myRating) : 'Rate difficulty';
}

// ── Submit a rating ────────────────────────────
async function submitRating(probId, val) {
  const u = window.DB.users[window.S.user];
  if (!u) return;

  const prev = u.probRatings?.[probId];
  if (!u.probRatings) u.probRatings = {};
  u.probRatings[probId] = val;
  await saveUserOnly();

  // Update aggregate on the problem doc in Firestore
  await updateProblemAggregate(probId, val, prev);

  // Update local DB.problems aggregate too
  const prob = window.DB.problems.find(p => p.id === probId);
  if (prob) {
    const agg = await getProblemAggregate(probId);
    if (agg) { prob.ratingAvg = agg.avg; prob.ratingCount = agg.count; }
  }

  // Re-render stars to show selection
  resetStars(probId);

  // Flash confirmation
  const lbl = document.getElementById(`rating-label-${probId}`);
  if (lbl) {
    lbl.textContent = '✓ Rated!';
    lbl.style.color = 'var(--green)';
    setTimeout(() => {
      lbl.textContent = ratingLabel(val);
      lbl.style.color = '';
    }, 1500);
  }
}

async function updateProblemAggregate(probId, newVal, prevVal) {
  try {
    // Store aggregate in a separate 'ratings' collection (students can write)
    const ref  = window._docRef('ratings', probId);
    const snap = await window._getDoc(ref);
    const data = snap.exists() ? snap.data() : { total:0, count:0 };
    let { total, count } = data;

    if (prevVal) { total -= prevVal; count = Math.max(0, count-1); }
    total += newVal; count++;

    await window._setDoc('ratings', probId, {
      total, count,
      avg: Math.round((total/count)*10)/10,
    });
  } catch(e) {
    console.warn('Rating aggregate update failed:', e);
  }
}

async function getProblemAggregate(probId) {
  try {
    const snap = await window._getDoc(window._docRef('ratings', probId));
    if (!snap.exists()) return null;
    const d = snap.data();
    return { avg: d.avg || 0, count: d.count || 0 };
  } catch(e) { return null; }
}

// ── Inject rating widget into a problem card ───
// Called after buildProbCardEl; pass the card element and problem data.
function injectRatingWidget(cardEl, prob) {
  if (!cardEl) return;
  const u        = window.DB.users[window.S.user];
  const myRating = u?.probRatings?.[prob.id] || 0;
  const avgRating = prob.ratingAvg || 0;
  const count     = prob.ratingCount || 0;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;border-top:0.5px solid var(--border);margin-top:8px;flex-wrap:wrap';
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:4px">
      ${starWidget(prob.id, myRating, true)}
    </div>
    ${avgRating ? `
      <div style="font-size:10px;color:var(--text4);font-family:var(--mono);margin-left:auto">
        Class avg: ${avgRating}★ (${count})
      </div>` : ''}`;

  const body = cardEl.querySelector('.prob-body');
  if (body) body.appendChild(wrap);
}
