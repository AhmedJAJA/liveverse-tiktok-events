// SPONGE LIVE — outside services: e-mail (Resend) and payments (Moyasar hosted invoices).
// Both are optional. Without keys, e-mail links are written to the server log outside production,
// and checkout answers «الدفع غير مفعّل بعد» instead of pretending to take money.
import { timingSafeEqual } from 'node:crypto';

export function createMailer(env = process.env) {
  const key = env.RESEND_API_KEY, from = env.MAIL_FROM;
  if (key && from) {
    return {
      configured: true,
      async send({ to, subject, html, text }) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, html, text }), signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error('mail provider answered ' + res.status);
        return { sent: true };
      },
    };
  }
  return {
    configured: false,
    async send({ to, subject, text }) {
      if (env.NODE_ENV !== 'production') console.log(`[mail:dev] to=${to} subject=${subject}\n${text}`);
      return { sent: false };
    },
  };
}

/** Moyasar hosted invoices: the buyer pays on Moyasar's page; card data never reaches this server. */
export function createGateway(env = process.env) {
  const key = env.MOYASAR_SECRET_KEY;
  const base = (env.MOYASAR_API_BASE || 'https://api.moyasar.com/v1').replace(/\/$/, '');
  const webhookSecret = env.MOYASAR_WEBHOOK_SECRET || '';
  if (!key) return { configured: false, name: 'none', checkWebhook: () => false };
  const auth = 'Basic ' + Buffer.from(key + ':').toString('base64');
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`moyasar ${method} ${path} → ${res.status} ${data?.message || ''}`.trim());
    return data;
  };
  return {
    configured: true, name: 'moyasar',
    async createInvoice(o) { const inv = await call('POST', '/invoices', o); if (!inv.id || !inv.url) throw new Error('moyasar invoice without id/url'); return { id: String(inv.id), url: inv.url, status: inv.status }; },
    async fetchInvoice(id) { const inv = await call('GET', '/invoices/' + encodeURIComponent(id)); return { id: String(inv.id), status: inv.status, amount: inv.amount, currency: inv.currency }; },
    /** The webhook carries the secret token configured in the Moyasar dashboard; compare in constant time. */
    checkWebhook(token) {
      if (!webhookSecret) return false;
      const a = Buffer.from(String(token || '')), b = Buffer.from(webhookSecret);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}
