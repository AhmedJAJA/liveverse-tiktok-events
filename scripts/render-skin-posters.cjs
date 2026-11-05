#!/usr/bin/env node
/* Renders public/skins/<id>.webp (480×480, transparent) from the built GLB files, using the site's own viewer.
   Needs a running local server and Playwright + sharp:  node scripts/render-skin-posters.cjs http://localhost:8099 [id …] */
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');
(async () => {
  const [base = 'http://localhost:8099', ...only] = process.argv.slice(2);
  const { SKINS } = await import(path.join(__dirname, '..', 'src', 'skins.mjs'));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 480 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  // a bare page on the same origin (so the CSP-friendly module imports work)
  await page.route(base + '/__poster', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:transparent"><div id="s" style="width:480px;height:480px"></div></body></html>' }));
  await page.goto(base + '/__poster');
  for (const skin of SKINS) {
    if (only.length && !only.includes(skin.id)) continue;
    await page.evaluate(async ({ model, rarity, accent }) => {
      document.getElementById('s').replaceChildren();
      const { mountViewer } = await import('/skin-viewer.js');
      window.__v?.dispose();
      window.__v = await mountViewer(document.getElementById('s'), { model, autoRotate: false, animations: { idle: 'idle' }, rarity, accent, low: false });
      window.__v.rotate(-0.45); window.__v.zoom(0.92);
      await new Promise((r) => setTimeout(r, 900));
    }, { model: skin.model, rarity: skin.rarity, accent: skin.accent });
    const png = await page.locator('#s').screenshot({ omitBackground: true });
    const out = path.join(__dirname, '..', 'public', 'skins', skin.id + '.webp');
    await sharp(png).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(out);
    console.log('poster', skin.id + '.webp', require('node:fs').statSync(out).size, 'bytes');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
