// سبونج لايف — preparing a lobby after «ابدأ اللعبة» (and restoring one after a restart).
//
// Each step is an operation that really runs here, reported to the studio as it starts and ends
// (PREPARING_LOBBY → LOBBY_READY or LOBBY_ERROR). Nothing is shown for work that was not done, and there are no
// pauses for effect: the only waits are the short back-off between two attempts to reach the live chat.
// The stream connection uses the room's existing connectors (TikTok bridge, Kick official webhooks); a working
// connection is reused, never duplicated.
import { validateSettings } from './game-settings.mjs';
import { backoffDelay } from './bridge.mjs';

/** Every failure the host can see, with what to do about it (the studio draws exactly this). */
export const LOBBY_ERRORS = Object.freeze({
  not_linked: { title: 'حساب البث غير مرتبط', label: 'ربط الحساب', action: 'link', href: '/account#settings', hint: 'اربط حساب TikTok أو Kick بتسجيل الدخول الرسمي من «الإعدادات»، ثم ارجع واضغط «ابدأ اللعبة».' },
  not_live: { title: 'البث المباشر غير نشط', label: 'التحقق مجددًا', action: 'retry', hint: 'ابدأ البث المباشر على المنصة أولًا ثم اضغط «التحقق مجددًا».' },
  chat_failed: { title: 'تعذر استقبال التعليقات', label: 'إعادة الاتصال', action: 'retry', hint: 'لم نتمكن من الوصول إلى تعليقات البث بعد عدة محاولات. تأكد أن البث شغال ثم أعد الاتصال.' },
  reauth: { title: 'انتهت صلاحية التفويض', label: 'إعادة ربط المنصة', action: 'link', href: '/account#settings', hint: 'انتهت صلاحية الدخول إلى المنصة — أعد الربط من «الإعدادات» ثم ارجع.' },
  plan: { title: 'لا يمكن استخدام الاستوديو لانتهاء الاشتراك', label: 'عرض الاشتراكات', action: 'plans', href: '/account#plans', hint: 'جدّد اشتراكك أو فعّل التجربة المجانية لتشغيل الألعاب على بثك.' },
  not_connected: { title: 'البث غير متصل', label: 'التحقق مجددًا', action: 'retry', hint: 'اتصل ببثك من شريط الأعلى ثم أعد المحاولة.' },
  unavailable: { title: 'ربط المنصة غير مفعّل على الموقع بعد', label: 'إعادة المحاولة', action: 'retry', hint: 'ربط المنصات يحتاج تفعيلًا من إدارة الموقع — جرّب اللعبة بلاعبين تجريبيين الآن.' },
  demo_only: { title: 'هذه الغرفة للتجربة فقط', label: 'تجربة اللعبة', action: 'demo', hint: 'هذه الغرفة لا تتصل ببث مباشر — جرّب اللعبة بلاعبين تجريبيين.' },
  game_invalid: { title: 'إعدادات اللعبة غير صالحة', label: 'العودة للإعدادات', action: 'setup' },
  prepare_failed: { title: 'تعذر تجهيز اللوبي', label: 'إعادة المحاولة', action: 'retry', hint: 'حدث خطأ غير متوقع أثناء التجهيز — لم تبدأ أي جولة. أعد المحاولة.' },
});
export class LobbyError extends Error {
  constructor(code, message, step) { super(message || LOBBY_ERRORS[code]?.title || 'تعذر تجهيز اللوبي'); this.code = code; this.step = step; }
}
/** Map an error from the connectors / accounts to one of LOBBY_ERRORS. */
export function classify(err) {
  if (err instanceof LobbyError) return err.code;
  const m = String(err?.message || err);
  if (err?.needPlan || err?.status === 402) return 'plan';
  if (/انتهى تفويض|أعد الربط|تغيّر|reauth|unauthori/i.test(m)) return 'reauth';
  if (err?.needLink) return 'not_linked';
  if (err?.status === 503) return 'unavailable';
  if (/غير مباشر|not live|offline|isn't online|UserOffline/i.test(m)) return 'not_live';
  return 'chat_failed';
}
const PNAME = { tiktok: 'TikTok', kick: 'Kick' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms).unref?.());

