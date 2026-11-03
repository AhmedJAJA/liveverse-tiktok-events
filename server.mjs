import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Engine } from './src/engine.mjs';
import { LiveBridge } from './src/bridge.mjs';
import { QuestionBank } from './src/question-bank.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const authToken = process.env.ADMIN_TOKEN || randomBytes(24).toString('hex');
if (!process.env.ADMIN_TOKEN) console.log('\n[LOCAL ADMIN TOKEN] ' + authToken + '\nSet ADMIN_TOKEN in hosting environment before publishing.');
const safeToken = Buffer.from(authToken, 'utf8');
const matchesToken = (raw) => { const incoming = Buffer.from(String(raw||''), 'utf8'); return incoming.length === safeToken.length && timingSafeEqual(incoming, safeToken); };
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const clients = new Set();
function send(ws, value) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); }
const engine = new Engine({ notify(state) { const packet = { type: 'state', data: state }; for (const ws of clients) send(ws, packet); } });
const bridge = new LiveBridge(engine);
const questionBank = new QuestionBank();
const PORT = Number(process.env.PORT) || 3000;
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function readBody(req) {
  let size = 0, bytes = [];
  for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new Error('الطلب كبير جدًا'); bytes.push(chunk); }
  try { return JSON.parse(Buffer.concat(bytes).toString('utf8') || '{}'); }
  catch { throw new Error('JSON غير صالح'); }
}
function secureHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: https://*.tiktokcdn.com https://*.tiktokcdn-us.com https://*.tiktokcdn-eu.com https://*.tiktokcdn-in.com https://*.byteoversea.com https://*.ibytedtos.com https://*.ibyteimg.com https://*.muscdn.com; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
}
function isAuthorized(req) { return matchesToken((req.headers.authorization || '').replace(/^Bearer\s+/i, '')); }
async function handleAction(action, body) {
  switch (action) {
    case 'configure': engine.configure(body); return { ok: true };
    case 'registration-open': engine.openRegistration(body); return { ok: true };
    case 'registration-close': engine.closeRegistration(); return { ok: true };
    case 'bank-next': {
      if (engine.status.active) throw new Error('أوقف الجولة الحالية قبل اختيار سؤال جديد');
      if (body.start && !engine.players.size) throw new Error('افتح التسجيل أولًا وانتظر المشاركين');
      const q = questionBank.draw(body);
      engine.configure({ mode: 'quiz', title: 'تحدي ' + (questionBank.stats().categories[q.category]?.title || 'المعلومات'), prompt: q.question, options: q.options, answer: q.answer });
      if (body.start === true) engine.start();
      return { ok: true, question: q, bank: questionBank.stats() };
    }
    case 'bank-reset': return { ok: true, bank: questionBank.reset() };
    case 'start': engine.start(); return { ok: true };
    case 'stop': engine.stop(); return { ok: true };
    case 'reset': engine.resetScores(); return { ok: true };
    case 'draw': return { ok: true, result: engine.drawWheel() };
    case 'connect': await bridge.connect(body.username); return { ok: true };
    case 'disconnect': await bridge.disconnect(); return { ok: true };
    case 'simulate': {
      const name = String(body.username ?? '').trim().slice(0,32);
      if (!name || !body.text) throw new Error('أدخل اسم المشاهد والتعليق');
      engine.receiveChat({ id: 'demo:' + name.toLowerCase(), username: name, text: body.text });
      return { ok: true };
    }
    default: throw new Error('الإجراء غير معروف');
  }
}
const server = http.createServer(async (req, res) => {
  secureHeaders(res);
  let url; try { url = new URL(req.url, 'http://localhost'); } catch { return json(res, 400, { error: 'Bad URL' }); }
  if (url.pathname === '/health') return json(res, 200, { ok: true, mode: engine.status.mode });
  if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, engine.snapshot());
  if (url.pathname === '/api/admin/bank' && req.method === 'GET') return isAuthorized(req) ? json(res, 200, questionBank.stats()) : json(res, 401, { error: 'رمز الإدارة غير صحيح' });
  if (url.pathname === '/api/admin/verify' && req.method === 'POST') return json(res, isAuthorized(req) ? 200 : 401, { ok: isAuthorized(req) });
  if (url.pathname.startsWith('/api/admin/') && req.method === 'POST') {
    if (!isAuthorized(req)) return json(res, 401, { error: 'رمز الإدارة غير صحيح' });
    try { const result = await handleAction(url.pathname.slice('/api/admin/'.length), await readBody(req)); return json(res, 200, result); }
    catch (err) { return json(res, 400, { error: String(err.message || err).slice(0, 240) }); }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
  const fileMap = { '/': 'landing.html', '/studio': 'index.html', '/dashboard': 'index.html', '/overlay': 'overlay.html', '/favicon.ico': 'sky-live.webp' };
  const relative = fileMap[url.pathname] || url.pathname.slice(1);
  // Explicit whitelist: no path traversal, hidden files or project files exposed.
  if (!['index.html','landing.html','landing.css','sky-landing.css','landing.js','liveverse-brand.svg','sky-live-brand.svg','sky-live-cover.webp','sky-live.webp','sky-live-theme.css','overlay.html','app.js','overlay.js','styles.css','overlay.css','broadcast-theme.css','presenter.css','liveverse-show.css','favicon.svg','fonts/tajawal-arabic-500-normal.woff2','fonts/tajawal-arabic-700-normal.woff2','fonts/tajawal-arabic-800-normal.woff2','fonts/tajawal-latin-700-normal.woff2','fonts/OFL.txt'].includes(relative)) return json(res, 404, { error: 'Not found' });
  const filename = path.join(root, relative);
  try { const content = await fs.promises.readFile(filename); res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : content); }
  catch { json(res, 404, { error: 'Not found' }); }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
server.on('upgrade', (req, socket, head) => {
  let url; try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  // Public WebSocket is read-only; messages from clients do nothing.
  wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws); });
});
wss.on('connection', ws => {
  if (clients.size >= 150) { ws.close(1013, 'Too many connections'); return; }
  clients.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', () => {});
  ws.on('close', () => clients.delete(ws));
  send(ws, { type: 'state', data: engine.snapshot() });
});
const roundClock = setInterval(() => engine.tick(), 250);
roundClock.unref?.();
const heartbeat = setInterval(() => { for (const ws of clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 30000);
heartbeat.unref?.();
server.listen(PORT, '0.0.0.0', () => console.log(`TikTok LIVE Events ready on http://localhost:${PORT}`));
const shutdown = async () => { clearInterval(roundClock); clearInterval(heartbeat); await bridge.disconnect(); wss.close(); server.close(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

