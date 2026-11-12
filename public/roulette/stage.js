/* سبونج لايف — «الروليت»: the broadcast stage (OBS, the studio preview and the viewers' /play page all show it).
   The server decides everything and publishes it in the room state (src/roulette.mjs → party). This module only
   draws it, on the server clock: the players' grid, the names reel that stops on the holder, the revolver scene,
   the result, and the winner. A screen that connects late, or refreshes, lands in the same scene at the same
   moment; a one-shot effect (a sound, the flash) only plays if its moment is now — never twice, never late.
   Player data is written with textContent only. */
import { reelPosition, AIM, REVEAL, span, clamp01, drumTurn, drumNotch, flash, shake, noise, WIN } from './timeline.js';
import { createSfx } from './sfx.js';

const SR = { drawing: 'السحب جارٍ', picked: 'تم اختيار صاحب الدور', choose: 'صاحب الدور يختار', aim: 'الخزنة تدور', reveal: 'النتيجة', ready: 'الجولة جاهزة', finished: 'انتهت المباراة' };
const fmtNum = (v) => new Intl.NumberFormat('en-US').format(Number(v) || 0);
const ar = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? fmtNum(n) + ' ' + few : fmtNum(n) + ' ' + many);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function h(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = String(text); return n; }
function svgIcon(id, cls = 'i') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '/icons.svg#' + id); s.append(u); return s;
}