/**
 * Run the preparation of `room.flow.lobby` (already in PREPARING_LOBBY or RECOVERING).
 * ctx: { actor, platform (preferred: 'tiktok' | 'kick' | ''), linked(userId) → { tiktok?, kick? }, linkable(p) → bool,
 *        entitled(actor) → bool, connect(actor, room, p) (connectLinked), flush() → screens reached, sleep, random, attempts }
 */
export async function prepareLobby(room, ctx) {
  const flow = room.flow, lobby = flow.lobby, id = lobby.id, recovering = lobby.state === 'RECOVERING', demo = !!lobby.demo;
  const { actor } = ctx;
  const live = !demo;
  const steps = recovering
    ? [['auth', 'التحقق من الحساب والاشتراك'], ['restore', 'استعادة اللاعبين وكلمة الانضمام'], ['account', 'التحقق من حساب البث'], ['listener', 'إعادة الاتصال بالبث واستقبال التعليقات'], ['sync', 'مزامنة قائمة المتسابقين']]
    : demo
      ? [['auth', 'التحقق من الحساب'], ['game', 'التحقق من بيانات اللعبة'], ['session', 'إنشاء جلسة اللعبة'], ['lobby', 'تجهيز اللوبي وكلمة الانضمام'], ['demo', 'وضع التجربة — لاعبون تجريبيون بلا بث'], ['sync', 'مزامنة قائمة المتسابقين']]
      : [['auth', 'التحقق من الحساب والاشتراك'], ['game', 'التحقق من بيانات اللعبة'], ['session', 'إنشاء جلسة اللعبة'], ['lobby', 'تجهيز اللوبي وكلمة الانضمام'], ['account', 'التحقق من حساب البث'], ['listener', 'الاتصال بالبث وتجهيز استقبال التعليقات'], ['sync', 'مزامنة قائمة المتسابقين']];
  flow.plan(steps);
  let current = null;
  const alive = () => flow.preparing(id);
  const begin = (key) => { if (!alive()) throw new Cancelled(); current = key; flow.step(key, 'running'); };
  const done = (key, detail, status = 'done') => { if (!alive()) throw new Cancelled(); flow.step(key, status, detail); current = null; };
  try {
    // A — who asks, and may they run a live game
    begin('auth');
    if (live && !actor.live) throw new LobbyError(actor.kind === 'acct' ? 'plan' : 'demo_only', null, 'auth');
    if (actor.kind === 'acct' && !ctx.entitled(actor)) throw new LobbyError('plan', null, 'auth');
    done('auth', actor.kind === 'owner' ? 'غرفة المالك' : actor.kind === 'acct' ? 'الاشتراك فعال' : demo ? 'جلسة تجربة' : 'رمز الاستوديو صالح');

    if (recovering) {
      begin('restore');
      done('restore', `${room.engine.players.size} لاعب • الكلمة «${flow.join.keyword}»`);
    } else {
      // B — the game and its saved settings
      begin('game');
      const g = flow.game(flow.mode);
      try { validateSettings(g.mode, flow.settingsFor(g.mode), flow.settingsFor(g.mode)); }
      catch (err) { throw new LobbyError('game_invalid', err.message, 'game'); }
      if (g.mode === 'guess' && !(room.engine.status.mode === 'guess' && room.engine.status.answer)) throw new LobbyError('game_invalid', 'اكتب التلميح والإجابة السرية في الإعدادات', 'game');
      done('game', g.title);
      // C — the session (the same id is kept for the same game, so a repeated press never makes a second one)
      begin('session');
      const reused = !!lobby.sessionReused;
      done('session', reused ? 'استُخدمت جلسة اللعبة نفسها' : 'جلسة جديدة');
      // D — the lobby: game mode, join word, joining rules, capacity
      begin('lobby');
      const e = room.engine;
      if (e.status.mode !== g.mode) e.configure({ mode: g.mode, title: g.title });
      e.registration.keyword = flow.join.keyword;
      done('lobby', `الكلمة «${flow.join.keyword}» • حتى ${e.registration.maxPlayers} لاعب`);
    }

    if (demo) {
      begin('demo');
      const added = ctx.addDemo ? ctx.addDemo() : 0;
      done('demo', `أُضيف ${added} لاعبين تجريبيين — لا تُقرأ تعليقات حقيقية ولا تُحتسب النتائج في الترتيب`);
    } else {
      // E — which platform account, linked officially (accounts) or connected by hand (the owner's test room)
      begin('account');
      let chosen = null;
      if (actor.kind === 'acct') {
        const links = await ctx.linked(actor.userId);
        const usable = ['tiktok', 'kick'].filter((p) => links[p] && !links[p].needsReauth);
        const c = room.engine.connection;
        chosen = [ctx.platform, c.state === 'connected' ? c.platform : null, ...usable].find((p) => p && usable.includes(p)) || null;
        if (!chosen) throw new LobbyError(['tiktok', 'kick'].some((p) => links[p]?.needsReauth) ? 'reauth' : 'not_linked', null, 'account');
        if (!ctx.linkable(chosen)) throw new LobbyError('unavailable', null, 'account');
        done('account', `${PNAME[chosen]} @${links[chosen].handle}`);
      } else {
        const c = room.engine.connection;
        if (c.state !== 'connected') throw new LobbyError('not_connected', null, 'account');
        chosen = c.platform;
        done('account', `${PNAME[chosen]} @${c.username} (اتصال يدوي)`);
      }
      // F — the live chat: reuse a working connection, otherwise connect with a few short retries
      begin('listener');
      const c = room.engine.connection;
      const working = c.state === 'connected' && c.platform === chosen && (actor.kind !== 'acct' || room.engine.connMeta.verified);
      if (working) done('listener', 'الاتصال الحالي يعمل — لم يُنشأ اتصال جديد');
      else {
        const max = ctx.attempts ?? 3;
        for (let attempt = 1; ; attempt++) {
          try { await ctx.connect(actor, room, chosen); break; }
          catch (err) {
            const code = classify(err);
            if (code !== 'chat_failed' || attempt >= max || !alive()) throw new LobbyError(code, code === 'chat_failed' || code === 'not_live' ? String(err.message || '').slice(0, 160) || null : null, 'listener');
            flow.step('listener', 'running', `المحاولة ${attempt + 1} من ${max}`);
            await (ctx.sleep || wait)(Math.min(4000, backoffDelay(attempt, ctx.random)));
          }
        }
        if (!alive()) throw new Cancelled();
        done('listener', chosen === 'kick' ? 'Kick: اشتراك التعليقات الرسمي مفعّل' : 'TikTok: متصل بالبث — التعليقات تصل');
      }
    }
    // G — every screen of the room (studio, OBS, viewers) gets the lobby now
    begin('sync');
    const screens = ctx.flush();
    done('sync', `أُرسلت الحالة إلى ${screens} ${screens === 1 ? 'شاشة' : 'شاشات'}`);
    flow.ready();
    return { ok: true, state: flow.lobby.state };
  } catch (err) {
    if (err instanceof Cancelled || !alive()) return { ok: false, cancelled: true };
    const code = classify(err), meta = LOBBY_ERRORS[code] || LOBBY_ERRORS.prepare_failed;
    if (current) flow.step(current, 'failed', err.message);
    // a chat connection that could not be made is closed (no retries left running behind an error screen)
    if (current === 'listener') try { ctx.release?.(meta.title); } catch {}
    flow.failLobby({ code, message: err instanceof LobbyError && err.message !== meta.title ? err.message : (meta.hint || ''), action: meta.action, step: current });
    if (!(err instanceof LobbyError) && code === 'chat_failed') console.warn('[lobby] prepare', err?.message);
    return { ok: false, code };
  }
}
class Cancelled extends Error {}
/** The error object the studio draws: title, details, and the button (label + action or link). */
export function describeError(e) {
  if (!e) return null;
  const meta = LOBBY_ERRORS[e.code] || LOBBY_ERRORS.prepare_failed;
  return { code: e.code, title: meta.title, message: e.message || meta.hint || '', label: meta.label, action: meta.action, href: meta.href || null, step: e.step || null };
}
