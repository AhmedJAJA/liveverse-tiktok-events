import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const home = read('landing.html');
const css = read('royal-landing.css');
const script = read('landing.js');
const studio = read('app.js');
test('SKY LIVE approved homepage contains all nine cohesive dashboard areas',()=>{
  for(const id of ['platforms','season','tasks','tools','games','leaderboard','allGames','how','start'])
    assert.match(home,new RegExp('id="'+id+'"'),id);
  for(const label of ['اربط بثك وابدأ التفاعل','موسم','مهام اليوم','مسار التقدم','أدوات البث','الألعاب الجديدة','تحدي المعلومات','سباق الجمهور','أبطال','استكشف المزيد من الألعاب'])
    assert.ok(home.includes(label),label);
});
test('live connect form requires admin permission instead of publishing a secret',()=>{
  for(const id of ['liveConnectForm','liveUsername','liveConnectionBadge','adminDialog','landingAdminToken','adminLoginForm'])
    assert.ok(home.includes('id="'+id+'"'),id);
  assert.match(script,/sessionStorage\.getItem\('liveverse_admin'\)/);
  assert.match(script,/Authorization:'Bearer '/);
  assert.match(script,/callAdmin\('verify'/);
  assert.doesNotMatch(script,/\/api\/dev-token/);
});
test('champion cards and score progress are populated from real API state',()=>{
  for(const id of ['nameOne','nameTwo','nameThree','pointsOne','pointsTwo','pointsThree','seasonChampions','passProgress'])
    assert.ok(home.includes('id="'+id+'"'),id);
  assert.match(script,/\/api\/state/);
  assert.match(script,/new WebSocket/);
  assert.match(script,/renderLeaderboard\(leaderboard\)/);
  assert.match(script,/renderChampions\(leaderboard\)/);
  assert.match(script,/safeAvatar\(raw\)/);
});
test('home game links select working studio game modes, without fake gameplay',()=>{
  for(const mode of ['quiz','race','guess','wheel']) {
    assert.ok(home.includes('mode='+mode'),mode);
    assert.ok(studio.includes("['quiz','guess','race','wheel','glass'].includes(requestedMode)"));
  }
  assert.match(studio,/urlOptions\.get\('panel'\) === 'games'/);
});
test('approved mobile visual layout, animations and accessible fallback are present',()=>{
  for(const cls of ['.connect-card','.season-hero','.daily-strip','.pass-card','.tools-strip','.games-grid','.podium-grid','.category-grid','.hero-crown','.quiz-sign','.race-car'])
    assert.ok(css.includes(cls),cls);
  assert.match(css,/@media \(max-width:560px\)/);
  assert.match(css,/@media \(max-width:850px\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(home,/aria-label="أبطال الجلسة"/);
  assert.match(home,/الصورة غير متاحة حاليًا/);
});