export function mount(arena, { paintAvatar, frameOf }) {
  const sfx = createSfx();
  /* ------------------------------------------------------------------ the DOM (built once) */
  const stage = h('section', 'rr-stage'); stage.id = 'rouletteStage'; stage.hidden = true; stage.setAttribute('aria-label', 'الروليت');
  stage.dataset.scene = 'grid'; stage.dataset.tone = '';
  const bg = h('div', 'rr-bg'); bg.setAttribute('aria-hidden', 'true'); bg.append(h('i', 'rr-bg-spot'), h('i', 'rr-bg-wash'), h('i', 'rr-bg-rays'), h('i', 'rr-bg-vignette'));
  // header: what is happening, the counters, the honest state of the stream
  const head = h('header', 'rr-head');
  const titleBox = h('div', 'rr-title'), eyebrow = h('small', 'rr-eyebrow', 'الروليت'), title = h('h1', 'rr-h1', 'الروليت'), sub = h('p', 'rr-sub', '');
  titleBox.append(eyebrow, title, sub);
  const meta = h('div', 'rr-meta');
  const trialPill = h('span', 'rr-pill is-trial'); trialPill.append(svgIcon('i-robot'), h('span', '', 'وضع التجربة — لاعبون تجريبيون')); trialPill.hidden = true;
  const connPill = h('span', 'rr-pill rr-conn'); const connText = h('span', '', ''); connPill.append(h('i', 'rr-dot'), connText);
  const stats = h('div', 'rr-stats');
  const stat = (cls, label) => { const s = h('span', 'rr-stat ' + cls), b = h('b', 'num', '0'); s.append(b, h('small', '', label)); stats.append(s); return b; };
  const statIn = stat('is-in', 'داخل اللعبة'), statOut = stat('is-out', 'خرجوا'), statTurn = stat('is-turn', 'الدور');
  // the browser blocks sound until the page is clicked (a normal tab; OBS never does): say so instead of staying silent
  const soundHint = h('p', 'rr-pill rr-sound-hint'); soundHint.append(svgIcon('i-volume-off'), h('span', '', 'الصوت متوقف من المتصفح — اضغط على الصفحة لتشغيله')); soundHint.hidden = true;
  meta.append(soundHint, trialPill, connPill, stats);
  head.append(titleBox, meta);
  // body: the scenes (main) and the side panel (events, announced rules)
  const body = h('div', 'rr-body'), main = h('div', 'rr-main'), side = h('aside', 'rr-side');
  // grid scene
  const gridScene = h('section', 'rr-scene rr-grid-scene');
  const banner = h('div', 'rr-banner'); banner.hidden = true;
  const bannerAv = h('div', 'rr-av rr-banner-av'), bannerWho = h('div', 'rr-banner-who'), bannerName = h('strong', 'rr-banner-name', ''), bannerLine = h('span', 'rr-banner-line', '');
  bannerWho.append(h('small', '', 'الدور على'), bannerName, bannerLine);
  const ring = h('div', 'rr-ring'); const ringNum = h('b', 'num', ''); ring.append(ringNum, h('small', '', 'ثانية'));
  const bannerAvBox = h('div', 'rr-banner-avbox'); bannerAvBox.append(bannerAv);
  banner.append(bannerAvBox, bannerWho, ring);
  const grid = h('div', 'rr-grid'); grid.setAttribute('role', 'list');
  const toast = h('div', 'rr-toast'); toast.hidden = true; const toastTitle = h('strong', '', ''), toastLine = h('span', '', ''); toast.append(svgIcon('i-refresh'), toastTitle, toastLine);
  // the lock-in beat: a line from the shooter's tile to the target's, drawn over the grid
  const lockSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); lockSvg.setAttribute('class', 'rr-lockline'); lockSvg.setAttribute('aria-hidden', 'true');
  const lockLine = document.createElementNS('http://www.w3.org/2000/svg', 'line'); lockSvg.append(lockLine);
  gridScene.append(banner, grid, toast, lockSvg);
  // draw scene
  const drawScene = h('section', 'rr-scene rr-draw-scene');
  const drawPhoto = h('div', 'rr-draw-photo'), drawAvBox = h('div', 'rr-draw-avbox'), drawRing = h('div', 'rr-draw-ring'); drawRing.append(drawAvBox, h('i', 'rr-draw-orbit'));
  const drawLabel = h('small', 'rr-draw-label', 'من صاحب الدور؟'), drawName = h('strong', 'rr-draw-name', ''), drawNum = h('span', 'rr-draw-num num', '');
  drawPhoto.append(drawRing, drawLabel, drawName, drawNum);
  const reel = h('div', 'rr-reel'), strip = h('div', 'rr-strip'), windowEl = h('div', 'rr-window'); windowEl.setAttribute('aria-hidden', 'true');
  reel.append(strip, windowEl);
  drawScene.append(drawPhoto, reel);
  // the revolver scene
  const shotScene = h('section', 'rr-scene rr-shot-scene');
  const glShot = h('div', 'rr-gl-host');
  const target = h('div', 'rr-target'), targetRing = h('div', 'rr-target-ring'), targetAv = h('div', 'rr-av rr-target-av');
  const targetAvBox = h('div', 'rr-target-avbox'); targetAvBox.append(targetAv);
  const crack = h('i', 'rr-crack'); crack.setAttribute('aria-hidden', 'true');
  const okBadge = h('span', 'rr-ok'); okBadge.append(svgIcon('i-check'));
  targetRing.append(targetAvBox, crack, okBadge);
  const targetName = h('div', 'rr-target-name'), targetNum = h('span', 'rr-target-num num', ''), targetBy = h('p', 'rr-target-by', '');
  target.append(targetRing, targetName, targetNum, targetBy);
  const stamp = h('div', 'rr-stamp'); stamp.append(h('b', '', 'OUT'), h('span', '', 'تم الإقصاء')); stamp.setAttribute('aria-hidden', 'true');
  const hud = h('div', 'rr-hud'), cyl = h('div', 'rr-cyl'), cylText = h('p', 'rr-cyl-text', ''), oddsText = h('small', 'rr-odds', '');
  hud.append(cyl, cylText, oddsText);
  // the duel: the holder who chose sits across the table from the target (their photo, or their equipped skin and frame)
  const shooter = h('div', 'rr-shooter'), shooterAvBox = h('div', 'rr-shooter-avbox');
  const shooterText = h('div', 'rr-shooter-text'), shooterRole = h('small', 'rr-shooter-role', 'يضغط الزناد');
  const shooterName = h('div', 'rr-shooter-name'), shooterNum = h('span', 'rr-shooter-num num', '');
  shooterText.append(shooterRole, shooterName, shooterNum); shooter.append(shooterAvBox, shooterText); shooter.hidden = true;
  shotScene.append(glShot, shooter, target, stamp, hud);
  // the winner
  const winScene = h('section', 'rr-scene rr-win-scene');
  const glWin = h('div', 'rr-gl-host rr-win-gl');
  const confetti = h('div', 'rr-confetti'); confetti.setAttribute('aria-hidden', 'true');
  const winCard = h('div', 'rr-win-card');
  const winEyebrow = h('span', 'rr-win-eyebrow'); winEyebrow.append(svgIcon('i-crown'), h('span', '', 'الفائز'));
  const winAvBox = h('div', 'rr-win-avbox'), winAv = h('div', 'rr-av rr-win-av'); winAvBox.append(winAv);
  const winName = h('div', 'rr-win-name'), winLine = h('p', 'rr-win-line', ''), winStats = h('div', 'rr-win-stats'), winRank = h('ol', 'rr-win-rank'), winNote = h('p', 'rr-win-note', '');
  winCard.append(winEyebrow, winAvBox, winName, winLine, winStats, winRank, winNote);
  winScene.append(glWin, confetti, winCard);
  main.append(gridScene, drawScene, shotScene, winScene);
  // side
  const logBox = h('section', 'rr-log'); const logHead = h('h2', ''); logHead.append(svgIcon('i-bolt'), h('span', '', 'أحداث المباراة'));
  const logList = h('ol', ''), logEmpty = h('p', 'rr-empty', 'تظهر هنا نتيجة كل دور');
  logBox.append(logHead, logList, logEmpty);
  const rulesBox = h('section', 'rr-rules'); const rulesHead = h('h2', ''); rulesHead.append(svgIcon('i-shield'), h('span', '', 'القواعد المعلنة'));
  const rulesList = h('ul', ''), fairLine = h('p', 'rr-fair', 'الخادم وحده يسحب صاحب الدور ويحدد كل سحبة — لعبة للمتعة، بلا رهان ولا عملات.');
  rulesBox.append(rulesHead, rulesList, fairLine);
  side.append(logBox, rulesBox);
  body.append(main, side);
  const flashEl = h('div', 'rr-flash'); flashEl.setAttribute('aria-hidden', 'true');
  const live = h('p', 'sr-only'); live.setAttribute('aria-live', 'assertive');
  stage.append(bg, head, body, flashEl, live);
  arena.append(stage);

  /* ------------------------------------------------------------------ state */
  const v = { data: null, party: null, roster: new Map(), offset: 0, offsetSet: false, key: '', scene: 'grid', tiles: new Map(), gridSig: '', layoutSig: '',
    reelSig: '', reelCards: [], lastTick: -1, lastTickAt: 0, lastNotch: null, cues: new Set(), raf: 0, gl: null, glKind: null, glLoading: null, glWant: null,
    winSig: '', logSig: '', rulesSig: '', drawShown: null, drawShownAt: 0, targetSig: '', announce: '', winAt: 0, lastFrameAt: 0 };
  const now = () => Date.now() + v.offset;
  const cue = (name, fn, fresh = true) => { const k = v.key + ':' + name; if (v.cues.has(k)) return; v.cues.add(k); if (v.cues.size > 300) v.cues = new Set([...v.cues].slice(-120)); if (fresh && !document.hidden) fn(); };
  const playerOf = (n) => v.roster.get(n) || { number: n, name: 'لاعب ' + n };
  const nameOf = (p) => (v.party?.display?.showNames === false ? 'اللاعب رقم ' + p.number : p.name);
  function avatar(box, p, { frame = true, cls = '' } = {}) {
    // the player's photo (or equipped skin), inside their equipped frame when the host shows frames
    const fr = frame && v.party?.display?.showFrames !== false ? frameOf(p) : null;
    const key = JSON.stringify([p.number, p.name, p.avatar || '', fr?.id || '', cls, p.alive !== false]);
    if (box.dataset.k === key) return; box.dataset.k = key;
    const av = h('div', 'rr-av ' + cls); paintAvatar(av, p);
    box.replaceChildren(fr && window.SpongeFrames ? window.SpongeFrames.avatar(av, fr) : av);
  }
  function nameplate(box, p, cls) {
    const fr = v.party?.display?.showFrames !== false ? frameOf(p) : null, text = nameOf(p);
    const key = JSON.stringify([text, fr?.id || '']);
    if (box.dataset.k === key) return; box.dataset.k = key;
    box.replaceChildren(fr && window.SpongeFrames ? window.SpongeFrames.plate(text, fr, cls) : Object.assign(h('bdi', cls, text)));
  }
  function say(text) { if (text && text !== v.announce) { v.announce = text; live.textContent = text; } }

  /* ------------------------------------------------------------------ the 3D (or SVG) prop */
  function ensureGL(pref = v.party?.display?.graphics || 'auto', chambers = v.party?.rules?.chambers || 2) {
    if (v.glWant === pref && (v.gl || v.glLoading)) return v.glLoading || Promise.resolve(v.gl);
    v.glWant = pref;
    const old = v.gl; v.gl = null;
    v.glLoading = import('./revolver3d.js').then(async (m) => {
      if (m.canUse3D(pref)) { try { const g = await m.createStage3D({ chambers, quality: pref === 'high' ? 'high' : 'normal' }); g.kind = '3d'; return g; } catch (err) { console.warn('[roulette] 3D off:', err.message); } }
      const m2 = await import('./revolver2d.js'); const g = m2.createStage2D({ chambers }); g.kind = '2d'; return g;
    }).then((g) => { old?.dispose(); v.gl = g; v.glLoading = null; stage.dataset.gfx = g.kind; kick(); return g; })
      .catch((err) => { console.warn('[roulette] prop unavailable', err); v.glLoading = null; return null; });
    return v.glLoading;
  }

  /* ------------------------------------------------------------------ data in */
  function update(data) {
    v.data = data;
    const party = data.party && data.status?.mode === 'roulette' ? data.party : null;
    v.party = party;
    const st = Number(data.serverTime) || 0, recv = data._recv || Date.now();
    // server clock = local clock + offset. Each state says when the server wrote it; a late delivery only makes the
    // sample smaller, so the largest recent sample is the truest — new ones pull it down slowly (a clock change)
    if (st) { const sample = st - recv; if (!v.offsetSet || sample > v.offset) { v.offset = sample; v.offsetSet = true; } else v.offset = Math.max(sample, v.offset - 15); }
    v.roster = new Map((data.roster || []).map((p) => [p.number, p]));
    stage.hidden = false;
    stage.dataset.fx = party?.display?.effects || 'normal';
    sfx.setEnabled(party ? party.display?.sounds !== false : false);
    paintSoundHint();
    const key = party ? party.match + ':' + party.seq : 'lobby';
    if (key !== v.key) { v.key = key; v.lastTick = -1; v.lastNotch = null; }
    paintHead(data, party);
    paintSide(data, party);
    const scene = sceneOf(party);
    setScene(scene, party);
    if (scene === 'grid' || scene === 'lock') paintGrid(data, party);
    if (scene === 'draw') paintDraw(party);
    if (scene === 'shot') paintShot(party);
    if (scene === 'win') paintWin(data, party);
    if (party && ['drawing', 'picked', 'aim', 'reveal', 'finished'].includes(party.phase)) ensureGL();
    oneShots(party);
    kick();
  }
  function paintSoundHint() { soundHint.hidden = !v.party || sfx.status() !== 'blocked'; }
  sfx.onChange(paintSoundHint);
  /** The revolver's own scene starts after the lock-in beat (both on the server clock). */
  const aimStart = (p) => (p.phaseStartedAt || 0) + (p.lockMs || 0);
  function sceneOf(p) {
    if (!p) return 'grid';
    if (p.phase === 'finished') return 'win';
    if (p.phase === 'drawing' || p.phase === 'picked') return 'draw';
    if (p.phase === 'aim') return now() < aimStart(p) ? 'lock' : 'shot';
    if (p.phase === 'reveal') return p.result?.outcome === 'cancel' ? 'grid' : 'shot';
    return 'grid';
  }
  function setScene(scene, p) {
    if (v.scene !== scene) { stage.dataset.prev = v.scene; v.scene = scene; }
    stage.dataset.scene = scene;
    stage.dataset.phase = p?.phase || 'lobby';
    const r = p?.phase === 'reveal' ? p.result : null;
    stage.dataset.tone = r ? (r.outcome === 'out' ? 'out' : r.outcome === 'empty' ? 'safe' : 'cancel') : p?.phase === 'aim' ? 'tense' : p?.phase === 'finished' ? (p.winner ? 'win' : 'ended') : '';
    for (const [el, name] of [[gridScene, 'grid'], [drawScene, 'draw'], [shotScene, 'shot'], [winScene, 'win']]) el.classList.toggle('is-on', name === scene || (name === 'grid' && scene === 'lock'));
  }

  /* ------------------------------------------------------------------ header and side */
  function paintHead(data, p) {
    const demo = !!(p?.demo || data.flow?.lobby?.demo || data.flow?.trial);
    trialPill.hidden = !demo;
    const c = data.connection || {};
    const ok = c.state === 'connected';
    connPill.dataset.tone = demo ? 'demo' : ok ? 'ok' : c.state === 'connecting' ? 'wait' : 'bad';
    connText.textContent = demo ? 'بلا بث — تجربة' : ok ? 'البث متصل · ' + (c.platform === 'kick' ? 'Kick' : 'TikTok') : c.state === 'connecting' ? 'جارٍ الاتصال بالبث…' : 'البث غير متصل — اللعبة مستمرة';
    connPill.hidden = false;
    const players = p ? p.players || [] : [...v.roster.values()];
    const alive = p ? p.alive : players.length, out = p ? p.eliminated : 0;
    statIn.textContent = fmtNum(alive); statOut.textContent = fmtNum(out); statTurn.textContent = fmtNum(p?.turn || 0);
    // the headline
    const H = headline(p);
    eyebrow.textContent = H.eyebrow; title.textContent = H.title; sub.textContent = H.sub;
    stage.dataset.waiting = p?.waitingHost ? '1' : '';
  }
  function headline(p) {
    if (!p) return { eyebrow: 'الروليت', title: 'المتسابقون جاهزون', sub: 'المباراة تبدأ عندما يضغط المضيف «بدء الجولة»' };
    const hol = p.holder ? playerOf(p.holder.number) : null, tgt = p.target ? playerOf(p.target.number) : null;
    switch (p.phase) {
      case 'ready': {
        if (p.waitingHost) return { eyebrow: 'الدور ' + fmtNum(p.turn + 1), title: 'بانتظار المضيف', sub: 'الأدوار التلقائية تتوقف حتى تعود نافذة المضيف — لا شيء يتغير' };
        const auto = p.rules?.autoRun === 'auto' && p.endsAt;
        return { eyebrow: 'الدور ' + fmtNum(p.turn + 1), title: 'الجولة جاهزة', sub: auto ? 'السحب التالي يبدأ تلقائيًا' : 'بانتظار «ابدأ السحب» — الخادم يختار صاحب الدور عشوائيًا' };
      }
      case 'drawing': return { eyebrow: 'الدور ' + fmtNum(p.turn), title: 'السحب جارٍ…', sub: 'من صاحب الدور؟' };
      case 'picked': return { eyebrow: 'الدور ' + fmtNum(p.turn), title: 'الدور على ' + (hol ? nameOf(hol) : ''), sub: 'سيختار من يواجه المسدس' };
      case 'choose': return { eyebrow: 'الدور ' + fmtNum(p.turn), title: 'صاحب الدور يختار', sub: p.chatDown ? 'الشات منقطع — المهلة متوقفة حتى يعود الاتصال' : 'اكتب في الشات رقم لاعب آخر ما زال في اللعبة' };
      case 'aim': {
        // the lock-in: who pulls the trigger on whom, and why
        const T = tgt ? nameOf(tgt) : '';
        const title = !tgt ? 'الخزنة تدور…'
          : (p.how === 'chat' || p.how === 'host') && hol && hol.number !== tgt.number ? nameOf(hol) + ' يصوّب على ' + T
          : p.how === 'timeout' ? 'انتهت المهلة — الخادم اختار ' + T
          : p.how === 'random' ? 'هدف عشوائي: ' + T : 'الخزنة تدور…';
        return { eyebrow: 'الدور ' + fmtNum(p.turn) + (tgt ? ' • ' + T : ''), title, sub: 'الخزنة تدور… هل الطلقة هنا؟' };
      }
      case 'reveal': {
        const r = p.result || {};
        if (r.outcome === 'out') return r.reason === 'host' ? { eyebrow: 'الدور ' + fmtNum(p.turn), title: 'OUT — قرار المضيف', sub: (tgt ? nameOf(tgt) : '') + ' خرج من الجولة' } : { eyebrow: 'الدور ' + fmtNum(p.turn), title: 'انطلقت الطلقة', sub: (tgt ? nameOf(tgt) : '') + ' — خرج من الجولة' };
        if (r.outcome === 'empty') return { eyebrow: 'الدور ' + fmtNum(p.turn), title: 'حجرة فارغة — نجا!', sub: 'تكة… لا طلقة هنا' };
        return { eyebrow: 'الدور ' + fmtNum(p.turn), title: 'أُلغي الدور', sub: r.reason === 'timeout' ? 'انتهت مهلة الاختيار' : 'ألغى المضيف هذا الدور' };
      }
      case 'finished': return p.winner ? { eyebrow: 'انتهت المباراة', title: 'الفائز: ' + nameOf(playerOf(p.winner.number)), sub: 'آخر من بقي في الروليت' } : { eyebrow: 'انتهت المباراة', title: 'انتهت بدون فائز', sub: 'أوقف المضيف المباراة قبل النهاية' };
    }
    return { eyebrow: 'الروليت', title: 'الروليت', sub: '' };
  }
  function logText(e) {
    const t = e.target != null ? playerOf(e.target) : null, ho = e.holder != null ? playerOf(e.holder) : null;
    const who = (x) => (x ? '#' + x.number + ' ' + nameOf(x) : '');
    switch (e.kind) {
      case 'empty': return ['safe', who(t) + ' نجا — الحجرة ' + fmtNum(e.chamber) + ' فارغة'];
      case 'out':
        if ((e.how === 'chat' || e.how === 'host') && ho && t && ho.number !== t.number) return ['out', who(ho) + ' أقصى ' + who(t) + ' — انطلقت الطلقة'];
        if (e.how === 'timeout') return ['out', who(t) + ' خرج — اختاره الخادم بعد انتهاء المهلة'];
        return ['out', who(t) + ' خرج — انطلقت الطلقة'];
      case 'timeout': return ['info', 'انتهت مهلة ' + who(ho) + (e.rule === 'skip' ? ' — أُلغي الدور' : ' — اختار الخادم هدفًا عشوائيًا')];
      case 'cancel': return ['info', 'ألغى المضيف دور ' + who(ho)];
      case 'random': return ['info', 'هدف عشوائي لدور ' + who(ho)];
      case 'host-out': return ['out', 'أقصى المضيف ' + who(ho)];
    }
    return ['info', ''];
  }
  function paintSide(data, p) {
    const log = p?.log || [];
    const sig = JSON.stringify([log.map((e) => [e.turn, e.kind, e.target, e.holder]), p?.display?.showNames]);
    if (sig !== v.logSig) {
      const first = !v.logSig; v.logSig = sig;
      logList.replaceChildren();
      [...log].reverse().slice(0, 9).forEach((e, i) => {
        const [tone, text] = logText(e); if (!text) return;
        const li = h('li', 'is-' + tone + (i === 0 && !first ? ' is-new' : ''));
        li.append(h('b', 'num', fmtNum(e.turn)), h('span', '', text));
        logList.append(li);
      });
      logEmpty.hidden = log.length > 0;
    }
    const lines = p?.rules?.text || preRules(data.flow?.settings);
    const odds = oddsLine(p?.rules || data.flow?.settings);
    const rsig = JSON.stringify([lines, odds]);
    if (rsig !== v.rulesSig) { v.rulesSig = rsig; rulesList.replaceChildren(...lines.map((l) => h('li', '', l)), ...(odds ? [h('li', 'is-odds', odds)] : [])); }
  }
  function preRules(s) {
    if (!s || !s.chambers) return ['آخر من يبقى يفوز.'];
    const c = Number(s.chambers), b = Math.min(Number(s.bullets) || 1, c - 1);
    return ['صاحب الدور يكتب في الشات رقم لاعب آخر ما زال في اللعبة ليضغط عليه الزناد.',
      'لكل لاعب خزنة من ' + ar(c, 'حجرة', 'حجرتين', 'حجرات', 'حجرة') + ' فيها ' + ar(b, 'طلقة واحدة', 'طلقتان', 'طلقات', 'طلقة') + '.', 'آخر من يبقى يفوز.'];
  }
  function oddsLine(r) {
    if (!r || !r.chambers) return '';
    const c = Number(r.chambers), b = Math.min(Number(r.bullets) || 1, c - 1);
    return r.cylinder === 'spin' ? 'احتمال الإقصاء في كل سحبة: ' + b + ' من ' + c : 'احتمال الإقصاء في أول سحبة على اللاعب: ' + b + ' من ' + c;
  }

  /* ------------------------------------------------------------------ the grid */
  function playersList(data, p) {
    if (p) return (p.players || []).map((x) => ({ ...playerOf(x.n), number: x.n, alive: !!x.a, shots: x.s || 0, survived: x.v || 0, outTurn: x.o || null, host: !!x.h, by: x.b ?? null, kills: x.k || 0 }));
    return [...v.roster.values()].map((x) => ({ ...x, alive: true, shots: 0, survived: 0, outTurn: null }));
  }
  function paintGrid(data, p) {
    const list = playersList(data, p);
    const C = p?.rules?.chambers || Number(data.flow?.settings?.chambers) || 2, spin = (p?.rules?.cylinder || data.flow?.settings?.cylinder) === 'spin';
    const holderN = p?.holder?.number ?? null, choose = p?.phase === 'choose', targetN = p?.phase === 'aim' ? p.target?.number ?? null : null;
    // the holder's banner while they choose
    banner.hidden = !choose;
    if (choose && p.holder) {
      const hp = playerOf(p.holder.number);
      avatar(bannerAvBox, hp, { cls: 'rr-banner-av' });
      bannerName.textContent = nameOf(hp) + ' — #' + hp.number;
      const f = p.feedback, warn = !!f && !p.chatDown;
      bannerLine.textContent = p.chatDown ? 'الشات منقطع — المهلة متوقفة حتى يعود الاتصال' : f ? feedbackText(f) : 'يكتب في الشات رقم لاعب آخر ليضغط عليه الزناد';
      bannerLine.classList.toggle('is-warn', warn);
      bannerLine.classList.toggle('is-paused', !!p.chatDown);
      ring.classList.toggle('is-paused', !!p.chatDown);
      if (warn) { cue('fb' + f.at, () => sfx.cancel(), now() - f.at < 1500); say(bannerLine.textContent); }
      paintCountdown(p, now());
    }
    stage.dataset.choose = choose ? '1' : '';
    // the cancelled-turn card
    const cancel = p?.phase === 'reveal' && p.result?.outcome === 'cancel';
    toast.hidden = !cancel;
    if (cancel) { toastTitle.textContent = 'أُلغي الدور'; toastLine.textContent = p.result.reason === 'timeout' ? 'انتهت مهلة الاختيار — لم يُضغط الزناد على أحد' : 'ألغى المضيف هذا الدور'; }
    const sig = JSON.stringify([list.map((x) => [x.number, x.name, x.avatar || '', x.alive, x.shots, x.survived, x.host]), holderN, targetN, C, spin, p?.display?.showNames, p?.display?.showFrames, Object.keys(data.frames || {}).length, Object.keys(data.skins || {}).length]);
    if (sig === v.gridSig) { layoutGrid(list.length); return; }
    v.gridSig = sig;
    const seen = new Set();
    list.forEach((x, i) => {
      seen.add(x.number);
      let t = v.tiles.get(x.number);
      if (!t) {
        t = { el: h('div', 'rr-tile'), avBox: h('div', 'rr-tile-av'), num: h('b', 'rr-num num', ''), name: h('div', 'rr-tile-name'), pips: h('span', 'rr-pips'), mark: h('span', 'rr-out-mark', 'OUT'), wasAlive: true };
        t.el.setAttribute('role', 'listitem'); t.mark.setAttribute('aria-hidden', 'true');
        const avWrap = h('div', 'rr-tile-ring'); avWrap.append(t.avBox, t.mark, t.num);
        t.el.append(avWrap, t.name, t.pips);
        v.tiles.set(x.number, t);
      }
      t.el.style.order = String(i);
      if (t.el.parentNode !== grid) grid.append(t.el);
      t.num.textContent = String(x.number);
      t.el.classList.toggle('is-out', !x.alive); // before the photo: an equipped skin shows its «lose» pose when out
      avatar(t.avBox, x, { cls: 'rr-tile-photo' });
      nameplate(t.name, x, 'rr-name');
      if (t.wasAlive && !x.alive && v.gridSig) { t.el.classList.remove('is-just-out'); void t.el.offsetWidth; t.el.classList.add('is-just-out'); }
      t.wasAlive = x.alive;
      t.el.classList.toggle('is-holder', x.number === holderN && !!p && ['choose', 'picked', 'aim'].includes(p.phase));
      t.el.classList.toggle('is-target', x.number === targetN);
      t.el.classList.toggle('is-host', !!x.host);
      t.el.classList.toggle('is-bot', !!x.bot);
      // pips: one per chamber of this player's cylinder (the fired ones lit), or — with a spun cylinder — one per survived pull
      const pipKey = JSON.stringify([C, spin, x.shots, x.survived, x.alive]);
      if (t.pips.dataset.k !== pipKey) {
        t.pips.dataset.k = pipKey; t.pips.replaceChildren();
        const n = spin ? Math.min(6, x.survived) : C;
        for (let k = 0; k < n; k++) {
          const fired = spin ? true : k < x.shots;
          const hit = !x.alive && !spin && k === x.shots - 1;
          t.pips.append(h('i', fired ? (hit ? 'is-hit' : 'is-safe') : ''));
        }
        t.pips.setAttribute('aria-label', x.alive ? (x.survived ? 'نجا ' + ar(x.survived, 'مرة', 'مرتين', 'مرات', 'مرة') : 'لم يواجه المسدس بعد') : 'خرج من اللعبة');
      }
      t.el.setAttribute('aria-label', '#' + x.number + ' ' + nameOf(x) + (x.alive ? '' : ' — خرج'));
    });
    for (const [n, t] of v.tiles) if (!seen.has(n)) { t.el.remove(); v.tiles.delete(n); }
    layoutGrid(list.length);
  }
  /** The holder wrote a number that is not a choice: the stream says why, so they can write another one. */
  function feedbackText(f) {
    if (f.kind === 'self') return '#' + f.number + ' هو رقمك — اكتب رقم لاعب آخر';
    if (f.kind === 'out') return '#' + f.number + ' خرج من اللعبة — اختر لاعبًا ما زال فيها';
    if (f.kind === 'missing') return 'لا يوجد لاعب برقم ' + f.number + ' — انظر الأرقام على الشاشة';
    if (f.kind === 'protected') return '#' + f.number + ' كان الهدف في الدور السابق — اختر لاعبًا آخر';
    if (f.kind === 'ambiguous') return 'اكتب رقمًا واحدًا فقط (كتبت ' + (f.numbers || []).join(' و ') + ')';
    return '';
  }
  /** Tile size: as large as the space allows for every player at once (up to 100). */
  function layoutGrid(n) {
    const r = { width: grid.clientWidth, height: grid.clientHeight }; if (!r.width || !r.height) return; // layout size (the scene may be mid-zoom)
    const sig = [n, Math.round(r.width), Math.round(r.height)].join(':');
    if (sig === v.layoutSig) return; v.layoutSig = sig;
    const gap = Math.max(4, r.width * 0.011);
    const fit = (ratio, min) => {
      for (let w = Math.min(230, r.width); w >= min; w -= 1) {
        const cols = Math.max(1, Math.floor((r.width + gap) / (w + gap))), rows = Math.ceil(Math.max(1, n) / cols);
        if (rows * (w * ratio + gap) - gap <= r.height) return w;
      }
      return 0;
    };
    // with its name and pips when there is room; a crowd on a small screen keeps the photo and the number only
    let best = fit(1.42, 56), compact = false;
    if (!best) { best = fit(1.12, 16) || 16; compact = true; }
    grid.style.setProperty('--rr-tile', best.toFixed(1) + 'px');
    grid.style.setProperty('--rr-gap', gap.toFixed(1) + 'px');
    grid.classList.toggle('is-dense', best < 92);
    grid.classList.toggle('is-compact', compact);
  }

  /* ------------------------------------------------------------------ the names reel */
  function paintDraw(p) {
    const r = p.reel; if (!r) return;
    const sig = p.match + ':' + p.turn + ':' + r.list.join(',');
    if (sig !== v.reelSig) {
      v.reelSig = sig; strip.replaceChildren(); v.reelCards = [];
      r.list.forEach((n, i) => {
        const pl = playerOf(n), card = h('div', 'rr-card'), avb = h('div', 'rr-card-av');
        avatar(avb, pl, { frame: false, cls: 'rr-card-photo' });
        const txt = h('div', 'rr-card-txt'); txt.append(h('strong', '', nameOf(pl)), h('small', '', 'اللاعب رقم ' + n));
        card.append(avb, txt, h('b', 'rr-card-num num', String(n)));
        if (i === r.stop) card.classList.add('is-stop');
        strip.append(card); v.reelCards.push(card);
      });
      v.drawShown = null; v.reelGeo = null;
    }
    drawScene.classList.toggle('is-picked', p.phase === 'picked');
    if (p.phase === 'picked') { const hp = playerOf(p.holder.number); drawLabel.textContent = 'الدور على'; showDrawPlayer(hp, true); say('الدور على ' + nameOf(hp)); }
    else drawLabel.textContent = 'من صاحب الدور؟';
  }
  function showDrawPlayer(pl, force = false) {
    const t = performance.now();
    if (!force && (v.drawShown === pl.number || t - v.drawShownAt < 70)) return;
    v.drawShown = pl.number; v.drawShownAt = t;
    avatar(drawAvBox, pl, { cls: 'rr-draw-av' });
    drawName.textContent = nameOf(pl); drawNum.textContent = '#' + pl.number;
  }
  function frameReel(p, tNow) {
    const r = p.reel; if (!r || !v.reelCards.length) return;
    const u = p.phase === 'drawing' && p.endsAt > p.phaseStartedAt ? (tNow - p.phaseStartedAt) / (p.endsAt - p.phaseStartedAt) : 1;
    const pos = reducedMotion() && p.phase === 'drawing' ? Math.min(r.stop, Math.floor(clamp01(u) * 6) * (r.stop / 6)) : reelPosition(u, r.stop);
    if (!v.reelGeo) { const cardH = v.reelCards[0].offsetHeight || 100, gap = parseFloat(getComputedStyle(strip).rowGap) || 0; v.reelGeo = { cardH, step: cardH + gap, view: reel.clientHeight }; }
    const { cardH, step, view } = v.reelGeo;
    strip.style.transform = `translate3d(0, ${(view / 2 - cardH / 2 - pos * step).toFixed(1)}px, 0)`;
    const idx = Math.max(0, Math.min(v.reelCards.length - 1, Math.round(pos)));
    if (idx !== v.lastTick) {
      if (v.lastTick >= 0) v.reelCards[v.lastTick]?.classList.remove('is-at');
      v.reelCards[idx].classList.add('is-at');
      const tt = performance.now();
      if (p.phase === 'drawing' && v.lastTick >= 0 && tt - v.lastTickAt > 34 && fresh(p, 400 + (p.endsAt - p.phaseStartedAt))) { sfx.reelTick(clamp01(1 - u)); v.lastTickAt = tt; }
      v.lastTick = idx;
      if (p.phase === 'drawing') showDrawPlayer(playerOf(r.list[idx]));
    }
    // motion blur by speed (cheap: a class, not a filter per frame)
    const speed = p.phase === 'drawing' ? Math.abs(reelPosition(Math.min(1, u + 0.02), r.stop) - pos) : 0;
    strip.classList.toggle('is-fast', speed > 0.55);
  }
  const fresh = (p, within = 900) => now() - (p.phaseStartedAt || 0) < within;

  /* ------------------------------------------------------------------ the revolver scene */
  function paintShot(p) {
    const tp = p.target ? playerOf(p.target.number) : null; if (!tp) return;
    const r = p.phase === 'reveal' ? p.result : null;
    const sig = [p.match, p.turn, tp.number, p.display?.showNames, p.display?.showFrames].join(':');
    if (sig !== v.targetSig) {
      v.targetSig = sig;
      avatar(targetAvBox, tp, { cls: 'rr-target-av' });
      nameplate(targetName, tp, 'rr-target-plate');
      targetNum.textContent = '#' + tp.number;
      const hp = p.holder ? playerOf(p.holder.number) : null;
      targetBy.textContent = p.how === 'chat' && hp && hp.number !== tp.number ? 'اختاره صاحب الدور ' + nameOf(hp) + ' من الشات'
        : p.how === 'host' && r?.reason === 'host' ? 'قرار المضيف' : p.how === 'host' ? 'اختاره المضيف (صاحب الدور)' : p.how === 'random' ? 'هدف عشوائي من الخادم'
        : p.how === 'timeout' ? 'انتهت مهلة ' + (hp ? nameOf(hp) : 'صاحب الدور') + ' — اختار الخادم هذا اللاعب' : '';
      // the shooter: the holder, when someone else faces the revolver (the host's own decision has no shooter)
      const duel = hp && hp.number !== tp.number && p.how !== 'host';
      shooter.hidden = !duel;
      if (duel) {
        avatar(shooterAvBox, hp, { cls: 'rr-shooter-av' });
        nameplate(shooterName, hp, 'rr-shooter-plate');
        shooterNum.textContent = '#' + hp.number;
        shooterRole.textContent = p.how === 'chat' ? 'يضغط الزناد' : 'صاحب الدور';
      }
      shotScene.classList.remove('is-hit', 'is-safe', 'is-settled', 'is-host-out');
      buildCylinder(p.rules?.chambers || 2);
    }
    const C = p.rules?.chambers || 2, spin = p.rules?.cylinder === 'spin';
    const idx = p.chamber?.index ?? null;
    cylText.textContent = r?.reason === 'host' ? 'قرار المضيف — بلا سحبة' : idx ? (spin ? 'دارت الخزنة — ' : '') + 'الحجرة ' + fmtNum(idx) + ' من ' + fmtNum(C) : '';
    oddsText.textContent = oddsLine(p.rules);
    // fired chambers of this target's cylinder (cylinder that advances): the ones before the current are empty (they survived them)
    const shots = (p.target.shots || 0);
    [...cyl.querySelectorAll('.rr-ch')].forEach((d, k) => {
      d.classList.toggle('is-spent', !spin && k < (r ? shots - 1 : shots));
      d.classList.toggle('is-now', idx != null && k === idx - 1);
      d.classList.toggle('is-hit', !!r && r.outcome === 'out' && r.reason !== 'host' && idx != null && k === idx - 1);
      d.classList.toggle('is-safe', !!r && r.outcome === 'empty' && idx != null && k === idx - 1);
    });
    if (r) {
      const late = !fresh(p, 700);
      shotScene.classList.toggle('is-hit', r.outcome === 'out');
      shotScene.classList.toggle('is-safe', r.outcome === 'empty');
      shotScene.classList.toggle('is-host-out', r.reason === 'host');
      shotScene.classList.toggle('is-settled', late);
      say(r.outcome === 'out' ? 'تم إقصاء ' + nameOf(tp) : 'نجا ' + nameOf(tp) + ' — حجرة فارغة');
    }
  }
  function buildCylinder(n) {
    if (cyl.dataset.n === String(n)) return; cyl.dataset.n = String(n); cyl.replaceChildren();
    const face = h('div', 'rr-cyl-face');
    for (let k = 0; k < n; k++) { const d = h('i', 'rr-ch'); const a = (k / n) * Math.PI * 2; d.style.setProperty('--x', (50 + 31 * Math.sin(a)).toFixed(2) + '%'); d.style.setProperty('--y', (50 - 31 * Math.cos(a)).toFixed(2) + '%'); face.append(d); }
    face.append(h('i', 'rr-cyl-pin'));
    cyl.append(face, h('i', 'rr-cyl-mark'));
  }
  function frameShot(p, tNow) {
    const r = p.phase === 'reveal' ? p.result : null;
    const C = p.rules?.chambers || 2, idx = p.chamber?.index ?? (r?.chamber || 1);
    const top = Math.max(0, (idx || 1) - 1);
    const aimDur = Math.max(1, (p.endsAt || 0) - aimStart(p));
    const u = p.phase === 'aim' ? clamp01((tNow - aimStart(p)) / aimDur) : 1;
    const t = p.phase === 'reveal' ? tNow - p.phaseStartedAt : -1;
    const outcome = r?.reason === 'host' ? 'host' : r?.outcome || null;
    // the 2D cylinder face turns with the 3D one
    const angle = p.phase === 'aim' ? drumTurn(u, C, top) : top * ((Math.PI * 2) / C);
    const face = cyl.firstChild; if (face) face.style.transform = `rotate(${(-angle * 180 / Math.PI).toFixed(2)}deg)`;
    // cues on the timeline (only when they happen now)
    if (p.phase === 'aim') {
      const notch = drumNotch(angle, C);
      const live = fresh(p, (p.lockMs || 0) + aimDur + 200);
      if (v.lastNotch != null && notch !== v.lastNotch && live) sfx.ratchet();
      v.lastNotch = notch;
      if (u >= AIM.cock[0]) cue('cock', () => sfx.cock(), live);
      if (u >= 0.76) cue('hb1', () => sfx.heartbeat(), live);
      if (u >= 0.9 && aimDur > 2600) cue('hb2', () => sfx.heartbeat(), live);
    }
    if (p.phase === 'reveal' && t >= REVEAL.trigger) {
      const ok = t < REVEAL.trigger + 600;
      if (outcome === 'out') { cue('bang', () => sfx.bang(), ok); cue('sting', () => sfx.outSting(), ok); }
      if (outcome === 'empty') { cue('click', () => sfx.click(), ok); cue('relief', () => sfx.relief(), ok); }
      if (outcome === 'host') cue('hostout', () => sfx.hostOut(), ok);
    }
    // the flash and the shake on the page (the camera of the 3D scene shakes too)
    const fxLevel = p.display?.effects === 'high' ? 1.3 : p.display?.effects === 'low' ? 0.4 : 1;
    const calm = reducedMotion();
    const fl = outcome === 'out' && !calm ? flash(t) * (0.55 + 0.35 * fxLevel) : 0;
    flashEl.style.opacity = fl.toFixed(3);
    const sk = outcome === 'out' && !calm ? shake(t) * fxLevel : 0;
    main.style.transform = sk > 0.001 ? `translate3d(${(sk * 14 * noise(Math.floor(t / 16))).toFixed(1)}px, ${(sk * 10 * noise(Math.floor(t / 16) + 9)).toFixed(1)}px, 0)` : '';
    // the prop
    if (v.gl) {
      v.gl.attach(glShot);
      v.gl.frame({ scene: 'revolver', phase: p.phase === 'reveal' ? 'reveal' : 'aim', u, ms: t, outcome: outcome === 'host' ? null : outcome, chamberTop: top, chambers: C,
        effects: p.display?.effects || 'normal', reduced: calm, clock: tNow, at: stage.clientWidth > stage.clientHeight ? 0.64 : 0.5 });
    }
  }

  /* ------------------------------------------------------------------ the winner */
  function paintWin(data, p) {
    const w = p.winner ? { ...playerOf(p.winner.number), ...p.winner } : null;
    const sig = JSON.stringify([p.match, w?.number, p.stats, p.display?.showNames, p.display?.showFrames]);
    if (sig === v.winSig) return;
    v.winSig = sig;
    winCard.classList.toggle('is-none', !w);
    winAvBox.hidden = !w;
    if (w) {
      avatar(winAvBox, w, { cls: 'rr-win-av' });
      nameplate(winName, w, 'rr-win-plate');
      winLine.textContent = (w.kills ? 'أقصى ' + ar(w.kills, 'لاعبًا واحدًا', 'لاعبَين', 'لاعبين', 'لاعبًا') + ' • ' : '') + 'آخر من بقي — ' + (w.survived ? 'نجا من المسدس ' + ar(w.survived, 'مرة', 'مرتين', 'مرات', 'مرة') : 'لم يُصبه المسدس مرة');
      say('الفائز ' + nameOf(w));
    } else { winName.replaceChildren(h('strong', 'rr-win-plate', 'انتهت المباراة')); winName.dataset.k = ''; winLine.textContent = 'أوقف المضيف المباراة قبل أن يبقى لاعب واحد — لا فائز في هذه المباراة'; }
    const s = p.stats || {};
    const mins = Math.floor((s.durationMs || 0) / 60000), secs = Math.floor(((s.durationMs || 0) % 60000) / 1000);
    winStats.replaceChildren(...[[fmtNum(s.players), 'لاعبًا'], [fmtNum(s.turns), 'دورًا'], [fmtNum(s.pulls), 'سحبة'], [fmtNum(s.empty), 'حجرة فارغة'], [mins + ':' + String(secs).padStart(2, '0'), 'المدة']]
      .map(([b, small]) => { const x = h('span', 'rr-win-stat'); x.append(h('b', 'num', b), h('small', '', small)); return x; }));
    // the final ranking after the winner: the last ones to go out
    const outs = (p.players || []).filter((x) => !x.a && x.o).sort((a, b) => b.o - a.o).slice(0, 4);
    winRank.replaceChildren(...outs.map((x, i) => {
      const pl = playerOf(x.n), li = h('li', ''), avb = h('div', 'rr-rank-av'); avatar(avb, pl, { frame: false, cls: 'rr-rank-photo' });
      // who eliminated them: the holder who chose, or the server after a silent holder
      const by = x.b != null ? 'أقصاه ' + nameOf(playerOf(x.b)) : 'اختيار الخادم';
      const txt = h('span', 'rr-rank-txt'); txt.append(h('bdi', '', nameOf(pl)), h('small', 'rr-rank-by', by));
      li.append(h('b', 'num', String(i + 2)), avb, txt); return li; }));
    winRank.hidden = !outs.length || !w;
    winNote.textContent = p.demo ? 'مباراة تجريبية — لاعبون تجريبيون، لا تدخل الترتيب' : '';
    // confetti (count by «قوة المؤثرات»)
    confetti.replaceChildren();
    if (w && !reducedMotion()) {
      const n = p.display?.effects === 'high' ? 70 : p.display?.effects === 'low' ? 18 : 42;
      for (let i = 0; i < n; i++) {
        const c = h('i', 'c' + (i % 4)); c.style.setProperty('--x', ((noise(i) * 0.5 + 0.5) * 100).toFixed(1) + '%'); c.style.setProperty('--d', ((noise(i + 50) * 0.5 + 0.5) * 2.4).toFixed(2) + 's');
        c.style.setProperty('--t', (3.2 + (noise(i + 90) * 0.5 + 0.5) * 2.6).toFixed(2) + 's'); c.style.setProperty('--r', (noise(i + 7) * 540).toFixed(0) + 'deg'); confetti.append(c);
      }
    }
    v.winAt = p.phaseStartedAt || now();
  }
  function frameWin(p, tNow) {
    if (p.winner) cue('win', () => sfx.win(), fresh(p, 1500));
    if (!v.gl || !p.winner) return;
    v.gl.attach(glWin);
    v.gl.frame({ scene: 'trophy', ms: tNow - (p.phaseStartedAt || tNow), effects: p.display?.effects || 'normal', reduced: reducedMotion(), at: stage.clientWidth > stage.clientHeight ? 0.27 : 0.5 });
  }

  /* ------------------------------------------------------------------ one-shot cues on entering a scene */
  function oneShots(p) {
    if (!p) return;
    if (p.phase === 'drawing') cue('whoosh', () => sfx.whoosh(), fresh(p, 600));
    if (p.phase === 'picked') cue('picked', () => sfx.picked(), fresh(p, 700));
    if (p.phase === 'aim') cue('enter', () => sfx.whoosh(), fresh(p, 600));
    if (p.phase === 'reveal' && p.result?.outcome === 'cancel') cue('cancel', () => sfx.cancel(), fresh(p, 700));
    if (p.phase === 'choose' && p.holder) say('الدور على ' + nameOf(playerOf(p.holder.number)) + ' — يختار من الشات');
  }

  /* ------------------------------------------------------------------ the frame loop (only while something moves) */
  function needsLoop() {
    const p = v.party; if (stage.hidden || !p || document.hidden) return false;
    if (['drawing', 'picked', 'aim', 'choose'].includes(p.phase)) return true;
    if (p.phase === 'reveal') return true;
    if (p.phase === 'finished') return !!p.winner && now() - (p.phaseStartedAt || 0) < 25_000;
    if (p.phase === 'ready' && p.endsAt) return true;
    return false;
  }
  function loop() {
    v.raf = 0;
    const p = v.party; if (!p || stage.hidden) return;
    const tNow = now();
    // the winner's trophy turns gently: full rate at first, then a light 24 fps
    if (p.phase === 'finished' && tNow - (p.phaseStartedAt || tNow) > 4000 && performance.now() - v.lastFrameAt < 41) { if (needsLoop()) v.raf = requestAnimationFrame(loop); return; }
    v.lastFrameAt = performance.now();
    // the lock-in beat ends on the server clock: every screen switches to the revolver at the same moment
    if (p.phase === 'aim') { const want = sceneOf(p); if (want !== v.scene) { setScene(want, p); if (want === 'shot') paintShot(p); } }
    if (v.scene === 'lock') frameLock();
    else lockSvg.classList.remove('is-on');
    if (v.scene === 'draw') frameReel(p, tNow);
    else if (v.scene === 'shot') frameShot(p, tNow);
    else if (v.scene === 'win') frameWin(p, tNow);
    else { flashEl.style.opacity = '0'; main.style.transform = ''; }
    if (p.phase === 'choose' || (p.phase === 'ready' && p.endsAt)) paintCountdown(p, tNow);
    if (needsLoop()) v.raf = requestAnimationFrame(loop);
  }
  /** The line from the shooter's tile to the target's (tiles move with the layout, so it is placed every frame). */
  function frameLock() {
    const a = grid.querySelector('.rr-tile.is-holder .rr-tile-ring'), b = grid.querySelector('.rr-tile.is-target .rr-tile-ring');
    if (!a || !b) { lockSvg.classList.remove('is-on'); return; }
    const box = gridScene.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    lockSvg.setAttribute('viewBox', '0 0 ' + Math.max(1, box.width).toFixed(0) + ' ' + Math.max(1, box.height).toFixed(0));
    lockLine.setAttribute('x1', (ra.left + ra.width / 2 - box.left).toFixed(1)); lockLine.setAttribute('y1', (ra.top + ra.height / 2 - box.top).toFixed(1));
    lockLine.setAttribute('x2', (rb.left + rb.width / 2 - box.left).toFixed(1)); lockLine.setAttribute('y2', (rb.top + rb.height / 2 - box.top).toFixed(1));
    lockSvg.classList.add('is-on');
  }
  /** «ينتهي الاختيار خلال …» (and the automatic mode's next draw), on the server clock. */
  function paintCountdown(p, tNow) {
    if (!p.endsAt) return;
    const total = Math.max(1, (p.endsAt - p.phaseStartedAt) / 1000);
    const left = Math.min(Math.ceil(total), Math.max(0, Math.ceil((p.endsAt - tNow) / 1000)));
    if (ringNum.textContent !== String(left)) ringNum.textContent = String(left);
    ring.style.setProperty('--p', (clamp01((p.endsAt - tNow) / 1000 / total) * 100).toFixed(1));
    ring.classList.toggle('is-urgent', left <= 5);
    // the holder's last five seconds tick (not while the chat is down: the countdown is frozen then)
    if (p.phase === 'choose' && !p.chatDown && left >= 1 && left <= 5) cue('cd' + left, () => sfx.countTick(left), true);
    if (p.phase === 'ready' && p.rules?.autoRun === 'auto' && !p.waitingHost) sub.textContent = 'السحب التالي يبدأ تلقائيًا خلال ' + left + ' ث';
  }
  function kick() { if (!v.raf && needsLoop()) v.raf = requestAnimationFrame(loop); }
  document.addEventListener('visibilitychange', kick);
  addEventListener('resize', () => { v.layoutSig = ''; v.reelGeo = null; if (v.scene === 'grid' && v.data) layoutGrid(v.tiles.size); v.gl?.resize(); kick(); });

  /** Hidden (another game, the registration screen): nothing runs, nothing is kept busy. */
  function hide() {
    if (stage.hidden) return;
    stage.hidden = true; cancelAnimationFrame(v.raf); v.raf = 0; flashEl.style.opacity = '0'; main.style.transform = '';
  }
  /** Get the prop ready before the first turn (the mode is known as soon as the lobby opens). */
  function preload(data) {
    const set = data?.flow?.settings || {};
    ensureGL(data?.party?.display?.graphics || set.graphics || 'auto', data?.party?.rules?.chambers || Number(set.chambers) || 2);
  }
  return { update, hide, preload, el: stage };
}
