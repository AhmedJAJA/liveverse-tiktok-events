// سبونج لايف — stream tools for OBS: a countdown, a random draw from the chat and a wall of active chatters.
// They run beside the games, from the same verified chat, and every screen gets them through the room's state.
import { randomInt } from 'node:crypto';
import { norm } from './round-game.mjs';

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const httpsOnly = (v) => (/^https:\/\//.test(v || '') ? String(v).slice(0, 500) : '');
const WALL_SIZE = 12, DRAW_MAX = 5000;

export class StreamTools {
  constructor({ now = () => Date.now(), random = randomInt } = {}) {
    this.now = now; this.random = random;
    this.countdown = { label: '', seconds: 60, endsAt: null, left: null };
    this.draw = { open: false, keyword: 'سحب', entries: new Map(), winner: null, drawnAt: null };
    this.wall = { on: true, chatters: new Map() };
  }
  /** Every verified chat message of the room passes here. */
  chat({ id, username, text, avatar }) {
    const key = clean(id, 80); if (!key) return false;
    const name = clean(username, 32) || 'مشاهد', pic = httpsOnly(avatar);
    let changed = false;
    if (this.wall.on) {
      const c = this.wall.chatters.get(key) || { name, avatar: pic, count: 0 };
      c.name = name; if (pic) c.avatar = pic; c.count++; c.last = this.now();
      this.wall.chatters.delete(key); this.wall.chatters.set(key, c); // most recent last
      if (this.wall.chatters.size > 200) this.wall.chatters.delete(this.wall.chatters.keys().next().value);
      changed = true;
    }
    if (this.draw.open && !this.draw.entries.has(key) && this.draw.entries.size < DRAW_MAX && norm(text) === norm(this.draw.keyword)) {
      this.draw.entries.set(key, { name, avatar: pic }); changed = true;
    }
    return changed;
  }
  command(action, body = {}) {
    const t = this.now();
    switch (action) {
      case 'countdown-start': {
        const seconds = Math.round(Number(body.seconds));
        if (!(seconds >= 5 && seconds <= 3600)) throw new Error('اختر مدة بين 5 ثوانٍ وساعة');
        Object.assign(this.countdown, { label: clean(body.label, 40), seconds, endsAt: t + seconds * 1000, left: null });
        break;
      }
      case 'countdown-pause':
        if (this.countdown.endsAt) { this.countdown.left = Math.max(0, this.countdown.endsAt - t); this.countdown.endsAt = null; }
        else if (this.countdown.left) { this.countdown.endsAt = t + this.countdown.left; this.countdown.left = null; }
        break;
      case 'countdown-stop': Object.assign(this.countdown, { endsAt: null, left: null }); break;
      case 'draw-open': {
        const keyword = clean(body.keyword, 20);
        if (!norm(keyword)) throw new Error('اكتب كلمة الدخول في السحب');
        Object.assign(this.draw, { open: true, keyword, entries: new Map(), winner: null, drawnAt: null });
        break;
      }
      case 'draw-close': this.draw.open = false; break;
      case 'draw-pick': {
        // a winner already drawn is left out, so «اسحب مرة أخرى» picks someone new
        const pool = [...this.draw.entries].filter(([id]) => id !== this.draw.winner?.id);
        if (!pool.length) throw new Error('لا يوجد مشاركون في السحب بعد');
        const [id, p] = pool[this.random(pool.length)];
        this.draw.open = false; this.draw.winner = { id, ...p }; this.draw.drawnAt = t;
        break;
      }
      case 'draw-reset': Object.assign(this.draw, { open: false, entries: new Map(), winner: null, drawnAt: null }); break;
      case 'wall': this.wall.on = body.on !== false; if (body.clear) this.wall.chatters.clear(); break;
      default: throw new Error('أداة غير معروفة');
    }
    return this.snapshot();
  }
  snapshot() {
    const d = this.draw, t = this.now();
    const recent = [...d.entries.values()].slice(-8).reverse();
    return {
      countdown: { label: this.countdown.label, seconds: this.countdown.seconds, endsAt: this.countdown.endsAt, left: this.countdown.left, running: !!this.countdown.endsAt && this.countdown.endsAt > t },
      draw: { open: d.open, keyword: d.keyword, count: d.entries.size, recent, winner: d.winner ? { name: d.winner.name, avatar: d.winner.avatar } : null, drawnAt: d.drawnAt },
      wall: { on: this.wall.on, chatters: [...this.wall.chatters.values()].slice(-WALL_SIZE).reverse().map(({ name, avatar, count }) => ({ name, avatar, count })) },
      serverNow: t,
    };
  }
}
