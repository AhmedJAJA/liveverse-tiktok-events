/* سبونج لايف — «قيد التطوير»: the notice a direct link to a game under development opens. The server decides
   (src/game-status.mjs); this page only names the game from the catalogue — no invented dates or promises. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const path = location.pathname;
  const mode = (path.match(/^\/game\/([a-z]{2,20})$/) || [])[1] || (path === '/bomb' ? 'bomb' : new URLSearchParams(location.search).get('mode') || '');
  const sized = (cover, w) => (/^\/cards\/.+\.webp$/.test(cover || '') ? cover.replace(/\.webp$/, '-' + w + '.webp') : cover);
  fetch('/api/site', { cache: 'no-store' }).then((r) => r.json()).then((site) => {
    const g = [...(site.games || []), ...(site.extraGames || [])].find((x) => x.mode === mode);
    if (site.devMessage) $('gsMsg').textContent = site.devMessage;
    if (!g) return;
    document.title = g.title + ' — قيد التطوير — سبونج لايف';
    $('gsTitle').textContent = g.title;
    if (g.categoryLabel) { $('gsCat').textContent = g.categoryLabel; $('gsCat').hidden = false; }
    if (g.cover) { const img = $('gsCover'); img.src = sized(g.cover, 400) || g.cover; img.addEventListener('error', () => { img.src = '/brand/sponge-256.webp'; }, { once: true }); }
    if (g.spotlight && g.spotlightBadge) {
      $('gsBadge').textContent = g.spotlightBadge; $('gsBadge').classList.add('is-spotlight');
      $('gsNote').textContent = 'هي أول لعبة ستعود: نعيد بناءها من الصفر ونختبرها قبل فتحها للجميع.'; $('gsNote').hidden = false;
    }
    // a game released meanwhile: this notice no longer applies
    if (g.status === 'available') { $('gsMsg').textContent = 'اللعبة متاحة الآن — افتحها من مكتبة الألعاب.'; document.querySelector('.gs-state').hidden = true; }
  }).catch(() => {});
})();
