import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = path => fs.readFileSync(new URL('../public/'+path, import.meta.url), 'utf8');
const home=file('index.html');
const overlay=file('overlay.html');
const theme=file('liveverse-show.css');
const presenter=file('presenter.css');
const audience=file('broadcast-theme.css');
const script=file('app.js');
test('reference-inspired site-wide identity loads after foundational CSS on both pages',()=>{
  for(const html of [home,overlay]) {
    assert.match(html,/<link rel="stylesheet" href="\/liveverse-show\.css">/);
    assert.ok(html.indexOf('/liveverse-show.css') > html.indexOf('/styles.css') || html.indexOf('/liveverse-show.css') > html.indexOf('/broadcast-theme.css'));
  }
});
test('site-wide theme styles the presenter, controls, overlays, registration and results',()=>{
  for(const selector of ['.presenter-toolbar','.presenter-actions','.presenter-stage','.presenter-footer','.settings-dialog','.arena .question-card','.arena .choice','.arena .signup-spotlight','.arena .results-screen']) {
    assert.ok(theme.includes(selector),selector);
  }
});
test('presenter controls remain connected and live stats contain no fake data',()=>{
  for(const id of ['presenterRegistration','presenterSettings','presenterNext','presenterStop','presenterFullscreen','presenterStart','presenterAudienceCount','presenterQuestionNumber'])
    assert.ok(home.includes('id="'+id+'"'),id);
  assert.match(script,/el\('presenterAudienceCount'\)\.textContent=count/);
  assert.match(script,/el\('presenterQuestionNumber'\)\.textContent=/);
  assert.match(script,/presenterKeyword'\)\.textContent=active/);
});
test('mobile and accessibility support retained in original and new styles',()=>{
  assert.match(theme,/@media\(max-width:780px\)/);
  assert.match(theme, /prefers-reduced-motion/);
  assert.match(presenter, /:focus-visible/);
  assert.match(audience, /max-aspect-ratio:4\/5/);
  assert.match(overlay, /id="signupRecent"/);
  assert.match(overlay, /id="roundResultsOverlay"/);
});
test('original own branding used, no impersonation or external third-party source',()=>{
  assert.doesNotMatch(theme,/hudhudlive\.com/i);
  assert.doesNotMatch(home,/hudhudlive\.com/i);
  assert.match(home,/LIVEVERSE/);
  assert.match(overlay,/LIVEVERSE/);
});
