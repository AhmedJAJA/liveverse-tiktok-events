// Local stand-in for Kick (channel API + Pusher-like chat socket) used by the end-to-end tests.
import http from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';

/** Stand-in for Kick: GET /api/v2/channels/:slug and a Pusher-like chat socket. */
export
async function fakeKick() {
  const channels = new Map(); // slug -> { chatroom, userId, live }
  const subs = new Map();     // chatroom id -> Set(ws)
  const srv = http.createServer((req, res) => {
    const slug = decodeURIComponent((/^\/api\/v2\/channels\/([^/?]+)/.exec(req.url) || [])[1] || '');
    const ch = channels.get(slug);
    if (!ch) { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ chatroom: { id: ch.chatroom }, user_id: ch.userId, user: { username: slug, profile_pic: 'https://files.kick.com/images/user/' + ch.userId + '/p.webp' }, livestream: ch.live ? { is_live: true } : null }));
  });
  const wss = new WebSocketServer({ server: srv });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ event: 'pusher:connection_established', data: '{}' }));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.event !== 'pusher:subscribe') return;
      const id = Number(String(m.data.channel).split('.')[1]);
      if (!subs.has(id)) subs.set(id, new Set());
      subs.get(id).add(ws); ws.on('close', () => subs.get(id)?.delete(ws));
      ws.send(JSON.stringify({ event: 'pusher_internal:subscription_succeeded', channel: m.data.channel, data: '{}' }));
    });
  });
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  const base = 'http://127.0.0.1:' + srv.address().port;
  let n = 0;
  return {
    api: base, socket: base.replace('http', 'ws') + '/app',
    add(slug, { userId, live = true }) { channels.set(slug, { chatroom: 1000 + channels.size, userId, live }); },
    setLive(slug, live) { channels.get(slug).live = live; },
    /** a chat message as Kick sends it: the sender is decided by the platform, not by the message text */
    say(slug, sender, text) {
      const ch = channels.get(slug);
      const data = JSON.stringify({ id: 'm' + (++n), content: text, sender: { id: sender.id, username: sender.slug, slug: sender.slug, identity: { badges: [] } } });
      for (const ws of subs.get(ch.chatroom) || []) ws.send(JSON.stringify({ event: 'App\\Events\\ChatMessageEvent', channel: 'chatrooms.' + ch.chatroom + '.v2', data }));
    },
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(); srv.close(r); }),
  };
}
