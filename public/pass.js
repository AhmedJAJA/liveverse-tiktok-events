/* سبونج لايف — «SpongePass»: the season's tier, the reward track (premium above, free below), the premium track,
   the season's frames and how XP is earned. The server decides everything (src/spongepass.mjs): the tier comes from its
   own statistics, a reward is granted once, the premium track is bought with coins checked on the server. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('spTrack')) return;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; };
  const num = (n) => Number(n || 0).toLocaleString('ar-SA');
  const SPRITE = '/icons.svg?v=20261106';
  const icon = (name) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', SPRITE + '#i-' + name); s.append(u); return s; };
  const api = async (method, url, body) => {
    const res = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.href = '/login?next=' + encodeURIComponent('/pass'); throw new Error('سجّل الدخول أولًا'); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'تعذر إتمام الطلب'), { status: res.status });
    return data;
  };
  const msg = (t, ok = true) => { const m = $('spMsg'); m.textContent = t || ''; m.hidden = !t; m.dataset.tone = ok ? 'ok' : 'err'; };
  let st = null, me = { name: 'اسمك', picture: '' }, owned = new Map(), busy = false, scrolled = false;

  /* ---------- a reward, drawn as what it is ---------- */
  function avatar() {
    const box = el('span', 'sp-av'); box.append(el('span', '', Array.from(me.name)[0] || '؟'));
    if (me.picture && /^https:\/\//.test(me.picture)) { const img = el('img'); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = me.picture; img.addEventListener('error', () => img.remove(), { once: true }); box.append(img); }
    return box;
  }
  const frameOf = (f) => ({ id: f.id, effect: f.effect, name: f.name });
  function rewardFace(r) {
    const face = el('span', 'sp-face is-' + r.kind);
    if (r.kind === 'frame') face.append(window.SpongeFrames ? SpongeFrames.avatar(avatar(), frameOf(r.frame)) : avatar());
    else if (r.kind === 'coins') { const img = el('img'); img.src = '/brand/coin-64.webp'; img.alt = ''; img.width = 30; img.height = 30; face.append(img, el('b', 'num', num(r.amount))); }
    else if (r.kind === 'spins') face.append(icon('wheel'), el('b', 'num', '×' + num(r.count)));
    else if (r.kind === 'badge') face.append(icon('trophy'));
    return face;
  }
  const rewardName = (r) => r.kind === 'frame' ? 'إطار «' + r.frame.name + '»' : r.kind === 'coins' ? num(r.amount) + ' عملة' : r.kind === 'spins' ? (r.count === 1 ? 'لفّة مجانية' : num(r.count) + ' لفّات مجانية') : 'شارة «' + r.badge.name + '»';

  function cell(r) {
    const b = el('button', 'sp-cell is-' + r.track);
    b.type = 'button'; b.dataset.tier = r.tier; b.dataset.track = r.track;
    if (r.kind === 'frame') b.dataset.rarity = r.frame.rarity;
    b.classList.toggle('is-claimed', r.claimed); b.classList.toggle('is-ready', r.claimable); b.classList.toggle('is-locked', r.locked); b.classList.toggle('is-future', !r.reached);
    b.append(rewardFace(r));
    const state = r.claimed ? 'استلمته' : r.claimable ? 'استلم' : r.locked ? 'مميز' : 'المستوى ' + num(r.tier);
    b.append(el('small', 'sp-cell-state', state));
    if (r.claimed) b.append(Object.assign(icon('check'), { classList: 'i sp-tick' }));
    else if (r.locked) b.append(Object.assign(icon('lock'), { classList: 'i sp-lock' }));
    b.disabled = !r.claimable;
    b.setAttribute('aria-label', rewardName(r) + ' — ' + (r.track === 'premium' ? 'المسار المميز' : 'المسار المجاني') + '، المستوى ' + num(r.tier) + ' — ' + state);
    b.title = rewardName(r);
    return b;
  }

  /* ---------- paint ---------- */
  function paint() {
    const s = st.season;
    $('spSeason').textContent = s.name;
    const left = Math.ceil((Date.parse(s.endsAt) - Date.parse(st.serverNow)) / 86400e3);
    $('spLeft').textContent = s.ended ? 'انتهى الموسم — يمكنك استلام ما وصلت إليه' : 'يتبقى ' + num(left) + (left === 1 ? ' يوم' : left === 2 ? ' يومان' : left <= 10 ? ' أيام' : ' يومًا');
    $('spTier').textContent = num(st.tier); $('spOf').textContent = 'من ' + num(s.tiers);
    const done = st.tier >= s.tiers, pct = done ? 100 : Math.round((st.tierXp / st.nextTierXp) * 100);
    $('spBarFill').style.setProperty('--p', pct + '%');
    $('spBar').setAttribute('aria-valuemax', String(st.nextTierXp)); $('spBar').setAttribute('aria-valuenow', String(done ? st.nextTierXp : st.tierXp));
    $('spXpText').textContent = done ? 'وصلت إلى المستوى الأخير — ' + num(st.xp) + ' نقطة خبرة' : num(st.tierXp) + ' / ' + num(st.nextTierXp) + ' نقطة إلى المستوى ' + num(st.tier + 1);
    // premium
    $('spPremium').dataset.on = String(st.premium);
    $('spPremiumTitle').textContent = st.premium ? 'المسار المميز مفتوح' : 'المسار المميز';
    $('spPremiumText').textContent = st.premium ? (st.premiumSource === 'grant' ? 'مُنح لك هذا الموسم — استلم مكافآت المسارين.' : 'استلم مكافآت المسارين حتى نهاية الموسم.') : 'ستة إطارات إضافية، منها «ملك الإسفنج» في المستوى الأخير، ولفّات ومكافآت في كل مستوى.';
    $('spBuy').hidden = st.premium || s.ended;
    $('spBuyLabel').textContent = 'افتح المميز — ' + num(s.premiumPrice) + ' عملة';
    $('spBuy').disabled = busy || st.wallet.balance < s.premiumPrice;
    $('spBalance').textContent = st.premium ? '' : st.wallet.balance < s.premiumPrice ? 'رصيدك ' + num(st.wallet.balance) + ' عملة — ينقصك ' + num(s.premiumPrice - st.wallet.balance) : 'رصيدك ' + num(st.wallet.balance) + ' عملة';
    // claim all
    $('spClaimAll').hidden = !st.claimable; $('spReady').textContent = num(st.claimable); $('spClaimAll').disabled = busy;
    // the track: one column per tier, premium above, free below
    const byTier = new Map();
    for (const r of st.rewards) { if (!byTier.has(r.tier)) byTier.set(r.tier, {}); byTier.get(r.tier)[r.track] = r; }
    const cols = [];
    for (let t = 1; t <= s.tiers; t++) {
      const col = el('div', 'sp-col' + (t <= st.tier ? ' is-reached' : '') + (t === st.tier + 1 && !done ? ' is-next' : ''));
      col.dataset.tier = t;
      const x = byTier.get(t) || {};
      col.append(x.premium ? cell(x.premium) : el('span', 'sp-cell is-empty'));
      col.append(el('b', 'sp-num num', num(t)));
      col.append(x.free ? cell(x.free) : el('span', 'sp-cell is-empty'));
      cols.push(col);
    }
    $('spTrack').replaceChildren(...cols);
    if (!scrolled) { scrolled = true; const target = $('spTrack').querySelector('.sp-col.is-next') || $('spTrack').querySelector('.sp-col.is-reached:last-of-type'); target?.scrollIntoView({ inline: 'center', block: 'nearest' }); }
    // the season's frames, on the player's own name
    const frames = st.rewards.filter((r) => r.kind === 'frame');
    $('spFrames').replaceChildren(...frames.map((r) => {
      const li = el('li', 'sp-frame'); li.dataset.rarity = r.frame.rarity;
      const demo = el('div', 'sp-frame-demo');
      demo.append(window.SpongeFrames ? SpongeFrames.avatar(avatar(), frameOf(r.frame)) : avatar(), window.SpongeFrames ? SpongeFrames.plate(me.name, frameOf(r.frame)) : el('b', '', me.name));
      const o = owned.get(r.frame.id);
      const info = el('div', 'sp-frame-info');
      info.append(el('b', '', r.frame.name), el('small', '', (r.track === 'premium' ? 'المميز' : 'المجاني') + ' — المستوى ' + num(r.tier)));
      li.append(demo, info);
      if (o) {
        const eq = el('button', 'sl-btn sl-btn-sm ' + (o.equipped ? 'sl-btn-ghost' : 'sl-btn-primary'), o.equipped ? 'مُجهَّز' : 'تجهيز');
        eq.type = 'button'; eq.disabled = o.equipped || busy; eq.dataset.equip = r.frame.id; li.append(eq);
      } else li.append(el('span', 'sp-frame-lock', r.claimed ? '' : r.claimable ? 'جاهز للاستلام' : r.locked ? 'المسار المميز' : 'المستوى ' + num(r.tier)));
      return li;
    }));
    // XP rules (the server's own numbers)
    const R = st.rules || {};
    $('spRules').replaceChildren(...[['entry', 'كل جولة تشارك فيها'], ['win', 'كل فوز'], ['playMinute', 'كل دقيقة لعب'], ['streamMinute', 'كل دقيقة بث تستضيف فيها لعبة'], ['streamRound', 'كل جولة تستضيفها'], ['session', 'كل جلسة بث']]
      .filter(([k]) => R[k]).map(([k, t]) => { const li = el('li'); li.append(el('b', 'num', '+' + num(R[k])), el('span', '', t)); return li; }));
  }

  async function load() {
    const [pass, frames] = await Promise.all([api('GET', '/api/me/pass'), api('GET', '/api/me/frames').catch(() => ({ frames: [] }))]);
    st = pass; owned = new Map((frames.frames || []).filter((f) => f.owned).map((f) => [f.id, f]));
    if (!st.season) { $('main').replaceChildren(el('p', 'sp-msg', 'لا يوجد موسم SpongePass حاليًا — يبدأ الموسم القادم قريبًا.')); return; }
    paint();
  }
  const run = async (fn) => { if (busy) return; busy = true; if (st) paint(); try { await fn(); } catch (err) { msg(err.message, false); } finally { busy = false; if (st) paint(); } };

  $('spTrack').addEventListener('click', (e) => {
    const b = e.target.closest('.sp-cell.is-ready'); if (!b) return;
    run(async () => {
      const r = await api('POST', '/api/me/pass-claim', { tier: Number(b.dataset.tier), track: b.dataset.track });
      st = r; msg(r.granted.length ? 'استلمت: ' + r.granted.map(rewardName).join('، ') : 'استلمت هذه المكافأة من قبل');
      if (r.granted.some((g) => g.kind === 'frame')) { const f = await api('GET', '/api/me/frames'); owned = new Map(f.frames.filter((x) => x.owned).map((x) => [x.id, x])); }
    });
  });
  $('spClaimAll').addEventListener('click', () => run(async () => {
    const r = await api('POST', '/api/me/pass-claim', { all: true });
    st = r; msg(r.granted.length ? 'استلمت ' + num(r.granted.length) + (r.granted.length === 1 ? ' مكافأة' : ' مكافآت') : 'لا توجد مكافآت جديدة');
    const f = await api('GET', '/api/me/frames'); owned = new Map(f.frames.filter((x) => x.owned).map((x) => [x.id, x]));
  }));
  $('spBuy').addEventListener('click', () => run(async () => {
    if (!confirm('فتح المسار المميز لهذا الموسم مقابل ' + num(st.season.premiumPrice) + ' عملة؟ تُخصم العملات المشتراة أولًا ثم المكتسبة.')) return;
    st = await api('POST', '/api/me/pass-buy', {});
    msg('فُتح المسار المميز — استلم مكافآته من المستويات التي وصلت إليها.');
  }));
  $('spFrames').addEventListener('click', (e) => {
    const b = e.target.closest('[data-equip]'); if (!b) return;
    run(async () => {
      const f = await api('POST', '/api/me/frame-equip', { id: b.dataset.equip });
      owned = new Map(f.frames.filter((x) => x.owned).map((x) => [x.id, x]));
      msg('جُهّز الإطار — يظهر مع اسمك في قوائم اللاعبين.');
    });
  });

  fetch('/api/access/me', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()).then((x) => {
    const a = x.account || x.user || x; if (a?.displayName) me = { name: a.displayName, picture: a.picture || '' }; if (st) paint();
  }).catch(() => {});
  load().catch((err) => msg(err.message, false));
})();
