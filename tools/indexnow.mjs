// سبونج لايف — tell IndexNow search engines (Bing, Yandex, Seznam, Naver…) about public pages that changed.
// Google does not use IndexNow; it reads /sitemap.xml.
//
// Run by hand after a deploy that changed public pages (never on server start, so restarts do not resend):
//   INDEXNOW_KEY=<the key set on Render> node tools/indexnow.mjs --since 2026-11-06            submit pages changed since a date
//   INDEXNOW_KEY=<key> node tools/indexnow.mjs --since 2026-11-06 --dry-run                     only print what would be sent
//
// Only the indexable pages of src/seo.mjs (the sitemap) can be sent — never private, sign-in or development pages.
// A 200/202 answer means the list was received, not that a page is indexed.
import { pathToFileURL } from 'node:url';
import { INDEXABLE_PAGES, SITE_URL, indexNowKey } from '../src/seo.mjs';

export async function submitIndexNow({ since, dryRun = false, env = process.env, fetchImpl = fetch, log = console.log, siteUrl = SITE_URL } = {}) {
  const key = indexNowKey(env);
  if (!key) throw new Error('INDEXNOW_KEY is missing or invalid (8–128 characters: a-z A-Z 0-9 -).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(since || ''))) throw new Error('Give --since YYYY-MM-DD (the date of the content change).');
  const urlList = [...new Set(INDEXABLE_PAGES.filter((p) => p.lastmod >= since).map((p) => siteUrl + p.path))];
  if (!urlList.length) { log('No public page changed since ' + since + ' — nothing to send.'); return { sent: 0 }; }
  const keyLocation = siteUrl + '/' + key + '.txt';
  log('Pages: ' + urlList.join(', '));
  if (dryRun) { log('Dry run — nothing sent.'); return { sent: 0, urlList }; }
  // the search engine checks this file; refuse to send when the deployed site does not serve the same key
  const check = await fetchImpl(keyLocation);
  const served = check.ok ? (await check.text()).trim() : '';
  if (served !== key) throw new Error(`${keyLocation} does not serve this key (HTTP ${check.status}). Set INDEXNOW_KEY on Render and deploy first.`);
  const endpoint = env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow';
  const res = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(siteUrl).host, key, keyLocation, urlList }) });
  const meaning = { 200: 'received', 202: 'received; key validation pending', 400: 'bad request', 403: 'key not valid', 422: 'URLs do not belong to the host or key mismatch', 429: 'too many requests — try later' }[res.status] || 'unexpected answer';
  log(`IndexNow answered HTTP ${res.status} (${meaning}).`);
  if (res.status !== 200 && res.status !== 202) throw new Error('IndexNow refused the submission: HTTP ' + res.status + ' ' + meaning);
  return { sent: urlList.length, status: res.status, urlList };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
  submitIndexNow({ since: arg('--since'), dryRun: process.argv.includes('--dry-run') })
    .catch((err) => { console.error(err.message); process.exitCode = 1; });
}
