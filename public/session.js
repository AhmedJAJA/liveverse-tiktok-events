/* SKY LIVE session context — shared by every page (classic script, load before page scripts).
   Resolves which room the page shows: an explicit ?room=, the signed-in account/guest room,
   or the owner's main room. Admin requests are routed by the server from the credentials. */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const explicit = /^[a-z0-9]{1,16}$/.test(params.get('room') || '') ? params.get('room') : '';
  let me = { user: null, guest: false, room: null, live: false };
  const listeners = new Set();
  const ownerToken = () => { try { return sessionStorage.getItem('liveverse_admin') || ''; } catch { return ''; } };
  const room = () => explicit || (ownerToken() ? 'main' : (me.room || 'main'));
  const withRoom = (path) => {
    const r = room();
    return r === 'main' ? path : path + (path.includes('?') ? '&' : '?') + 'room=' + encodeURIComponent(r);
  };
  const wsUrl = () => (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + withRoom('/ws');
  async function refresh() {
    try {
      const res = await fetch('/api/account/me', { cache: 'no-store', credentials: 'same-origin' });
      if (res.ok) me = await res.json();
    } catch { /* offline: keep previous */ }
    for (const fn of listeners) { try { fn(me); } catch {} }
    return me;
  }
  const ready = refresh();
  window.SkySession = Object.freeze({
    ready, refresh, room, withRoom, wsUrl, explicitRoom: () => explicit,
    me: () => me,
    hasControl: () => !!ownerToken() || !!me.user || !!me.guest,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    ownerToken,
    async logout() { await fetch('/api/account/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}); return refresh(); }
  });
})();
