// SKY DRAW — a write → draw → describe chain game (/draw).
// Each player starts a chain with a sentence; on every following step they receive
// someone else's latest entry and either draw it or describe the drawing. When all
// steps are done the host walks everyone through the albums together.
import { randomBytes, randomInt } from 'node:crypto';

export const DRAW_LIMITS = Object.freeze({ maxPlayers: 8, minPlayers: 2, textMax: 120, imageMax: 120_000, maxRooms: 25, idleMs: 60 * 60_000 });
export const DRAW_COLORS = Object.freeze(['#7dffc8', '#ffd36c', '#ff8fb3', '#7fe3ff', '#c9a7ff', '#ffb38a', '#a5f36c', '#f1f1f1']);
const STEP_MS = { text: 60_000, drawing: 90_000 };
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const clean = (raw, max) => String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export class DrawHub {
  constructor({ now = () => Date.now(), random = randomInt } = {}) { this.now = now; this.random = random; this.rooms = new Map(); }
  newCode() {
    for (let tries = 0; tries < 50; tries++) {
      const code = Array.from({ length: 5 }, () => CODE_ALPHABET[this.random(CODE_ALPHABET.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('تعذّر إنشاء رمز غرفة، حاول مجددًا');
  }
  normalizeCode(raw) { const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return code.length === 5 ? code : null; }
  person({ name, color }) {
    const n = clean(name, 20);
    if (n.length < 2) throw new Error('اكتب اسمًا من حرفين على الأقل');
    return { id: 'dp_' + randomBytes(6).toString('hex'), secret: randomBytes(18).toString('base64url'), name: n, color: DRAW_COLORS.includes(color) ? color : DRAW_COLORS[0], joinedAt: this.now(), seen: this.now() };
  }
  create(profile) {
    this.cleanup();
    if (this.rooms.size >= DRAW_LIMITS.maxRooms) throw new Error('الغرف ممتلئة الآن، حاول بعد قليل');
    const host = this.person(profile);
    const room = { code: this.newCode(), hostId: host.id, players: [host], phase: 'lobby', allowGuests: true, step: 0, steps: 0, chains: [], endsAt: null, album: 0, albumStep: 0, created: this.now(), touched: this.now(), round: 0 };
    this.rooms.set(room.code, room);
    return { code: room.code, player: { id: host.id, secret: host.secret } };
  }
  join(rawCode, profile, { guest = true } = {}) {
    const room = this.room(rawCode);
    if (room.phase !== 'lobby') throw new Error('بدأت اللعبة في هذه الغرفة، انتظر الجولة القادمة');
    if (guest && !room.allowGuests) throw new Error('هذه الغرفة للحسابات فقط — سجّل الدخول للانضمام');
    if (room.players.length >= DRAW_LIMITS.maxPlayers) throw new Error('الغرفة مكتملة (8 لاعبين)');
    const p = this.person(profile);
    if (room.players.some((x) => x.name === p.name)) p.name = p.name.slice(0, 17) + ' ' + (room.players.length + 1);
    room.players.push(p); room.touched = this.now();
    return { code: room.code, player: { id: p.id, secret: p.secret } };
  }
  room(rawCode) {
    const code = this.normalizeCode(rawCode);
    const room = code && this.rooms.get(code);
    if (!room) throw new Error('رمز الغرفة غير صحيح أو انتهت الغرفة');
    return room;
  }
  auth(rawCode, pid, secret) {
    const room = this.room(rawCode);
    const p = room.players.find((x) => x.id === pid);
    if (!p || typeof secret !== 'string' || p.secret !== secret) throw new Error('انتهت جلستك في الغرفة، انضم مجددًا');
    p.seen = this.now(); room.touched = this.now();
    return { room, player: p };
  }
  requireHost(room, player) { if (room.hostId !== player.id) throw new Error('هذا الإجراء للمضيف فقط'); }
  setGuests(code, pid, secret, allow) { const { room, player } = this.auth(code, pid, secret); this.requireHost(room, player); room.allowGuests = !!allow; return true; }
  start(code, pid, secret) {
    const { room, player } = this.auth(code, pid, secret); this.requireHost(room, player);
    if (room.phase !== 'lobby') throw new Error('اللعبة جارية بالفعل');
    if (room.players.length < DRAW_LIMITS.minPlayers) throw new Error('تحتاج لاعبَين على الأقل');
    room.order = room.players.map((p) => p.id);
    room.steps = Math.min(6, Math.max(3, room.order.length));
    room.chains = room.order.map((id) => ({ owner: id, entries: [] }));
    room.phase = 'playing'; room.step = 0; room.round++;
    this.openStep(room);
    return true;
  }
  kind(step) { return step % 2 === 0 ? 'text' : 'drawing'; }
  openStep(room) { room.endsAt = this.now() + STEP_MS[this.kind(room.step)]; room.submitted = new Set(); }
  chainFor(room, pid) {
    const n = room.order.length, i = room.order.indexOf(pid);
    return room.chains[((i - room.step) % n + n) % n];
  }
  submit(code, pid, secret, { data } = {}) {
    const { room, player } = this.auth(code, pid, secret);
    if (room.phase !== 'playing') throw new Error('لا توجد مهمة الآن');
    if (!room.order.includes(player.id)) throw new Error('انضممت بعد بداية اللعبة');
    if (room.submitted.has(player.id)) throw new Error('أرسلت مهمتك لهذه الخطوة');
    const kind = this.kind(room.step);
    let value;
    if (kind === 'text') {
      value = clean(data, DRAW_LIMITS.textMax);
      if (value.length < 2) throw new Error(room.step === 0 ? 'اكتب جملة قصيرة' : 'اكتب وصفًا للرسمة');
    } else {
      value = String(data ?? '');
      if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value) || value.length > DRAW_LIMITS.imageMax) throw new Error('الرسمة غير صالحة أو كبيرة جدًا');
      const head = Buffer.from(value.slice(22, 34), 'base64');
      if (head[0] !== 0x89 || head[1] !== 0x50 || head[2] !== 0x4e || head[3] !== 0x47) throw new Error('الرسمة ليست صورة PNG');
    }
    this.chainFor(room, player.id).entries.push({ kind, data: value, by: player.name, color: player.color });
    room.submitted.add(player.id);
    if (room.submitted.size >= room.order.length) this.advance(room);
    return true;
  }
  advance(room) {
    // Players who ran out of time leave a visible gap instead of blocking the chain.
    const kind = this.kind(room.step);
    for (const id of room.order) if (!room.submitted.has(id)) {
      const p = room.players.find((x) => x.id === id);
      this.chainFor(room, id).entries.push({ kind, data: kind === 'text' ? '(لم يُكتب شيء)' : null, by: p?.name || 'لاعب', color: p?.color || DRAW_COLORS[0], missed: true });
    }
    room.step++;
    if (room.step >= room.steps) { room.phase = 'album'; room.album = 0; room.albumStep = 0; room.endsAt = null; return; }
    this.openStep(room);
  }
  albumNav(code, pid, secret, { action } = {}) {
    const { room, player } = this.auth(code, pid, secret); this.requireHost(room, player);
    if (room.phase !== 'album') throw new Error('الألبوم يظهر بعد انتهاء الخطوات');
    const last = room.chains[room.album].entries.length - 1;
    if (action === 'next') {
      if (room.albumStep < last) room.albumStep++;
      else if (room.album < room.chains.length - 1) { room.album++; room.albumStep = 0; }
    } else if (action === 'prev') {
      if (room.albumStep > 0) room.albumStep--;
      else if (room.album > 0) { room.album--; room.albumStep = room.chains[room.album].entries.length - 1; }
    } else if (action === 'all') room.albumStep = last;
    else throw new Error('إجراء غير معروف');
    return true;
  }
  restart(code, pid, secret) {
    const { room, player } = this.auth(code, pid, secret); this.requireHost(room, player);
    Object.assign(room, { phase: 'lobby', step: 0, steps: 0, chains: [], endsAt: null, album: 0, albumStep: 0 });
    return true;
  }
  leave(code, pid, secret) {
    const { room, player } = this.auth(code, pid, secret);
    if (room.phase === 'playing') throw new Error('لا يمكن المغادرة أثناء الجولة');
    room.players = room.players.filter((p) => p.id !== player.id);
    if (!room.players.length) this.rooms.delete(room.code);
    else if (room.hostId === player.id) room.hostId = room.players[0].id;
    return true;
  }
  tick() {
    const t = this.now(); let changed = false;
    for (const room of this.rooms.values()) if (room.phase === 'playing' && room.endsAt && t >= room.endsAt) { this.advance(room); changed = true; }
    return changed;
  }
  cleanup() { const t = this.now(); for (const [code, room] of this.rooms) if (t - room.touched > DRAW_LIMITS.idleMs) this.rooms.delete(code); }
  view(code, pid, secret) {
    const { room, player } = this.auth(code, pid, secret);
    const base = { code: room.code, phase: room.phase, host: room.hostId === player.id, me: { id: player.id, name: player.name, color: player.color }, allowGuests: room.allowGuests,
      players: room.players.map((p) => ({ id: p.id, name: p.name, color: p.color, host: p.id === room.hostId, done: room.phase === 'playing' && room.submitted?.has(p.id) })),
      step: room.step, steps: room.steps, endsAt: room.endsAt, serverTime: this.now(), round: room.round };
    if (room.phase === 'playing' && room.order.includes(player.id)) {
      const kind = this.kind(room.step);
      const prev = room.step > 0 ? this.chainFor(room, player.id).entries[room.step - 1] : null;
      base.task = { kind, done: room.submitted.has(player.id), prompt: prev ? { kind: prev.kind, data: prev.data, missed: !!prev.missed } : null };
    }
    if (room.phase === 'album') {
      const chain = room.chains[room.album];
      const owner = room.players.find((p) => p.id === chain.owner);
      base.album = { index: room.album, total: room.chains.length, owner: owner?.name || 'لاعب', step: room.albumStep, entries: chain.entries.slice(0, room.albumStep + 1) };
    }
    return base;
  }
}
