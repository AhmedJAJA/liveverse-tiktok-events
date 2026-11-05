// Home page v2: no fake partners or prizes, FAQ that matches the real product, accessible accordion.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const pub = (f) => fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');

test('partners and prizes are never invented: hidden until the owner adds real ones', () => {
  const html = pub('home.html'), js = pub('home.js');
  assert.match(html, /<section class="hm-sec hm-partners" id="partners"[^>]*hidden>/);
  assert.match(html, /id="lbPrize" hidden/);
  assert.match(js, /\$\('partners'\)\.hidden = !show/);
  assert.match(js, /\$\('lbPrize'\)\.hidden = !prizes\.length/);
});

test('FAQ: the required questions, official sign-in only, accordion with aria-expanded', () => {
  const html = pub('home.html');
  const faq = html.slice(html.indexOf('id="faq"'), html.indexOf('id="contact"'));
  for (const q of ['ما هو سبونج لايف', 'كيف أربط TikTok', 'كيف أربط Kick', 'هل أحتاج OBS', 'هل يوجد تجديد تلقائي', 'كيف يُحسب ترتيب المتصدرين', 'كيف أستخدم كود الغرفة', 'كيف أتواصل مع الدعم'])
    assert.ok(faq.includes(q), q);
  assert.equal((faq.match(/class="fq-q"/g) || []).length, 16);
  assert.doesNotMatch(faq, /اكتب اسم حسابك|اكتب اسم قناتك/, 'no username-based linking instructions');
  assert.match(faq, /aria-expanded="false" aria-controls="fq0"/);
  for (const plan of ['29 ريال', '44.99 ريال', '24 ساعة']) assert.ok(faq.includes(plan), plan);
});

test('every section anchor clears the sticky header', () => {
  const css = pub('home.css');
  assert.match(css, /\.hm-sec,\.hm-hero\{scroll-margin-top:calc\(var\(--hm-bar-h\) \+ 12px\)\}/);
});
